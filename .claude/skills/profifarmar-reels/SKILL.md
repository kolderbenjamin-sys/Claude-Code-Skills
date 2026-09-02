---
name: profifarmar-reels
description: "Vyrobí a publikuje REELS (9:16 video, 1080×1920) z článků na Profifarmar.cz — na Instagram i Facebook přes Buffer. Ze statického článku udělá krátké video: fotka na celé ploše se pomalu přibližuje, titulek leží nehybně na tmavém přechodu. Na rozdíl od agro-stories-cloud, který dělá statické STORY mizící po 24 hodinách, tenhle skill dělá trvalé video příspěvky do sekce Reels. Sazba je posazená mimo UI vrstvu Instagramu včetně bočního ořezu, který 9:16 video na telefonech potkává. Který článek a kdy publikovat určuje volající — skill zpracuje, co dostane. Použij vždy, když uživatel chce udělat reel, video z článku, krátké video na sítě, animovaný příspěvek, nebo zmíní že chce statický post změnit na video. Trigger keywords: profifarmar reels, agro reel, udělej reel, reel z článku, video z článku, krátké video na instagram, animovaný příspěvek, statický post na video, ken burns, 9:16 video, reels routine, publikuj reel."
---

# ProfiFarmář Reels

Ze zadaného článku udělá **reel 1080×1920** a publikuje ho na Instagram i Facebook.

Pipeline: vstup → PNG vrstvy (Chromium) → MP4 (ffmpeg) → Cloudinary → Buffer.

> **Co tenhle skill neřeší.** Který článek se zpracuje, kolik reelů se udělá za běh, v jaký
> čas se publikují a jestli se něco eviduje — to určuje volající (Routine nebo uživatel
> v chatu). Skill umí vyrobit a vydat **jeden reel** ze zadaného vstupu; víc reelů = víc
> průchodů.

> **Proč vlastní renderer, ne Canva.** Free Canva účet má vyčerpanou kvótu na `resize-design`
> i `export-design`, takže 9:16 v Canvě vyrobit nejde. Renderer navíc nemá kvótu, běží offline
> a pro stejný vstup vrací stejný výstup.
>
> **Nikdy nesahej na Canva šablonu `DAHOBdpJ1tk`** — ta se aktivně používá na 4:5 feed posty.

---

## Rozdíl proti stories

| | `agro-stories-cloud` | `profifarmar-reels` |
|---|---|---|
| Výstup | statický PNG | video MP4 |
| Životnost | 24 h | trvale |
| Sazba | krémový pás přes celou šířku | tmavý přechod, fotka nezakrytá |
| Výběr a časování | pevně ve skillu | na volajícím |

---

## Vstup

Skill potřebuje čtyři věci: **titulek**, **kategorii**, **datum** a **cover fotku**.

Když dostane jen odkaz nebo identifikaci článku, dotáhne si je z API:

```bash
set -euo pipefail
: "${AI_API_KEY:?AI_API_KEY chybí — viz SECRETS.md}"

curl -sS -m 60 -H "Authorization: Bearer $AI_API_KEY" \
  "https://profifarmar.cz/api/webhook.php?limit=10000" -o /tmp/articles.json
```

Bez `?limit` vrátí API tiše jen 100 záznamů, a ne spolehlivě ty nejnovější.

Kategorie podle `category_id`: 1 ROSTLINNÁ VÝROBA · 2 ŽIVOČIŠNÁ VÝROBA · 3 TECHNIKA ·
4 LEGISLATIVA · 5 TRHY & CENY · 6 AGROEKOLOGIE. Datum ve tvaru `ZÁŘÍ 2026 · ČR`.

Článek **musí mít vyplněný `cover_image_url`** — bez fotky nemá reel co ukázat.

---

## Titulek — zkrať na ~50 znaků

Sloupec sazby je v reelu užší než u story (780 px proti 954), takže se text láme dřív.

| Znaků | Řádků | Kde začíná sazba |
|---|---|---|
| ~40 | 2 | 1000 |
| ~50 | 3 | 965 |
| ~75 | 4 | 915 |
| 95+ | 5 | 758 — už moc, přeformuluj |

Zachovej čísla, neusekávej uprostřed věty, nepřidávej `…`.

---

## Fotka — zkontroluj kontrast

Titulek leží přímo na fotce, takže je potřeba **klidný, spíš tmavý spodek**. Změř to,
neodhaduj:

```bash
# průměrný jas v pásu, kde bude ležet titulek (0–255)
ffmpeg -v error -i cover.jpg -vf \
  "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,\
crop=900:420:0:1000,format=gray,scale=1:1" -f rawvideo - | od -An -tu1
```

Ověřeno na živých reelech: **jas 28 i 118 je čitelný**. Nad ~140 kontrast klesá — nahlas to,
ať se dá vzít jiný článek.

---

## Krok 1 — Vyrenderuj vrstvy

