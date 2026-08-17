---
name: agro-cover-image
description: >
  Nahraje cover obrázky k zemědělským článkům na Profifarmar.cz s inteligentním přiřazením podle obsahu. Pipeline: najde všechny obrázky v pracovní složce, vizuálně zanalyzuje obsah každého, načte články bez cover_image_url přes Profifarmar API, spáruje obrázky s články podle kontextu (co je na obrázku vs. téma článku), případně zkomprimuje obrázky větší než 10 MB kvůli limitu Cloudinary, nahraje je do Cloudinary, nastaví cover_image_url a změní status článku na published. Podporuje zpracování jednoho i více obrázků najednou. Použij tento skill vždy, když uživatel chce přidat nebo nahrát titulní / cover obrázek k zemědělskému článku na Profifarmar.cz nebo publikovat článek s obrázkem
---

# Agro Cover Image Skill

Nahraje obrázky z pracovní složky na Cloudinary a inteligentně je přiřadí jako cover image k článkům bez obrázku na Profifarmar.cz. Podporuje hromadné zpracování více obrázků najednou s párováním podle vizuálního obsahu. Plně autonomní — žádné dotazy na uživatele.

---

## Krok 1 — Najdi VŠECHNY obrázky v pracovní složce

Prohledej složku jednotlivě pro každou příponu (FileSystem tool nepodporuje čárkou oddělené patterny):

```
mcp__Windows-MCP__FileSystem  mode: list  path: [PRACOVNÍ_SLOŽKA]  pattern: *.png
mcp__Windows-MCP__FileSystem  mode: list  path: [PRACOVNÍ_SLOŽKA]  pattern: *.jpg
mcp__Windows-MCP__FileSystem  mode: list  path: [PRACOVNÍ_SLOŽKA]  pattern: *.jpeg
mcp__Windows-MCP__FileSystem  mode: list  path: [PRACOVNÍ_SLOŽKA]  pattern: *.webp
```

**Spusť všechny 4 paralelně** (v jednom tool-call bloku).

Pokud žádný obrázek neexistuje → ukonči s hláškou:
`[COVER] CHYBA — žádný obrázek nenalezen v pracovní složce.`

Pro každý nalezený obrázek zjisti metadata (`mode: info`) — velikost a datum modifikace. **Ignoruj** soubory obsahující `_compressed` v názvu (ty jsou dočasné).

Ulož si seznam jako `[IMAGES]` — pole objektů `{ path, ext, size_bytes, modified }`.

Mapování přípony na MIME typ:

* `.jpg` / `.jpeg` → `image/jpeg`
* `.png` → `image/png`
* `.webp` → `image/webp`

---

## Krok 1b — Komprese velkých obrázků (>10 MB)

Cloudinary free plan má limit **10 485 760 bytes** (10 MB). Pro každý obrázek kde `size_bytes > 10_485_760`:

```powershell
Add-Type -AssemblyName System.Drawing
$srcPath = "[IMG_PATH]"
$dstPath = "[IMG_PATH_BEZ_PŘÍPONY]_compressed.jpg"

$img = [System.Drawing.Image]::FromFile($srcPath)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 85L)
$img.Save($dstPath, $codec, $encoderParams)
$img.Dispose()

$fi = Get-Item $dstPath
Write-Output "Compressed: $($fi.Length) bytes ($([math]::Round($fi.Length/1MB, 2)) MB)"
```

Aktualizuj `[IMAGES]` — nahraď `path` kompresovanou verzí, `ext` na `.jpg`, `size_bytes` novou hodnotou.

Pokud i po kompresi >10 MB → sniž kvalitu na 70L a zkus znovu.

---

## Krok 2 — Vizuální analýza a párování s články

### 2a — Prohlédni každý obrázek

Pomocí **Read** tool (Claude je multimodální) otevři každý obrázek a zapiš si stručný popis obsahu:

```
Pro každý obrázek v [IMAGES]:
  Read file_path=[IMG_PATH]
  → zapiš: [IMG_PATH] = "popis co je na obrázku" (např. "dojírna s kravami a Afimilk dashboard", "suchá popraskaná půda", "červená secí jednotka na poli")
```

### 2b — Načti články bez cover image

(Viz Krok 4 níže — proveď GET request na API)

### 2c — Spáruj obrázky s články podle kontextu

Pro každý článek bez cover image porovnej jeho `title` s popisem každého obrázku a vytvoř páry:

**Pravidla párování (v pořadí priority):**

1. **Přímá shoda** — obrázek vizuálně zobrazuje přesně to, o čem článek pojednává (např. secí stroj → článek o secí jednotce)
2. **Tematická shoda** — obrázek odpovídá tématu článku (např. suché pole → článek o suchu)
3. **Kategoriová shoda** — obrázek odpovídá kategorii článku (např. krávy → článek o chovu)
4. **Zbytková přiřazení** — pokud zbývají nepřiřazené obrázky i články, přiřaď zbylé k sobě

**Důležité:**

* Každý obrázek může být přiřazen **maximálně k jednomu** článku
* Každý článek dostane **maximálně jeden** obrázek
* Pokud je obrázků **méně** než článků → zpracuj jen tolik článků, kolik je obrázků (preferuj nejnovější články)
* Pokud je obrázků **více** než článků → přebytek obrázků ignoruj

Ulož výsledek jako `[PAIRS]` — pole `{ img_path, img_mime, article_id, article_title, article_status }`.

---

## Krok 3 — Cloudinary upload VŠECH spárovaných obrázků

Cloudinary MCP nepodporuje lokální `file://` cesty — upload probíhá přes přímé REST API volání z PC pomocí Windows-MCP PowerShell. Endpoint je **`image/upload`** (ne `video/upload`).

**Pro každý pár v `[PAIRS]` spusť upload** (nezávislé uploady lze spustit **paralelně** v jednom tool-call bloku):

**Konstanty:**

```
cloudName  = "dxrpsbvx2"
apiKey     = "963366693952873"
apiSecret  = "As2Z8GqSVWA3RIQG-aeylsSWipk"
folder     = "ČLÁNKY"
```

**PowerShell příkaz pro KAŽDÝ obrázek** (spusť přes `mcp__Windows-MCP__PowerShell`):

```powershell
$filePath = "[IMG_PATH]"
$cloudName = "dxrpsbvx2"
$apiKey = "963366693952873"
$apiSecret = "As2Z8GqSVWA3RIQG-aeylsSWipk"
$folder = "ČLÁNKY"

$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$timestamp = $epoch.ToString()

$paramString = "folder=$folder&overwrite=true&timestamp=$timestamp" + $apiSecret
$sha1 = [System.Security.Cryptography.SHA1]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($paramString)
$hash = $sha1.ComputeHash($bytes)
$signature = -join ($hash | ForEach-Object { $_.ToString("x2") })

$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"
$url = "https://api.cloudinary.com/v1_1/$cloudName/image/upload"

$webRequest = [System.Net.HttpWebRequest]::Create($url)
$webRequest.Method = "POST"
$webRequest.ContentType = "multipart/form-data; boundary=$boundary"
$webRequest.Timeout = 120000

$requestStream = $webRequest.GetRequestStream()
$encoding = [System.Text.Encoding]::UTF8

function Add-FormField($stream, $boundary, $name, $value) {
    $fieldData = "--$boundary$LF" +
        "Content-Disposition: form-data; name=`"$name`"$LF$LF" +
        "$value$LF"
    $bytes = $encoding.GetBytes($fieldData)
    $stream.Write($bytes, 0, $bytes.Length)
}

Add-FormField $requestStream $boundary "api_key" $apiKey
Add-FormField $requestStream $boundary "timestamp" $timestamp
Add-FormField $requestStream $boundary "signature" $signature
Add-FormField $requestStream $boundary "folder" $folder
Add-FormField $requestStream $boundary "overwrite" "true"

