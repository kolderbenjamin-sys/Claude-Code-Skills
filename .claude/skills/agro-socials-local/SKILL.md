---
name: agro-socials-local
description: Vezme publikovaný zemědělský článek z Profifarmar.cz a vytvoří z něj příspěvek na sociální sítě pomocí Canva šablony (interaktivní/lokální varianta, na rozdíl od agro-social-cloud). Pipeline načte nejnovější publikovaný článek přes Profifarmar API, zkopíruje Canva šablonu (DAHOBdpJ1tk - ProfiFarmář 4:5 Stacked), vymění kategorii, datum, titulek a cover fotku, exportuje PNG (1080×1334, preserved aspect), nahraje na Cloudinary a publikuje IHNED přes Buffer na Instagram a Facebook. Použij vždy, když uživatel chce udělat příspěvek na sítě z článku, postnout nejnovější článek, sdílet článek na sociální sítě, nebo sdílet článek na Instagram a Facebook. Trigger keywords - agro social, agro socials local, postni na sítě, sdílej článek, social příspěvek z článku, canva šablona článek, příspěvek instagram facebook článek, social media agro článek.
---

# Agro-Socials Skill

Vytvoří social media příspěvek z **publikovaného článku** na Profifarmar.cz. Naplní Canva šablonu titulkem,
kategorií, datem a cover fotkou, vyexportuje PNG, nahraje na Cloudinary a **ihned publikuje** příspěvky na
Instagram a Facebook přes Buffer. Vše v češtině.

> **Kontrola před publikací:** Posty se publikují okamžitě / s minimálním delay (nelze odnaplánovat).
> Před Krokem 5 ukaž uživateli vizuál ([CLOUDINARY_URL]) a oba texty a počkej na potvrzení.
> Přeskoč POUZE pokud uživatel explicitně řekl „rovnou / bez kontroly / autonomně".

---

## Vstup — který článek

