---
name: agro-cover-image-gemini
description: >
  Vygeneruje NOVÝ cover obrázek pomocí Gemini (AI generování obrázků v prohlížeči) pro zemědělský
  článek na Profifarmar.cz, který ještě nemá titulní obrázek, a rovnou ho publikuje. Na rozdíl od
  agro-cover-image (který páruje a nahrává JIŽ EXISTUJÍCÍ obrázky ze složky) tento skill obrázek
  nejprve sám VYTVOŘÍ pomocí AI podle tématu článku — žádný vstupní obrázek není potřeba. Pipeline:
  najde nejnovější článek bez cover_image_url → sestaví popisný obrazový prompt podle titulku a
  obsahu článku → vygeneruje obrázek v Gemini přes prohlížeč → stáhne ho → nahraje na Cloudinary →
  nastaví cover_image_url a status na published. Použij tento skill vždy, když uživatel chce
  VYGENEROVAT (ne nahrát hotový) cover/titulní obrázek pomocí AI/Gemini pro článek na Profifarmaru,
  nebo zmíní "vygeneruj obrázek k článku", "udělej cover přes Gemini", "AI obrázek na titulku",
  "vytvoř titulku pomocí AI", "nemám obrázek, vygeneruj nějaký", "Gemini cover image".
---

# Agro Cover Image — generování přes Gemini

Vytvoří cover obrázek od nuly pomocí Gemini AI a publikuje ho k zemědělskému článku na
Profifarmar.cz, který na obrázek čeká. Použij tento skill, když **žádný vhodný obrázek
neexistuje** — pokud už uživatel obrázek má v pracovní složce, použij místo toho
`agro-cover-image`, který je rovnou páruje a nahrává.

Plně autonomní — neptej se uživatele na detaily promptu ani výběr článku, rozhodni sám
podle obsahu článku. Jediné místo, kde má smysl uživatele zapojit, je krok 4 (vizuální
kontrola vygenerovaného obrázku před publikací) — viz níže.

---

## Krok 1 — Najdi článek čekající na cover image

### Načtení API klíče

MCP PowerShell session nezdědí proměnné prostředí — token je uložen na úrovni User:

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
if (-not $token) {
    Write-Output "[COVER-GEMINI] CHYBA — AI_API_KEY není nastavena."
    exit 1
}
```

### Stažení seznamu článků

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
# Bez ?limit vrací API tiše jen 100 záznamů, a ne spolehlivě těch nejnovějších — vždy dotahuj vše.
$response = Invoke-WebRequest -Uri "https://profifarmar.cz/api/webhook.php?limit=10000" -Method GET `
  -Headers @{ "Authorization" = "Bearer $token" } -UseBasicParsing
Write-Output $response.Content
```

Z odpovědi vyber články, kde `cover_image_url` je `null`, prázdný string, nebo chybí úplně.
Seřaď je od nejnovějšího (podle data vytvoření, jinak podle pořadí v response) a **vyber
ten nejnovější** — generuješ jen pro jeden článek najednou, ne hromadně.

Pokud žádný takový článek neexistuje → ukonči s hláškou:
`[COVER-GEMINI] INFO — všechny články už mají cover image. Žádná akce.`

Ulož si vybraný článek jako `[ARTICLE]` — `{ id, title, content/excerpt, status }`.

---

## Krok 2 — Sestav obrazový prompt podle tématu článku

Přečti si `title` (a pokud je k dispozici, krátký výtah obsahu) vybraného článku a z něj
odvoď **konkrétní vizuální scénu**, kterou chceš nechat vygenerovat — ne abstraktní
shrnutí článku, ale něco, co se dá nakreslit. Např.:

- článek o suchu na polích → "vyprahlé popraskané pole pod žhnoucím sluncem, suchá kukuřice"
- článek o nové secí technice → "moderní secí stroj v akci na poli za soumraku"
- článek o mléčné produkci → "moderní dojírna, klidné dojnice, ranní světlo"

Napiš prompt v **angličtině** (Gemini na anglické prompty reaguje konzistentněji) ve
stylu profesionální zemědělské fotografie. Doporučená kostra promptu:

```
A photorealistic photograph of [konkrétní scéna podle tématu článku], professional
agricultural/editorial photography, natural lighting, high detail, wide shot,
16:9 aspect ratio, no text or watermarks
```

Dodatek "no text or watermarks" je důležitý — Gemini má sklon do generovaných obrázků
vkládat nesmyslný text. Ulož prompt jako `[IMAGE_PROMPT]`.

---

## Krok 3 — Vygeneruj obrázek v Gemini

Použij Claude in Chrome nástroje (ne computer-use — prohlížeč běží na tier "read", takže
klikat a psát musíš přes `mcp__Claude_in_Chrome__*`):

1. `navigate` na `https://gemini.google.com/app` (případně `tabs_context_mcp` →
   `tabs_create_mcp`, pokud není otevřená karta)
