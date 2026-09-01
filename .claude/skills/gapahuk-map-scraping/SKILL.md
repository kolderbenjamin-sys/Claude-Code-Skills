---
name: gapahuk-map-scraping
description: >-
  Ověřuje přístřešky na přespání v aplikaci GAPAHUK podle online zdrojů (Mapy.com, OSM, weby
  správců, Google Maps), píše chybějící popisy a doplňuje fotky z Wikimedia Commons přes agentní
  API aplikace. Použij vždy, když uživatel chce "ověř přístřešky", "zkontroluj stav přístřešků",
  "projeď frontu GAPAHUK", "spusť agenta na gapahuk", "doplň popisy k přístřeškům", "napiš popisy
  přístřešků", "doplň fotky k přístřeškům", "zkontroluj kandidáty", "otrioduj kandidáty",
  "aktualizuj údaje o útulnách", "překontroluj fotky". Trigger keywords: gapahuk map scraping, map
  scraping, gapahuk, přístřešek, útulna, fronta úkolů, agentní API, doplnit popis přístřešku,
  doplnit fotky přístřešků, ověření stavu přístřešku, Mapy.com recenze, staleDays,
  missing=description, missing=photos.
---

# GAPAHUK — map scraping: ověřování přístřešků, popisy a fotky

## K čemu skill je

- GAPAHUK je mapa přístřešků vhodných k **přespání** v ČR (schválená místa + kandidáti z OpenStreetMap).
- Jeden běh agenta: **ověří** existenci a stav záznamů, **napíše chybějící popis** podle Mapy.com a dalších zdrojů, **doplní 1–2 fotky** tam, kde chybí, a vše **zapíše zpět** s poznámkou a zdroji.
- **Dvourychlostní důvěra ke zdrojům.** Popisná pole (`description`, `capacity`, `walls`, vybavení) smí vzniknout i z jediného dobrého zdroje — typicky z karty a recenzí na Mapy.com. Rozhodovací pole (`condition`, `status`) potřebují potvrzení druhým zdrojem, protože přepisují stav nebo přístřešek schovají z mapy.
- Každý zápis je auditovaný; správce ho vidí v `/admin/agenti` a může ho vrátit.
- **Pravidlo projektu:** cílem jsou jen místa vhodná k PŘESPÁNÍ. Posezení se stříškou, altán, zastávka MHD = `status: "rejected"`.
- **Jeden běh = jedna dávka.** Po zapsání poslední části napiš report a skonči, i když `remaining > 0`.

---

## 0. Předpoklady — projdi PŘED prvním dotazem

### Nejdřív zjisti, KDE běžíš

Skill běží ve dvou prostředích a liší se v tom, co je dostupné i co smíš udělat. Zjisti to jedním blokem a výsledek si drž do konce běhu:

```bash
uname -s 2>/dev/null || echo Windows
node --version 2>/dev/null || echo NO-NODE
command -v jq >/dev/null 2>&1 && echo JQ-OK || echo NO-JQ
[ -n "$AGENT_TOKEN" ] && echo TOKEN-Z-ENV || echo TOKEN-NENI-V-ENV
```

| | **Lokálně** (Claude Code u uživatele) | **Cloud Routine** (claude.ai/code/routines) |
|---|---|---|
| OS | Windows + Git Bash, nebo macOS/Linux | Linux kontejner |
| Uživatel | je u toho, můžeš se zeptat | **nikdo tam není — nikdy se neptej** |
| Token | `.env.local` projektu | proměnná v sekci Environment routine |
| `jq` | často chybí | bývá |
| Prohlížeč (Mapy.com, Google) | **k dispozici** | **zjisti detekcí**, nepředpokládej |
| Síť ven | bez omezení | **proxy s výchozím allowlistem domén** |
| Report | do chatu | poslední výstup běhu → run summary |

