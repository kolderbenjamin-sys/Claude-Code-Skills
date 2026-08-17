---
name: agro-cover-image
description: >
  Nahraje cover obrázek k zemědělskému článku na Profifarmar.cz.
  Pipeline: najde obrázek v pracovní složce → Cloudinary upload (složka ČLÁNKY) → najde nejnovější článek
  bez cover_image_url přes Profifarmar API → nastaví cover_image_url → změní status na published.
  Použij tento skill vždy, když uživatel: chce přidat obrázek k článku, nahrát cover image,
  přidat titulní obrázek, doplnit obrázek k článku na profifarmar, publikovat článek s obrázkem,
  zmíní "cover image", "titulní obrázek", "obrázek k článku", "nahraj obrázek k článku",
  nebo má v složce obrázek a chce ho přiřadit k článku.
  Trigger keywords: cover image, titulní obrázek, obrázek k článku, nahraj obrázek, přidej obrázek,
  cover článek, obrázek profifarmar, publikuj s obrázkem, doplň obrázek.
  Aktivuj i když uživatel jen řekne "přidej obrázek" v kontextu zemědělských článků.
---

# Agro Cover Image Skill

Nahraje obrázek z pracovní složky na Cloudinary a přiřadí ho jako cover image k nejnovějšímu článku bez obrázku na Profifarmar.cz. Poté článek publikuje. Plně autonomní — žádné dotazy na uživatele.

---

## Krok 1 — Najdi obrázek v pracovní složce

Prohledej složku, ve které tento skill pracuje (typicky Cowork outputs složka), a najdi nejnovější soubor s příponou `.jpg`, `.jpeg`, `.png` nebo `.webp`.

```
mcp__Windows-MCP__FileSystem
  mode: list
  path: [PRACOVNÍ_SLOŽKA]
  pattern: *.jpg,*.jpeg,*.png,*.webp
```

Pokud je obrázků více, vezmi **nejnovější** podle data modifikace.

Pokud žádný obrázek neexistuje → ukonči s hláškou:
`[COVER] CHYBA — žádný obrázek nenalezen v pracovní složce.`

Ulož si cestu jako `[IMG_PATH]` a příponu jako `[IMG_EXT]` (jpg/png/webp).

Mapování přípony na MIME typ:
- `.jpg` / `.jpeg` → `image/jpeg`
- `.png` → `image/png`
- `.webp` → `image/webp`

---

## Krok 2 — Cloudinary upload (PowerShell REST API)

Cloudinary MCP nepodporuje lokální `file://` cesty — upload probíhá přes přímé REST API volání z PC pomocí Windows-MCP PowerShell. Endpoint je **`image/upload`** (ne `video/upload`).

**Konstanty:**
```
cloudName  = "dxrpsbvx2"
apiKey     = "963366693952873"
apiSecret  = "As2Z8GqSVWA3RIQG-aeylsSWipk"
folder     = "ČLÁNKY"
```

**PowerShell příkaz** (spusť přes `mcp__Windows-MCP__PowerShell`):

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

Z `SUCCESS:` response parsuj:
- `secure_url` → `[CLOUDINARY_URL]`

Pokud upload selže → zaznamenej chybu a ukonči. Bez URL nelze pokračovat.

**Nahraď `[IMG_PATH]` a `[MIME_TYPE]`** skutečnými hodnotami z Kroku 1.

---

## Krok 3 — Najdi článek bez cover image

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

### Výběr článku

Z odpovědi vyber článek podle těchto pravidel (v tomto pořadí priority):

1. **Filtruj** — vezmi všechny články kde `cover_image_url` je `null`, prázdný string, nebo pole úplně chybí
2. **Seřaď** — nejnovější první (podle data vytvoření, pokud API vrací datum; jinak podle ID sestupně)
3. **Vyber první** — to je tvůj cílový článek

Pokud žádný článek bez cover image neexistuje → ukonči s hláškou:
`[COVER] INFO — všechny články již mají cover image. Žádná akce.`

Ulož si `id` vybraného článku jako `[ARTICLE_ID]` a `title` jako `[ARTICLE_TITLE]`.

---

## Krok 4 — Nastav cover image a publikuj (jeden PUT request)

Pošli jeden PUT request, který nastaví `cover_image_url` a zároveň změní `status` na `published`. Tím se ušetří jedno API volání.

Pokud článek **již je** `published`, pošli PUT jen s `cover_image_url` (bez změny statusu — ten už je správný).

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

Ověř, že response obsahuje `"success":true`. Pokud ne, zaznamenej chybu.

---

## Krok 5 — Shrnutí

Zobraz v češtině:

```
✅ Cover image přiřazen:
   📰 Článek: [ARTICLE_TITLE]
   🆔 ID: [ARTICLE_ID]
   🖼️  Cover URL: [CLOUDINARY_URL]
   📊 Status: published

☁️  Cloudinary: [CLOUDINARY_URL]
```

---

## Chybové stavy

| Stav | Příčina | Řešení |
|---|---|---|
| Žádný obrázek ve složce | Uživatel ho ještě nevytvořil | Ukonči s hláškou, požádej o nahrání obrázku |
| Cloudinary upload selže | Špatné credentials nebo síťová chyba | Zaznamenej chybu, ukonči |
| AI_API_KEY chybí | Proměnná není nastavena | Požádej uživatele o nastavení tokenu |
| Žádný článek bez cover image | Všechny články mají obrázek | Informuj uživatele, ukonči gracefully |
| PUT selže | Chybné ID nebo server error | Zaznamenej chybu, zkus znovu jednou |