2. `find` vstupní pole pro prompt ("message Gemini" / textové pole na spodu stránky)
3. `left_click` do pole, `type` text `[IMAGE_PROMPT]`, odešli (Enter nebo tlačítko Send)
4. Počkej (pár sekund, generování obrázku trvá), pak `get_page_text` nebo `find`
   ("generated image") ověř, že se obrázek vygeneroval

Pokud Gemini vrátí více variant, vyber tu, která nejlépe odpovídá popisu scény.

**Pokud generování selže nebo Gemini odmítne** (např. kvůli politice obsahu), uprav
`[IMAGE_PROMPT]` na obecnější/neutrálnější popis scény a zkus to znovu (max. 2×). Pokud
selže i podruhé, ukonči s hláškou `[COVER-GEMINI] CHYBA — Gemini obrázek nevygeneroval.`

---

## Krok 4 — Stáhni vygenerovaný obrázek lokálně

Gemini obrázky nejdou stáhnout kliknutím (otevřel by se systémový dialog, který nelze
ovládat), a přímý `fetch(src)` z JS nástroje selže s `Failed to fetch` — blob URL patří
renderovacímu procesu stránky, ne rozšíření. Base64 string vrácený z `javascript_tool`
navíc bývá serverem MCP zablokován jako `[BLOCKED: Base64 encoded data]`. **Použij proto
download-trigger techniku** — necháš stránku samotnou uložit soubor do Downloads, a pak
ho jen přesuneš:

```javascript
// mcp__Claude_in_Chrome__javascript_tool — spusť na kartě s Gemini
const img = document.querySelector('[SELEKTOR_OBRÁZKU]'); // poslední vygenerovaný obrázek
const canvas = document.createElement('canvas');
canvas.width = img.naturalWidth;
canvas.height = img.naturalHeight;
canvas.getContext('2d').drawImage(img, 0, 0);
const a = document.createElement('a');
a.href = canvas.toDataURL('image/jpeg', 0.92);
a.download = 'gemini_cover.jpg';
document.body.appendChild(a);
a.click();
a.remove();
'triggered download';
```

(Pokud `drawImage` spadne na "tainted canvas" kvůli CORS, zkus rovnou `a.href = img.src`
— funguje to, pokud je `src` už `data:` URL.) Soubor přistane v uživatelově složce
**Downloads**. Najdi nejnovější `gemini_cover*.jpg`/`.png` tam (PowerShell `Get-ChildItem
... | Sort-Object LastWriteTime -Descending | Select -First 1`) a přesuň/zkopíruj ho do
pracovní složky:

```powershell
$src = Get-ChildItem "$env:USERPROFILE\Downloads\gemini_cover*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$outPath = "[PRACOVNÍ_SLOŽKA]\gemini_cover_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).jpg"
Copy-Item $src.FullName $outPath
Write-Output "Saved: $outPath"
```

Ulož cestu jako `[IMG_PATH]` a MIME typ jako `image/jpeg` (případně `image/png`, podle
skutečné přípony staženého souboru).

**Vizuální kontrola:** otevři `[IMG_PATH]` přes `Read` (Claude je multimodální) a stručně
zkontroluj, že obrázek odpovídá tématu článku a neobsahuje žádný rozbitý/nesmyslný text.
Pokud obrázek vypadá nepoužitelně, vrať se ke kroku 3 s upraveným promptem (max. 1 oprava).

**Pozn. k vodoznaku:** Gemini do generovaných obrázků vkládá malý diamantový vodoznak
v rozích — to je vlastnost generátoru a žádný prompt ho neodstraní. Počítej s tím jako
s očekávaným chováním, ne s chybou.

---

## Krok 5 — Komprese (pokud >10 MB)

