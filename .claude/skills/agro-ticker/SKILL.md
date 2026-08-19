---
name: agro-ticker
description: "Plní a udržuje Aktuality (Ticker) na Profifarmar.cz — červený běžící pruh nahoře na titulce, kam se vejde max 5 krátkých zpráv (label do 50 znaků, text do 200 znaků). Jedním neinteraktivním během načte, co v pásku běží, vybere čerstvé zprávy z vlastních publikovaných článků a doplní je rešerší z ověřených zdrojů (MZe, SZIF, ČHMÚ, ČSÚ, Evropská komise), napíše je do stylu pásku, ohlídá limity délky, zahodí duplicity a prošlé položky a odešle je přes /api/aktuality_webhook.php. Určeno pro Claude Code cloud Routine (Linux, python3), ale funguje i ručně z chatu. Použij tento skill vždy, když uživatel chce dát něco do pásku, aktualizovat pásek, přidat aktualitu, změnit běžící lištu nebo naplnit ticker na profifarmaru. Trigger keywords: agro ticker, attention pásek, pásek na webu, běžící pruh, červený pruh, aktuality profifarmar, přidej aktualitu, naplň ticker, aktualizuj pásek, ticker routine, breaking news lišta, zpravodajský pruh."
---

Jsi redakční agent, který se stará o **Aktuality (Ticker)** na Profifarmar.cz — červený běžící pruh hned pod hlavičkou titulky. Běží autonomně: při chybě loguje a pokračuje, nikdy nečeká na potvrzení.

---

## Co je pásek a proč na délce záleží

Pruh se **posouvá zleva doprava** a čtenář ho zahlédne koutkem oka, obvykle jednou. Každá položka má dvě části:

| Část | Zobrazení | Tvrdý limit | Redakční ideál |
|---|---|---|---|
| `label` | tučně, VELKÝMI, červeně oddělené | **50 znaků** (API odmítne víc) | 5–15 znaků, jedno slovo |
| `text` | běžný text za labelem | **200 znaků** (API odmítne víc) | 90–170 znaků, 1–2 věty |

V pásku je **maximálně 5 položek**. Šestou nemá kam dát — víc se do smyčky nevejde a pruh by se protáhl tak, že by konkrétní zprávu nikdo nedočetl.

---

## Klíčové informace

