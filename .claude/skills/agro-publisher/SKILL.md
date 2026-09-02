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

Vrátí seznam článků. Bez parametrů vrátí jen **posledních 100 záznamů, a ne spolehlivě
těch nejnovějších podle `published_at`** (ověřeno 17.8.2026: DB měla 221 článků, výchozích
100 vynechalo jeden ze tří téhož dne publikovaných). Pro spolehlivý úplný výpis vždy použij
`?limit=10000`. `category_id` filtruje dle kategorie a jde kombinovat s `limit`.

**Všechny články:**

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')

$response = Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php?limit=10000" `
  -Method GET `
  -Headers @{
    "Authorization" = "Bearer $token"
  } -UseBasicParsing

$articles = ($response.Content | ConvertFrom-Json)
```

**Vrácená pole:** `id`, `title`, `slug`, `category_id`, `status`, `published_at`,
`cover_image_url`, `meta_title`, `meta_description`. Perex ani body GET nevrací — pro ně je
nutné načíst veřejnou stránku článku.

Články bez SEO meta tagů (`meta_title` nebo `meta_description` je `null`) se dají z výpisu
vyfiltrovat takto:

```powershell
$chybi = $articles.data | Where-Object { -not $_.meta_title -or -not $_.meta_description }
Write-Output "[PUBLISHER] Bez meta tagů: $($chybi.Count) článků"
```

**Filtr dle kategorie (např. category_id=1):**

```powershell
$response = Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php?category_id=1&limit=10000" `
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
    title            = "Název článku"
    perex            = "Perex max 300 znaků."
    body             = "<h2>Podnadpis</h2><p>Obsah v HTML.</p>"
    category_id      = 1
    tags             = @("tag1","tag2","tag3")
    status           = "draft"
    meta_title       = "SEO titulek do 60 znaků"
    meta_description = "SEO popisek na 150–160 znaků s konkrétním číslem nebo faktem z článku."
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

**POZOR — tichá chyba:** API má whitelist povolených polí. Pole, které v něm není (překlep,
`seo_title` místo `meta_title`), **nezpůsobí chybu** — server vrátí HTTP 200 a
`{"success":true,"message":"Nebyly provedeny žádné změny"}` a nezapíše nic. Tuhle hlášku ber
vždy jako selhání zápisu, ne jako úspěch: zkontroluj názvy polí a zaznamenej to do logu.
Doplnění meta tagů ke staršímu článku vypadá takto:

```powershell
$payload = @{
    id               = "uuid-clanku"
    meta_title       = "SEO titulek do 60 znaků"
    meta_description = "SEO popisek na 150–160 znaků."
}
```

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
| `* Bullet bod` nebo `• Bullet bod` (jen ve starých doc) | `<p>Bullet bod</p>` — tučný souhrn se už nepoužívá |
| `*text*` (kurzíva) | `<em>text</em>` |
| Surové URL za `*Zdroje:*` | `<a href="url">doména.cz</a>` (text odkazu = doména bez `www.`) |

Z každého bloku extrahuj tato pole a **striktně dodrž, co kam patří**:

| Prvek ve zdroji | Kam patří | Poznámka |
|---|---|---|
| Text v kurzívě na 1. řádku (`*Nadpis*`) | `title` | Odstraň hvězdičky |
| Řádek s datem (`DD. MM. RRRR`) | **nikam** | Úplně ignoruj, do API neposílej |
| Řádek `PEREX: ...` | `perex` | Odstraň prefix `PEREX:`, ponech jen text. BEZ HTML tagů. |
| Řádek `META_TITLE: ...` | `meta_title` | Odstraň prefix, ponech jen text. Max 60 znaků. |
| Řádek `META_DESCRIPTION: ...` | `meta_description` | Odstraň prefix, ponech jen text. 150–160 znaků. |
| Řádky META_* chybí (starší doc) | `meta_title`, `meta_description` | Dogeneruj je sám podle pravidel v Kroku 3. Nikdy neposílej článek bez nich. |
| Pokud PEREX řádek chybí a jsou 2 řádky `* ...` | `perex` | Spoj do 1–2 vět, max 300 znaků. Fallback pro starý formát. |
| `<h2>` sekce + `<p>` odstavce | `body` (od začátku) | Už jsou HTML, nebo převeď z `##` |
| Tučný souhrnný odstavec na začátku (`<p><strong>…</strong></p>` nebo `* …`) — **jen u starších článků** | `body` (na začátek) | Nové články ho nemají. U starších převeď markdown na prostý `<p>text</p>` (bez `<strong>`). Do `perex` NIKDY. |
| `<p><em>Zdroje:</em> <a href=...>` | `body` (na konec) | Už jsou HTML, nebo převeď surové URL na `<a>` |
| Surové URL za `*Zdroje:*` | `body` (na konec) | Převeď: `<p><em>Zdroje:</em> <a href="url">domena.cz</a></p>` |

**Proč na tom záleží:** Web Profifarmar.cz zobrazuje `perex` jako odděleně stylovaný blok s jiným typem písma a žlutou čarou hned pod nadpisem. Pokud by se text z `body` zopakoval i v `perex`, zobrazí se duplicitně. Datum ve `body` vytvoří ošklivý artefakt na začátku článku. Markdown značky se zobrazují jako surový text.

**Kontrola diakritiky:** Pokud text zdroje neobsahuje diakritiku, doplň ji před odesláním. Celý text musí být správně česky.

Pokud blok nelze parsovat → přeskoč ho, zaznamenej do logu a pokračuj dalším zdrojem.

---

### Krok 3 – Příprava API payloadu

Pro každý článek připrav JSON payload:

**`title`** — nadpis (ideálně 60–80 znaků), výsledek nebo událost, ne otázka

**`perex`** — 1–2 věty, max 300 znaků, plynulý text. BEZ HTML tagů, BEZ odrážek. Toto je **jediné** místo pro perex — do `body` ho nedávej.

**`body`** — čisté HTML, **začíná prvním podnadpisem**, pak sekce s odstavci, na konci zdroje:

```html
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
4. Začíná podnadpisem `<h2>`
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

**`meta_title`** — SEO titulek pro výsledky vyhledávání, **max 60 znaků**. Není to zkopírovaný
`title` — ten bývá delší a publicističtější. Sem patří výstižná verze zaměřená na klíčové slovo,
ideálně s klíčovým slovem na začátku. Když se `title` do 60 znaků vejde a je dost konkrétní,
může zůstat stejný.

**`meta_description`** — SEO popisek, **150–160 znaků**. Není to zkopírovaný `perex`. Má lákat
ke kliknutí konkrétním číslem, faktem nebo přínosem z článku, ale **nesmí slibovat víc, než
v článku opravdu je** — žádný clickbait.

**Unikátnost meta polí (povinná kontrola před odesláním):** žádné dva články na webu nesmějí mít
stejný ani skoro stejný `meta_title` — jinak si v hledání kradou pozice navzájem (keyword
cannibalization). Před odesláním si načti existující meta titulky přes GET a porovnej:

```powershell
$existujici = ($response.Content | ConvertFrom-Json).data |
    Where-Object { $_.meta_title } | ForEach-Object { $_.meta_title.ToLower() }

if ($existujici -contains $metaTitle.ToLower()) {
    Write-Output "[PUBLISHER] KOLIZE — meta_title uz existuje, prepis ho jinym uhlem: $metaTitle"
}
```

Kolize řeš jiným úhlem pohledu (jeden článek na výkon, druhý na cenu, třetí na srovnání
s konkurencí), ne přidáním čísla nebo roku na konec. Kontroluj i články ve stejné dávce
navzájem, nejen proti DB.

**Porovnávej i titulky, nejen `meta_title`.** Starší články mají meta pole prázdná, takže
kontrola proti `meta_title` u nich nic nenajde — a přesně na stejné téma přitom už článek
existovat může. Projeď proto i `title` všech článků a hledej shodu v klíčových slovech:

```powershell
$klic = "sklizeň obilovin"   # 2–3 hlavní slova z tématu
($response.Content | ConvertFrom-Json).data |
    Where-Object { $_.title -and $_.title.ToLower().Contains($klic) } |
    ForEach-Object { Write-Output "[PUBLISHER] PODOBNÝ ČLÁNEK: $($_.title)" }