- **Nikdy nepředpokládej `jq` ani jeho absenci** — detekuj. Není-li, parsuj Node (v22+).
- **Kanonická cesta = malý Node klient** (viz „Klient" níže). Těla požadavků piš do souborů a posílej odtud — vyhneš se problémům s diakritikou a escapováním v shellu.
- **Windows + Git Bash přepisuje argumenty, které vypadají jako unixová cesta**, na windowsové. `get "/api/agent/shelters/16618"` proto skončí na `ENOTFOUND gapahuk.vercel.appc` — a je to matoucí, protože volání fronty (mají v URL `?`) se nepřevádějí a fungují. Před prvním voláním nastav:
  ```bash
  export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
  ```
  Na Linuxu i macOS jsou ty proměnné bez efektu, takže je nastav vždy.
- **Dočasné soubory:** lokálně scratchpad session, v cloudu `${TMPDIR:-/tmp}/gapahuk`. **Nikdy nezapisuj do repozitáře** — v cloudu by se to snažilo commitnout.

Celý start běhu (nastav jednou, pak už jen používej `"$SCRATCH/…"`):

```bash
export SCRATCH="${CLAUDE_SCRATCHPAD:-${TMPDIR:-${TEMP:-/tmp}}/gapahuk}"
mkdir -p "$SCRATCH"
# Windows/Git Bash: node je nativní binárka a "/tmp" by četl jako "C:\tmp" — převeď na nativní cestu
command -v cygpath >/dev/null 2>&1 && SCRATCH="$(cygpath -m "$SCRATCH")"
export SCRATCH
export GAPAHUK_URL="${GAPAHUK_URL:-https://gapahuk.vercel.app}"
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
GAPAHUK_DIR="${GAPAHUK_DIR:-$HOME/Claude-Workspace/Dev/GAPAHUK}"
if [ -z "$AGENT_TOKEN" ] && [ -f "$GAPAHUK_DIR/.env.local" ]; then
  export AGENT_TOKEN=$(sed -n 's/^AGENT_TOKEN=//p' "$GAPAHUK_DIR/.env.local" | tr -d '"\r')
fi
[ -n "$AGENT_TOKEN" ] || { echo "AGENT_TOKEN chybi - lokalne .env.local projektu, v cloudu Environment routine"; exit 1; }
```

> Proměnné se mezi voláními Bash **nedrží** — tenhle blok zopakuj na začátku každého bloku, ve kterém voláš API.

### Co v cloudu ověřit, než se rozhodneš

**Nehádej, co v cloudu je a co ne — zjisti to na začátku běhu.** O tom, co má smysl dělat, rozhodují dvě věci:

**1. Máš prohlížečové nástroje?** Podívej se, co je v session opravdu dostupné.

- `mcp__claude-in-chrome__*` řídí **skutečný Chrome uživatele** — ve vzdáleném kontejneru nebude.
- Prohlížeč zabudovaný v Claude Code je nástroj harnessu, ne uživatelův Chrome — **v cloudu běžně funguje** a v routine tohoto projektu se s ním počítá. Na začátku si ověř, že ho v session opravdu máš, ale neplánuj běh dopředu tak, jako by chyběl.

**2. Pustí tě síť ven?** Claude Code na webu i routine běží v izolované VM, kde **proxy vynucuje výchozí allowlist domén**. Co v něm není, se nedovolá — ani `curl`, ani WebFetch, ani prohlížeč. Ověř to jedním blokem, ne až u desátého záznamu:

```bash
for D in gapahuk.vercel.app api.openstreetmap.org overpass-api.de commons.wikimedia.org; do
  curl -s -o /dev/null -m 15 -w "$D %{http_code}\n" "https://$D" || echo "$D NEDOSTUPNA"
done
```

Domény, které skill potřebuje — do síťové konfigurace routine patří všechny:

| Doména | K čemu |
|---|---|
| `gapahuk.vercel.app` | agentní API — bez ní běh nemá smysl vůbec |
| `api.openstreetmap.org`, `www.openstreetmap.org`, `overpass-api.de` | OSM tagy, historie, hledání podle jména |
| `commons.wikimedia.org`, `upload.wikimedia.org` | fotky a ověření licencí |
| `mapy.com`, `api.mapy.com` | karta a recenze (má smysl jen s prohlížečem) |
| weby správců, spolků a obcí | **nejde vyjmenovat dopředu** — kaskáda míří na libovolné domény, proto je allowlist routine tohohle projektu nastavený otevřeně. Potvrď si to kontrolním blokem výše; kdyby přesto něco selhalo, zdroj přeskoč a napiš to do reportu. |

**Co platí vždy, bez ohledu na prostředí:** Mapy.com ani Google nemají veřejné API na recenze. `curl` i WebFetch na ně vrátí prázdný JS shell — jdou jen přes prohlížeč. `api.mapy.com/v1/geocode` umí dohledat pouze název POI. **Nevymýšlej si recenze a nepiš do `note`, že jsi je četl.**

### Volba typu běhu podle toho, co máš

Rozhoduj podle **výsledku detekce**, ne podle toho, jestli běžíš lokálně nebo v cloudu.

| Typ běhu | S prohlížečem | Bez prohlížeče |
|---|---|---|
| Doplňování fotek (`missing=photos`) | ✅ | ✅ celé přes Commons API |
| Triáž kandidátů (`status=candidate`) | ✅ | ✅ o většině rozhodnou OSM tagy |
| Doplňování popisů (`missing=description`) | ✅ nejlepší | ⚠️ jen objekty s dohledatelným správcem |
| Přeověření stavu (`staleDays=180`) | ✅ | ⚠️ bez recenzí často skončí razítkem |
| Re-check fotek | ✅ | ✅ |

- **Nemáš-li prohlížeč a nikdo ti neurčil typ běhu, volej `missing=photos` nebo `status=candidate`** — ty dva o nic nepřijdou.
- Máš-li výslovné zadání na popisy i bez prohlížeče, běh proveď, ale v reportu uveď, **kolik záznamů skončilo bez popisu** a proč.
- **Popisy jde psát i bez recenzí.** U objektů, které někdo oficiálně postavil nebo zdokumentoval (Lesy ČR, KČT, Via Czechia, obce), bývá dokumentace správce bohatší než recenze — projekt, rozměry, vybavení, pravidla přespání. U bezejmenného objektu bez dohledatelného správce popis většinou nenapíšeš: zapiš razítko ověření a jdi dál.

### Cílový server (kritické)

- **Výchozí cíl je produkční doména** `https://gapahuk.vercel.app`. Je-li v prostředí `GAPAHUK_URL`, má přednost.
- `http://localhost:3000` použij **jen na výslovné přání uživatele a nikdy v cloudu**. Bez `DATABASE_URL` běží lokálně souborová PGlite v `.data/pglite` — zápisy se na veřejné mapě nikdy neprojeví. Takový běh v reportu označ: „testovací běh, data nejdou na web".
- **Sanity check před prvním zápisem:**
  - `GET /api/agent/tasks?limit=1&status=approved&staleDays=1` → `remaining` řádově **stovky**,
  - `…&status=candidate&staleDays=1` → řádově **tisíce**.
  - Nesedí-li řád: **lokálně se zeptej uživatele, v cloudu běh ukonči** a napiš proč. Nejspíš míříš do prázdné lokální DB.

### Token a přístup

- Token ber **z prostředí** (`AGENT_TOKEN`). Není-li tam, vezmi ho z `.env.local` projektu GAPAHUK. V cloudu `.env.local` neexistuje (je v `.gitignore`) — tam ho nastav v sekci **Environment** routine.
- **Skill je globální a nespouští se nutně v adresáři projektu** (klidně z jiného chatu nebo jiného repa). Nikdy proto nesahej na `.env.local` relativní cestou — použij `GAPAHUK_DIR`:
  ```bash
  GAPAHUK_DIR="${GAPAHUK_DIR:-$HOME/Claude-Workspace/Dev/GAPAHUK}"
  if [ -z "$AGENT_TOKEN" ] && [ -f "$GAPAHUK_DIR/.env.local" ]; then
    export AGENT_TOKEN=$(sed -n 's/^AGENT_TOKEN=//p' "$GAPAHUK_DIR/.env.local" | tr -d '"\r')
  fi
  [ -n "$AGENT_TOKEN" ] || { echo "AGENT_TOKEN chybi - lokalne .env.local projektu, v cloudu Environment routine"; exit 1; }
  ```
- Běh **nepotřebuje repozitář** — všechno jde přes HTTP API. Adresář projektu je jen zdroj tokenu.
- **Token nikdy nevypisuj** do reportu, logu ani do souborů ve scratchpadu.
- Hlavičky každého volání: `X-Agent-Token: <token>` (nebo `Authorization: Bearer <token>`) + `X-Agent-Name: gapahuk-verifier` + `Content-Type: application/json`.
- Stálé jméno se propíše do auditu jako `agent:gapahuk-verifier` a je vidět u každého zásahu. Správce ale **vrací zásahy po jednom** a v `/admin/agenti` vidí **jen posledních 50** záznamů — proto piš `note` tak, aby se zásah dal posoudit samostatně.
- **S agentním tokenem funguje jen `/api/agent/*`.** Celá aplikace je v předdeploy režimu za Basic Auth, takže `links.detail` (`/pristresek/{id}`), `links.map` i `/api/shelters/{id}` vrátí prostý text 401 „Přihlášení vyžadováno". **Neotvírej je** — nejsou to chyby běhu.

### Prohlížečové nástroje

- Mapy.com i Google Maps jsou JS aplikace: `curl`/WebFetch vrátí prázdný shell **bez recenzí**.
- Čti je jen přes prohlížeč (`mcp__claude-in-chrome__navigate` + `get_page_text`, nebo prohlížečový panel aplikace, případně computer-use).
- **Ověř dostupnost prohlížeče PŘED vyžádáním dávky**, ne až u třetího záznamu. Není-li: lokálně to řekni uživateli a nabídni jiný typ běhu, jinak se řiď tabulkou „Volba typu běhu podle toho, co máš" výše.
- Nejsou-li prohlížečové nástroje k dispozici, tyto kroky kaskády **vynech** a napiš to do `note` („Mapy.com/Google v tomto běhu nedostupné").
- **Necituj recenzi ani datum, které jsi ve skutečném textu stránky neviděl.** Vymyšlená citace v `note` je horší než `unknown`.
- Narazíš-li na CAPTCHA nebo blokaci automatizovaného přístupu, zdroj přeskoč, napiš to do reportu a **neobcházej ji**.

### Klient (napiš jednou na začátku běhu)

```js
// $SCRATCH/gapahuk.mjs   — spouštěj: node "$SCRATCH/gapahuk.mjs" <cmd> …
import fs from "node:fs";
const BASE = process.env.GAPAHUK_URL, TOKEN = process.env.AGENT_TOKEN;
if (!BASE || !TOKEN) { console.error("Chybí GAPAHUK_URL nebo AGENT_TOKEN"); process.exit(1); }
const H = { "X-Agent-Token": TOKEN, "X-Agent-Name": "gapahuk-verifier", "Content-Type": "application/json" };
const [cmd, a, b] = process.argv.slice(2);
const file = (f) => fs.readFileSync(f, "utf8");
async function call(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: H });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { raw: t.slice(0, 300) }; }
  console.log(JSON.stringify({ status: r.status, body }, null, 1));
  if (!r.ok) process.exitCode = 1;
}
if (cmd === "get") await call(a);
else if (cmd === "patch") await call(`/api/agent/shelters/${a}`, { method: "PATCH", body: file(b) });
else if (cmd === "batch") await call("/api/agent/shelters/batch", { method: "POST", body: file(a) });
else if (cmd === "create") await call("/api/agent/shelters", { method: "POST", body: file(a) });
else console.error("get <path> | patch <id> <file> | batch <file> | create <file>");
```

```bash
export GAPAHUK_URL="${GAPAHUK_URL:-https://gapahuk.vercel.app}"   # localhost jen na výslovné přání
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'                 # jen Windows/Git Bash, jinde bez efektu
node "$SCRATCH/gapahuk.mjs" get "/api/agent" > "$SCRATCH/manifest.json"
```

---

## 1. Vezmi si JEDNU dávku

- Fronta je seřazená: **nikdy neověřené první**, pak nejstarší ověření, pak podle `id`. Nevymýšlej si vlastní pořadí.
- Stáhni dávku **jednou** a pracuj z ní. Dokud nezapíšeš, záznamy z fronty nemizí.
- `remaining` = kolik záznamů celkem odpovídá filtru → do reportu jako „zbývá ve frontě".
- Další dávku si vyžádej **až po zapsání** té předchozí — lokálně jen když k tomu vyzve uživatel, **v cloudu nikdy** (jeden běh = jedna dávka, pak report a konec).

| Typ běhu | Dotaz | Dávka |
|---|---|---|
| **Doplňování popisů** (výchozí, neřekne-li uživatel jinak) | `?limit=10&status=approved&missing=description&staleDays=1` | 10 |
| Běžné přeověření | `?limit=20&status=approved&staleDays=180` | 20 |
| Doplňování fotek | `?limit=10&status=approved&missing=photos&staleDays=1` | 10 |
| Triáž kandidátů | `?limit=25&status=candidate&staleDays=180` | 25 |
| Jeden region | `?limit=20&bbox=13.2,48.9,14.1,49.4` | 20 |
| Chybí kapacita | `?limit=20&missing=capacity` | 20 |
| Re-check fotek | ruční výběr `id` z minulých běhů (viz „Re-check fotek") | 10 |

- **Běh na popisy je pomalý** — na jeden záznam padne otevření karty na Mapy.com, přečtení recenzí a často i OSM. Proto dávka **10**, ne 20. Radši deset konkrétních popisů než dvacet vět „přístřešek u lesní cesty".

- Jedno volání vrátí **nejvýš `limit`** záznamů (strop API 100). Sloupec „dávka" = `limit`.
- **`staleDays=0` nefunguje** — API ho kvůli `parseInt(...) || 180` tiše převede na 180. Pro čerstvě ověřené použij `staleDays=1`.
- **Foto-fronta je vždy zároveň filtrovaná stářím ověření**: `missing=photos` = prázdné `photos` **AND** (nikdy neověřeno NEBO ověřeno dřív než před `staleDays` dny). Bez `staleDays=1` uvidíš prázdno u záznamů, které jsi ověřil minule — a budeš si myslet, že jsou fotky hotové.
- `missing=description` filtruje přes `IS NULL`, prázdný řetězec se ve frontě neobjeví.
- **`staleDays` skrývá čerstvě ověřené záznamy, i když jsou jinak prázdné.** Import a enrichment nastavují `verifiedAt` na čas svého běhu, takže stovky záznamů mohou být „ověřené dnes" a ve frontě nebudou. Pro dávkový běh je to správně — pro hledání konkrétního přístřešku ne (viz níže).

### Najdi jeden konkrétní přístřešek

Fronta na to není stavěná: neumí hledat podle jména a `staleDays` ti čerstvě ověřené záznamy schová. Postup:

1. **Zjisti souřadnice z OSM** (Overpass podle jména a okolí obce), ne odhadem z mapy.
2. **Vyžádej si úzký `bbox` kolem nich se `staleDays=-1`.** Záporná hodnota projde přes `parseInt` a filtr stáří tím fakticky vypneš — vrátí se i záznam ověřený před hodinou. (`staleDays=0` nefunguje, spadne na 180.)
3. Projdi **`approved`, `candidate` i `rejected`** — nevíš předem, ve kterém stavu záznam je.

```bash
BBOX="18.74,49.66,18.80,49.70"   # minLng,minLat,maxLng,maxLat
for ST in approved candidate rejected; do
  node "$SCRATCH/gapahuk.mjs" get "/api/agent/tasks?limit=100&status=$ST&staleDays=-1&bbox=$BBOX"
done
```

- **`staleDays=-1` používej jen na cílené dohledání**, nikdy na dávkový běh — vracel by ti i to, cos ověřil před chvílí, a běhy by se točily dokola.
- Nenajdeš-li záznam ani takhle, teprve pak zvaž, že v DB opravdu není — a i pak platí „nezakládej nové přístřešky pro jistotu".

```bash
node "$SCRATCH/gapahuk.mjs" get "/api/agent/tasks?limit=20&status=approved&staleDays=180" > "$SCRATCH/tasks.json"
node -e "const d=JSON.parse(require('fs').readFileSync(process.env.SCRATCH+'/tasks.json','utf8')).body; \
console.log(d.remaining, d.returned, d.tasks.map(t=>t.id).join(','))"
```

---

## 2. Zpracuj záznamy

- **Nejdřív si přečti, co je v záznamu:** `name`, `type`, `status`, `condition`, `capacity`, `description`, `walls`, `photos`, `sources`, `osmTags`, `elevation`, `verifiedAt`, `verifiedBy` a hlavně **`verificationNote`**.
  - `verificationNote` = poznámka z minulého ověření. Napsal-li minulý běh „fotku se nepodařilo dohledat", zkus **jen jednu novou cestu** (jiný poloměr, jiný název) a jdi dál.
  - Popíráš-li svým zjištěním závěr minulého běhu, napiš v `note` **explicitně proč**.
- **Rozpočet:** ~3–4 načtení stránky na ověření, ~4–5 na napsání popisu (karta na Mapy.com, recenze, OSM), ~5–6 na hledání fotky. Když nic nenajdeš, nepokračuj do nekonečna — zapiš poctivou poznámku a jdi dál.
- Sporné případy: cíleně `GET /api/agent/edits?shelterId={id}&limit=10`. Vidíš-li `actor: "human"` nebo `action: "revert"`, **neopakuj dřívější změnu agenta** — dej to do reportu k ruční kontrole.
- Veď běhový log `"$SCRATCH/beh-<datum>.json"` (`id`, výsledek, co změněno) — proti dvojímu zpracování a pro report.

---

## 3. Zapisuj průběžně

- **Po každých ~10 zpracovaných záznamech** pošli batch. Když běh spadne, o hotovou práci nepřijdeš.
- `POST /api/agent/shelters/batch` — běžná pole (`condition`, `capacity`, `fireplace`, `type`, `status`). Max **50** položek, děl po 20.
- `PATCH /api/agent/shelters/{id}` — citlivé změny (`description`, `status: "rejected"`, **fotky**). Odpověď je **surový DB řádek** (bez `links`), ale obsahuje uložené `photos` — použij ji na kontrolu.
- Batch vrací **HTTP 200 i při částečném selhání** — vždy čti `applied`, `failed`, `results`. Neúspěšné položky zůstávají ve frontě.

**Nutné minimum každého zápisu:**

1. `note` — jedna věta česky, min. 3 znaky: co jsi zjistil a odkud,
2. `sources` — aspoň jeden `http(s)` odkaz, **který jsi skutečně otevřel** (server je slučuje se stávajícími, max 10),
3. **aspoň jedno další datové pole** — jinak API vrátí „Žádná změna dat".

**Orazítkování bez nálezu (pozor, tady se dřív ničila data):**

- API nastaví `condition` **na to, co pošleš**, bez ohledu na předchozí hodnotu. Poslat `"unknown"` k záznamu, který měl `ok`, znamená degradovat ho na „Neznámý stav".
- **Vždy pošli stávající hodnotu `condition` z `tasks.json`** — i `null` (klíč v setu stačí, validace „Žádná změna dat" projde).
- `"unknown"` posílej jen když stávající hodnota už je `null`/`unknown`, nebo když jsi rozpor skutečně zjistil.

---

## 4. Konec běhu

- Dochází-li kontext nebo čas: **okamžitě zapiš, co máš**, a udělej report z rozpracované dávky.
- Nedokončený běh bez zápisu = veškerá práce ztracená, záznamy se příště objeví znovu.
- **Po odeslání poslední dávky běh KONČÍ**, i když `remaining > 0`. Další dávku bere až další spuštění skillu.

---

## Metodika ověřování

Cíl: doložitelně odpovědět — *existuje? v jakém je stavu? je to místo na spaní? co se o něm dá napsat člověku, který zvažuje, že tam půjde spát?* Není-li odpověď doložitelná, **nezapisuje se hodnota, zapisuje se poznatek**.

### Navázání zdroje na místo

- **Každý zdroj musí sedět na `lat`/`lng`**, ne jen na jméno: do ~50 m = totéž místo; 50–150 m = ověř druhým znakem (název, typ, okolí); nad 150 m = jiné místo, zdroj nepoužívej.
- Orientaci v terénu dělej přes `links.osm` a OSM data.
- **`links.staticMap` je placené Mapy.com Static API** (4 kredity/dotaz z kvóty aplikace) a URL obsahuje `apikey`. Otevírej ho **jen výjimečně u sporné polohy**, ne rutinně. **Nikdy ho nedávej do `sources`** (uložil by se klíč do DB i do auditu) a **nestahuj ho do scratchpadu**.

### Pořadí zdrojů (kaskáda)

**Kaskáda se liší podle toho, co zapisuješ.** Popisná pole snesou jeden dobrý zdroj, rozhodovací pole ne.

| Zapisuješ | Kolik zdrojů stačí |
|---|---|
| `description`, `capacity`, `walls`, `fireplace`, `waterNearby`, `hasDoor` | **jeden doložitelný zdroj** — typicky karta a recenze na Mapy.com |
| `condition` jiná než stávající hodnota, `status` (`approved` ↔ `rejected`) | **dva nezávislé zdroje**, nebo jeden datovaný a jednoznačný (web správce, OSM historie s `visible=false`) |

Po každém kroku se ptej: *mám dost na zápis?* Pokud ano, zbytek přeskoč.

| # | Zdroj | Co z něj brát | Váha |
|---|---|---|---|
| 1 | **Mapy.com — karta, recenze, fotky** (`links.mapy`) | popis místa a okolí, vybavení, kapacita a stav z datovaných českých recenzí lidí, kteří tam spali; vzhled stavby z fotek **jen jako vodítko** (viz „Doplňování fotek") | **primární pro popisná pole**, potvrzující pro stav |
| 2 | **OSM tagy** (`osmTags`, `links.osm`) | `shelter_type`, `building`, `capacity`, `material`, `roof:material`, `fireplace`, `drinking_water`, `door`, `name`, `operator`, `description`, `check_date` | vysoká pro typ a vybavení, nízká pro stav |
| 3 | **Weby správců a spolků** — Lesy ČR, obce, mikroregiony, KČT, treking.cz, hiking.cz, turistické a trampské weby | oprava, uzavření, zbourání; pravidla přespání, kapacita, historie | **nejvyšší pro fakta i stav** |
| 4 | **OSM historie** | kdy byl objekt naposledy potvrzen, zda byl smazán / přeznačen | vysoká, ale jen podle pravidla níže |
| 5 | **Google Maps** — karta, recenze, Street View | druhý nezávislý proud recenzí | potvrzující |
| 6 | **Wikipedie / Wikimedia Commons** (`links.commonsSearch`) | fakta u pojmenovaných útulen + **legální fotky** | vysoká pro fakta, nízká pro aktuálnost |
| 7 | **Fulltext** (`"<název>" útulna přespání`, `"<název>" přístřešek zbořen`, název + obec) | fóra, blogy z výletů, příspěvky spolků | nízká–střední, u malých objektů často jediný |

- **Mapy.com jdou první, ale nejsou samospásné.** Bezejmenné objekty tam kartu nemají → nezdržuj se a pokračuj krokem 2. Prázdná nebo neexistující karta **není** důkaz neexistence.
- **Na změnu `condition` nebo `status` Mapy.com samy nestačí.** Dohledej krok 3 nebo 4. Bez potvrzení nech stávající hodnotu a rozpor napiš do `note` — popisná pole přitom zapiš normálně.
- **Nikdy nezačínej fulltextem** — bez OSM kontextu nepoznáš, jestli nález patří k tvým souřadnicím.
- **Do `sources` patří jen URL, které jsi skutečně otevřel.** Pro Mapy.com používej **výhradně hodnotu `links.mapy` z odpovědi API zkopírovanou 1:1** — short-linky `mapy.com/s/…` vznikají jen kliknutím ve webové mapě a nelze je zkonstruovat. Nikdy si URL nevymýšlej.

**OSM historie — konkrétně:**

- `https://www.openstreetmap.org/{type}/{id}/history` nebo API `https://api.openstreetmap.org/api/0.6/{type}/{id}/history.json`.
- U ručně založených záznamů je `links.osm` **`null`** — krok vynech.
- **Smazání v OSM je důkaz jen tehdy, když v historii vidíš verzi s `visible=false` a její changeset komentář.** Prázdná stránka, 404 nebo nedostupné API **důkaz nejsou** — z toho nikdy nedělej `destroyed`.

### Právní hranice u Mapy.com a Google Maps

Mapy.com jsou teď primární zdroj popisů, takže tahle hranice platí **víc**, ne míň.

- Slouží **jen jako informace k přečtení**. Do databáze smí vstoupit **pouze poznatek shrnutý vlastními slovy**.
- **Zakázáno:** doslovný citát recenze, doslovný text karty místa, převzatý název POI (`name` ber jen z OSM nebo z oficiálního webu), jakákoli fotka či panorama.
- **Neukládej si z nich NIC** — ani screenshot, ani soubor ve scratchpadu, ani doslovný text. Jen přečti a shrň.
- Pole `description` (5000 znaků) svádí k opisování — piš vlastní shrnutí.
- **Test před zápisem:** poznal by autor recenze v tvém `description` svoje věty? Pak jsi opisoval. Popis musí být tvoje shrnutí faktů, ne přeskládaná cizí formulace.

### Jak napsat `description`

Hlavní výstup běhu na popisy. Popis čte člověk, který zvažuje, jestli tam dojde spát — piš pro něj.

**Struktura (2–5 vět, zhruba 200–600 znaků):**

1. **Co to je a kde** — typ stavby, materiál, poloha v terénu („Otevřený dřevěný přístřešek na hraně mýtiny nad soutokem…").
2. **Jak se v tom spí** — pryčna, lavice, rovná podlaha, kolik lidí, jak je místo chráněné před větrem a deštěm.
3. **Vybavení v okolí** — ohniště, stůl, voda, dřevo, a jak daleko.
4. **Na co si dát pozor** — blízká silnice nebo hospoda, frekventované místo, zamykání, zákazy, sezónnost.
5. **Vývoj v čase**, je-li doložený — „střecha opravena 2024".

**Pravidla:**

- **Piš jen to, co máš z konkrétního zdroje.** Nemáš-li o vodě nic, o vodě nepiš — nevymýšlej ani „voda v okolí není".
- **Bez marketingu a bez hodnocení.** Ne „kouzelné místo s úžasným výhledem", ale „výhled na údolí Vltavy". Hvězdičky a emoce z recenzí do popisu nepatří.
- **Datuj, co je datovatelné.** „Podle recenzí z léta 2025 sucho a čisto" je lepší než „je tam čisto".
- **Rozpory neschovávej** — „starší recenze zmiňují zatékání, novější (2025) opravenou střechu".
- **Nepřepisuj vyplněný `description`** bez prokazatelně novější a lepší informace; jinak **přidej větu** na konec.
- Nemáš-li na popis dost ani po celé kaskádě, `description` **nezapisuj** a do `note` napiš, co jsi zkusil.

**Špatně / dobře:**

| Špatně | Proč | Dobře |
|---|---|---|
| „Krásný přístřešek, doporučuji." | hodnocení, nulová informace | „Otevřený přístřešek s pryčnou pro 3–4 lidi, zadní a boční stěny z klád." |
| „Přístřešek u lesní cesty." | prázdné, platí o polovině databáze | „Přístřešek u lesní cesty asi 300 m od rozcestí Pod Klínem, ohniště s lavicemi před ním." |
| „Super místo, byli jsme tu 3× a vždy sucho a klid!" | opsaná recenze i s emocemi | „Recenze z let 2023–2025 se shodují, že uvnitř zůstává sucho." |
| „Voda ani ohniště tu nejsou." (nikde nedoloženo) | domněnka vydávaná za fakt | (nepsat nic; do `note`: „o vodě a ohništi jsem nic nenašel") |

### Jak číst `condition` z recenzí

Recenze čti **s datem**. Nejnovější věta o stavu přebíjí starší; nedatovaná věta je slabý signál.

- **`ok`** — funkční, suché, použitelné k přespání: „přespali jsme ve dvou, sucho", „loni opravená střecha", „trochu tam táhne, ale super nocleh" (nepohodlí ≠ poškození), „uvnitř nepořádek, jinak v pohodě".
- **`damaged`** — stojí, ale konstrukce narušená: zatéká do střechy, chybí prkna v bočnici, prohnilá podlaha, ohořelá stěna, ulomená část střechy.
- **`destroyed`** — objekt fyzicky neexistuje nebo neplní funkci: „už tam není, zbyly patky", „shořelo", „Lesy ČR odstranily kvůli těžbě", „střecha spadla dovnitř, spát se v tom nedá".
  - „Marně jsme to hledali, je tam jen mýtina" = **slabý signál**. Potvrď druhým zdrojem nebo smazáním v OSM (podle pravidla výše), jinak `unknown` + poznámka.
  - `condition: "destroyed"` posílej **spolu s** `status: "rejected"`.
- **NENÍ signál stavu:** hvězdičky bez textu, emoce, nároky na komfort, počasí, komáři, hluk (leda do `description`).

### Jak poznat pouhé posezení → `status: "rejected"`

- **Textové:** altán, odpočívadlo, posezení, „přístřešek se stolem a lavicemi", zastřešené posezení u cyklostezky, autobusová čekárna, informační přístřešek s mapou, krmelec, posed, kaplička, kryté ohniště bez stěn.
- **OSM tagy:** `shelter_type=picnic_shelter | public_transport | gazebo | field_shelter`, `tourism=picnic_site`, `highway=bus_stop` v okolí.
- **Konfigurace:** pevný stůl s lavicemi uprostřed a žádná rovná plocha na lehnutí; půdorys užší než ~1,5 m; jen střecha na sloupech u frekventované silnice nebo v zástavbě.
- **Věty:** „hezké místo na svačinu", „schováte se, než přejde přeháňka", „uvnitř jen stůl, spát by se tu nedalo".
- **Nezamítej** kvůli: absenci stěn (`lean_to` je platný typ, má-li pryčnu/lavici/rovnou plochu a je mimo zástavbu), absenci ohniště nebo vody, malé velikosti.
- Hraniční případ (stříška s lavicí v lese, žádná recenze o přespání): **nech `status` beze změny**, dilema popiš v `note` a `description`. Zamítnutí je destruktivní.

### Kdy povýšit `candidate` → `approved`

- Jen když platí **obojí**: (a) doložená existence a aktuální stav (`ok` nebo `damaged`), (b) doložená vhodnost k přespání — rovná plocha / pryčna / útulna, a to **ze dvou nezávislých zdrojů** (např. OSM tagy + web správce, nebo web + datovaná recenze o přespání).
- Při pochybnostech **nech `candidate`**.
- **Triáž bez rozhodnutí:** dospěješ-li jen k „nevím", zápis buď **vynech úplně** (záznam zůstane ve frontě), nebo ho v reportu vypiš do sekce „orazítkováno bez rozhodnutí" s upozorněním, že se vrátí až za `staleDays` dní. Nikdy nezametej kandidáty pod koberec hromadným razítkem.

### Kapacita, materiál, vybavení

- **`capacity` = počet lidí, kteří si lehnou** (ne míst k sezení). Celé číslo 0–999.
  - Přímý doklad má přednost: „spali jsme tam ve čtyřech" → `4`. OSM `capacity=N` ber jako výchozí.
  - **Odhad z konstrukce je povolený jen tehdy, když jsi konkrétní stavbu skutečně viděl na fotce nebo máš její popis** (pryčna po celé délce, palanda, patro). V `note` to pak napiš doslova: „kapacita odhadnuta z fotky (nikoli doložena textem)".
  - **Odvozovat kapacitu jen z hodnoty `type` je zakázáno.** Jen fotka zvenku → capacity nezapisuj.
  - **Zaokrouhluj dolů**, u rozpětí ber spodní hranici („4–6 lidí" → `4`), rozpětí zmiň v `description`.
- **`walls`** = volný český text, **max 60 znaků** („dřevěné klády", „plech na dřevěné konstrukci", „kámen"). Zdroje: OSM `material` / `building:material` / `roof:material` → fotka → popis. Rozlišuj **stěny** a **střechu**.
- **`hasDoor`** jen při jistotě — dveře na fotce, OSM `door=yes`, jednoznačná věta. „Uvnitř bylo teplo" dveře nedokazuje. Jinak `null`.
- **`fireplace`** = ohniště u objektu nebo kamna uvnitř. „Popel po ohni vedle" = ano; „dá se rozdělat oheň" = ne.
- **`waterNearby`** = zdroj vody pěšky do ~10 min. „Vodu si vezměte, nikde nic" → `false`. Nic o vodě → nezapisuj.

### Protichůdné informace

1. **Novější přebíjí starší.**
2. **Vizuální / oficiální důkaz přebíjí anonymní text.**
3. **Dva nezávislé zdroje přebíjí jeden.**
4. **Konkrétní přebíjí obecné.**
5. **Stejně silné a stejně staré rozpory → `unknown`**, rozpor popiš v `note` i `description`.

- **Objekt byl opraven.** 2021 „spadlá střecha" → 2024 „nová střecha" není rozpor, ale vývoj. Řiď se posledním stavem, historii shrň do `description`.
- **Dvě stavby blízko sebe** (útulna + altán na 80 m) → recenze se míchají. Nesedí-li text k souřadnicím, zdroj zahoď; zvaž `POST /api/agent/shelters` na samostatný záznam.

### Kdy NEZAPISOVAT hodnotu

- nemáš **URL** do `sources`,
- zdroj nejde prokazatelně navázat na tyto souřadnice,
- jde o **tvou domněnku** („vypadá to na dřevo", „asi tam bude ohniště"),
- zdrojem je jen AI shrnutí / agregátor / obsahová farma bez dohledatelného originálu,
- jde o `condition` a jediný nález je **nedatovaný**,
- jde o **změnu** `condition` nebo `status` a máš pro ni **jen Mapy.com nebo jen Google** — popisná pole zapiš, rozhodovací nech být a rozpor popiš v `note`,
- zdroj popisuje jiný rok/roční období („v zimě zavřeno" ≠ `destroyed`),
- jde o `rejected` a nemáš jednoznačný doklad, že se tam nedá spát.

**Nedostatek informací není `destroyed` ani `damaged`.** Zápis přesto proveď (obnoví `verifiedAt`) — se **stávající** hodnotou `condition`:

```json
{
  "note": "Ověřeno přes OSM, web obce a fulltext; Mapy.com v tomto běhu nedostupné, žádné nové informace o stavu.",
  "sources": ["https://www.openstreetmap.org/way/123456", "https://www.obec-priklad.cz/turistika"],
  "condition": "ok"
}
```

*(`"ok"` = hodnota, kterou měl záznam v `tasks.json`. Byla-li `null`, pošli `null`.)*

### Checklist pro jeden přístřešek

1. Přečti `verificationNote` a co je vyplněné; poznamenej souřadnice.
2. **Mapy.com** (jen přes prohlížeč) → karta a datované recenze: co to je, jak se tam spí, vybavení, stav. Fotky si prohlédni jako vodítko, **nic z nich neukládej**.
3. OSM tagy + historie → typ, vybavení, případné smazání.
4. Weby správce / spolku / obce → oficiální fakta a stav; **povinné, chceš-li měnit `condition` nebo `status`**.
5. Google Maps → druhý nezávislý proud recenzí, když krok 2 nestačil.
6. Wikipedie/Commons → fakta a **legální fotky** (jen když přístřešek vhodný obrázek nemá).
7. Vyhodnoť: je to místo na spaní? v jakém stavu? co se o něm dá napsat?
8. Rozpory vyřeš podle pravidel, zbytek nech `unknown` / beze změny.
9. Zapiš: `note` + `sources` + `description`, je-li na co + jen doložená pole (+ stávající `condition` jako razítko).

---

## Doplňování fotek

### Kdy a kolik

- Frontu vyžádej: `GET /api/agent/tasks?missing=photos&staleDays=1&limit=10`.
- **Prázdné `photos` neznamená „už se hledalo".** Automatické dohledání (`enrichShelter`) běží **líně — až při prvním otevření veřejného detailu**; agentní API ho nespouští a `/api/shelters/{id}` je agentnímu tokenu nedostupné. U záznamu, na který nikdo nikdy neklikl, geosearch nikdy neproběhl.
- **`photosCheckedAt` ve frontě ani v `GET` detailu není, ale v odpovědi na `PATCH` ano** — ta vrací surový DB řádek. Po zápisu si z něj můžeš ověřit, jestli a kdy automatické hledání fotek proběhlo; když našlo prázdno ve stejný den jako ty, tvoje neúspěšné hledání není jen smůla.
- **Proto vždy začni geosearchem na 120 m** (stejné parametry jako aplikace — levné, často stačí) a teprve pak rozšiřuj na 250–500 m a fulltext.
- Cíl: **1–2 fotky na přístřešek**. Ne galerie. Radši žádná fotka než špatná.

**Fotka na Mapy.com jako vodítko (ne jako zdroj):**

- Fotky z Mapy.com se do `photos` **nikdy nekopírují ani nehotlinkují** — API je stejně odmítne (povolený `source` je jen `commons | osm | manual`).
- Smíš se na ně ale **podívat a použít je jako popis hledaného objektu**: poznáš z nich typ stavby, materiál, barvu střechy a okolí, a pak hledáš **týž objekt na Commons** cíleněji — přesnější klíčová slova a jistější vizuální kontrola.
- **Dělej to jen tehdy, když přístřešek ještě vhodný obrázek nemá.** Má-li `photos` neprázdné a snímek odpovídá objektu, nehledej nic dalšího a jdi na další záznam.
- „Vhodný obrázek" = aspoň jedna položka v `photos`, která projde vizuální kontrolou (je na ní ta stavba, ne panorama, cedule ani jiný objekt). Je-li tam jen nesouvisející snímek, ber to jako „nemá" a hledej.
- Fotku z Mapy.com si **neukládej ani dočasně** — jen se na ni podívej v prohlížeči.

### Právní hranice (tvrdá)

**Jediný povolený zdroj fotek do `photos` je teď Wikimedia Commons.**

| Zdroj | Stav | Pravidlo |
|---|---|---|
| **Wikimedia Commons** | **povoleno** | jakákoli volná licence (CC0, PD, CC BY, CC BY-SA); vždy dotáhni `author`, `license`, `page` z Commons API |
| OSM tag `wikimedia_commons=File:…` | povoleno **jako tip** | dohledej soubor na Commons a licenci/autora vezmi odtud |
| OSM tag `image=…` | **jen tip, kam se podívat** | ODbL kryje tag (data), ne dílo na cizím serveru (Mapillary, Flickr ARR, imgur, blog). Do `photos` zapiš, jen když cílová stránka doloží volnou licenci a soubor je na Commons. Jinak nepřidávej a napiš to do `note`. |
| Oficiální web správce (obec, KČT, LČR) | **hotlink zakázán vždy** | i „fotogalerie obce" je autorské dílo (v ČR presumpce autorství). Najdeš-li vhodnou fotku s výslovnou licencí, **nedávej ji do `photos`** — uveď ji v reportu jako **úkol pro člověka** včetně URL a citované věty o licenci. |
| Flickr CC | **zatím zakázáno** | viz „Co musí aplikace umět" níže |

**Nikdy nekopírovat, nehotlinkovat, ani dočasně neukládat:** Mapy.com (včetně panoramat), Google Maps / Street View / Fotky, Seznam, Facebook, Instagram, Turistika.cz, Geocaching, Pinterest, náhodné blogy a fóra, AI generované obrázky.

- Fotku **nestahuj a nenahrávej jinam** „aby fungovala" — aplikace hotlinkuje.
- **Nejistota o licenci = fotku nepřidávat.**

### Co musí aplikace umět, než přibude další zdroj fotek

Do reportu pro správce (dokud neplatí, drž se výhradně Commons):

- `app/pristresek/[id]/page.tsx` má natvrdo „Fotky: Wikimedia Commons (licence u snímků)" → jakákoli ne-Commons fotka by byla **nepravdivě připsána Commons**. Patičku je třeba odvodit z `photos[].source`.
- `PhotoGallery` ukazuje autora a licenci jen v lightboxu a bez odkazu na `page` → doplnit atribuci i k náhledu.
- Server nevynucuje licenci: `sanitizePhotos()` bere `author`/`license`/`page` jako volitelné → doplnit validaci (položka se `source: commons|osm` bez `license` a `page` = 400).
- `source` API zná jen `commons | osm | manual`; Flickr by skončil jako nerozlišitelný „manual".

### Wikimedia Commons — dotazy

Vždy s hlavičkou (politika Wikimedie vyžaduje identifikaci):

```bash
UA="User-Agent: GAPAHUK-agent/1.0 (mapa pristresku CR; kolderbenjamin@gmail.com)"
```

**a) Geosearch — nejdřív 120 m, pak 250–500 m:**

```bash
curl -s -H "$UA" -o "$SCRATCH/commons.json" "https://commons.wikimedia.org/w/api.php?action=query&format=json&\
generator=geosearch&ggscoord=49.6721|15.9037&ggsradius=120&ggslimit=20&ggsnamespace=6&\
prop=imageinfo|coordinates|categories&iiprop=url|extmetadata&iiurlwidth=900&cllimit=max"
```

- `ggsnamespace=6` = jen soubory. `prop=coordinates` → spočítej vzdálenost (haversine). **`iiurlwidth=900`** — stejná šířka jako aplikace.

**b) Fulltext**, když geosearch nic nevrátí:

```bash
curl -s -H "$UA" -o "$SCRATCH/commons-fts.json" "https://commons.wikimedia.org/w/api.php?action=query&format=json&\
generator=search&gsrsearch=P%C5%99%C3%ADst%C5%99e%C5%A1ek%20%C4%8Ce%C5%99%C3%ADnek&gsrnamespace=6&gsrlimit=20&\
prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900"
```

Postupně: `<name>` z DB → název bez typového slova + obec/hora → anglicky `shelter <místo>`, `lean-to <místo>`, `hut <místo>` → `incategory:"Shelters in the Czech Republic"` + lokalita.

- Má-li OSM tag `wikipedia=cs:…`, smíš z článku vzít `prop=images`, **ale každý soubor musíš dohledat na commons.wikimedia.org** (`action=query&prop=imageinfo&iiprop=url|extmetadata`). Co na Commons neexistuje, **zahoď bez výjimky** — na cs.wikipedii jsou i lokálně nahrané nesvobodné soubory (fair use).

**Mapování odpovědi:**

| Pole odpovědi | Kam |
|---|---|
| `imageinfo[0].thumburl` (fallback `url`) | `photos[].url` |
| `extmetadata.Artist.value` — **strip HTML** | `photos[].author` |
| `extmetadata.LicenseShortName.value` (fallback `License`, `UsageTerms`) | `photos[].license` |
| `imageinfo[0].descriptionurl` | `photos[].page` |
| `extmetadata.ObjectName` / `ImageDescription` | jen ke kontrole obsahu |

- **Autora nikdy nezkracuj.** Server `author` delší než 120 znaků a `license` delší než 60 **tiše zahodí** (uloží se fotka bez atribuce, aniž bys to poznal). Nevejde-li se plná atribuce, ulož **kanonickou krátkou formu** (uživatelské jméno na Commons) a plnou atribuci nech dostupnou přes `page`. **Vyjde-li `author` prázdný, fotku NEPŘIDÁVEJ.**
- Licenci ověř před zápisem: přijmi `CC0`, `Public domain`, `PD-*`, `CC BY *`, `CC BY-SA *` (nebo `LicenseUrl` na `creativecommons.org/licenses/by(-sa)/*` či `publicdomain/*`). **Odmítni** `Fair use`, `non-free`, `NC`, `ND` a vyplněné `extmetadata.Restrictions`.
- **Tvar URL sjednoť s aplikací** (dedup je podle **přesné shody URL**, jinak vznikne dvojitá fotka, až enrichment doběhne):
  - z geosearche/fulltextu → `imageinfo[0].thumburl` při `iiurlwidth=900`,
  - z tagu `wikimedia_commons=File:X` → `https://commons.wikimedia.org/wiki/Special:FilePath/X?width=900`.

### Ověření, že fotka ukazuje TEN přístřešek

Přidej jen tehdy, když projde **všemi** kroky:

1. **Vzdálenost: tvrdý strop 200 m.** ≤ 60 m = OK; 60–200 m jen s potvrzením v názvu/popisu/kategorii. Nad 200 m nebo bez souřadnic **jen tehdy**, když objekt jmenuje **název souboru I popis nebo kategorie** a zároveň sedí typ stavby z vizuální kontroly. Jinak nech `photos` prázdné a do `note` napiš, co se našlo a proč to nestačilo.
2. **Text:** vyluč „View from…", „Panorama", „Rozhledna", „Kaple", „Rozcestník", „Sign", „Map", „Bus stop".
3. **Vizuální kontrola je povinná.** Stáhni náhled do scratchpadu a otevři nástrojem Read:
   ```bash
   curl -sL -H "$UA" -o "$SCRATCH/check1.jpg" "<thumburl>"
   ```
   Je na fotce **stavba, pod kterou se dá spát**? Sedí typ (`lean_to` = otevřená přední stěna; `basic_hut`/`wilderness_hut` = čtyři stěny, dveře, případně kamna)? Sedí materiál a okolí?
   Viděl-li jsi objekt na fotce na Mapy.com, **porovnej ho po paměti** — sedí tvar střechy, materiál, okolí? Rozpor je důvod fotku z Commons zahodit.
4. **Křížová kontrola informací** (ne obrázků) přes prohlížeč na Mapy.com / Google — jen si přečti, nic neukládej. Odkazy do `sources`.
5. **Rozpor = nepřidávat.** Jiná stavba, cedule, holá krajina, interiér bez kontextu, nejistota → zahoď.
6. Ukazuje-li správná fotka **poškození**, rovnou nastav `condition` a napiš to do `note`.

### Zápis fotek: načti → sluč → zapiš → zkontroluj

- **Pole `photos` se PŘEPISUJE celé, server nic neslučuje.**
- **Existující položky kopíruj DOSLOVA tak, jak je vrátil GET** — včetně `author`, `license`, `page`, `source`. Nikdy je nepřeváděj na holý string ani nedoplňuj `source: "manual"`; ruční fotky se nesmí ztratit a atribuce se nesmí smazat.
- **Blokující pravidlo:** u každé **nové** položky musí být vyplněné `author` + `license` + `page`. Chybí-li kterékoli z nich, **PATCH s touto fotkou vůbec neposílej.**
- Limity: max **12** fotek, `author` ≤ 120, `license` ≤ 60, `url` i `page` http(s), `source` jen `commons | osm | manual` (jiná hodnota spadne na `manual`). Neposílej `photos` vůbec, pokud nic nepřidáváš.
- **Po PATCH si přečti vrácené `photos`** (odpověď je surový řádek) a ověř, že `author`, `license` i `page` zůstaly u **všech** položek. Chybí-li něco (tiché useknutí přes limit), fotku okamžitě odeber dalším PATCHem.
- Do `note` u každé přidané fotky napiš **datum ověření licence**.

### Re-check fotek (samostatný typ běhu)

- Projdi záznamy s neprázdným `photos` (výběr `id` z běhového logu minulých běhů, od uživatele, nebo cíleně přes `bbox` + `staleDays=-1`).
- U každé fotky ověř: dostupnost `url` (HTTP 200) a aktuální licenci na `page`.
- Při **404**, smazání souboru na Commons (copyvio) nebo změně na ARR/NC/ND položku z `photos` **odstraň** a důvod napiš do `note`.
- Uložený řetězec „CC BY-SA 4.0" je licenční tvrzení, které aplikace veřejně opakuje — zastaralý údaj je stejná chyba jako chybějící atribuce.

### Když se nic nenajde

Fotku **nevymýšlej, nenahrazuj podobnou stavbou z okolí, negeneruj.** Zapiš přesto (se **stávající** hodnotou `condition`):

```json
{
  "note": "Fotku se nepodařilo dohledat ve volných zdrojích (Commons geosearch 120 i 500 m a fulltext bez výsledku, 19. 8. 2026).",
  "sources": ["https://commons.wikimedia.org/w/index.php?search=P%C5%99%C3%ADst%C5%99e%C5%A1ek&ns6=1", "https://www.openstreetmap.org/way/123456"],
  "condition": "ok"
}
```

### Checklist před každým PATCH s fotkou

- [ ] Soubor je na Wikimedia Commons (nic z Mapy.com, Google, webu obce ani Flickru)
- [ ] Licence ověřena z Commons API (ne odhadem), NC/ND/fair-use odmítnuto
- [ ] `author` (nezkrácený, neprázdný), `license`, `page` u **každé nové** fotky
- [ ] Fotka vizuálně zkontrolována nástrojem Read — je na ní přístřešek
- [ ] Vzdálenost ≤ 200 m, název/popis potvrzují objekt
- [ ] Staré položky zkopírované doslova, nové max 2, žádná duplicita URL, tvar URL sjednocený s aplikací (šířka 900)
- [ ] Po zápisu ověřeno, že se `author` + `license` + `page` opravdu uložily
- [ ] `note` je jedna česká věta (počet fotek, zdroj, licence, datum), `sources` obsahuje popisné stránky (ne přímé JPEG)

---

## Pravidla a mantinely

- **Neměň souřadnice ani `osmId`** — API je nepřijme. Nesoulad popiš v `note` a v reportu.
- **Nemaž data.** Neposílej `null` do vyplněného pole jen proto, žes informaci nedohledal.
- **Nepřepisuj vyplněný `description`** bez prokazatelně novější a lepší informace; jinak přidej větu.
- **Popisná pole z jednoho zdroje ano, rozhodovací ne.** `description`, `capacity`, `walls` a vybavení smí stát na samotných Mapy.com; `condition` a `status` potřebují potvrzení druhým zdrojem.
- **Prázdný popis je lepší než vata.** Nemáš-li konkrétní fakta, `description` nezapisuj.
- **Při pochybnostech spíš `candidate` než `approved`.**
- **`condition: "unknown"` je legitimní výsledek** — nehádej `ok`. Ale jako pouhé razítko posílej **stávající** hodnotu.
- **`destroyed` posílej spolu se `status: "rejected"`.**
- **`hasDoor` jen při jistotě**, jinak `null`.
- **Žádné fotky ani doslovné texty z Mapy.com a Google.** Fotka na Mapy.com smí posloužit jen jako vodítko při hledání téhož objektu na Commons — a to jen tehdy, když přístřešek ještě vhodný obrázek nemá.
- **`sources` se kumulují, max 10.** Má-li záznam už 10 zdrojů, nový se nemusí uložit — klíčový odkaz zmiň i v `note`.
- **Nezakládej nové přístřešky „pro jistotu".** `POST /api/agent/shelters` použij jen při doložené existenci.
  - Povinné: `lat`, `lng` (jen ČR: lat 48–51.2, lng 12–19), `note`, `sources`. **`type` je volitelný** (default `lean_to`).
  - Ukládají se jen vyjmenovaná pole — **`photos`, `walls` a `elevation` se při zakládání tiše zahodí** (dodej je následným PATCHem).
  - Záznam vzniká jako `candidate` a **bez `verifiedAt`**, takže hned vyskočí na začátek fronty kandidátů.
- **Nikdy nekonči běh s „prozkoumáno, ale nezapsáno"** (výjimka: vědomé ponechání kandidáta ve frontě — napiš to do reportu).
- **Drž stejné `staleDays` napříč běhy** (výchozí 180; `staleDays=0` nefunguje, použij `1`).
- **Střídej filtry, ne pořadí:** jeden běh `missing=description`, jiný přeověření, jiný `missing=photos`, jiný `status=candidate`, jiný re-check fotek.
- Piš `note` tak, aby po půl roce dávalo smysl, proč jsi to udělal.

### Chyby API

| Kód | Význam | Co udělat |
|---|---|---|
| **400** „Chybí note…" / „Chybí sources…" | povinné pole chybí | doplň a pošli znovu — **jednou** |
| **400** „Žádná změna dat…" | poslal jsi jen `note` + `sources` | přidej datové pole (typicky stávající `condition`) |
| **400** „Neplatný status/typ/stav" | hodnota mimo výčet | oprav podle manifestu |
| **400** „Neplatná kapacita (celé číslo 0-999)" | `capacity` není integer | pošli číslo, ne `"4 osoby"` |
| **400** „Neplatné fotky (jen http/https URL, max 12)" | špatná `url` nebo > 12 fotek | oprav (pozor: špatné `page`/`author`/`license` chybu **nevyvolá**, tiše se zahodí) |
| **400** „Neplatné zdroje (jen http/https URL, max 10)" | špatná URL nebo > 10 zdrojů | zkrať seznam |
| **400** „Neplatné souřadnice (…lat 48-51.2, lng 12-19)" | jen u `POST /api/agent/shelters` | oprav bod, nebo záznam nezakládej |
| **400** „Neplatný JSON" | rozbité tělo | posílej těla ze souboru, ne inline v shellu |
| **400** „Maximálně 50 položek…" | příliš velký batch | rozděl po 20 |
| **401** JSON `{"error":"Chybí platný agentní token…"}` | hlavička chybí/špatná — **jen na `/api/agent/*`** | zkontroluj `X-Agent-Token` |
| **401** prostý text „Přihlášení vyžadováno" | Basic Auth proxy | Na `/pristresek/*`, `/mapa`, `/api/shelters/*` je to **normální** — tyto stránky neotvírej. Na `/api/agent/*` znamená neplatný token nebo chybějící `AGENT_TOKEN` na serveru → **ukonči běh** a důvod napiš do reportu; netipuj token, nezkoušej admin heslo. |
| **404** „Nenalezeno" | záznam neexistuje | přeskoč, do reportu |
| **5xx / timeout** | dočasný výpadek | zkus **jednou** znovu; pak běh ukonči a zapiš hotové |

- **Žádné retry ve smyčce** — 400 se opakováním neopraví.
- U batche kontroluj `results`, ne jen HTTP kód.
- Selže-li víc než ~třetina zápisů, **zastav se** a nahlas problém.

---

## Ukázky volání

**Detail jednoho záznamu:**

```bash
node "$SCRATCH/gapahuk.mjs" get "/api/agent/shelters/8139" > "$SCRATCH/8139.json"
```

**PATCH (těleso do souboru, pak odeslat):**

```json
// $SCRATCH/patch-8139.json
{
  "note": "Web obce z 6/2025 uvádí opravenou střechu; OSM tag capacity=2 sedí s popisem pryčny.",
  "sources": [
    "https://www.openstreetmap.org/way/123456",
    "https://www.obec-priklad.cz/turistika/pristresek"
  ],
  "condition": "ok",
  "capacity": 2,
  "description": "Otevřený přístřešek s pryčnou u lesní cesty. Střecha opravena 2025. Ohniště cca 5 m od objektu, voda v okolí není."
}
```

```bash
node "$SCRATCH/gapahuk.mjs" patch 8139 "$SCRATCH/patch-8139.json"
```

**PATCH s fotkou (staré položky doslova + nová na konci):**

```json
// $SCRATCH/patch-8163.json
{
  "note": "Doplněna 1 fotka z Wikimedia Commons (CC BY-SA 4.0, licence ověřena 19. 8. 2026); otevřený přístřešek na fotce odpovídá poloze i typu.",
  "sources": [
    "https://commons.wikimedia.org/wiki/File:Pristresek_Cerinek_01.jpg",
    "https://www.openstreetmap.org/way/123456"
  ],
  "condition": "ok",
  "photos": [
    { "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Stara.jpg/900px-Stara.jpg",
      "author": "Petr Svoboda", "license": "CC BY 4.0",
      "page": "https://commons.wikimedia.org/wiki/File:Stara.jpg", "source": "commons" },
    { "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Pristresek_Cerinek_01.jpg/900px-Pristresek_Cerinek_01.jpg",
      "author": "Jan Novák", "license": "CC BY-SA 4.0",
      "page": "https://commons.wikimedia.org/wiki/File:Pristresek_Cerinek_01.jpg", "source": "commons" }
  ]
}
```

**Dávkový zápis:**

```json
// $SCRATCH/batch.json
{"updates":[
  {"id":8139,"note":"Podle fotogalerie Lesů ČR přístřešek stojí a je udržovaný.",
   "sources":["https://lesycr.cz/..."],"condition":"ok"},
  {"id":8140,"note":"Web mikroregionu z 3/2025 uvádí odstranění stavby při těžbě; v OSM verze s visible=false.",
   "sources":["https://www.openstreetmap.org/way/123456/history","https://www.mikroregion-priklad.cz/aktuality/..."],
   "condition":"destroyed","status":"rejected"},
  {"id":8141,"note":"Online nic nového; ponechávám stávající stav, poloha sedí na turistickou mapu.",
   "sources":["https://www.openstreetmap.org/way/123457"],"condition":"ok"}
]}
```

```bash
node "$SCRATCH/gapahuk.mjs" batch "$SCRATCH/batch.json"
```

**Historie jednoho záznamu (u sporných případů):**

```bash
node "$SCRATCH/gapahuk.mjs" get "/api/agent/edits?shelterId=8139&limit=10"
```

---

## Závěrečný report uživateli

Běh **vždy** ukonči souhrnem (ne souborem). Lokálně jde do chatu, v cloudu je to poslední výstup běhu a skončí v run summary — proto musí dávat smysl i bez kontextu konverzace. Čísla nejdřív, detaily pod tím, odrážky a tabulky.

```markdown
## Běh agenta GAPAHUK — 19. 8. 2026
Cíl: https://<produkce> · prostředí: lokálně / cloud Routine · fronta: status=approved, staleDays=180 · zpracováno 20 z 234

**Zapsáno:** 18 · **Selhalo:** 2 · **Zbývá ve frontě:** 216

### Co se změnilo (11)
| id | přístřešek | změna | zdroj |
|---|---|---|---|
| 8140 | Útulna pod Smrkem | condition ok → destroyed, status → rejected | web mikroregionu 3/2025 + OSM historie |
| 8151 | Přístřešek U buku | +popis, +kapacita 4, +ohniště | Mapy.com (recenze 2024–2025) + web obce |
| 8163 | (bez názvu) | +1 fotka (Commons, CC BY-SA 4.0) | commons.wikimedia.org |

### Doplněné popisy (6)
| id | popis (zkráceně) | z čeho |
|---|---|---|
| 8151 | Otevřený přístřešek s pryčnou pro 4, ohniště před ním, voda v potoce 200 m. | Mapy.com, 3 recenze 2023–2025 |
| 8154 | Zděná útulna se dvěma pryčnami a kamny, dřevo bývá uvnitř. | Mapy.com + OSM `shelter_type=wilderness_hut` |

### Popis jsem nenapsal (2)
- **8159, 8162** — bez karty na Mapy.com, OSM má jen `amenity=shelter`, fulltext nic; zapsáno jen razítko ověření

### Jen ověřeno, beze změny (7)
8142, 8145, 8147, 8149, 8152, 8155, 8158

### K ruční kontrole (3)
- **8140** — navrhuji rejected potvrdit ručně
- **8171** — zdroje popisují místo 80 m vedle (souřadnice jsem neměnil)
- **8175** — v historii je dřívější revert správcem, nechal jsem beze změny

### Selhalo (2)
- **8168** — 404 Nenalezeno · **8170** — 400 „Neplatná kapacita" („6-8 osob"), pole nechávám prázdné

### Nenašel jsem fotku (4)
8142, 8149, 8155, 8158 — Commons geosearch 120 i 500 m a fulltext bez výsledku

### Fotka jen s ručním posouzením (1)
- **8180** — vhodná fotka na webu obce (URL), licence tam uvedena není → hotlink jsem neudělal

### Úkoly pro správce
- Patička detailu tvrdí „Fotky: Wikimedia Commons" natvrdo — odvodit ji z `photos[].source`, jinak nelze přidat jiný zdroj.
- Doplnit serverovou validaci: fotka se `source: commons|osm` bez `license` a `page` = 400.
```

- **Odděl „ověřeno beze změny" od „změněno"** — uživatele zajímá druhá skupina.
- U triáže kandidátů vypiš i **„orazítkováno bez rozhodnutí"** a připomeň, že se vrátí až za `staleDays` dní.
- Uveď `remaining` a zda šlo o produkci, nebo testovací lokální běh.
- Připomeň, že zásahy jsou v `/admin/agenti` (posledních 50, revert po jednom). **Token do reportu nikdy nepiš.**
