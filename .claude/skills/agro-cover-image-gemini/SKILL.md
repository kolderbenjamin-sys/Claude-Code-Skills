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
    Write-Output "[COVER-GEMINI] CHYBA — AI_API_KEY není nastavena. Viz SECRETS.md."
    exit 1
}
```

### Stažení seznamu článků

```powershell
$token = [System.Environment]::GetEnvironmentVariable('AI_API_KEY', 'User')
$response = Invoke-WebRequest -Uri "https://profifarmar.cz/api/webhook.php?limit=10000" -Method GET `
  -Headers @{ "Authorization" = "Bearer $token" } -UseBasicParsing
Write-Output $response.Content
```

**Důležité:** API má bez parametru `limit` výchozí stránkování na 100 článků — bez
`?limit=10000` bys u větších archivů (150+ článků) viděl jen část a mohl bys minout
starší články čekající na cover image. Vždy volej s `?limit=10000`.

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

**Nikdy nezahrnuj do scény konkrétní lidskou postavu** (např. "farmer looking concerned",
"zemědělec kontroluje tablet") — 25. 08. 2026 takový prompt (dojírna + zemědělec) v Gemini
opakovaně zamrzl na prázdném/nedokončeném obrázku, zatímco identická scéna bez lidí
("no people") proběhla hned napoprvé. Lidé v generovaných fotkách navíc mívají
zdeformované ruce/obličeje. Vždy piš scénu jako prázdnou krajinu, techniku, zvířata nebo
interiér — a explicitně přidej "no people" do promptu, i když článek o lidech pojednává
(např. o cenách, dotacích, farmářích).

Napiš prompt v **angličtině** (Gemini na anglické prompty reaguje konzistentněji) ve
stylu profesionální zemědělské fotografie. Doporučená kostra promptu:

```
A photorealistic photograph of [konkrétní scéna podle tématu článku, bez lidí], professional
agricultural/editorial photography, natural lighting, high detail, wide shot,
16:9 aspect ratio, no people, no text or watermarks
```

Dodatek "no text or watermarks" je důležitý — Gemini má sklon do generovaných obrázků
vkládat nesmyslný text. Ulož prompt jako `[IMAGE_PROMPT]`.

---

## Krok 3 — Vygeneruj obrázek v Gemini

Pro každý nový obrázek si vždy **otevři nový tab a fresh konverzaci** — recyklování chatu vede k tomu, že download tlačítko se naváže na předchozí obrázek a stahování selže:

1. `mcp__Claude_in_Chrome__tabs_create_mcp` — vytvoř nový tab
2. `mcp__Claude_in_Chrome__navigate` na `https://gemini.google.com/app`
3. Krátká pauza (3–4 s) pro načtení stránky
4. Pošli prompt přes `javascript_tool` (nejspolehlivější, vyhne se synthetic-input problémům s contenteditable):

```javascript
const promptText = "[IMAGE_PROMPT]";
const editable = document.querySelector('div[contenteditable="true"][role="textbox"]')
              || document.querySelector('div[contenteditable="true"]');
if (!editable) { 'ERROR: no editable'; }
else {
  editable.focus();
  while (editable.firstChild) editable.removeChild(editable.firstChild);
  const p = document.createElement('p');
  p.textContent = promptText;
  editable.appendChild(p);
  editable.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, data: promptText, inputType: 'insertText'
  }));
  setTimeout(() => {
    const btn = document.querySelector('button[aria-label="Poslat zprávu"]')
             || document.querySelector('button[aria-label*="Send"]');
    if (btn) btn.click();
  }, 500);
  'SUBMITTED';
}
```

5. Počkej **50–90 sekund** — generování přes Gemini Flash trvá v praxi víc než „pár sekund". Pokus o klik na download tlačítko před dokončením generování selže, protože tlačítko stáhne prázdný / nedokončený blob.

6. Ověř, že obrázek je hotový — buď přes `computer.screenshot` (vidíš ho na stránce) nebo přes JS:

