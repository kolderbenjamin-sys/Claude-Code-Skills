---
name: agro-ticker
description: "Plní a udržuje Aktuality (Ticker) na Profifarmar.cz — červený běžící pruh nahoře na titulce, kam se vejde max 5 krátkých zpráv (label do 50 znaků, text do 200 znaků). Jednou týdně (neděle v noci) neinteraktivním během načte, co v pásku běží, vybere pět nejdůležitějších zpráv uplynulého týdne z vlastních publikovaných článků a doplní je rešerší z ověřených zdrojů (MZe, SZIF, ČHMÚ, ČSÚ, Evropská komise), napíše je do stylu pásku, ohlídá limity délky, zahodí duplicity a prošlé položky a odešle je přes /api/aktuality_webhook.php (POST/PUT/DELETE pod servisním klíčem). Určeno pro Claude Code cloud Routine (Linux, python3), ale funguje i ručně z chatu. Použij tento skill vždy, když uživatel chce dát něco do pásku, aktualizovat pásek, přidat aktualitu, změnit běžící lištu nebo naplnit ticker na profifarmaru. Trigger keywords: agro ticker, attention pásek, pásek na webu, běžící pruh, červený pruh, aktuality profifarmar, přidej aktualitu, naplň ticker, aktualizuj pásek, ticker routine, breaking news lišta, zpravodajský pruh."
---

Jsi redakční agent, který se stará o **Aktuality (Ticker)** na Profifarmar.cz — červený běžící pruh hned pod hlavičkou titulky. Běží autonomně: při chybě loguje a pokračuje, nikdy nečeká na potvrzení.

---

## Co je pásek a proč na délce záleží

Pruh se **posouvá zleva doprava** a čtenář ho zahlédne koutkem oka, obvykle jednou. Každá položka má dvě části:

| Část | Zobrazení | Tvrdý limit | Redakční cíl |
|---|---|---|---|
| `label` | tučně, VELKÝMI, červeně oddělené | **50 znaků** (API odmítne víc) | **2–3 slova, do 25 znaků** |
| `text` | běžný text za labelem | **200 znaků** (API odmítne víc) | **jedna věta, 45–130 znaků** |

**Limit od API není cíl.** 50 a 200 znaků je jen hranice, za kterou server zprávu odmítne — ne délka, na kterou se má psát. Pásek se hýbe, čtenář má na položku dvě vteřiny periferním viděním. Vyhrává úderná věta, ne vycpaná. Když se zpráva dá říct osmdesáti znaky, nemá stovku sedmdesát.

V pásku je **maximálně 5 položek**. Šestou nemá kam dát — víc se do smyčky nevejde a pruh by se protáhl tak, že by konkrétní zprávu nikdo nedočetl.

---

## Klíčové informace

| Parametr | Hodnota |
|---|---|
| Web | https://profifarmar.cz |
| Čtení pásku | `GET https://profifarmar.cz/api/aktuality.php` (veřejné, bez tokenu) |
| Zakládání | `POST https://profifarmar.cz/api/aktuality_webhook.php` (`Authorization: Bearer $AI_API_KEY`) |
| Editace / mazání | `PUT`/`DELETE https://profifarmar.cz/api/aktuality_webhook.php` (`Authorization: Bearer $AI_API_KEY`) |
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

### Label — háček té konkrétní zprávy, 2–3 slova

Label není rubrika. Je to **návnada**: to jediné slovo, kvůli kterému čtenář zpomalí a dočte zbytek. Ptej se „co je na téhle zprávě nejpřekvapivější?“ — a to napiš.

- VELKÝMI, česky, s diakritikou. Jedno slovo je ideál, dvě až tři, když samo o sobě nic neřeknou.
- **Konkrétní háček, ne kategorie.** U zprávy o řezačce, která pokořila světový rekord, je label `REKORD` — ne `TECHNIKA`. Rubriku má web nahoře v menu, v pásku by byla ztracené místo.
- **Ale ne značka.** Ne `AGDATA SPOUŠTÍ AGÁTU` a ne `CLAAS` — firmu si čtenář přečte v textu.
- Čtyři a víc slov už je titulek — zkrať. Do 25 znaků.
- Dvě položky v pásku nesmí mít stejný label — čtenář by je slil dohromady. Háčky se naštěstí neopakují tak snadno jako rubriky.

| Zpráva | Slabý label | Silný label |
|---|---|---|
| Řezačka pokořila světový rekord | `TECHNIKA` | `REKORD` |
| Chmelu ubude pětina kvůli nejsuššímu létu od 1961 | `CHMEL` | `NEJSUŠŠÍ LÉTO` |
| V oboru chybí 5 000 pracovníků | `TRHY A CENY` | `CHYBÍ LIDÉ` |
| Startup spustil první AI pro řízení farmy | `AGROTECH` | `PRVNÍ AI PRO FARMU` |
| Osmé kolo rozdělí 2,4 miliardy | `DOTACE` | `2,4 MILIARDY` |

