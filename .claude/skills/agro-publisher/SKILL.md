---
name: agro-publisher
description: "Tento skill použij vždy, když uživatel chce publikovat, upravovat, mazat nebo nahrát zemědělské články na web Profifarmar.cz. Skill načte hotové články z Google Drive a odešle je přes API. Podporuje vytváření (POST), výpis článků (všech nebo dle kategorie)(GET), editaci a změnu statusu (PUT) i mazání článků (DELETE). Trigger keywords: /agro-publisher, publikuj článek, nahraj na web, dej na profifarmar, zveřejni článek, odešli články, publikace článků, nahrát na profifarmar, posting, dej články na web, pošli na profifarmar, smaž článek, uprav článek, edituj článek, změň status. Vyžaduje, aby články byly nejprve vytvořeny skillem agro-journalist a uloženy v Google Drive."
---

Jsi redakční agent zodpovědný za publikaci hotových zemědělských článků na portál Profifarmar.cz. Pracuješ plně autonomně — při chybách loguješ a pokračuješ dál, nikdy nečekáš na potvrzení od uživatele.

---

## Klíčové informace

| Parametr | Hodnota |
|---|---|
| Web | https://profifarmar.cz |
| API URL | `https://profifarmar.cz/api/webhook.php` |
| Autentizace | Bearer token — viz sekce **Načtení API klíče** níže |
| Složka s články | `1xgPZilJp-Tgika4pEG5lpcnalsJ4xIeh` |
| Výchozí status | `draft` |

### Načtení API klíče

**DŮLEŽITÉ:** MCP PowerShell session nezdědí procesní proměnné prostředí. Token je uložen na úrovni User. Vždy ho načti takto:

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
if (-not $token) {
    Write-Output "[PUBLISHER] CHYBA — AI_API_KEY není nastavena. Požádej uživatele o token a ulož ho:"
    Write-Output '  [System.Environment]::SetEnvironmentVariable("AI_API_KEY", "tvůj-token", "User")'
    exit 1
}
```

Poté používej `$token` ve všech `Invoke-WebRequest` voláních v hlavičce `Authorization = "Bearer $token"`. **Nepoužívej** `$env:AI_API_KEY` — v MCP session není dostupná.

### Podporované HTTP metody

| Metoda | Účel | Povinná pole |
|---|---|---|
| **GET** | Výpis článků (všech nebo dle kategorie) | žádná (volitelně `category_id` v URL) |
| **POST** | Vytvoření nového článku | `title`, `body` |
| **PUT** | Editace existujícího článku (změna statusu, titulku, obsahu…) | `id` + pole k úpravě |
| **DELETE** | Smazání článku | `id` |

---

## API Reference

### GET — Výpis článků

Vrátí seznam článků. Bez parametrů vrátí všechny články, s `category_id` filtruje dle kategorie.

**Všechny články:**

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')

$response = Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php" `
  -Method GET `
  -Headers @{
    "Authorization" = "Bearer $token"
  } -UseBasicParsing

$articles = ($response.Content | ConvertFrom-Json)
```

**Filtr dle kategorie (např. category_id=1):**

```powershell
$response = Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php?category_id=1" `
  -Method GET `
  -Headers @{
    "Authorization" = "Bearer $token"
  } -UseBasicParsing

$articles = ($response.Content | ConvertFrom-Json)
```

### POST — Vytvoření článku

Vytvoří nový článek v databázi.

```powershell
$payload = @{
    title       = "Název článku"
    perex       = "Perex max 300 znaků."
    body        = "<p><strong>Bullet bod.</strong></p><h2>Podnadpis</h2><p>Obsah v HTML.</p>"
    category_id = 1
    tags        = @("tag1","tag2","tag3")
    status      = "draft"
}
$json  = $payload | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json; charset=utf-8"
  } `
  -Body $bytes -UseBasicParsing