```javascript
function deepFind(root, depth=0) {
  if (depth > 5) return [];
  let imgs = [];
  if (root.querySelectorAll) root.querySelectorAll('img').forEach(i => imgs.push(i));
  if (root.shadowRoot) imgs = imgs.concat(deepFind(root.shadowRoot, depth+1));
  if (root.children) for (const c of root.children) if (c.shadowRoot) imgs = imgs.concat(deepFind(c.shadowRoot, depth+1));
  return imgs;
}
const aigen = deepFind(document.body).filter(i => (i.alt||'').includes('vygenerováno') || (i.src||'').startsWith('blob:'));
JSON.stringify(aigen.map(i => ({w: i.naturalWidth, h: i.naturalHeight, complete: i.complete})));
```

Pokud `complete: false` nebo `w: 0`, počkej dalších 20–30 s a zkontroluj znovu.

**Pokud generování selže nebo Gemini odmítne** (např. kvůli politice obsahu), uprav
`[IMAGE_PROMPT]` na obecnější/neutrálnější popis scény a zkus to znovu (max. 2×). Pokud
selže i podruhé, ukonči s hláškou `[COVER-GEMINI] CHYBA — Gemini obrázek nevygeneroval.`

---

## Krok 4 — Stáhni vygenerovaný obrázek lokálně

**Toto je nejnáchylnější krok celého skillu.** Chrome z bezpečnostních důvodů spouští download **jen po skutečném (trusted) uživatelském kliknutí** — synthetic `.click()` z JS download tiše zablokuje, `fetch(blob_url)` z extension contextu vrátí „Failed to fetch", a chunked base64 přes JS → PowerShell spustí auto-mode classifier (klasifikováno jako exfiltrace dat). **Jediná spolehlivá cesta je `mcp__Claude_in_Chrome__computer.left_click` s pixel coordinates** — ten používá Chrome DevTools Protocol a injectuje **trusted MouseEvent**, který Chrome akceptuje.

### Ověřená sekvence (testováno 15. 6. 2026)

**1) Screenshot — najdi pozici download tlačítek**

```
mcp__Claude_in_Chrome__computer.screenshot(tabId)
```

V pravém horním rohu vygenerovaného obrázku jsou 3 ikony (zleva):
- **Sdílet obrázek** (`aria-label="Sdílet obrázek"`)
- **Zkopírovat obrázek** (`aria-label="Zkopírovat obrázek"`)
- **Stáhnout obrázek v plné velikosti** (`aria-label="Stáhnout obrázek v plné velikosti"`)

Při rozlišení screenshotu ~1568×705 px jsou ikony typicky na souřadnicích:
- Sdílet: ~(1192, 343)
- Zkopírovat: ~(1238, 343)
- Stáhnout: **~(1284, 343)**

Když screenshot rozměry vypadají jinak, zkontroluj pozici tlačítka „Stáhnout" z aktuálního screenshotu.

**2) Hover nad obrázkem — odhalí ikony, které jsou jinak skryté**

```
mcp__Claude_in_Chrome__computer.hover(tabId, coordinate=[935, 450])
```

Coordinates ukazují přibližně do středu obrázku. Bez hover-u jsou ikony průhledné a klik nezareaguje.

**3) Klik na download tlačítko**

```
mcp__Claude_in_Chrome__computer.left_click(tabId, coordinate=[1284, 343])
```

Pozn.: Pokud máš `find` reference (`ref_XXXX`) tlačítka „Stáhnout obrázek v plné velikosti", můžeš použít `left_click(ref=ref_XXXX)` místo coordinates — ale **scroll_to + ref klik bez předchozího hover často selže**, protože ikony jsou viditelné jen v hover stavu.

**4) Vyčkej 6–10 s a zkontroluj Downloads:**