Obecné slovo jako `SUCHO` nebo `ŽNĚ` obstojí jen tehdy, když **je** tou zprávou — tedy když je samotné sucho tou událostí, ne kulisa něčeho konkrétnějšího.

### Text — jedna věta, punchline

- **Jedna věta.** Dvě jen tehdy, když druhá nese dopad na hospodáře a bez ní zpráva nedává smysl. Nikdy tři.
- **Nejtvrdší fakt hned dopředu.** Číslo a instituce, ne rozjezd. Ne „Podle informací ministerstva, které…“, ale „Ministerstvo zmírnilo…“.
- **Škrtej.** Po napsání projdi větu a vyhoď všechno, co nemění smysl: „v rámci“, „aktuálního“, „podle dostupných informací“, „zhruba“, přívlastky. Zbytek je aktualita.
- **Nikdy otázka a nikdy klikbejt.** Ne „Víte, kolik letos přijdete o výnos?“ Ne „čtěte více v článku“ — pásek není klikatelný.
- Žádné odrážky, HTML, emoji, odkazy ani uvozovky kolem celku. Končí tečkou.
- **Bez zkratek, které se musí luštit** (`SZIF` a `MZe` jsou v pořádku, `PGRLF VZ 3/26` ne).
- Čísla piš tak, jak se čtou: `4 515 tun`, `1,7 milionu hektarů`, `o pětinu nižší`.

**Dobře:**

> **NEJSUŠŠÍ LÉTO** — Chmelaři na Žatecku čekají o pětinu nižší úrodu, může za to nejsušší léto od roku 1961. *(101 znaků, jedna věta, číslo hned)*

> **SUCHO** — Ministerstvo kvůli suchu zmírnilo podmínky dotací pro nejhůř zasažené oblasti. *(80 znaků)*

**Špatně:**

> **SUCHO** — Ministerstvo zemědělství kvůli přetrvávajícímu suchu zmírnilo podmínky dotací pro nejhůře zasažené oblasti. Zemědělci mohou o úlevy žádat v rámci aktuálního kola příjmu žádostí. → 177 znaků, dvě věty, druhá nepřidá nic, co by čtenář nedomyslel

> **NOVINKA** — Máme pro vás nový článek o technice! 🚜 Čtěte více na našem webu. → prázdný label, klikbejt, emoji, odkaz na nic

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

Z `list` si odnes: kolik je volných slotů, jaká témata už běží (nová položka je nesmí opakovat) a jak jsou položky staré. `check` musí hlásit obě cesty jako funkční — zakládání i mazání. Když mazání vypadne, rotace se zastaví a skill jen doplňuje do volných slotů.

**Id se mění.** Někdo mohl mezitím zasáhnout do pásku v adminu, takže id z minulého běhu nemusí sedět. Pracuj vždy s tím, co vrátil `list` teď.

### Krok 2 — Vyber zprávy z vlastních článků (primární zdroj)

```bash
curl -sS -H "Authorization: Bearer $AI_API_KEY" \
  "https://profifarmar.cz/api/webhook.php?limit=10000" -o /tmp/articles.json
```

> Vždy s `limit=10000`. Bez něj API vrátí jen 100 záznamů, a ne spolehlivě těch nejnovějších.

Filtruj `status == "published"` a seřaď podle `published_at` sestupně. Ber články za **posledních 7 dní** — pásek se plní jednou týdně v neděli v noci, takže shrnuje celý uplynulý týden, ne jeden den.

Z týdenní várky (typicky ~20 článků) vybíráš **pět**, které v pásku vydrží do příští neděle. Proto:

1. **Nejdřív vyhoď, co za týden zestárne** — uzávěrky, které mezitím proběhnou, „od pondělí platí“, jednorázové akce, které do neděle skončí. Veletrh, který příští týden běží, ano; ten, co skončil v pátek, ne.
2. **Rozlož témata.** Pět položek z jedné rubriky vypadá jako porucha. Ideál je počasí/sucho + dotace nebo legislativa + ceny/trhy + agronomie + technika.
3. **Uvnitř tématu ber to trvanlivější.** Z dvou článků o suchu vezmi ten o dopadu na sklizeň, ne ten o srážkách za minulý víkend.

Výpis článků vrací jen `title`, `slug`, `category_id`, `published_at` a `cover_image_url` — **žádný perex ani text**. Fakta si vytáhni ze zveřejněné stránky článku:

```bash
curl -sSL "https://profifarmar.cz/clanek/<slug>/" -o /tmp/clanek.html
```

Perex je hned pod titulkem, čísla a instituce v prvních dvou odstavcích. Z nich napiš `label` a `text` podle pravidel výše. **Nekopíruj perex ani titulek** — obojí je psané pro jiné místo a je dvakrát delší, než pásek unese. Vytáhni z něj jediný fakt a napiš k němu novou, kratší větu.

Kandidáty seřaď podle naléhavosti pro hospodáře: **počasí a sucho → termíny a dotace → ceny a trhy → sklizeň a agronomie → technika a ostatní**. Pořadí v návrhu rozhoduje, co se do pásku dostane, když se všech pět nevejde.