| Parametr | Hodnota |
|---|---|
| Web | https://profifarmar.cz |
| Čtení pásku | `GET https://profifarmar.cz/api/aktuality.php` (veřejné, bez tokenu) |
| Zakládání | `POST https://profifarmar.cz/api/aktuality_webhook.php` (`Authorization: Bearer $AI_API_KEY`) |
| Mazání / editace | `DELETE`/`PUT https://profifarmar.cz/api/admin/aktuality.php` — **zatím jen admin session**, viz [Známé omezení](#známé-omezení--mazání) |
| Články jako zdroj | `GET https://profifarmar.cz/api/webhook.php?limit=10000` (`Authorization: Bearer $AI_API_KEY`) |
| Admin pro člověka | https://profifarmar.cz/admin/ → dlaždice Aktuality (Ticker) |
| Log odeslaných | `posted-ticker-log.json` v kořeni repa Claude-Code-Skills |

Token ber z proměnné prostředí `AI_API_KEY`. V cloud Routine ji doplň v sekci **Environment**; lokálně na Windows je uložená na úrovni User (`[System.Environment]::GetEnvironmentVariable('AI_API_KEY','User')`).

Veškerou práci s API dělá `scripts/ticker.py` — sám hlídá limity délky, počet položek, duplicity i expiraci. **Nevolej API ručně přes curl**, pokud jen nediagnostikuješ.

```bash
python3 scripts/ticker.py list                       # co v pásku právě běží
python3 scripts/ticker.py check                      # co všechno smí skript dělat
python3 scripts/ticker.py apply --file navrh.json    # celá rotace jedním krokem
python3 scripts/ticker.py apply --file navrh.json --dry-run   # nanečisto
```

---

## Jak se píše aktualita do pásku

Tohle je jádro skillu. Pásek není nadpis článku ani tweet — je to **rozhlasová zpravodajská znělka v jedné větě**.

### Label

- Jedno slovo, VELKÝMI, česky, s diakritikou: `SUCHO`, `SKLIZEŇ`, `DOTACE`, `CENY`, `ŽNĚ`, `TECHNIKA`, `CHMEL`, `LEGISLATIVA`.
- Když jedno slovo nestačí, přidej rok nebo region: `SUCHO 2026`, `ŽNĚ NA MORAVĚ`.
- Label je **téma, ne značka a ne titulek**. Ne `AGDATA SPOUŠTÍ AGÁTU`, ale `AGROTECH`.
- Dvě položky v pásku nesmí mít stejný label — čtenář by je slil dohromady.

### Text

- **1–2 věty, plynulá čeština, končí tečkou.** Žádné odrážky, HTML, emoji, odkazy ani uvozovky kolem celku.
- **Konkrétní fakt s číslem nebo institucí** v první větě. Druhá věta je dopad na hospodáře — co s tím má sedlák dělat.
- **Nikdy otázka a nikdy klikbejt.** Ne „Víte, kolik letos přijdete o výnos?“ Ne „čtěte více v článku“ — pásek není klikatelný.
- **Bez zkratek, které se musí luštit** (`SZIF` a `MZe` jsou v pořádku, `PGRLF VZ 3/26` ne).
- Čísla piš tak, jak se čtou: `4 515 tun`, `1,7 milionu hektarů`, `o pětinu nižší`.

**Dobře:**

> **SKLIZEŇ** — Naplno běží hlavní sklizeň obilovin a řepky. Podle odhadů ministerstva se výnosy v řadě regionů drží navzdory suchu blízko loňského průměru.

> **CHMEL** — Chmelaři na Žatecku čekají o pětinu nižší úrodu. Nejsušší léto od roku 1961 srazilo i obsah hořkých látek.

**Špatně:**

> **NOVINKA** — Máme pro vás nový článek o technice! 🚜 Čtěte více na našem webu. → značka místo tématu, klikbejt, emoji, odkaz na nic

> **DOTAČNÍ TITUL 4.1.1 PRO MLADÉ ZEMĚDĚLCE V 8. KOLE PŘÍJMU ŽÁDOSTÍ** — … → label je titulek, v běžícím pruhu se nedočte

### Co do pásku nepatří

- Cokoli, co **za tři dny nebude platit** a nikdo to nepřepíše (uzávěrky, které mezitím proběhnou).
- Historické a vysvětlovací články („Sedm století rybníkářství“) — ty jsou skvělé na story, ale v pruhu s nápisem AKTUALITY působí divně.
- Marketing, vlastní PR, pozvánky na vlastní obsah.
- Nepotvrzené zprávy. **Nikdy si nevymýšlej číslo ani citaci** — když fakt není v článku ani ve zdroji, položku vynech.

---

## Pracovní postup

### Krok 1 — Zjisti, co v pásku běží

```bash
python3 scripts/ticker.py list
python3 scripts/ticker.py check
```

Z `list` si odnes: kolik je volných slotů, jaká témata už běží (nová položka je nesmí opakovat) a jak jsou položky staré. Z `check` víš, jestli v tomto běhu smíš mazat.

### Krok 2 — Vyber zprávy z vlastních článků (primární zdroj)

```bash
curl -sS -H "Authorization: Bearer $AI_API_KEY" \
  "https://profifarmar.cz/api/webhook.php?limit=10000" -o /tmp/articles.json
```

> Vždy s `limit=10000`. Bez něj API vrátí jen 100 záznamů, a ne spolehlivě těch nejnovějších.

Filtruj `status == "published"` a seřaď podle `published_at` sestupně. Ber články z **posledních 48 hodin** (redakční dávka vzniká večer a přetéká přes půlnoc, takže „dnešek“ sám o sobě nestačí).

Výpis článků vrací jen `title`, `slug`, `category_id`, `published_at` a `cover_image_url` — **žádný perex ani text**. Fakta si vytáhni ze zveřejněné stránky článku:

```bash
curl -sSL "https://profifarmar.cz/clanek/<slug>/" -o /tmp/clanek.html
```

Perex je hned pod titulkem, čísla a instituce v prvních dvou odstavcích. Z nich napiš `label` a `text` podle pravidel výše. **Nekopíruj perex** — ten je delší než 200 znaků a psaný pro jiné místo; napiš větu znovu, kratší a s tvrdým faktem vepředu.

Kandidáty seřaď podle naléhavosti pro hospodáře: **počasí a sucho → termíny a dotace → ceny a trhy → sklizeň a agronomie → technika a ostatní**.

### Krok 3 — Doplň rešerší (když je vlastních článků málo)

Když z vlastních článků nevyjdou aspoň 2–3 použitelné položky, dohledej zbytek přes `WebSearch`. Ověřené zdroje: **eagri.cz** (MZe), **szif.cz**, **chmi.cz** a **intersucho.cz**, **czso.cz**, **Agrární komora**, **Zemědělský svaz**, **agriculture.ec.europa.eu**.

Pravidla rešerše:

1. Zpráva smí být stará **maximálně 3 dny**.
2. Číslo i instituci musíš mít **přímo ze zdroje**, ne z paměti a ne z odhadu.
3. Do `source` v návrhu zapiš doménu zdroje — kvůli logu a dohledatelnosti.
4. Když se fakt nedá ověřit, položku **vynech**. Kratší pásek je lepší než smyšlený.

### Krok 4 — Sestav návrh a nech skript rozhodnout

Ulož kandidáty jako JSON (pořadí = priorita, nejdůležitější první):

```json
[
  {"label": "CHMEL",  "text": "Chmelaři na Žatecku čekají o pětinu nižší úrodu. Nejsušší léto od roku 1961 srazilo i obsah hořkých látek.", "source": "profifarmar.cz"},
  {"label": "DOTACE", "text": "Osmé kolo dotací na rozvoj venkova rozdělí 2,4 miliardy korun, prioritou je místní zpracování potravin.", "source": "eagri.cz"}
]
```

```bash
python3 scripts/ticker.py apply --file navrh.json --dry-run   # nejdřív nanečisto
python3 scripts/ticker.py apply --file navrh.json             # a pak ostře
```

Co `apply` udělá samo:

| Kontrola | Chování |
|---|---|
| Délka `label`/`text`, HTML, odkazy, nový řádek | Tvrdá chyba — běh skončí, položku přepiš |
| Verzálky, tečka na konci, ideální délka | Varování, ale odešle se |
| Položka už v pásku běží (podobnost ≥ 0,75) | Přeskočí |
| Stejná zpráva byla v pásku posledních 14 dní (`posted-ticker-log.json`) | Přeskočí |
| Duplicita mezi kandidáty navzájem | Přeskočí |
| Položka v pásku starší než 7 dní | Označí jako prošlou a smaže (jde-li mazat) |
| Pásek by přetekl přes 5 | Uvolní místo od nejstarší položky |
| Mazat nejde | Doplní jen do volných slotů a vypíše, co smazat ručně |

Prahy se dají posunout: `--max-age-days`, `--dedupe-days`, `--similarity`.

### Krok 5 — Shrnutí běhu

```
[TICKER] Běh dokončen: DD.MM.RRRR HH:MM
  + CHMEL — Chmelaři na Žatecku čekají o pětinu nižší úrodu…
  + DOTACE — Osmé kolo dotací na rozvoj venkova rozdělí 2,4 miliardy…
  − #2 SUCHO (prošlá, 8 dní)
  V pásku: 5/5 · zdroje: 1× vlastní článek, 1× eagri.cz
```

Když se nic nezměnilo (všechno duplicita, pásek plný a nemá co ustoupit), napiš to jednou větou a skonči. Nepřidávej vatu, jen aby běh „něco udělal“.

---

## Rotace a expirace

- **Pásek drží 5 položek.** Nová položka vytlačí nejstarší.
- **Po 7 dnech položka mizí**, i kdyby bylo volno — týden stará „aktualita“ dělá z pásku archiv.
- Log `posted-ticker-log.json` si pamatuje, co už v pásku bylo, aby se táž zpráva nevrátila do 14 dnů. Log commituj do repa, jinak si příští běh v čerstvém kontejneru nic nepamatuje.

---

## Známé omezení — mazání

`aktuality_webhook.php` umí **jen POST**. `DELETE` a `PUT` existují pouze na `/api/admin/aktuality.php`, kam se servisním klíčem nedostaneš (`401 Neplatná nebo vypršená session`) — ten endpoint chce session z přihlášení do adminu.

Dokud to platí:

- rutina **doplňuje jen do volných slotů**,
- co má jít pryč, vypíše jako `! smaž ručně v adminu: #3 SKLIZEŇ (prošlá)`,
- při plném pásku neudělá nic a napíše proč.

Jak to dorovnat, je v [`reference/api-patch.md`](reference/api-patch.md) — stačí doplnit `DELETE` do webhooku (pár řádků PHP). Po nasazení běží rotace úplně sama; ve skriptu se jen přepne `mutate()` z `ADMIN_URL` na `WEBHOOK_URL`.

---

## Nastavení Routine (cloud)

- **Repozitář:** `kolderbenjamin-sys/Claude-Code-Skills`
- **Environment:** `AI_API_KEY`
- **Prompt:** `Spusť skill agro-ticker: aktualizuj pásek aktualit na Profifarmar.cz.`
- **Čas:** zatím nenastaveno — doporučení je jeden běh ráno **6:45 Europe/Prague** (cron `45 4 * * *` v UTC, v zimě `45 5 * * *`), hned po noční redakční dávce, takže je pásek od rána čerstvý. Druhý běh kolem 15:00 dává smysl jen v obdobích, kdy se zprávy mění během dne (žně, mimořádná opatření, cenové výkyvy).

---

## Chybové stavy

| Stav | Příčina | Autonomní řešení |
|---|---|---|
| `AI_API_KEY není nastavena` | Chybí proměnná | Doplň ji v Environment u Routine, běh ukonči |
| `HTTP 401` na webhooku | Špatný nebo odvolaný klíč | Ukonči běh, nahlas — nezkoušej jiný endpoint |
| `Pole text nesmí překročit 200 znaků` | Dlouhý text prošel do API | Nemělo by nastat, `apply` to chytá dřív — zkrať a opakuj |
| `Chybí povinná pole: label, text` | Prázdná položka v návrhu | Oprav JSON návrhu |
| Mazání vrací 401 | Admin endpoint chce session | Doplň jen do volných slotů, zbytek vypiš k ručnímu úklidu |
| Pásek plný a nic neexpirovalo | 5 čerstvých položek už běží | Nic neposílej, napiš jednou větou že není kam |
| Výpis článků vrátí 100 záznamů | Chybí `limit=10000` | Zopakuj dotaz s limitem |
| Rešerše nenajde ověřený fakt | Klidný den | Pásek nech být — radši 3 pravdivé položky než 5 vycucaných |