```powershell
Start-Sleep -Seconds 6
$src = Get-ChildItem "$env:USERPROFILE\Downloads\Gemini_Generated_Image_*.png" |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $src -or $src.LastWriteTime -lt (Get-Date).AddSeconds(-30)) {
    Write-Output "[COVER-GEMINI] WARN — download neproběhl, zkouším znovu"
    exit 2
}
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$workDir = "$env:USERPROFILE\Documents\Claude-code\agro-covers"
if (-not (Test-Path $workDir)) { New-Item -ItemType Directory -Path $workDir | Out-Null }
$pngPath = "$workDir\[ARTICLE.slug]_cover_$ts.png"
Copy-Item $src.FullName $pngPath -Force
Write-Output "Saved: $pngPath ($((Get-Item $pngPath).Length/1MB) MB)"
```

Gemini stahuje soubor pod jménem `Gemini_Generated_Image_<8 znaků>.png` (PNG, typicky 5–10 MB). Soubor přistane v `~/Downloads/`.

### Co dělat, když download neproběhne (retry strategie)

| Příčina | Řešení |
|---|---|
| Hover proběhl mimo obrázek | Spusť `screenshot` znovu, ověř pozici obrázku, přesuň hover do skutečného středu |
| Klik proběhl mimo button | Spusť `screenshot` po hoveru, zkontroluj viditelnost ikon, přepočítej coordinates pro tvůj screenshot rozměr |
| Recyklovaná konverzace | Vrať se na Krok 3 a otevři **nový tab** přes `tabs_create_mcp` + `navigate` — nikdy nereuse chat, ve kterém už jsi generoval jeden obrázek |
| Obrázek se ještě generuje | Před klikem ověř JS dotazem (`naturalWidth > 500 && complete === true`); jinak počkej dalších 20 s |

**Nepoužívej:**
- ❌ Synthetic `document.querySelector('button[aria-label="Stáhnout..."]').click()` — Chrome blokuje download pro `isTrusted: false` event
- ❌ `canvas.toDataURL()` + `anchor.download` — stejný user-gesture problém
- ❌ `fetch(blob_url)` nebo `XMLHttpRequest` — selže s „Failed to fetch" (extension worker ≠ page process)
- ❌ Chunked base64 přes JS → PowerShell — auto-mode classifier to klasifikuje jako data exfiltration

### Komprese a vizuální kontrola

PNG z Gemini bývají 5–10 MB. Pro Cloudinary i pro rychlejší PUT je vhodné rovnou převést na JPG quality 85 (~1 MB):

```powershell
Add-Type -AssemblyName System.Drawing
$jpgPath = $pngPath -replace '\.png$', '.jpg'
$img = [System.Drawing.Image]::FromFile($pngPath)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
         Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, 85L)
$img.Save($jpgPath, $codec, $encoderParams)
$img.Dispose()
```

Aktualizuj `[IMG_PATH] = $jpgPath` a MIME na `image/jpeg`.

**Vizuální kontrola:** otevři `[IMG_PATH]` přes `Read` (Claude je multimodální) a stručně
zkontroluj, že obrázek odpovídá tématu článku a neobsahuje žádný rozbitý/nesmyslný text.
Pokud obrázek vypadá nepoužitelně, vrať se ke kroku 3 s upraveným promptem (max. 1 oprava).

**Pozn. k vodoznaku:** Gemini do generovaných obrázků vkládá malý diamantový vodoznak
v rozích — to je vlastnost generátoru a žádný prompt ho neodstraní. Počítej s tím jako
s očekávaným chováním, ne s chybou.

---

## Krok 5 — Komprese (přeskoč, pokud už máš JPG z Kroku 4)

Tento krok je už integrovaný v Kroku 4 (PNG → JPG quality 85). Pokud z nějakého důvodu pracuješ se surovým PNG > 10 MB, použij stejný postup jako v Kroku 4 pro převod na JPG.

Cloudinary free plan má limit 10 485 760 bytes. JPG quality 85 z Gemini PNG je typicky 0,9–1,2 MB, takže limit bezpečně procházíš.