- **Bez upřesnění** („postni na sítě nejnovější článek") → vezmi **nejnovější `published` článek** z Profifarmar API.
- **S tématem** („sdílej článek o cenách mléka") → najdi nejnovější `published` článek, jehož titulek/perex
  tématu odpovídá.
- Pracuj s článkem, který **má vyplněný `cover_image_url`** (potřebujeme cover fotku do šablony). Pokud nejnovější
  článek cover nemá, vezmi nejbližší novější, který ho má, a informuj uživatele.

**Sdílené proměnné:**
- `[TITULEK]` — `title` článku. Pokud je delší než ~75 znaků, **smysluplně zkrať** (zachovej hlavní sdělení
  a čísla, neusekávej uprostřed slova/věty).
- `[KATEGORIE]` — název kategorie podle `category_id` (mapování níže)
- `[DATUM]` — měsíc + rok **z `published_at` článku** + region (auto), velkými písmeny.
  Formát `ČERVEN 2026 · ČR` (region viz níže)
- `[DATUM_SLUG]` — rok-měsíc publikace, formát `2026-06` (pro Cloudinary public_id — bez diakritiky a mezer!)
- `[COVER_URL]` — `cover_image_url` článku
- `[ID]` — krátký ASCII slug pro Cloudinary public_id (např. `falcon_sf700`, `farmdroid`, `valtra_cvt`)
- `[CLANEK_URL]` — URL článku: použij pole `url` z API response, pokud existuje; jinak sestav
  `https://profifarmar.cz/clanek/<slug>` z pole `slug`. Pokud API nevrací ani jedno, ověř URL přes
  GET na sestavenou adresu (status 200) a při neúspěchu odkaz vynech a informuj uživatele.

**Mapování kategorií (`category_id` → `[KATEGORIE]`):**

| ID | Kategorie |
|---|---|
| 1 | ROSTLINNÁ VÝROBA |
| 2 | ŽIVOČIŠNÁ VÝROBA |
| 3 | TECHNIKA |
| 4 | LEGISLATIVA |
| 5 | TRHY & CENY |
| 6 | AGROEKOLOGIE |

**Region v datu (`[DATUM]` suffix) — auto podle tématu článku:**
- Defaultně `· ČR` (české zemědělství, lokální témata)
- `· EU` pokud článek se týká celé EU / evropského trhu
- `· FINSKO`, `· DÁNSKO`, `· FRANCIE` atd. pokud článek se primárně týká konkrétní zahraniční země
  (např. dánský robot, finská továrna, francouzská sklizeň)
- Pokud si nejsi jistý, použij `· ČR`.

---

## Krok 1 — Načti článek z Profifarmar API

```
API URL    = https://profifarmar.cz/api/webhook.php
Autentizace = Bearer token z env proměnné AI_API_KEY (User scope)
```

```powershell
$ProgressPreference = 'SilentlyContinue'
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
if (-not $token) {
    Write-Output "[AGRO-SOCIAL] CHYBA — AI_API_KEY není nastavena. Ulož ji:"
    Write-Output '  [System.Environment]::SetEnvironmentVariable("AI_API_KEY", "tvůj-token", "User")'
    exit 1
}

$response = Invoke-WebRequest -Uri "https://profifarmar.cz/api/webhook.php" -Method GET `
  -Headers @{ "Authorization" = "Bearer $token" } -UseBasicParsing
$json = $response.Content | ConvertFrom-Json
$articles = if ($json.data) { $json.data } else { $json }

$article = $articles |
  Where-Object { $_.status -eq "published" -and $_.cover_image_url } |
  Sort-Object { try { [datetime]$_.published_at } catch { [datetime]::MinValue } } -Descending |
  Select-Object -First 1
```

Z `$article` vyplň proměnné `[TITULEK]`, `[KATEGORIE]` (přes `category_id`), `[DATUM]` (z `published_at`),
`[DATUM_SLUG]`, `[COVER_URL]`, `[CLANEK_URL]`.

---

## Krok 2 — Naplň Canva šablonu (MCP)

**Šablona (template design ID):** `DAHOBdpJ1tk` — **ProfiFarmář 4:5 Stacked** (1 stránka, native 408×504).

> ⚠️ **DŮLEŽITÉ — root cause poznámka:** Canva nemůže design natáhnout neproporcionálně. Pokud
> v `export-design` zadáš `width` AND `height` které neodpovídají native aspect ratio designu
> (408:504 = 0.8095), Canva přidá **transparent padding** na vyrovnání. Proto v Kroku 3 zadáváme
> **POUZE `width: 1080`** — aspect ratio se zachová a výsledek je čistý 1080×1334 PNG bez transparent edges.

1. **Zkopíruj šablonu** — `copy-design` (paralelně s Krok 2.2):
   ```
   mcp__canva__copy-design   designId: DAHOBdpJ1tk
   → ulož nové designId jako [COPY_ID]
   ```

2. **Nahraj cover fotku** jako asset z URL — `upload-asset-from-url` (paralelně s Krok 2.1):
   ```
   mcp__canva__upload-asset-from-url   url: [COVER_URL]   name: "cover_[ID]"
   → ulož assetId jako [COVER_ASSET_ID]
   ```

3. **Otevři editační transakci** — `start-editing-transaction`:
   ```
   mcp__canva__start-editing-transaction   designId: [COPY_ID]
   → ulož transaction_id jako [TX_ID]
   → z richtexts přečti element IDs pro kategorii, datum, titulek
   → z fills přečti element ID pro cover image
   ```

   > 🔑 **Autorita pro element IDs je VŽDY response ze `start-editing-transaction`** — kopie designu
   > může mít jiná ID než originál. Tabulka níže je jen nápověda pro orientaci.

   **Orientační element IDs originální šablony `DAHOBdpJ1tk` (str. 1, page_id `PBq9qr86WDHScDx5`):**
   | Element | ID suffix | Typ | Pozice |
   |---|---|---|---|
   | Kategorie (SHAPE s textem) | `LBwBD8HsxVkMpMc8` | SHAPE | top=206, w=130 h=23 |
   | Datum + region | `LBKSrz7mKnSrsYmB` | TEXT | top=259 |
   | Titulek | `LBXWW9JWn2KBw5Md` | TEXT | top=280, w=361 |
   | Cover image (fill) | `LBML0Ply1GM4nFqh` | SHAPE | top=0, w=408 h=240 |
   | Profi Farmář (logo + text) | `LBM75h00WhJWWH0T`, `LBZ7Pf1D8WnzlT5S` | — | neměň |
   | profifarmar.cz, VÍCE V ČLÁNKU | `LBlQYz0s68qKD6Kv`, `LBHnvwnhl0KSghH1` | — | neměň |

   Plná ID: `<page_id>-LB...`

4. **Vyměň obsah** — `perform-editing-operations`:
   ```
   mcp__canva__perform-editing-operations
     transaction_id: [TX_ID]
     page_index: 1
     pages: [{ page_id: "<page_id>", is_responsive: false, is_editable: true }]
     operations:
       - replace_text  elementId: [KATEGORIE_ID]  text: [KATEGORIE]
       - replace_text  elementId: [DATUM_ID]      text: [DATUM]      ← VŽDY, nikdy nevynechávej
       - replace_text  elementId: [TITULEK_ID]    text: [TITULEK]  (max ~75 znaků)
       - update_fill   elementId: [COVER_ID]      assetId: [COVER_ASSET_ID]  assetType: image  altText: "..."
   ```

   > **POZN.:** Výměna data je **povinná při každém běhu** — šablona obsahuje statické datum
   > „Květen 2026 · ČR" z minulosti a bez `replace_text` by post vyšel se starým měsícem.

5. **Commitni transakci:**
   ```
   mcp__canva__commit-editing-transaction   transaction_id: [TX_ID]
   ```

**Kontrola:** titulek musí být čitelný a zalomený, datum aktuální, cover na správném místě, branding zachovaný.

---

## Krok 3 — Export PNG z Canvy (HD, preserved aspect)

```
mcp__canva__export-design
  designId: [COPY_ID]
  format:
    type: png
    width: 1080            ← POUZE width, height NEZADÁVAT!
    lossless: true
    export_quality: pro
    pages: [1]
→ vrátí PNG URL, výsledný rozměr 1080×1334
```

> ⚠️ **NIKDY nezadávej `height` současně s `width`** — když nesedí native aspect ratio designu
> (0.8095), Canva přidá transparent padding (8 px nahoře + 8 px dole), který na IG/FB vytvoří
> viditelné čáry. S preserved aspect (1080×1334) je výsledek čistý.

**Stáhni PNG IHNED** (URL platí omezeně):
```powershell
$tmp = "$env:TEMP\social_[ID].png"
Invoke-WebRequest -Uri "[PNG_URL]" -OutFile $tmp -UseBasicParsing
```
→ ulož cestu jako `[LOCAL_PNG]`

---

## Krok 4 — Cloudinary upload (PowerShell REST API)

Cloudinary MCP nepodporuje `file://` cesty — upload jde přes REST API z PC (Windows-MCP PowerShell).

> 🔐 **Credentials se čtou z env proměnných (User scope), NIKDY je nepiš do kódu ani výstupu:**
> `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
> Pokud chybí, řekni uživateli, ať je nastaví přes
> `[System.Environment]::SetEnvironmentVariable("CLOUDINARY_API_SECRET","...","User")` (analogicky ostatní).

```
folder    = "SOCIALS"
publicId  = "social_[DATUM_SLUG]_[ID]"   ← jen ASCII, čísla, pomlčky, podtržítka!
eager     = "w_1080,c_scale,q_100,f_png"  ← čistý PNG, žádný flatten (není potřeba)
```

> ⚠️ `public_id` NESMÍ obsahovat diakritiku, mezery ani `·` — rozbilo by to signature a URL.
> Proto `[DATUM_SLUG]` (`2026-06`), nikdy `[DATUM]` (`ČERVEN 2026 · ČR`).
> `[ID]` musí být ASCII slug (např. `falcon_sf700`, ne `Falcon SF700`).

```powershell
$ProgressPreference = 'SilentlyContinue'
$filePath  = "[LOCAL_PNG]"
$cloudName = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_CLOUD_NAME', 'User')
$apiKey    = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_API_KEY', 'User')
$apiSecret = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_API_SECRET', 'User')
if (-not $cloudName -or -not $apiKey -or -not $apiSecret) {
    Write-Output "[AGRO-SOCIAL] CHYBA — Cloudinary env proměnné chybí."
    exit 1
}
$folder    = "SOCIALS"
$publicId  = "social_[DATUM_SLUG]_[ID]"
$eager     = "w_1080,c_scale,q_100,f_png"

$timestamp = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).ToString()
# Parametry v signature MUSÍ být abecedně seřazeny
$paramString = "eager=$eager&folder=$folder&overwrite=true&public_id=$publicId&timestamp=$timestamp" + $apiSecret
$sha1 = [System.Security.Cryptography.SHA1]::Create()
$hash = $sha1.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($paramString))
$signature = -join ($hash | ForEach-Object { $_.ToString("x2") })

