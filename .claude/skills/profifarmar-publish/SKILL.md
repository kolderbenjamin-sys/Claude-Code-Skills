---
name: profifarmar-publish
description: >
  Publikuje hotové zemědělské "Před a po" video na sociální sítě přes Buffer.
  Pipeline: uživatel zadá cestu k videu (nebo Cowork projektová složka) → Cloudinary upload → copywriting (1 text per platforma optimalizovaný pro Instagram, Facebook, YouTube) → Buffer distribuce.
  Použij tento skill vždy, když uživatel: zadá cestu k .mp4/.mov/.avi souboru a chce ho publikovat,
  chce nahrát agro video na sociální sítě, dokončil Google Labs Flow a chce distribuci,
  zmíní "publish", "nahrát video", "Buffer agro", "dej to na sítě", "naplánuj příspěvek",
  nebo pokračuje po ProfiFarmar-prompt skillu.
  Trigger keywords: publish video, nahrát na sítě, buffer agro, naplánovat příspěvek, mp4 agro,
  agro video sociální sítě, distribuovat video, instagram reel agro, facebook agro video.
---

# ProfiFarmar Publish Skill

Publikační pipeline pro zemědělský Before & After obsah. Přijme video soubor (.mp4, .mov, .avi) → Cloudinary → copywriting → Buffer → úklid.
Plně autonomní. Vše v češtině.

---

## DŮLEŽITÉ SCHEDULING PRAVIDLO

- Videa se VŽDY plánují na **peak time 18:00 CET** (rozmezí 17:00–21:00).
- Pokud je v pracovní složce **VÍCE videí**: každé video se publikuje v **JINÝ den** — jedno video = jeden den, vždy v 18:00 CET. První video dnes (nebo zítra pokud je po 20:00), další +1 den.
- Pokud je **JEDNO video**: publikuj ho v nejbližší peak time — nejpozději dnes v 21:00 pokud je ještě čas, jinak zítra v 18:00.
- Použij `mode: customScheduled`, `schedulingType: automatic` a `dueAt` s konkrétním ISO 8601 časem (např. `2026-05-12T18:00:00+02:00`).

---

## Detekce režimu — automaticky, bez dotazování

### Režim A — absolutní cesta v promptu
Uživatel zadal cestu přímo, např. `C:\Users\Ben\Downloads\restoration_zetor.mp4`
→ Zpracuj toto jedno video. Podporované formáty: .mp4, .mov, .avi.

### Režim B — žádná cesta v promptu
Žádná cesta nebyla zadána → načti pracovní složku z Cowork projektového kontextu.
```
mcp__Windows-MCP__FileSystem
  mode: list
  path: [COWORK_PROJECT_FOLDER]
  pattern: *.mp4,*.mov,*.avi
```
→ Zpracuj všechna nalezená videa sekvenčně, každé celým pipeline (Cloudinary → copy → Buffer).
→ Žádné potvrzení od uživatele — spusť automaticky.
→ Po zpracování VŠECH videí proveď úklid celé pracovní složky (viz Krok 5).

**Sdílené proměnné (pro oba režimy):**
- `[DATUM]` — dnešní datum ve formátu YYYY-MM-DD
- `[ID]` — krátký unikátní identifikátor: použij posledních 6 znaků z Unix timestamp (např. `a3f7c2`). V Režimu A vždy jedno ID. V Režimu B každé video dostane vlastní.

---

## Krok 1 — Cloudinary upload (PowerShell REST API)

Cloudinary MCP nepodporuje lokální `file://` cesty — upload probíhá přes přímé REST API volání z PC pomocí Windows-MCP PowerShell.

**Konstanty:**
```
cloudName  = <User env proměnná CLOUDINARY_CLOUD_NAME>
apiKey     = <User env proměnná CLOUDINARY_API_KEY>
apiSecret  = <User env proměnná CLOUDINARY_API_SECRET>
folder     = "agro-restoration"
publicId   = "restoration_[DATUM]_[ID]"
```