$mimeType = "[MIME_TYPE]"
$fileName = [System.IO.Path]::GetFileName($filePath)

$fileHeader = "--$boundary$LF" +
    "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"$LF" +
    "Content-Type: $mimeType$LF$LF"
$headerBytes = $encoding.GetBytes($fileHeader)
$requestStream.Write($headerBytes, 0, $headerBytes.Length)

$fileStream = [System.IO.File]::OpenRead($filePath)
$fileStream.CopyTo($requestStream)
$fileStream.Close()

$endBytes = $encoding.GetBytes("$LF--$boundary--$LF")
$requestStream.Write($endBytes, 0, $endBytes.Length)
$requestStream.Close()

try {
    $response = $webRequest.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $result = $reader.ReadToEnd()
    Write-Output "SUCCESS: $result"
} catch [System.Net.WebException] {
    $errStream = $_.Exception.Response.GetResponseStream()
    $errReader = New-Object System.IO.StreamReader($errStream)
    $errBody = $errReader.ReadToEnd()
    Write-Output "ERROR: $errBody"
}
```

Z každého `SUCCESS:` response parsuj `secure_url` a ulož do příslušného páru jako `[CLOUDINARY_URL]`.

Pokud upload selže → zaznamenej chybu pro daný pár, pokračuj s ostatními. Pár bez URL se přeskočí.

**Nahraď `[IMG_PATH]` a `[MIME_TYPE]`** skutečnými hodnotami z příslušného páru.

---

## Krok 4 — Načti články bez cover image

### Načtení API klíče

MCP PowerShell session nezdědí procesní proměnné prostředí. Token je uložen na úrovni User:

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
if (-not $token) {
    Write-Output "[COVER] CHYBA — AI_API_KEY není nastavena."
    exit 1
}
```

### Stažení seznamu článků

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')

# Bez ?limit vrací API tiše jen 100 záznamů, a ne spolehlivě těch nejnovějších — vždy dotahuj vše.
$response = Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php?limit=10000" `
  -Method GET `
  -Headers @{
    "Authorization" = "Bearer $token"
  } -UseBasicParsing

Write-Output $response.Content
```

### Výběr článků

Z odpovědi vyber články podle těchto pravidel:

1. **Filtruj** — vezmi všechny články kde `cover_image_url` je `null`, prázdný string, nebo pole úplně chybí
2. **Seřaď** — nejnovější první (podle data vytvoření, pokud API vrací datum; jinak podle pořadí v response)

Pokud žádný článek bez cover image neexistuje → ukonči s hláškou:
`[COVER] INFO — všechny články již mají cover image. Žádná akce.`

Ulož si seznam jako `[ARTICLES_NO_COVER]` — pole `{ id, title, status }`.

**POZNÁMKA:** Tento krok proveď PŘED Krokem 2c (párování), protože potřebuješ znát tituly článků pro kontextové přiřazení.

---

## Krok 5 — Nastav cover image a publikuj (PUT requesty)

Pro každý úspěšně nahraný pár v `[PAIRS]` pošli PUT request. **Nezávislé PUT requesty lze spustit paralelně.**

Pokud článek **je `draft`**, pošli PUT s `cover_image_url` + `status: published`.
Pokud článek **již je `published`**, pošli PUT jen s `cover_image_url`.

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
$articleId = "[ARTICLE_ID]"
$coverUrl = "[CLOUDINARY_URL]"

# Pokud článek je draft:
$json = "{`"id`":`"$articleId`",`"cover_image_url`":`"$coverUrl`",`"status`":`"published`"}"
# Pokud článek už je published:
# $json = "{`"id`":`"$articleId`",`"cover_image_url`":`"$coverUrl`"}"

$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

$response = Invoke-WebRequest `
  -Uri "https://profifarmar.cz/api/webhook.php" `
  -Method PUT `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json; charset=utf-8"
  } `
  -Body $bytes -UseBasicParsing