$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"
$enc = [System.Text.Encoding]::UTF8
$url = "https://api.cloudinary.com/v1_1/$cloudName/image/upload"

$wr = [System.Net.HttpWebRequest]::Create($url)
$wr.Method = "POST"; $wr.ContentType = "multipart/form-data; boundary=$boundary"; $wr.Timeout = 120000
$rs = $wr.GetRequestStream()
function Add-FormField($s,$b,$n,$v) {
    $d="--$b$LF" + "Content-Disposition: form-data; name=`"$n`"$LF$LF" + "$v$LF"
    $bb=$enc.GetBytes($d); $s.Write($bb,0,$bb.Length)
}
Add-FormField $rs $boundary "api_key"    $apiKey
Add-FormField $rs $boundary "timestamp"  $timestamp
Add-FormField $rs $boundary "signature"  $signature
Add-FormField $rs $boundary "folder"     $folder
Add-FormField $rs $boundary "public_id"  $publicId
Add-FormField $rs $boundary "overwrite"  "true"
Add-FormField $rs $boundary "eager"      $eager

$fh = "--$boundary$LF" + "Content-Disposition: form-data; name=`"file`"; filename=`"social.png`"$LF" + "Content-Type: image/png$LF$LF"
$fhb = $enc.GetBytes($fh); $rs.Write($fhb,0,$fhb.Length)
$fs = [System.IO.File]::OpenRead($filePath); $fs.CopyTo($rs); $fs.Close()
$eb = $enc.GetBytes("$LF--$boundary--$LF"); $rs.Write($eb,0,$eb.Length); $rs.Close()

try {
    $resp = $wr.GetResponse()
    $result = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    $json = $result | ConvertFrom-Json
    if ($json.eager -and $json.eager[0].secure_url) {
        $eagerUrl = $json.eager[0].secure_url
    } else {
        $eagerUrl = $json.secure_url -replace '/image/upload/', "/image/upload/$eager/"
    }
    Write-Output "EAGER URL: $eagerUrl"
} catch [System.Net.WebException] {
    $errBody = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
    Write-Output "ERROR: $errBody"
}
```

Z výstupu vezmi `EAGER URL` → **`[CLOUDINARY_URL]`** (jde do Bufferu).
**Retry:** při `ERROR:` počkej 5 s a zkus 1× znovu.

---

## Krok 5 — Copywriting (1 text per platforma)

### Instagram
- **Styl:** vizuální, emocionální, vytáhni hlavní číslo/fakt z článku.
- **Délka:** 1–3 věty, max 150 znaků.
- **CTA:** „Celý článek v biu ↗", „Uložte si to 🔖".
- **Hashtagy: vždy přesně 5** — z `#zemedelstvi #agro #ceskezemedelstvi #profifarmar` + 1–2 tematické z článku.

### Facebook
- **Styl:** komunitní, příběhový, oslov komunitu zemědělců.
- **Délka:** 2–4 věty, max 250 znaků.
- **CTA:** „Co na to říkáte? 💬", „Sdílejte mezi sousedy".
- **Odkaz:** přidej `[CLANEK_URL]` na konec.
- **Hashtagy: vždy přesně 1–2** — ideálně jeden tematický + `#profifarmar` (nebo jen tematický).

> **YouTube se přeskakuje** — Buffer nepodporuje image-only posty na YT (vyžaduje video).

**→ Kontrolní bod:** Ukaž uživateli `[CLOUDINARY_URL]` + oba texty a počkej na potvrzení.
Po potvrzení pokračuj Krokem 6.

---

## Krok 6 — Buffer distribuce (Instagram + Facebook) — IHNED

### Metoda — PowerShell HTTP (ověřená)

```powershell
$token = [System.Environment]::GetEnvironmentVariable('BUFFER_API_KEY', 'User')
if (-not $token) { Write-Output "BUFFER_API_KEY chybí"; exit 1 }

function Call-BufferMCP($method, $params, $id) {
    $body = @{ jsonrpc="2.0"; id=$id; method=$method; params=$params } | ConvertTo-Json -Depth 14
    $wr = [System.Net.HttpWebRequest]::Create("https://mcp.buffer.com/mcp")
    $wr.Method = "POST"; $wr.ContentType = "application/json"
    $wr.Accept = "text/event-stream, application/json"
    $wr.Headers.Add("Authorization", "Bearer $token"); $wr.Timeout = 60000
    $bb = [System.Text.Encoding]::UTF8.GetBytes($body)
    $rs = $wr.GetRequestStream(); $rs.Write($bb,0,$bb.Length); $rs.Close()
    $resp = $wr.GetResponse()
    $raw = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    # Response může být SSE: JSON je v řádcích začínajících "data: "
    if ($raw -match '(?m)^data: ') {
        return (($raw -split "`n" | Where-Object { $_ -match '^data: ' } | Select-Object -Last 1) -replace '^data: ','')
    }
    return $raw
}