---

## Krok 6 — Nahraj na Cloudinary

Stejný postup jako v `agro-cover-image` (Krok 3) — REST upload přes
`mcp__Windows-MCP__PowerShell`, endpoint `image/upload`.

Klíč **nikdy nepiš do skillu ani do chatu** — stalo se 25. 08. 2026, že natvrdo
vepsaný `apiKey` v čase zestárl a vrátil `"Invalid api_key"`. Čte se výhradně
z proměnných prostředí. Kam je uložit, popisuje
[`SECRETS.md`](https://github.com/kolderbenjamin-sys/Claude-Code-Skills/blob/main/SECRETS.md).

```powershell
$filePath = "[IMG_PATH]"
$cloudName = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_CLOUD_NAME', 'User')
$apiKey    = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_API_KEY', 'User')
$apiSecret = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_API_SECRET', 'User')
if (-not $cloudName -or -not $apiKey -or -not $apiSecret) {
    Write-Output "[COVER-GEMINI] CHYBA — Cloudinary env proměnné chybí (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET). Viz SECRETS.md."
    exit 1
}
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

## Batch režim — paralelní generování více obrázků najednou

Pokud uživatel (nebo scheduled task) potřebuje vygenerovat cover pro **více článků v jednom běhu** (typicky 3 z denní pipeline), použij tento režim místo opakovaného 3× spouštění celého skillu. Ušetří ~2,5 min na pipeline tím, že 3 Gemini generations běží paralelně místo sekvenčně.

**Vstup:** pole 3 ID článků bez `cover_image_url` (získej z API GET v Kroku 1, vyber 3 nejstarší drafty).

### Batch Krok 1 — Připrav 3 prompty (sériově, rychlé)

Pro každý článek udělej **Krok 2** (sestav prompt podle titulku/obsahu). Výsledek: pole `[{articleId, slug, prompt}, ...]` × 3.

### Batch Krok 2 — Otevři 3 taby + naviguj na Gemini (paralelně)

V **jedné** message zavolej tyto MCP tooly paralelně (multiple tool calls v jedné odpovědi = concurrent execution):

```
mcp__Claude_in_Chrome__tabs_create_mcp()  →  tabId_1
mcp__Claude_in_Chrome__tabs_create_mcp()  →  tabId_2
mcp__Claude_in_Chrome__tabs_create_mcp()  →  tabId_3
```

Pak v další message paralelně naviguj všechny 3 taby:

```
navigate(tabId_1, "https://gemini.google.com/app")
navigate(tabId_2, "https://gemini.google.com/app")
navigate(tabId_3, "https://gemini.google.com/app")
```

Krátká pauza 4 s pro načtení stránek.

Ulož si mapu `{articleId → tabId}` pro pozdější identifikaci.

### Batch Krok 3 — Pošli 3 prompty paralelně

V jedné message zavolej `javascript_tool` 3× paralelně, každý do svého tabu se svým promptem (stejný JS jako v Kroku 3 standardního flow).

### Batch Krok 4 — Společné čekání

Místo 3× `Start-Sleep 80s` (= 240 s sériově) udělej **jen jednu pauzu ~90 s** — všechny 3 Gemini chats generují obrázky souběžně na Google straně.

```powershell
Start-Sleep -Seconds 90
```

### Batch Krok 5 — Ověření že všechny 3 obrázky jsou hotové (paralelně)

V jedné message spusť `javascript_tool` 3× paralelně, každý kontroluje `complete && naturalWidth > 500` ve svém tabu. Pokud některý ještě není hotový, počkej 20 s a zkontroluj znovu (max 2× retry).

### Batch Krok 6 — Stáhni 3 obrázky **SÉRIOVĚ** (KRITICKÉ)

**Pozor — paralelní download je velké riziko:** všechny 3 PNG by spadly do `~/Downloads` ve stejnou sekundu pod jménem `Gemini_Generated_Image_<random>.png` a nešlo by je párovat s články. Proto download dělej **jeden po druhém s 3 s pauzou**:

```
Pro každý article v batch:
  1. snapshot stávajícího nejnovějšího Gemini souboru v Downloads
  2. computer.hover(tabId, [935, 450])
  3. computer.left_click(tabId, [1284, 343])
  4. wait 8 s
  5. najdi nový Gemini soubor (LastWriteTime > snapshot)
  6. přesuň/přejmenuj na <slug>_cover_<ts>.png v pracovní složce
  7. converze PNG → JPG quality 85
```

Tato fáze trvá ~3 × 10 s = 30 s — stále rychlejší než kompletní sériový flow.

### Batch Krok 7 — Cloudinary upload (paralelně) + PUT update (paralelně)

V jedné message spusť **3 paralelní PowerShell calls** pro Cloudinary upload. Po dokončení v další message **3 paralelní PUT** requesty pro nastavení `cover_image_url` + `status: published`.

### Batch Krok 8 — Úklid + souhrnný report

Smaž lokální soubory paralelně. Souhrn:

```
✅ Batch hotov — 3/3 cover images publikováno:

  📰 [článek 1]: <cloudinary_url_1>
  📰 [článek 2]: <cloudinary_url_2>
  📰 [článek 3]: <cloudinary_url_3>

⏱️ Celkový čas: ~3 min (oproti ~6 min sériově)
```

### Riziko a fallback

- **Gemini rate limit:** Pro účet zvládá 3 souběžné generations. Pokud se některý prompt vrátí s chybou „too many requests", přepni daný článek do sériového fallbacku (opakuj Krok 3 standardního flow).
- **Tab si nezapamatuje prompt:** pokud `javascript_tool` JS vrátí `ERROR: no editable`, počkej 3 s a opakuj — Gemini stránka se nestihla načíst.
- **Klik na download stáhne starý cached obrázek:** pokud nový PNG se v Downloads neobjeví do 10 s, ověř že JS check `complete: true` opravdu prošel — možná byl false positive a obrázek se stahuje znova.

---

## Chybové stavy

| Stav | Příčina | Řešení |
|---|---|---|
| Žádný článek bez cover image | Všechny články mají obrázek, nebo agro-journalist nezavolal POST do API | Spusť `agro-journalist` (Krok 5.5) a ověř články přes GET; ukonči gracefully |
| AI_API_KEY chybí | Proměnná není nastavena | Ulož ji do User env proměnných — viz `SECRETS.md` |
| Cloudinary env proměnné chybí | `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` nejsou nastavené | Ulož je do User env proměnných — viz `SECRETS.md` |
| Gemini odmítne / nevygeneruje | Politika obsahu, nejasný prompt | Zobecni prompt, zkus znovu (max 2×) |
| Generování zamrzne na prázdném/šedém obrázku | Prompt obsahuje konkrétní lidskou postavu | Přepiš scénu bez lidí (technika/zvířata/krajina/interiér), přidej "no people", zkus v novém tabu |
| Vygenerovaný obrázek neodpovídá tématu | Nejasný/abstraktní prompt | Konkretizuj scénu, zkus znovu (max 1×) |
| Klik na download neudělal nic | Synthetic JS click — Chrome blokuje | **Použij `computer.hover` → `computer.left_click([1284, 343])`** (CDP trusted event) |
| Download stáhl prázdný / starý obrázek | Recyklovaná konverzace | Otevři **nový tab** přes `tabs_create_mcp` + `navigate` a Krok 3 zopakuj |
| Image `complete: false` při kliku | Generování ještě běží | Počkej 20–30 s a zkontroluj znovu před klikem |
| Cloudinary upload selže | Špatné credentials / síť | Zaznamenej chybu, neukončuj — zkus jednou znovu |
| PUT selže | Chybné ID / server error | Zkus jednou znovu, pak nahlas chybu |