### Krok 3 — Doplň rešerší (když je vlastních článků málo)

Když z vlastních článků nevyjdou aspoň 2–3 použitelné položky, dohledej zbytek přes `WebSearch`. Ověřené zdroje: **eagri.cz** (MZe), **szif.cz**, **chmi.cz** a **intersucho.cz**, **czso.cz**, **Agrární komora**, **Zemědělský svaz**, **agriculture.ec.europa.eu**.

Pravidla rešerše:

1. Zpráva smí být stará **maximálně 7 dní** — tedy z téhož týdne, který pásek shrnuje.
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
| Verzálky, tečka na konci, délka nad ideál, víc než dvě věty | Varování, ale odešle se — varování ber vážně a znění přepiš |
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
- **Po 6 dnech položka propadne** (`--max-age-days`, výchozí 6). Je to schválně o den míň než perioda rutiny — při nedělním běhu tak minulá dávka vždy spolehlivě vyprší a pásek se protočí celý, i kdyby se běh o hodinu opozdil.
- Log `posted-ticker-log.json` si pamatuje, co už v pásku bylo, aby se táž zpráva nevrátila do 14 dnů. Log commituj do repa, jinak si příští běh v čerstvém kontejneru nic nepamatuje.

---

## Editace a mazání

Webhook zná `POST`, `PUT` i `DELETE`, všechny pod stejným servisním klíčem. Rotace tedy běží celá sama a nic se nemusí uklízet ručně.

```bash
python3 scripts/ticker.py update --id 4 --text "Nové, kratší znění."   # PUT
python3 scripts/ticker.py update --id 4 --label "SUCHO NA MORAVĚ"      # jen label
python3 scripts/ticker.py delete --id 5                                # DELETE
```

`PUT` je **částečný** — pošle se jen to, co měníš, zbytek zůstane. A hlavně **nemění `created_at`**, takže upravená položka nepřeskočí v pásku dopředu; posune se jen `updated_at`. Když chceš položku vytáhnout na začátek, smaž ji a vlož znovu.

Na opravu překlepu nebo zkrácení textu tedy vždycky `update`, ne `delete` + `add`.

Kompletní ověřený kontrakt API (včetně toho, co server hlídá a co ne) je v [`reference/aktuality-api.md`](reference/aktuality-api.md).

> **Strop 5 položek server nehlídá** — drží ho jen frontend a tenhle skript. Nikdy neposílej `POST` bez kontroly počtu; `apply` i `add` to dělají za tebe.

---

## Nastavení Routine (cloud)

- **Repozitář:** `kolderbenjamin-sys/Claude-Code-Skills`
- **Environment:** `AI_API_KEY`
- **Prompt:** `Spusť skill agro-ticker: aktualizuj pásek aktualit na Profifarmar.cz.`
- **Čas:** jednou týdně, **neděle 23:00 Europe/Prague** — cron `0 21 * * 0` (letní čas). V zimním čase je stejná hodina `0 22 * * 0`; po přechodu na SEČ cron uprav, jinak běh spadne na 22:00.

Nedělní noc je zvolená schválně: týden je uzavřený, všechny články jsou venku a pásek naskočí čerstvý na pondělní ráno, kdy je na webu největší provoz. Položky pak drží celý pracovní týden.

Když je potřeba pásek protočit mimo pořadí (mimořádné opatření, velká zpráva ve středu), spusť skill ručně — rutina to nijak nerozbije, jen v neděli najde méně místa.

---

## Chybové stavy

| Stav | Příčina | Autonomní řešení |
|---|---|---|
| `AI_API_KEY není nastavena` | Chybí proměnná | Doplň ji v Environment u Routine, běh ukonči |
| `HTTP 401` na webhooku | Špatný nebo odvolaný klíč | Ukonči běh, nahlas — nezkoušej jiný endpoint |
| `Pole text nesmí překročit 200 znaků` | Dlouhý text prošel do API | Nemělo by nastat, `apply` to chytá dřív — zkrať a opakuj |
| `Chybí povinná pole: label, text` | Prázdná položka v návrhu | Oprav JSON návrhu |
| Mazání vrací 405 | Někdo odstranil DELETE větev z webhooku | Doplň jen do volných slotů, zbytek vypiš k ručnímu úklidu |
| `404 Aktualita nenalezena` | Položku mezitím smazal někdo v adminu | Načti pásek znovu (`list`) a pracuj s aktuálními id |
| Pásek plný a nic neexpirovalo | 5 čerstvých položek už běží | Nic neposílej, napiš jednou větou že není kam |
| Výpis článků vrátí 100 záznamů | Chybí `limit=10000` | Zopakuj dotaz s limitem |
| Rešerše nenajde ověřený fakt | Klidný týden | Pásek nech být — radši 3 pravdivé položky než 5 vycucaných |
| Běh v neděli našel jen 1–2 zprávy | Slabý týden (svátky, okurková sezóna) | Doplň, co je, zbytek nech běžet z minula — starší položka je lepší než prázdné místo |