**PowerShell příkaz** (spusť přes `mcp__Windows-MCP__PowerShell`):
```powershell
$filePath = "[MP4_PATH]"
$cloudName = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_CLOUD_NAME', 'User')
$apiKey    = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_API_KEY', 'User')
$apiSecret = [System.Environment]::GetEnvironmentVariable('CLOUDINARY_API_SECRET', 'User')
if (-not $cloudName -or -not $apiKey -or -not $apiSecret) {
    Write-Output "[PUBLISH] CHYBA — Cloudinary env proměnné chybí (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)."
    exit 1
}
$folder = "agro-restoration"
$publicId = "restoration_[DATUM]_[ID]"

$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$timestamp = $epoch.ToString()

$paramString = "folder=$folder&overwrite=true&public_id=$publicId&timestamp=$timestamp" + $apiSecret
$sha1 = [System.Security.Cryptography.SHA1]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($paramString)
$hash = $sha1.ComputeHash($bytes)
$signature = -join ($hash | ForEach-Object { $_.ToString("x2") })

$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"
$url = "https://api.cloudinary.com/v1_1/$cloudName/video/upload"

$webRequest = [System.Net.HttpWebRequest]::Create($url)
$webRequest.Method = "POST"
$webRequest.ContentType = "multipart/form-data; boundary=$boundary"
$webRequest.Timeout = 180000

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
Add-FormField $requestStream $boundary "public_id" $publicId
Add-FormField $requestStream $boundary "overwrite" "true"

$fileHeader = "--$boundary$LF" +
    "Content-Disposition: form-data; name=`"file`"; filename=`"video.mp4`"$LF" +
    "Content-Type: video/mp4$LF$LF"
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
- `asset_id` → `[ASSET_ID]`

**Content-Type mapování:**
- `.mp4` → `video/mp4`
- `.mov` → `video/quicktime`
- `.avi` → `video/x-msvideo`
V PowerShell skriptu uprav `Content-Type` v `$fileHeader` podle skutečné přípony souboru.

**Retry logika:**
Pokud Cloudinary upload vrátí `ERROR:`, automaticky počkej 5 sekund a zkus upload znovu (1 retry). Pokud i druhý pokus selže, teprve pak reportuj chybu a pokračuj dalším videem (v Režimu B).

**Troubleshooting:**
- `ERROR:` v response → ověř, že cesta neobsahuje speciální znaky; obal do uvozovek
- Timeout (>180s) → velké soubory (>500MB) mohou překročit limit; zvyš `$webRequest.Timeout`
- `asset_id` chybí → použij `public_id` jako fallback

---

## Krok 2 — Copywriting (1 text per platforma)

Vygeneruj samostatný text pro každou platformu. Každý text v češtině.

### Instagram
- **Styl:** vizuální, emocionální, před/po kontrast
- **Délka:** 1–3 věty, max 150 znaků
- **CTA:** např. "Uložte si to 🔖", "Sledujte celý proces ↓"
- **Hashtagy:** 4–5 z: `#zemedelstvi #agro #renovace #BeforeAfter #farmlife #repairlife #kombajn #traktor`

### Facebook
- **Styl:** komunitní, příběhový, konverzační tón — oslovuj komunitu zemědělců
- **Délka:** 2–4 věty, max 250 znaků
- **CTA:** např. "Sdílejte, pokud znáte podobný stroj!", "Dejte vědět v komentářích 💬"
- **Hashtagy:** 3–5 z: `#zemedelstvi #renovace #predapo #farmlife #agro #oprava`

### YouTube
- **Title:** SEO-friendly, max 60 znaků, obsahuje klíčové slovo (renovace / before after / oprava)
- **Description:** 2–3 věty popisující obsah videa, bez hashtagů v první větě
- **Hashtagy:** 3 na konci popisu: `#renovace #zemedelstvi #predapo`

### Dynamické hashtagy z názvu souboru
Parsuj název souboru (bez přípony) a rozděl podle `_`, `-` nebo mezer. Pokud se v názvu nachází rozpoznatelné klíčové slovo (název stroje, značka, model — např. `zetor`, `7045`, `kombajn`, `claas`), přidej ho jako hashtag ke generickým hashtagům dané platformy. Příklad: soubor `renovace_zetor_7045.mp4` → přidej `#zetor` a `#7045`. Přidávej max 2–3 dynamické hashtagy, aby celkový počet zůstal rozumný.

---

## Krok 3 — Buffer distribuce

### Výběr metody — automaticky, bez dotazování

**Metoda A — Buffer MCP (preferovaná):**
Pokud je dostupný `mcp__buffer__create_post` tool, použij ho. Ověř dostupnost zavoláním `mcp__buffer__get_account`.

**Metoda B — PowerShell přímé volání Buffer MCP API (fallback):**
Pokud Buffer MCP tool NENÍ dostupný (ToolSearch nenajde `mcp__buffer`), použij přímé HTTP volání Buffer MCP endpointu přes PowerShell. Tato metoda je spolehlivější — obchází problémy s `mcp-remote` konektorem.

---

### Metoda A — Buffer MCP tools

```
mcp__buffer__get_account → ulož organizationId
mcp__buffer__list_channels → ulož channel IDs pro Instagram, Facebook, YouTube
```

Parametry `create_post`:
- `channelId` — ID kanálu z `list_channels`
- `mode` — `customScheduled` (pro konkrétní čas) nebo `shareNow` (ihned)
- `schedulingType` — `automatic`
- `dueAt` — ISO 8601 s timezone offsetem (povinné pro `customScheduled`)
- `text` — text příspěvku
- `assets` — objekt: `{ videos: [{ url: "..." }] }`
- `metadata` — platformově specifické: viz níže