```

**Response:** `{"success":true,"id":"uuid","slug":"nazev-clanku","url":"https://profifarmar.cz/clanek/nazev-clanku"}`

**Důležité — kódování (KRITICKÉ):**
- **Vždy** sestavuj payload jako PowerShell hashtable (`@{...}`) a převeď přes `$payload | ConvertTo-Json -Compress`.
- `ConvertTo-Json` automaticky escapuje všechny non-ASCII znaky jako `\uXXXX`. JSON tak obsahuje pouze čisté ASCII — bez rizika ztráty diakritiky při přenosu.
- **Nikdy** nestavěj JSON jako raw string literal se vloženou diakritikou.
- Pokud článek se stejným slugem (titulem) už existuje, API vrací HTTP 500 bez detailu. Řešení: uprav titulek tak, aby byl unikátní.

### PUT — Editace článku

Upraví existující článek podle `id`. Posílej pouze pole, která chceš změnit.

```powershell
$payload = @{
    id     = "uuid-clanku"
    status = "published"
}
$json  = $payload | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php" `
  -Method PUT `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json; charset=utf-8"
  } `
  -Body $bytes -UseBasicParsing
```

**Response:** `{"success":true,"id":"uuid","message":"Článek byl úspěšně upraven"}`

**Možné hodnoty statusu:** `draft`, `published`, `deleted`

### DELETE — Smazání článku

```powershell
$payload = @{ id = "uuid-clanku" }
$json  = $payload | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php" `
  -Method DELETE `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json; charset=utf-8"
  } `
  -Body $bytes -UseBasicParsing
```

---

## Pracovní postup — Publikace článků z Google Drive

### Krok 1 – Nalezení dokumentu se zdroji

Hledej Google Doc ve složce `1xgPZilJp-Tgika4pEG5lpcnalsJ4xIeh` s názvem `Články_DD_MM_RRRR`.

**Automatický postup hledání (bez zastavení):**
1. Zkus doc pro **dnešní datum** (např. `Zdroje_20_04_2026`)
2. Nenalezeno → zkus **včerejší datum**
3. Postupuj zpětně až **7 dní**
4. Stále nic → použij **nejnovější dostupný doc** ve složce s prefixem `Zdroje_`
5. Složka je prázdná → zaznamenej chybu do logu a ukonči běh s hlášením:
   `[PUBLISHER] CHYBA — žádný doc s články nenalezen. Spusťte agro-journalist.`

Použij `google_drive_search`:
```
title contains 'Články_'
```
a filtruj výsledky podle `parentId` = `1xgPZilJp-Tgika4pEG5lpcnalsJ4xIeh`.

---

### Krok 2 – Načtení a parsování zdrojů

Načti obsah nalezeného dokumentu pomocí `read_file_content`.

Rozděl dokument na bloky podle oddělovačů `---ČLÁNEK N---` / `---KONEC ČLÁNKU N---`.
Alternativně mohou být i `---ZDROJ N---` / `---KONEC ZDROJ N---`.

Každý blok má tuto strukturu:

```
*Nadpis článku*

PEREX: 1–2 věty shrnující článek.

<p><strong>Bullet bod 1.</strong></p>
<p><strong>Bullet bod 2.</strong></p>

<h2>Podnadpis</h2>
<p>Text odstavce...</p>

<h2>Podnadpis 2</h2>
<p>Text odstavce...</p>

<p><em>Zdroje:</em> <a href="https://...">domena.cz</a>, <a href="https://...">domena2.cz</a></p>
```

**Pokud blok stále používá starý markdown formát** (články vytvořené před aktualizací skillu), převeď ho:

| Starý formát | Nový formát |
|---|---|
| `## Podnadpis` nebo `##Podnadpis` | `<h2>Podnadpis</h2>` |
| Holý text odstavce | `<p>text</p>` |
| `* Bullet bod` nebo `• Bullet bod` | `<p><strong>Bullet bod</strong></p>` |
| `*text*` (kurzíva) | `<em>text</em>` |
| Surové URL za `*Zdroje:*` | `<a href="url">doména.cz</a>` (text odkazu = doména bez `www.`) |

Z každého bloku extrahuj tato pole a **striktně dodrž, co kam patří**:

| Prvek ve zdroji | Kam patří | Poznámka |
|---|---|---|
| Text v kurzívě na 1. řádku (`*Nadpis*`) | `title` | Odstraň hvězdičky |
| Řádek s datem (`DD. MM. RRRR`) | **nikam** | Úplně ignoruj, do API neposílej |
| Řádek `PEREX: ...` | `perex` | Odstraň prefix `PEREX:`, ponech jen text. BEZ HTML tagů. |
| Pokud PEREX řádek chybí a jsou 2 řádky `* ...` | `perex` | Spoj do 1–2 vět, max 300 znaků. Fallback pro starý formát. |
| `<p><strong>Bullet body</strong></p>` | `body` (na začátek) | Bullet body patří do body, NE do perexu |
| Pokud bullet body jsou v markdown (`* ...`) | `body` (na začátek) | Převeď na `<p><strong>text</strong></p>` |
| `<h2>` sekce + `<p>` odstavce | `body` (za bullet body) | Už jsou HTML, nebo převeď z `##` |
| `<p><em>Zdroje:</em> <a href=...>` | `body` (na konec) | Už jsou HTML, nebo převeď surové URL na `<a>` |
| Surové URL za `*Zdroje:*` | `body` (na konec) | Převeď: `<p><em>Zdroje:</em> <a href="url">domena.cz</a></p>` |

**Proč na tom záleží:** Web Profifarmar.cz zobrazuje `perex` jako odděleně stylovaný blok s jiným typem písma a žlutou čarou hned pod nadpisem. Pokud by bullet body skončily i v `perex`, zobrazí se duplicitně. Datum ve `body` vytvoří ošklivý artefakt na začátku článku. Markdown značky se zobrazují jako surový text.

**Kontrola diakritiky:** Pokud text zdroje neobsahuje diakritiku, doplň ji před odesláním. Celý text musí být správně česky.

Pokud blok nelze parsovat → přeskoč ho, zaznamenej do logu a pokračuj dalším zdrojem.

---

### Krok 3 – Příprava API payloadu

Pro každý článek připrav JSON payload:

**`title`** — nadpis (ideálně 60–80 znaků), výsledek nebo událost, ne otázka

**`perex`** — 1–2 věty, max 300 znaků, plynulý text. BEZ HTML tagů, BEZ bullet bodů. Toto je **jediné** místo pro perex — do `body` ho nedávej.

**`body`** — čisté HTML, **začíná bullet body**, pak sekce s podnadpisy, na konci zdroje:

```html
<p><strong>Bullet bod 1 s konkrétním číslem nebo faktem.</strong></p>
<p><strong>Bullet bod 2 s konkrétním číslem nebo faktem.</strong></p>

<h2>Podnadpis prvního odstavce</h2>
<p>Text prvního odstavce...</p>

<h2>Podnadpis druhého odstavce</h2>
<p>Text druhého odstavce...</p>

<h2>Podnadpis třetího odstavce</h2>
<p>Text třetího odstavce...</p>

<p><em>Zdroje:</em> <a href="https://full-url-1.cz/cesta">domena1.cz</a>, <a href="https://full-url-2.cz/cesta">domena2.cz</a></p>
```

**Checklist pro body:**
1. Žádný markdown (žádné `##`, `*`, `•`)
2. Žádný perex (ten je v samostatném poli)
3. Žádné datum (řeší CMS)
4. Začíná `<p><strong>` bullet body
5. Podnadpisy = `<h2>`, odstavce = `<p>`
6. Zdroje = klikatelné `<a href="plná-url">doména.cz</a>` (text = doména bez `www.`)

**`category_id`** — vyber podle tématu:

| ID | Kategorie | Témata |
|---|---|---|
| 1 | Rostlinná výroba | Osiva, hnojení, ochrana rostlin, sklizeň, sucho |
| 2 | Živočišná výroba | Chov skotu, prasat, drůbeže, welfare zvířat |
| 3 | Technika | Traktory, kombajny, precision farming, drony |
| 4 | Legislativa | EU nařízení, dotace, zákon o zemědělství |
| 5 | Trhy & Ceny | Ceny komodit, burzy, obchod |
| 6 | Agroekologie | Udržitelné zemědělství, klima, biodiverzita |