```

Výpis vždy dotahuj s `?limit=10000` — jsou v něm i drafty a ty mají `published_at` prázdné.
Na `null` hodnoty (`published_at`, `meta_title`, `cover_image_url`) kontrola nesmí spadnout;
ošetři je, jinak seznam skončí v půlce a kolizi přehlédneš.

**Kontrola délek — počítej, neodhaduj:**

```powershell
if ($metaTitle.Length -gt 60) {
    Write-Output "[PUBLISHER] meta_title ma $($metaTitle.Length) znaku (max 60) - prepis ho kratsi"
}
if ($metaDescription.Length -lt 150 -or $metaDescription.Length -gt 160) {
    Write-Output "[PUBLISHER] meta_description ma $($metaDescription.Length) znaku (cil 150-160) - uprav ho"
}
```

Text, který je moc dlouhý, **přepiš** — neřež ho uprostřed slova a nelep na konec tři tečky.
Diakritika se počítá normálně, `ř` i `č` je jeden znak.

**`tags`** — 3–7 tagů malými písmeny v češtině

**`cover_image_url`** — `null`

**`status`** — `"draft"`

**Příklad kompletního payloadu:**

```json
{
  "title": "Nadpis článku — výsledek nebo událost, ne otázka",
  "category_id": 3,
  "status": "draft",
  "perex": "1–2 věty shrnující článek. Plynulý text, žádné odrážky. BEZ HTML tagů.",
  "meta_title": "SEO titulek do 60 znaků s klíčovým slovem",
  "meta_description": "SEO popisek na 150–160 znaků, který obsahuje konkrétní číslo nebo fakt z článku a láká ke kliknutí, aniž by sliboval víc, než v textu je.",
  "body": "<h2>Podnadpis</h2>\n<p>Odstavec...</p>\n\n<p><em>Zdroje:</em> <a href=\"url\">domena.cz</a></p>"
}
```

---

### Krok 4 – Odeslání zdrojů

Odešli každý zdroj samostatně přes PowerShell. Zdroj zpracovávej **jeden po druhém**.

**KRITICKÉ — správné kódování (bez tohoto se diakritika poškodí):**

Vždy sestavuj payload jako hashtable a převeď přes `ConvertTo-Json`. **Nikdy** nepiš JSON jako raw string s diakritikou přímo. `ConvertTo-Json` escapuje diakritiku jako `\uXXXX`, takže JSON je čisté ASCII a přenos je bezpečný.

```powershell
$payload = @{
    title            = $title
    perex            = $perex
    body             = $body
    category_id      = $categoryId
    tags             = $tags
    status           = "draft"
    meta_title       = $metaTitle
    meta_description = $metaDescription
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
| `"Nebyly provedeny žádné změny"` u PUT | Pole není ve whitelistu API (překlep v názvu) | Zkontroluj názvy polí — správně je `meta_title` a `meta_description`; ber to jako selhání zápisu, ne jako úspěch |
| `meta_title` delší než 60 znaků | Text nebyl napsán na míru limitu | Přepiš ho kratší, neřež uprostřed slova |
| Kolize `meta_title` s existujícím článkem | Dva články na příbuzné téma | Přepiš jeden z nich jiným úhlem; při skoro shodném obsahu druhý článek nepublikuj |
| GDrive fetch selže | Connector odpojen | Zaznamenej chybu, ukonči běh gracefully |