### Metoda B — PowerShell HTTP (fallback)

**Konstanty:**
```
Buffer MCP endpoint = "https://mcp.buffer.com/mcp"
Buffer token        = <User env proměnná BUFFER_API_KEY>
```

**Načtení tokenu (PowerShell):** token čti z User env proměnné, **ne** z konfiguračních
souborů. Kam ji uložit, popisuje [`SECRETS.md`](https://github.com/kolderbenjamin-sys/Claude-Code-Skills/blob/main/SECRETS.md).

```powershell
$token = [System.Environment]::GetEnvironmentVariable('BUFFER_API_KEY', 'User')
if (-not $token) {
    Write-Output "[PUBLISH] CHYBA — BUFFER_API_KEY není nastavena. Viz SECRETS.md."
    exit 1
}
```

**Inicializace session (povinné — 1× na začátku):**
```powershell
function Call-BufferMCP($method, $params, $id) {
    $body = @{ jsonrpc="2.0"; id=$id; method=$method; params=$params } | ConvertTo-Json -Depth 10
    $wr = [System.Net.HttpWebRequest]::Create("https://mcp.buffer.com/mcp")
    $wr.Method = "POST"; $wr.ContentType = "application/json"
    $wr.Accept = "text/event-stream, application/json"
    $wr.Headers.Add("Authorization", "Bearer $token"); $wr.Timeout = 30000
    $bb = [System.Text.Encoding]::UTF8.GetBytes($body)
    $rs = $wr.GetRequestStream(); $rs.Write($bb, 0, $bb.Length); $rs.Close()
    $resp = $wr.GetResponse()
    $rd = New-Object System.IO.StreamReader($resp.GetResponseStream())
    return ($rd.ReadToEnd() | ConvertFrom-Json).result.content[0].text
}

# Inicializace
$initBody = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cowork","version":"1.0"}}}'
# ... (POST na endpoint, ověř že vrátí serverInfo)
```

**Získání účtu a kanálů:**
```powershell
$account = Call-BufferMCP "tools/call" @{ name="get_account"; arguments=@{} } 2 | ConvertFrom-Json
$orgId = $account.organizations[0].id

$channels = Call-BufferMCP "tools/call" @{ name="list_channels"; arguments=@{ organizationId=$orgId } } 3 | ConvertFrom-Json
$igId = ($channels | Where-Object { $_.service -eq "instagram" }).id
$fbId = ($channels | Where-Object { $_.service -eq "facebook" }).id
$ytId = ($channels | Where-Object { $_.service -eq "youtube" }).id
```

**Vytvoření postu (PowerShell):**
```powershell
$result = Call-BufferMCP "tools/call" @{
    name = "create_post"
    arguments = @{
        channelId = $igId
        text = "[TEXT + HASHTAGY]"
        assets = @{ videos = @(@{ url = "[CLOUDINARY_URL]" }) }
        mode = "customScheduled"
        schedulingType = "automatic"
        dueAt = "[ISO_8601_CAS]"
        metadata = @{ instagram = @{ type = "reel"; shouldShareToFeed = $true } }
    }
} [ID]
```

---

### Scheduling pravidlo — Peak Time distribuce (17:00–21:00 CET)

**Cíl:** Každé video se publikuje v nejatraktivnějších hodinách (17:00–21:00 CET). Nikdy víc než jedno video za den.

**Logika plánování:**

1. **Zjisti aktuální čas** (CET/CEST — Europe/Prague timezone).

2. **Jedno video (Režim A nebo Režim B s 1 videem):**
   - Pokud je teď < 20:00 → naplánuj na **dnes v 18:00** (nebo nejbližší celá hodina v rozmezí 17:00–20:00, aby Buffer stihl zpracovat).
   - Pokud je teď ≥ 20:00 → naplánuj na **zítra v 18:00**.

3. **Více videí (Režim B s 2+ videi):**
   - První video: stejná logika jako pro jedno video (dnes pokud < 20:00, jinak zítra).
   - Každé další video: **+1 den** oproti předchozímu, vždy v **18:00 CET**.
   - Příklad: 3 videa zpracovaná v pondělí v 15:00 → Video 1 = Po 18:00, Video 2 = Út 18:00, Video 3 = St 18:00.

4. **Formát dueAt:** ISO 8601 s timezone offsetem, např. `2026-05-12T18:00:00+02:00`.

---

### Parametry create_post per platforma

**Společné pro obě metody (A i B):**

### Instagram
```
channelId: [INSTAGRAM_ID]
text: [INSTAGRAM_COPY + hashtagy]
assets: { videos: [{ url: [CLOUDINARY_URL] }] }
mode: customScheduled
schedulingType: automatic
dueAt: [VYPOČTENÝ_ČAS]
metadata: { instagram: { type: "reel", shouldShareToFeed: true } }
```

### Facebook
```
channelId: [FACEBOOK_ID]
text: [FACEBOOK_COPY + hashtagy]
assets: { videos: [{ url: [CLOUDINARY_URL] }] }
mode: customScheduled
schedulingType: automatic
dueAt: [VYPOČTENÝ_ČAS]
metadata: { facebook: { type: "reel" } }
```
**POZOR:** Facebook vyžaduje `metadata.facebook.type` — bez něj post selže!

### YouTube
```
channelId: [YOUTUBE_ID]
text: [YOUTUBE_DESCRIPTION + hashtagy]
assets: { videos: [{ url: [CLOUDINARY_URL] }] }
mode: customScheduled
schedulingType: automatic
dueAt: [VYPOČTENÝ_ČAS]
metadata: { youtube: { title: "[YT_TITLE]", categoryId: "22" } }
```

**Poznámka k YouTube:** Video z Flow je portrait (9:16) — YouTube Shorts formát, funguje.

**Retry logika pro Buffer:** Pokud `create_post` selže na kterémkoli kanálu, počkej 5 sekund a zkus znovu (1 retry). Pokud i druhý pokus selže, reportuj chybu pro daný kanál a pokračuj s ostatními.

**Batch progress (Režim B):** Po každém zpracovaném videu zobraz:
`✅ Video [X/Y] — [název souboru] — naplánováno na Instagram, Facebook, YouTube`

---

## Krok 4 — Závěrečné shrnutí

Zobraz v češtině:

```
✅ Publikováno na 3 kanálech:
   📸 Instagram Reel — ID: [post_id] | čas: [scheduled_at]
   📘 Facebook — ID: [post_id] | čas: [scheduled_at]
   ▶️  YouTube — ID: [post_id] | čas: [scheduled_at]

📝 Použité copy:
   📸 Instagram: "[text]"
   📘 Facebook: "[text]"
   ▶️  YouTube title: "[title]"

☁️  Cloudinary: [CLOUDINARY_URL]
    (video zůstává v Cloudinary — nebylo smazáno)
```

---

## Krok 5 — Úklid pracovní složky

Tento krok se provede **vždy po kompletním dokončení** celého pipeline (všechna videa zpracována, závěrečné shrnutí zobrazeno). Platí pro **oba režimy** (A i B).

Smaž **všechny soubory** v pracovní složce — nejen videa, ale i případné dočasné soubory, logy, pomocné soubory. Cíl: složka musí být po skončení prázdná.

```
mcp__Windows-MCP__PowerShell
  Remove-Item -Path "[COWORK_PROJECT_FOLDER]\*" -Recurse -Force
```

Po provedení ověř, že složka je prázdná:
```
mcp__Windows-MCP__FileSystem
  mode: list
  path: [COWORK_PROJECT_FOLDER]
```

Zobraz:
`🧹 Pracovní složka vyčištěna — všechny soubory odstraněny.`

Pokud smazání selže (zamčený soubor apod.), reportuj které soubory se nepodařilo smazat, ale nepřerušuj celý workflow kvůli tomu.

---

## Troubleshooting

| Problém | Řešení |
|---|---|
| Cloudinary upload timeout | Ověř velikost souboru; velká videa (>500MB) mohou trvat déle |
| Cloudinary upload ERROR | Automaticky 1 retry po 5s; pokud selže i podruhé, reportuj a pokračuj |
| Buffer `channel not found` | Spusť `list_channels` znovu, ověř správné IDs |
| `create_post` selže na jednom kanálu | 1 retry po 5s; pokud selže, publikuj zbývající kanály a reportuj chybu |
| `secure_url` chybí v Cloudinary response | Použij `url` field jako fallback |
| YouTube odmítne portrait video | Přidej `metadata.youtube.madeForKids: false` |
| Nepodporovaný formát videa | Skill podporuje .mp4, .mov, .avi — jiné formáty přeskoč a informuj uživatele |
| Úklid složky selže | Reportuj zamčené soubory, ale nepřerušuj workflow |
| Buffer MCP tool nedostupný | Automaticky přepni na Metodu B (PowerShell HTTP) — viz Krok 3 |
| Buffer 406 Not Acceptable | Přidej header `Accept: text/event-stream, application/json` |
| Facebook post selže bez typu | Přidej `metadata.facebook.type: "reel"` — FB vyžaduje explicitní typ |
| Buffer token expiroval | Vygeneruj nový na publish.buffer.com/settings/api a přeulož do `BUFFER_API_KEY` (User scope) |
| Cloudinary env proměnné chybí | Ulož `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` do User env proměnných — viz `SECRETS.md` |
| BUFFER_API_KEY chybí | Ulož ji do User env proměnných — viz `SECRETS.md` |