Write-Output $response.Content
```

Ověř, že response obsahuje `"success":true`. Pokud ne, zaznamenej chybu a zkus jednou znovu.

---

## Krok 6 — Shrnutí

Zobraz v češtině souhrnnou tabulku VŠECH zpracovaných párů:

```
✅ Cover images přiřazeny ([POČET_ÚSPĚŠNÝCH]/[POČET_PÁRŮ]):

  1. 📰 Článek: [ARTICLE_TITLE]
     🖼️  Obrázek: [popis obsahu obrázku]
     🔗 Cover URL: [CLOUDINARY_URL]
     📊 Status: published

  2. 📰 Článek: [ARTICLE_TITLE]
     🖼️  Obrázek: [popis obsahu obrázku]
     🔗 Cover URL: [CLOUDINARY_URL]
     📊 Status: published

  ... (pro každý pár)
```

Pokud nějaké páry selhaly, zobraz je zvlášť:

```
❌ Selhalo ([POČET_CHYB]):
  - [ARTICLE_TITLE]: [důvod selhání]
```

Pokud zbyly nepřiřazené články (více článků než obrázků):

```
⏳ Články bez cover image ([POČET]):
  - [ARTICLE_TITLE] (ID: [ARTICLE_ID])
```

---

## Krok 7 — Úklid pracovní složky

Po úspěšném přiřazení VŠECH párů smaž zpracované obrázky z pracovní složky. Maž **pouze** obrázky, které byly úspěšně nahrány na Cloudinary a přiřazeny k článku.

```powershell
# Pro každý úspěšně zpracovaný pár:
Remove-Item -Path "[IMG_PATH]" -Force
# Pokud existuje i kompresovaná verze:
$compressed = "[IMG_PATH_BEZ_PŘÍPONY]_compressed.jpg"
if (Test-Path $compressed) { Remove-Item -Path $compressed -Force }
```

**Pravidla:**

* Maž **pouze** úspěšně zpracované obrázky (ne ty, u kterých upload nebo PUT selhal)
* Maž i dočasné `_compressed` verze
* Pokud smazání selže → zaloguj varování, ale nepřerušuj skill (obrázek už je na Cloudinary)

---

## Pořadí provádění kroků

Doporučené pořadí pro maximální efektivitu:

1. **Krok 1** — najdi obrázky + metadata (paralelní FileSystem volání)
2. **Krok 1b** — komprese velkých obrázků (pokud potřeba)
3. **Krok 4** — načti články z API (paralelně s Krokem 1)
4. **Krok 2a** — vizuálně analyzuj obrázky (Read tool, paralelně)
5. **Krok 2c** — spáruj obrázky s články
6. **Krok 3** — Cloudinary upload (paralelně pro všechny páry)
7. **Krok 5** — PUT requesty (paralelně pro všechny páry)
8. **Krok 6** — shrnutí

---

## Chybové stavy

| Stav | Příčina | Řešení |
|---|---|---|
| Žádný obrázek ve složce | Uživatel ho ještě nevytvořil | Ukonči s hláškou, požádej o nahrání obrázku |
| Obrázek >10 MB | Příliš velký pro Cloudinary | Automatická komprese do JPEG quality 85 (pak 70) |
| Cloudinary upload selže | Špatné credentials nebo síťová chyba | Zaznamenej chybu, pokračuj s ostatními páry |
| AI_API_KEY chybí | Proměnná není nastavena | Požádej uživatele o nastavení tokenu |
| Žádný článek bez cover image | Všechny články mají obrázek | Informuj uživatele, ukonči gracefully |
| Více obrázků než článků | Přebytek obrázků | Ignoruj přebytek, zpracuj jen tolik kolik je článků |
| Více článků než obrázků | Nedostatek obrázků | Zpracuj co je k dispozici, zbylé články vypiš v shrnutí |
| Špatné párování | Žádný obrázek neodpovídá článku | Přiřaď zbytkově (nejnovější obrázek → nejnovější článek) |
| PUT selže | Chybné ID nebo server error | Zaznamenej chybu, zkus znovu jednou |
