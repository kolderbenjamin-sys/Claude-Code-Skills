#!/usr/bin/env python3
"""Klient pro Aktuality (Ticker) na Profifarmar.cz — červený běžící pruh na titulce.

Pásek drží maximálně 5 položek, každá má `label` (max 50 znaků) a `text`
(max 200 znaků). Skript umí pásek vypsat, přidat/upravit/smazat jednu položku
a hlavně `apply` — jedním krokem provede celou rotaci: zahodí prošlé, uvolní
místo smazáním nejstarších a doplní nové položky, aby v pásku bylo max 5
aktuálních zpráv.

Čtení jde přes veřejný endpoint /api/aktuality.php (bez tokenu).
Zakládání jde přes /api/aktuality_webhook.php (POST, `Authorization: Bearer $AI_API_KEY`).
Mazání a editace webhook neumí — jedou přes /api/admin/aktuality.php, který dnes
uznává jen admin session z prohlížeče. Dokud tam servisní klíč neprojde
(viz reference/api-patch.md), skript jen doplňuje do volných slotů a co je
potřeba smazat, vypíše k ručnímu úklidu v adminu.

Příklady:
    python3 ticker.py list
    python3 ticker.py check
    python3 ticker.py add --label "SUCHO" --text "ČHMÚ hlásí…"
    python3 ticker.py update --id 3 --text "Opravený text."
    python3 ticker.py delete --id 3
    python3 ticker.py apply --file navrh.json --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from zoneinfo import ZoneInfo

PUBLIC_URL = "https://profifarmar.cz/api/aktuality.php"      # GET, veřejné
WEBHOOK_URL = "https://profifarmar.cz/api/aktuality_webhook.php"  # POST, servisní klíč
ADMIN_URL = "https://profifarmar.cz/api/admin/aktuality.php"  # PUT/DELETE, zatím jen admin session

MAX_ITEMS = 5
LABEL_MAX = 50
TEXT_MAX = 200
# Redakční doporučení — LABEL_MAX/TEXT_MAX je jen horní hranice od API,
# ne cíl. Pásek se hýbe, takže vyhrává kratší a údernější znění.
LABEL_SOFT_MAX = 25    # 2–3 slova
TEXT_SOFT_MIN = 45
TEXT_SOFT_MAX = 130    # nad tím zpráva v běžícím pruhu ztrácí úder

PRAGUE = ZoneInfo("Europe/Prague")
TIMEOUT = 30

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NO_AUTH = 2


# --- pomocné ---------------------------------------------------------------


def log(msg: str) -> None:
    print(f"[TICKER] {msg}")


def die(msg: str, code: int = EXIT_ERROR) -> None:
    print(f"[TICKER] CHYBA — {msg}", file=sys.stderr)
    sys.exit(code)


def token() -> str:
    tok = os.environ.get("AI_API_KEY", "").strip()
    if not tok:
        die("AI_API_KEY není nastavena (u cloud Routine ji doplň v sekci Environment).")
    return tok


def repo_root() -> Path:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10, check=True,
        )
        return Path(out.stdout.strip())
    except Exception:
        return Path.cwd()


def now_prague() -> datetime:
    return datetime.now(PRAGUE)


def parse_created(value: str | None) -> datetime | None:
    """`created_at` chodí jako '2026-08-15 12:00:28.450233' v serverovém čase (Praha)."""
    if not value:
        return None
    raw = str(value).strip().replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=PRAGUE)
        except ValueError:
            continue
    return None


def normalize(text: str) -> str:
    """Pro porovnávání podobnosti — bez diakritiky, bez interpunkce, malá písmena."""
    stripped = "".join(
        ch for ch in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(ch) != "Mn"
    )
    return re.sub(r"[^a-z0-9 ]+", " ", stripped).strip()


def similar(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


# --- HTTP ------------------------------------------------------------------


def http(method: str, url: str, payload: dict | None = None, auth: bool = False) -> tuple[int, dict | list | None]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=True).encode("ascii")
        headers["Content-Type"] = "application/json; charset=utf-8"
    if auth:
        headers["Authorization"] = f"Bearer {token()}"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        status = exc.code
    except Exception as exc:  # síť, DNS, TLS
        die(f"{method} {url} selhalo: {exc}")

    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, {"error": body[:300]}


def fetch_items() -> list[dict]:
    """Aktuální obsah pásku, seřazený od nejnovějšího."""
    status, data = http("GET", PUBLIC_URL)
    if status != 200 or not isinstance(data, dict):
        die(f"nepodařilo se načíst pásek (HTTP {status}).")
    items = data.get("data") or []
    items.sort(key=lambda i: (parse_created(i.get("created_at")) or datetime.min.replace(tzinfo=PRAGUE)), reverse=True)
    return items


def create(label: str, text: str) -> dict:
    """Založí položku přes aktuality_webhook.php (POST, servisní klíč). Vrací uloženou položku."""
    status, data = http("POST", WEBHOOK_URL, {"label": label, "text": text}, auth=True)
    if status == 401:
        die("webhook odmítl AI_API_KEY (HTTP 401) — zkontroluj hodnotu klíče.", EXIT_NO_AUTH)
    if status not in (200, 201) or not isinstance(data, dict) or data.get("error"):
        detail = data.get("error") if isinstance(data, dict) else data
        die(f"POST na webhook skončil HTTP {status}: {detail}")
    return data.get("data") or {}


def mutate(method: str, payload: dict) -> bool:
    """PUT/DELETE přes admin endpoint. Vrací False, když tam servisní klíč neprojde."""
    status, data = http(method, ADMIN_URL, payload, auth=True)
    if status == 401:
        return False
    if status >= 400 or (isinstance(data, dict) and data.get("error")):
        detail = data.get("error") if isinstance(data, dict) else data
        die(f"{method} skončilo HTTP {status}: {detail}")
    return True


def can_mutate() -> bool:
    """Umí skript i mazat a upravovat? (Admin endpoint zatím chce session z prohlížeče.)"""
    status, _ = http("GET", ADMIN_URL, auth=True)
    return status == 200


# --- validace --------------------------------------------------------------


@dataclass
class Item:
    label: str
    text: str
    source: str = ""


def validate(label: str, text: str) -> list[str]:
    problems: list[str] = []
    if not label.strip():
        problems.append("label je prázdný")
    if not text.strip():
        problems.append("text je prázdný")
    if len(label) > LABEL_MAX:
        problems.append(f"label má {len(label)} znaků, limit je {LABEL_MAX}")
    if len(text) > TEXT_MAX:
        problems.append(f"text má {len(text)} znaků, limit je {TEXT_MAX}")
    if "\n" in label or "\n" in text:
        problems.append("nový řádek — pásek je jednořádkový, věty spoj mezerou")
    if re.search(r"<[^>]+>", label + text):
        problems.append("HTML tag — pásek zobrazuje čistý text")
    if re.search(r"https?://", text):
        problems.append("odkaz v textu — pásek není klikatelný")
    return problems


def warnings(label: str, text: str) -> list[str]:
    out: list[str] = []
    words = len(label.split())
    if len(label) > LABEL_SOFT_MAX or words > 3:
        out.append(f"label {len(label)} znaků / {words} slova — drž se 2–3 slov do {LABEL_SOFT_MAX} znaků")
    if label != label.upper():
        out.append("label není verzálkami (zbytek pásku je psaný VELKÝMI)")
    if len(text) > TEXT_SOFT_MAX:
        out.append(
            f"text {len(text)} znaků — zkrať pod {TEXT_SOFT_MAX}; limit {TEXT_MAX} je horní "
            "hranice od API, ne cíl"
        )
    if len(text) < TEXT_SOFT_MIN:
        out.append(f"text {len(text)} znaků — pod {TEXT_SOFT_MIN} působí útržkovitě")
    sentences = len([p for p in re.split(r"[.!?]+", text) if p.strip()])
    if sentences > 2:
        out.append(f"{sentences} věty — pásek unese jednu, výjimečně dvě")
    if not text.rstrip().endswith((".", "!", "%")):
        out.append("text nekončí tečkou")
    return out


# --- log -------------------------------------------------------------------


def log_path(arg: str | None) -> Path:
    return Path(arg) if arg else repo_root() / "posted-ticker-log.json"


def load_log(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        log(f"varování — {path.name} je poškozený, zakládám nový.")
        return []


def save_log(path: Path, entries: list[dict]) -> None:
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def recent_log(entries: list[dict], days: int) -> list[dict]:
    cutoff = now_prague() - timedelta(days=days)
    out = []
    for entry in entries:
        stamp = parse_created(entry.get("added_at"))
        if stamp is None or stamp >= cutoff:
            out.append(entry)
    return out


# --- příkazy ---------------------------------------------------------------


def cmd_list(args: argparse.Namespace) -> int:
    items = fetch_items()
    if args.json:
        print(json.dumps(items, ensure_ascii=False, indent=2))
        return EXIT_OK
    log(f"v pásku je {len(items)} z {MAX_ITEMS} položek")
    now = now_prague()
    for item in items:
        created = parse_created(item.get("created_at"))
        age = f"{(now - created).days} dní" if created else "?"
        print(
            f"  #{item.get('id')}  {item.get('label')}  "
            f"[label {len(item.get('label', ''))}/{LABEL_MAX}, "
            f"text {len(item.get('text', ''))}/{TEXT_MAX}, stáří {age}]"
        )
        print(f"      {item.get('text')}")
    return EXIT_OK


def cmd_check(args: argparse.Namespace) -> int:
    """Ověří obě cesty, aniž by cokoli založil."""
    # Prázdné tělo projde autorizací a spadne až na validaci — nic nevytvoří.
    status, data = http("POST", WEBHOOK_URL, {}, auth=True)
    if status == 401:
        log("zakládání NENÍ dostupné — webhook odmítl AI_API_KEY (HTTP 401).")
        return EXIT_NO_AUTH
    if status == 400:
        log("zakládání funguje — webhook klíč uznal (vrátil jen chybu validace).")
    else:
        log(f"zakládání — webhook vrátil neočekávané HTTP {status}: {data}")

    if can_mutate():
        log("mazání i editace fungují — admin endpoint uznává AI_API_KEY.")
        return EXIT_OK
    log("mazání a editace NEJSOU dostupné — /api/admin/aktuality.php chce admin session.")
    log("Skript proto jen doplňuje do volných slotů; úklid vypíše k ručnímu smazání v adminu.")
    log("Trvalé řešení: reference/api-patch.md.")
    return EXIT_OK


def report(label: str, text: str) -> None:
    problems = validate(label, text)
    if problems:
        die("položka neprošla kontrolou: " + "; ".join(problems))
    for warn in warnings(label, text):
        log(f"varování — {warn}")


def cmd_add(args: argparse.Namespace) -> int:
    report(args.label, args.text)
    items = fetch_items()
    if len(items) >= MAX_ITEMS:
        die(f"pásek je plný ({len(items)}/{MAX_ITEMS}). Nejdřív smaž nebo použij `apply`.")
    if args.dry_run:
        log(f"[dry-run] přidal bych: {args.label} — {args.text}")
        return EXIT_OK
    result = create(args.label, args.text)
    log(f"přidáno #{result.get('id', '?')}: {args.label} — {args.text}")
    return EXIT_OK


def cmd_update(args: argparse.Namespace) -> int:
    items = {str(i.get("id")): i for i in fetch_items()}
    current = items.get(str(args.id))
    if current is None:
        die(f"položka #{args.id} v pásku není. Aktuální id: {', '.join(items) or '—'}")
    label = args.label if args.label is not None else current.get("label", "")
    text = args.text if args.text is not None else current.get("text", "")
    report(label, text)
    if args.dry_run:
        log(f"[dry-run] upravil bych #{args.id} na: {label} — {text}")
        return EXIT_OK
    if not mutate("PUT", {"id": current.get("id"), "label": label, "text": text}):
        die(
            "editaci zatím nejde udělat programově — /api/admin/aktuality.php chce admin "
            "session. Uprav položku v adminu, nebo nasaď reference/api-patch.md.",
            EXIT_NO_AUTH,
        )
    log(f"upraveno #{args.id}: {label} — {text}")
    return EXIT_OK


def cmd_delete(args: argparse.Namespace) -> int:
    items = {str(i.get("id")): i for i in fetch_items()}
    current = items.get(str(args.id))
    if current is None:
        die(f"položka #{args.id} v pásku není. Aktuální id: {', '.join(items) or '—'}")
    if args.dry_run:
        log(f"[dry-run] smazal bych #{args.id}: {current.get('label')}")
        return EXIT_OK
    if not mutate("DELETE", {"id": current.get("id")}):
        die(
            "mazání zatím nejde udělat programově — /api/admin/aktuality.php chce admin "
            f"session. Smaž #{args.id} „{current.get('label')}“ v adminu, nebo nasaď "
            "reference/api-patch.md.",
            EXIT_NO_AUTH,
        )
    log(f"smazáno #{args.id}: {current.get('label')}")
    return EXIT_OK


def load_candidates(path: Path) -> list[Item]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        die(f"nelze načíst {path}: {exc}")
    if isinstance(raw, dict):
        raw = raw.get("items", [])
    if not isinstance(raw, list):
        die(f"{path} musí obsahovat seznam položek [{{label, text}}, …].")
    out = []
    for entry in raw:
        if not isinstance(entry, dict):
            die(f"{path}: každá položka musí být objekt s klíči label a text.")
        out.append(Item(
            label=str(entry.get("label", "")).strip(),
            text=str(entry.get("text", "")).strip(),
            source=str(entry.get("source", "")).strip(),
        ))
    return out


def cmd_apply(args: argparse.Namespace) -> int:
    """Rotace: prošlé pryč, nejstarší ustoupí novým, v pásku zůstane max 5."""
    candidates = load_candidates(Path(args.file))
    if not candidates:
        log("žádné navržené položky — pásek nechávám beze změny.")
        return EXIT_OK

    for cand in candidates:
        problems = validate(cand.label, cand.text)
        if problems:
            die(f"návrh „{cand.label}“ neprošel kontrolou: " + "; ".join(problems))
        for warn in warnings(cand.label, cand.text):
            log(f"varování u „{cand.label}“ — {warn}")

    current = fetch_items()
    logfile = log_path(args.log)
    history = load_log(logfile)
    seen = recent_log(history, args.dedupe_days)

    # 1) Zahodit návrhy, které v pásku (nebo nedávno v logu) už byly.
    fresh: list[Item] = []
    for cand in candidates:
        dup = next(
            (i for i in current if similar(i.get("text", ""), cand.text) >= args.similarity),
            None,
        )
        if dup:
            log(f"přeskakuji „{cand.label}“ — v pásku už běží #{dup.get('id')} {dup.get('label')}.")
            continue
        old = next((e for e in seen if similar(e.get("text", ""), cand.text) >= args.similarity), None)
        if old:
            log(f"přeskakuji „{cand.label}“ — stejná zpráva byla v pásku {old.get('added_at', '?')}.")
            continue
        if any(similar(f.text, cand.text) >= args.similarity for f in fresh):
            log(f"přeskakuji „{cand.label}“ — duplicita v rámci návrhu.")
            continue
        fresh.append(cand)

    if not fresh:
        log("všechny návrhy byly duplicitní — pásek nechávám beze změny.")
        return EXIT_OK

    # 2) Co by mělo z pásku ven: prošlé (starší než --max-age-days), pak nejstarší,
    #    aby se novinky vešly do pěti slotů.
    cutoff = now_prague() - timedelta(days=args.max_age_days)
    keep, expired = [], []
    for item in current:
        created = parse_created(item.get("created_at"))
        (expired if created and created < cutoff else keep).append(item)

    keep.sort(key=lambda i: (parse_created(i.get("created_at")) or datetime.min.replace(tzinfo=PRAGUE)), reverse=True)
    to_add = fresh[:MAX_ITEMS]
    if len(fresh) > MAX_ITEMS:
        log(f"návrhů je {len(fresh)}, pásek pojme {MAX_ITEMS} — beru prvních {MAX_ITEMS}.")
    room = MAX_ITEMS - len(to_add)
    evicted = keep[room:]
    keep = keep[:room]
    to_delete = expired + evicted

    # Pojistka: pásek nikdy nezůstane prázdný, když není čím nahradit.
    if not to_add and not keep and to_delete:
        log("nemám čím nahradit — prošlé položky nechávám v pásku.")
        to_delete = []

    # 3) Mazat umíme jen přes admin endpoint. Když neprojde, doplňujeme
    #    jen do volných slotů a zbytek necháme uživateli.
    deletable = can_mutate() if to_delete else True
    if to_delete and not deletable:
        free = MAX_ITEMS - len(current)
        log("mazání programově nejde — /api/admin/aktuality.php chce admin session.")
        log(f"Doplním proto jen do volných slotů (volno: {max(free, 0)}).")
        for item in to_delete:
            why = "prošlá" if item in expired else "nejstarší"
            log(f"  ! smaž ručně v adminu: #{item.get('id')} {item.get('label')} ({why})")
        to_delete = []
        to_add = to_add[:max(free, 0)]
        if not to_add:
            log("pásek je plný — bez ručního úklidu se nic nepřidá.")
            return EXIT_OK

    log(f"pásek: {len(current)} položek → smazat {len(to_delete)}, přidat {len(to_add)}")
    for item in to_delete:
        why = "prošlá" if item in expired else "uvolňuje místo"
        log(f"  − #{item.get('id')} {item.get('label')} ({why})")
    for cand in to_add:
        log(f"  + {cand.label} — {cand.text}")

    if args.dry_run:
        log("[dry-run] nic jsem neodeslal.")
        return EXIT_OK

    for item in to_delete:
        if not mutate("DELETE", {"id": item.get("id")}):
            die(f"mazání #{item.get('id')} selhalo uprostřed rotace — zkontroluj pásek.", EXIT_NO_AUTH)
    stamp = now_prague().strftime("%Y-%m-%d %H:%M:%S")
    for cand in to_add:
        saved = create(cand.label, cand.text)
        history.append({
            "id": saved.get("id"),
            "label": cand.label,
            "text": cand.text,
            "source": cand.source,
            "added_at": stamp,
        })

    save_log(logfile, history)
    final = fetch_items()
    log(f"hotovo — v pásku je {len(final)} položek, log: {logfile}")
    return EXIT_OK


# --- CLI -------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Aktuality (Ticker) na Profifarmar.cz")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="vypíše aktuální obsah pásku")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("check", help="ověří, že admin endpoint uznává AI_API_KEY")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("add", help="přidá jednu položku")
    p.add_argument("--label", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("update", help="upraví existující položku")
    p.add_argument("--id", required=True)
    p.add_argument("--label")
    p.add_argument("--text")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("delete", help="smaže položku")
    p.add_argument("--id", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_delete)

    p = sub.add_parser("apply", help="rotace pásku podle JSON návrhu")
    p.add_argument("--file", required=True, help="JSON se seznamem [{label, text, source}]")
    p.add_argument("--max-age-days", type=int, default=6,
                   help="starší položky se zahodí (výchozí 6 — o den míň než týdenní perioda, "
                        "aby minulá dávka při nedělním běhu vždy propadla)")
    p.add_argument("--dedupe-days", type=int, default=14, help="jak dlouho zpět se hlídá duplicita (výchozí 14)")
    p.add_argument("--similarity", type=float, default=0.75, help="práh podobnosti pro duplicitu (0–1)")
    p.add_argument("--log", help="cesta k posted-ticker-log.json")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_apply)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