# Pořadí volání:
# 1) initialize
# 2) tools/call get_account → organizations[0].id = orgId
# 3) tools/call list_channels { organizationId = orgId } → igId, fbId podle service "instagram"/"facebook"
# 4) create_post per kanál
```

**Vytvoření postu — IMAGE asset, IHNED publikace:**

```powershell
# Try first: shareNow
$args = @{
    channelId = $igId   # nebo $fbId
    text = "[COPY + HASHTAGY]"
    assets = @( @{ image = @{ url = "[CLOUDINARY_URL]"; metadata = @{ altText = "[TITULEK]" } } } )
    mode = "shareNow"
    metadata = @{ instagram = @{ type = "post"; shouldShareToFeed = $true } }  # FB: @{ facebook = @{ type = "post" } }
}
$result = Call-BufferMCP "tools/call" @{ name = "create_post"; arguments = $args } 10
```

**Fallback** (pokud Buffer plán odmítne `shareNow` s "schedulingType required"):
```powershell
$due = (Get-Date).ToUniversalTime().AddMinutes(1).ToString("yyyy-MM-ddTHH:mm:ssZ")  # +1 minuta
$args = @{
    channelId = $channelId
    text = "[COPY + HASHTAGY]"
    assets = @( @{ image = @{ url = "[CLOUDINARY_URL]"; metadata = @{ altText = "[TITULEK]" } } } )
    mode = "customScheduled"
    schedulingType = "automatic"
    dueAt = $due
    metadata = @{ instagram = @{ type = "post"; shouldShareToFeed = $true } }  # nebo facebook
}
```

**Povinné parametry (naučené z provozu):**
- Instagram vyžaduje `metadata.instagram.shouldShareToFeed = $true`.
- Facebook vyžaduje `metadata.facebook.type = "post"` — bez něj post selže.
- `assets` musí být **pole** objektů `{ image = { url, metadata = { altText } } }`. Při stavbě JSON přes
  `ConvertTo-Json` použij `-Depth 14`, jinak PowerShell pole „splácne".

---

## Krok 7 — Shrnutí

```
✅ Příspěvek z článku: "[TITULEK]" ([KATEGORIE])
   📸 Instagram — ID: [post_id] | publikováno
   📘 Facebook  — ID: [post_id] | publikováno
   ▶️  YouTube  — přeskočeno (image-only nepodporováno)