```bash
SKILL_DIR=".claude/skills/profifarmar-reels"
curl -sS -m 90 "[COVER_URL]" -o "/tmp/cover_[ID].bin"

cat > "/tmp/reel_[ID].json" <<JSON
{
  "titulek":   "[TITULEK]",
  "kategorie": "[KATEGORIE]",
  "datum":     "[DATUM]",
  "coverPath": "/tmp/cover_[ID].bin",
  "assetsDir": "$SKILL_DIR/assets",
  "layout":    "gradient",
  "columns":   "edge",
  "layers":    true
}
JSON

node "$SKILL_DIR/scripts/render-reel.mjs" "/tmp/reel_[ID].json" "/tmp/reel_[ID].png"
```

`layers: true` uloží vedle výstupu **dvě vrstvy**: `.bg.png` (jen fotka) a `.fg.png`
(přechod a sazba, s alfou). Video pak zoomuje jen pozadí — bez toho by zoom odtáhl
titulek přesně z bezpečné zóny, kvůli které rozvržení vzniklo.

---

## Krok 2 — Sestav video

```bash
"$SKILL_DIR/scripts/png-to-reel.sh" --overlay "/tmp/reel_[ID].fg.png" \
  "/tmp/reel_[ID].bg.png" "/tmp/reel_[ID].mp4" 8
```

Poslední číslo je délka v sekundách; 8 s je výchozí volba. Výstup: 1080×1920, 30 fps,
H.264 High/4.1, tichá AAC stopa, faststart, ~2–3 MB.

**ffmpeg v cloud kontejneru není** — skript si ho stáhne jako `ffmpeg-static` z npm.
Bez sudo, bez apt.

---

## Krok 3 — Cloudinary

> 🔐 Credentials **jen z env proměnných**. Nikdy je nevypisuj do logu.

```bash
: "${CLOUDINARY_CLOUD_NAME:?}"; : "${CLOUDINARY_API_KEY:?}"; : "${CLOUDINARY_API_SECRET:?}"

folder="SOCIALS"; public_id="reel_[DATUM_SLUG]_[ID]"; ts=$(date +%s)
sig=$(printf "folder=%s&overwrite=true&public_id=%s&timestamp=%s%s" \
      "$folder" "$public_id" "$ts" "$CLOUDINARY_API_SECRET" | sha1sum | cut -d' ' -f1)

curl -sS -m 300 -X POST "https://api.cloudinary.com/v1_1/$CLOUDINARY_CLOUD_NAME/video/upload" \
  -F "file=@/tmp/reel_[ID].mp4" -F "api_key=$CLOUDINARY_API_KEY" -F "timestamp=$ts" \
  -F "signature=$sig" -F "folder=$folder" -F "public_id=$public_id" -F "overwrite=true" \
  | jq -r '.secure_url'
```

Endpoint je `/video/upload`, ne `/image/upload`. Prefix `reel_` v `public_id` je povinný —
feed i story skilly píšou do stejné složky `SOCIALS` a s `overwrite=true` by si assety
přepsaly. `[DATUM_SLUG]` jen ASCII (`2026-09`), nikdy `ZÁŘÍ 2026 · ČR`.

---

## Krok 4 — Buffer

```bash
: "${BUFFER_API_KEY:?}"

call_buffer() {
  local body raw
  body=$(jq -n --arg n "$1" --argjson a "$2" \
    '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')
  raw=$(curl -sS -m 120 -X POST "https://mcp.buffer.com/mcp" \
    -H "Authorization: Bearer $BUFFER_API_KEY" -H "Content-Type: application/json" \
    -H "Accept: text/event-stream, application/json" -d "$body")
  if printf '%s' "$raw" | grep -q '^data: '; then
    printf '%s' "$raw" | grep '^data: ' | tail -1 | sed 's/^data: //'
  else printf '%s' "$raw"; fi
}
unwrap() { jq -r 'if .error then ("BUFFER_ERROR " + (.error|tostring)) else .result.content[0].text end'; }

org_id=$(call_buffer get_account '{}' | unwrap | jq -r '.organizations[0].id')
channels=$(call_buffer list_channels "$(jq -n --arg o "$org_id" '{organizationId:$o}')" | unwrap)
ig=$(echo "$channels" | jq -r '.[] | select(.service=="instagram") | .id')
fb=$(echo "$channels" | jq -r '.[] | select(.service=="facebook")  | .id')
```

Kanály **nikdy nehardcoduj**, zjišťuj je za běhu.

### Vytvoření reelu

```bash
create_reel() {   # $1 channel  $2 text  $3 video URL  $4 instagram|facebook
  local meta
  if [ "$4" = "instagram" ]; then
    meta='{"instagram":{"type":"reel","shouldShareToFeed":false}}'
  else
    meta='{"facebook":{"type":"reel"}}'
  fi
  call_buffer create_post "$(jq -n --arg c "$1" --arg t "$2" --arg u "$3" --argjson m "$meta" \
    '{channelId:$c, text:$t,
      assets:[{video:{url:$u, metadata:{title:"ProfiFarmář reel", thumbnailOffset:1000}}}],
      mode:"shareNow", schedulingType:"automatic", metadata:$m}')" | unwrap
}
```