Cloudinary free plan má limit 10 485 760 bytes. Pokud `[IMG_PATH]` přesahuje limit:

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
```

Aktualizuj `[IMG_PATH]` na zkomprimovanou verzi (a `image/jpeg` jako MIME). AI generované
obrázky jsou typicky pod 5 MB, takže tento krok bude většinou zbytečný — ber ho jako
pojistku, ne jako standardní krok.

---

## Krok 6 — Nahraj na Cloudinary

Stejný postup jako v `agro-cover-image` (Krok 3) — REST upload přes
`mcp__Windows-MCP__PowerShell`, endpoint `image/upload`:

```
cloudName = "dxrpsbvx2"
apiKey    = "963366693952873"
apiSecret = "As2Z8GqSVWA3RIQG-aeylsSWipk"
folder    = "ČLÁNKY"
```

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
    $fieldData = "--$boundary$LF" + "Content-Disposition: form-data; name=`"$name`"$LF$LF" + "$value$LF"
    $b = $encoding.GetBytes($fieldData)
    $stream.Write($b, 0, $b.Length)
}
Add-FormField $requestStream $boundary "api_key" $apiKey
Add-FormField $requestStream $boundary "timestamp" $timestamp
Add-FormField $requestStream $boundary "signature" $signature
Add-FormField $requestStream $boundary "folder" $folder
Add-FormField $requestStream $boundary "overwrite" "true"

$mimeType = "[MIME_TYPE]"
$fileName = [System.IO.Path]::GetFileName($filePath)
$fileHeader = "--$boundary$LF" + "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"$LF" + "Content-Type: $mimeType$LF$LF"
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
    Write-Output "SUCCESS: $($reader.ReadToEnd())"
} catch [System.Net.WebException] {
    $errReader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Output "ERROR: $($errReader.ReadToEnd())"
}
```

Z `SUCCESS:` odpovědi vytáhni `secure_url` → `[CLOUDINARY_URL]`.

---

## Krok 7 — Nastav cover image a publikuj (PUT)

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
$articleId = "[ARTICLE.id]"
$coverUrl = "[CLOUDINARY_URL]"

# Pokud je článek draft → nastav i status:
$json = "{`"id`":`"$articleId`",`"cover_image_url`":`"$coverUrl`",`"status`":`"published`"}"
# Pokud je článek už published → pošli jen cover_image_url:
# $json = "{`"id`":`"$articleId`",`"cover_image_url`":`"$coverUrl`"}"

$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$response = Invoke-WebRequest -Uri "https://profifarmar.cz/api/webhook.php" -Method PUT `
  -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json; charset=utf-8" } `
  -Body $bytes -UseBasicParsing
Write-Output $response.Content
```

Ověř `"success":true`. Pokud ne, zkus jednou znovu.

---

## Krok 8 — Úklid a shrnutí

Smaž lokální soubor (i případnou `_compressed` verzi) — obrázek je už na Cloudinary:

```powershell
Remove-Item -Path "[IMG_PATH]" -Force
```

Zobraz shrnutí v češtině:

```
✅ Cover image vygenerován a publikován:

  📰 Článek: [ARTICLE.title]
  🎨 Prompt: [IMAGE_PROMPT] (zkráceně)
  🔗 Cover URL: [CLOUDINARY_URL]
  📊 Status: published
```

---

## Pořadí provádění kroků

1. Krok 1 — najdi článek čekající na obrázek (PowerShell GET)
2. Krok 2 — sestav prompt podle tématu
3. Krok 3 — vygeneruj obrázek v Gemini (Claude in Chrome)
4. Krok 4 — stáhni obrázek lokálně + vizuální kontrola
5. Krok 5 — komprese, jen pokud >10 MB
6. Krok 6 — Cloudinary upload
7. Krok 7 — PUT (cover_image_url + publish)
8. Krok 8 — úklid a shrnutí

---

## Chybové stavy

| Stav | Příčina | Řešení |
|---|---|---|
| Žádný článek bez cover image | Všechny články mají obrázek | Informuj uživatele, ukonči gracefully |
| AI_API_KEY chybí | Proměnná není nastavena | Požádej uživatele o nastavení tokenu |
| Gemini odmítne / nevygeneruje | Politika obsahu, nejasný prompt | Zobecni prompt, zkus znovu (max 2×) |
| Vygenerovaný obrázek neodpovídá tématu | Nejasný/abstraktní prompt | Konkretizuj scénu, zkus znovu (max 1×) |
| Stažení obrázku selže (fetch/base64) | CORS, neplatná URL | Zkus `data:` variantu z `src`, nebo screenshot+crop jako záložní řešení |
| Obrázek >10 MB | Vzácné u AI generování | Automatická komprese JPEG quality 85 |
| Cloudinary upload selže | Špatné credentials / síť | Zaznamenej chybu, neukončuj — zkus jednou znovu |
| PUT selže | Chybné ID / server error | Zkus jednou znovu, pak nahlas chybu |