🖼️  Vizuál (Canva → Cloudinary): [CLOUDINARY_URL]
📝 IG: "[text]"   FB: "[text]"
```

---

## Troubleshooting

| Problém | Řešení |
|---|---|
| AI_API_KEY chybí | Ulož přes `SetEnvironmentVariable(...,'User')` |
| BUFFER_API_KEY chybí | Ulož přes `SetEnvironmentVariable("BUFFER_API_KEY","token","User")` |
| Cloudinary env proměnné chybí | Ulož `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (User scope) |
| Žádný published článek s coverem | Vezmi nejbližší novější s `cover_image_url`, informuj uživatele |
| Canva design nenalezen | Jediné správné ID šablony je `DAHOBdpJ1tk` ("ProfiFarmář 4:5 Stacked") |
| **Tenké čáry nahoře/dole na IG/FB** | **NIKDY nezadávej `width` AND `height` v `export-design`** — Canva přidá transparent padding kvůli aspect ratio mismatchi. Použij jen `width: 1080`. |
| Canva element nenalezen | Element IDs ber VŽDY z aktuální `start-editing-transaction` response — kopie může mít jiná ID než tabulka |
| Datum na vizuálu staré | `replace_text` pro datum je povinný krok — viz Krok 2.4 |
| Cloudinary `Invalid public_id` / signature error | `public_id` jen ASCII (`social_[DATUM_SLUG]_[ID]`), žádná diakritika/mezery/`·` |
| Cloudinary `ERROR:` | 1 retry po 5 s; ověř cestu k PNG a env creds; ověř že `eager` param je v signature |
| Buffer odmítne `shareNow` | Fallback: `mode="customScheduled"` + `schedulingType="automatic"` + `dueAt` = teď + 1 min |
| IG post selže | Přidej `metadata.instagram.shouldShareToFeed = $true` |
| FB post selže | Přidej `metadata.facebook.type = "post"` |
| `assets` se splácne | `ConvertTo-Json -Depth 14`; assets musí zůstat pole |
| Buffer 406 Not Acceptable | Header `Accept: text/event-stream, application/json` |
| Buffer response nejde parsovat | Je to SSE — JSON vytáhni z řádků `data: ` (viz Call-BufferMCP) |
| `list_channels` vyžaduje organizationId | Získej přes `get_account` → `organizations[0].id` |
| Odkaz na článek 404 | Použij pole `url` z API; jinak `slug`; ověř GET 200, při neúspěchu odkaz vynech |
|