**`shouldShareToFeed` musí být `false`.** Reel pak jde jen do sekce Reels a **nepřidá se
do hlavní mřížky profilu**, kde má zůstat jen 4:5 feed obsah. Buffer má ve výchozím stavu
`true` — přenastavit se to musí v každém volání, nastavení v Bufferu na to nestačí.

**Kdy to vyjde.** `mode: "shareNow"` odešle reel okamžitě. Když volající chce konkrétní čas,
použij `mode: "customScheduled"` a `dueAt` s ISO 8601 v UTC. Čas počítej přes epoch, ne
zápisem zóny:

```bash
due=$(TZ="Europe/Prague" date -d "today 18:00" +%s)
date -u -d "@$due" +"%Y-%m-%dT%H:%M:%SZ"
```

`TZ=Europe/Prague date -u` vrátí špatnou hodnotu — `-u` přebije zónu i při parsování.
Nikdy nehardcoduj `+02:00`, přechod na zimní čas by to rozbil.

**Popisek** drž na jednu větu, max ~90 znaků. Hlavní sdělení nese vizuál.

### Ověřeno proti živému Buffer schématu

| Věc | Detail |
|---|---|
| asset | `{video:{url, metadata:{title, thumbnailOffset}}}` — video **nemá** `altText`, na rozdíl od obrázku |
| `metadata.instagram.type` | `"reel"`; `shouldShareToFeed` je povinné pole |
| `metadata.facebook.type` | `"reel"` |
| `schedulingType` | povinné vždy, i při `shareNow` |
| `thumbnailOffset` | v **ms**; 1000 = náhled ze sekundy videa |
| `Accept` hlavička | `text/event-stream, application/json`, jinak 406 |

### ⚠️ Timeout neznamená neúspěch

Volání občas spadne na `Request to Buffer API timed out after 30000ms`, ale post
**projde**. Ověřeno na živém běhu. Nikdy neopakuj zápis naslepo — nejdřív zkontroluj:

```bash
call_buffer list_posts "$(jq -n --arg o "$org_id" '{organizationId:$o,status:["sent"],limit:30}')" \
  | unwrap | jq -r '.edges[].node | "\(.channelService) \(.status) \(.text[0:40])"'
```

`list_posts` **bez** `status` nevrací odeslané posty. Filtruj `sent`, `sending`, `error`.

Instagram zpracovává reel **2–6 minut** (`status: sending` → `sent`). Facebook bývá
do 10 s, ale zvládne i 4 minuty. Čekej na výsledek, než ohlásíš hotovo.

---

## Rozvržení a bezpečné zóny

Reel 9:16 se na telefonech **ořezává po stranách** — displeje jsou užší než 9:16:

| Displej | Vidí z 1080 px |
|---|---|
| iPhone 19.5:9 | x 97 – 983 |
| Android 20:9 | x 108 – 972 |
| 16:9 | vše |

Přes video navíc Instagram kreslí vlastní UI: sloupec ikon vpravo (zhruba x 958–1036,
y 1040–1620) a dole jméno účtu s popiskem (od y ≈ 1550).

**Volby `columns`:**

| | Sloupec | Kdy |
|---|---|---|
| `edge` (výchozí) | 80 → 860 | schváleno na živých reelech |
| `safe` | 120 → 860 | konzervativní, přežije i nejužší displeje |
| `wide` | 60 → 1014 | jen pro 16:9, jinak se ořeže |

**Volby `layout`:** `gradient` (výchozí, fotka nezakrytá) · `card` (sazba v krémové kartě) ·
`band` (krémový pás přes celou šířku) · `fullbleed` (pás až ke spodní hraně jako story).

Sazba končí na y = 1520, štítek kategorie visí přímo na horní hraně sazby.

---

## Co se pokazí a jak to poznáš

| Příznak | Příčina |
|---|---|
| Reel se objevil v hlavní mřížce profilu | `shouldShareToFeed` zůstalo `true` |
| Černá dlaždice v mřížce profilu | fade-in z černé — první snímek je zároveň náhled. Ve skriptu už není, nevracej ho |
| Titulek useknutý na kraji | `columns` nastavené na `wide`, nebo příliš malý levý okraj |
| Titulek pod ikonami | totéž zprava — sloupec nesmí přesáhnout x = 860 |
| Text se ve videu hýbe | chybí `--overlay`, zoomuje se celý snímek včetně sazby |
| Náhled je jiný snímek | `thumbnailOffset` je v ms, ne v sekundách |
| `sending` navždy | Instagram odmítl médium; zkontroluj `status:["error"]` |
| Post vyšel dvakrát | retry po timeoutu bez ověření přes `list_posts` |
| `playwright not found` | renderer hledá Chromium v `PLAYWRIGHT_BROWSERS_PATH`, výchozí `/opt/pw-browsers` |

---

## Prostředí

- **Proměnné:** `AI_API_KEY` (jen když se dotahuje článek z API), `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `BUFFER_API_KEY`.
  Viz [`SECRETS.md`](../../../SECRETS.md).
- **Nástroje:** node 22+, Chromium (Playwright), jq, curl. ffmpeg se dotáhne sám.
- Běží v cloud Routine i ručně z chatu.