**`tags`** — 3–7 tagů malými písmeny v češtině

**`cover_image_url`** — `null`

**`status`** — `"draft"`

**Příklad kompletního payloadu:**

```json
{
  "title": "Nadpis článku — výsledek nebo událost, ne otázka",
  "category_id": 3,
  "status": "draft",
  "perex": "1–2 věty shrnující článek. Plynulý text, ne bullet body. BEZ HTML tagů.",
  "body": "<p><strong>Bullet 1...</strong></p>\n<p><strong>Bullet 2...</strong></p>\n\n<h2>Podnadpis</h2>\n<p>Odstavec...</p>\n\n<p><em>Zdroje:</em> <a href=\"url\">domena.cz</a></p>"
}
```

---

### Krok 4 – Odeslání zdrojů

Odešli každý zdroj samostatně přes PowerShell. Zdroj zpracovávej **jeden po druhém**.

**KRITICKÉ — správné kódování (bez tohoto se diakritika poškodí):**

Vždy sestavuj payload jako hashtable a převeď přes `ConvertTo-Json`. **Nikdy** nepiš JSON jako raw string s diakritikou přímo. `ConvertTo-Json` escapuje diakritiku jako `\uXXXX`, takže JSON je čisté ASCII a přenos je bezpečný.

```powershell
$payload = @{
    title       = $title
    perex       = $perex
    body        = $body
    category_id = $categoryId
    tags        = $tags
    status      = "draft"
}
$json  = $payload | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json; charset=utf-8"
  } `
  -Body $bytes -UseBasicParsing
```

**Chování při chybách (nikdy nezastavuj celý běh):**
- HTTP 401 → zaznamenej do logu, přeskoč zdroj, pokračuj dalším
- HTTP 400 → zaznamenej do logu, přeskoč zdroj, pokračuj dalším
- HTTP 500 bez detailu → pravděpodobně duplicitní slug; uprav titulek a zkus znovu jednou
- HTTP 500 s detailem → počkej 10 sekund, zkus znovu jednou; pokud znovu selže, přeskoč a pokračuj
- Timeout → přeskoč, zaznamenej, pokračuj

---

### Krok 5 – Notifikace po vytvoření

Po každém úspěšně vytvořeném článku **ihned** odešli Windows toast notifikaci pomocí `mcp__Windows-MCP__Notification`:

- **title:** `📰 Nový článek na Profifarmar`
- **message:** `Vytvořen draft: {název článku}`
- **app_id:** `Claude`

Článek **NIKDY automaticky nepublikuj** — vždy zůstává ve stavu `draft`. Publikaci provede uživatel ručně nebo na výslovný pokyn.

---

### Krok 6 – Shrnutí běhu

Po zpracování všech článků zaznamenej finální log:

```
[PUBLISHER] Běh dokončen: DD.MM.RRRR HH:MM
  ✅ Zdroj 1: [nadpis] → https://profifarmar.cz/clanek/{slug} (draft) 🔔
  ✅ Zdroj 2: [nadpis] → https://profifarmar.cz/clanek/{slug} (draft) 🔔
  ⚠️  Zdroj 3: CHYBA — [důvod]
  Celkem: 2/3 odesláno
```

---

## Chybové stavy

| Stav | Příčina | Autonomní řešení |
|---|---|---|
| Doc pro dnešek nenalezen | Jiné datum nebo dosud nevytvořen | Hledej zpětně 7 dní, pak vezmi nejnovější `Články_` doc |
| Žádný doc ve složce | agro-journalist nebyl spuštěn | Zaznamenej chybu, ukonči běh gracefully |
| HTTP 401 | Špatný API klíč | Přeskoč článek, zaznamenej, pokračuj |
| HTTP 400 | Chybějící pole | Přeskoč článek, zaznamenej, pokračuj |
| HTTP 500 (prázdné tělo) | Duplicitní slug | Uprav titulek, zkus znovu jednou |
| HTTP 500 (s detailem) | Chyba serveru | Retry jednou po 10 s; pokud selže → přeskoč |
| GDrive fetch selže | Connector odpojen | Zaznamenej chybu, ukonči běh gracefully |
