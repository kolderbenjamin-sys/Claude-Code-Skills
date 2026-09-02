---
name: profifarmar-reels
description: "Vyrobí a publikuje REELS (9:16 video, 1080×1920) z publikovaných článků na Profifarmar.cz — na Instagram i Facebook přes Buffer. Ze statického článku udělá krátké video: fotka na celé ploše se pomalu přibližuje, titulek leží nehybně na tmavém přechodu. Na rozdíl od agro-stories-cloud, který dělá statické STORY mizící po 24 hodinách, tenhle skill dělá trvalé video příspěvky do sekce Reels. Sazba je posazená mimo UI vrstvu Instagramu včetně bočního ořezu, který 9:16 video na telefonech potkává. Použij vždy, když uživatel chce udělat reel, video z článku, krátké video na sítě, animovaný příspěvek, nebo zmíní že chce statický post změnit na video. Trigger keywords: profifarmar reels, agro reel, udělej reel, reel z článku, video z článku, krátké video na instagram, animovaný příspěvek, statický post na video, ken burns, 9:16 video, reels routine, publikuj reel."
---

# ProfiFarmář Reels

Ze statického článku udělá **8s reel 1080×1920** a publikuje ho na Instagram i Facebook.

Pipeline: článek → PNG vrstvy (Chromium) → MP4 (ffmpeg) → Cloudinary → Buffer.

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
| Log | `posted-stories-log.json` | `posted-reels-log.json` |

Logy jsou **oddělené**. Reel _smí_ propagovat článek, který už byl na story nebo na feedu.
Nesmí se jen zopakovat **reel** ze stejného článku.

---

## Krok 1 — Vyber článek

```bash
set -euo pipefail
: "${AI_API_KEY:?AI_API_KEY chybí — nastav ji v Environment u Routine, viz SECRETS.md}"

curl -sS -m 60 -H "Authorization: Bearer $AI_API_KEY" \
  "https://profifarmar.cz/api/webhook.php?limit=10000" -o /tmp/articles.json

posted=$(jq '[.[].id]' posted-reels-log.json 2>/dev/null || echo "[]")
jq --argjson p "$posted" '
  (.data // .)
  | map(select(.status == "published" and .cover_image_url != null))
  | map(select(.id as $i | ($p | index($i)) == null))
  | sort_by(.published_at) | reverse
' /tmp/articles.json > /tmp/kandidati.json
```

Sezónní vhodnost staršího článku posuzuj **stejně jako u stories** — reel navíc žije
dlouho, takže je to důležitější: nedávej tam fáze zemědělského roku, počasí, termíny
a ceny starší než dva měsíce.

### Fotka rozhoduje víc než u story

Titulek leží přímo na fotce, takže vyber článek, jehož cover má **klidný, spíš tmavý
spodek**. Změř to, neodhaduj:

```bash
# průměrný jas v pásu, kde bude ležet titulek (0–255)
ffmpeg -v error -i cover.jpg -vf \
  "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,\
crop=900:420:0:1000,format=gray,scale=1:1" -f rawvideo - | od -An -tu1
```

Ověřeno na živých reelech: **jas 28 i 118 je čitelný**. Nad ~140 už kontrast klesá —
vezmi jiný článek nebo počítej s tím, že to bude slabší.

---

## Krok 2 — Zkrať titulek na ~50 znaků

Sloupec sazby je v reelu užší než u story (780 px proti 954), takže se text láme dřív.

| Znaků | Řádků | Kde začíná sazba |
|---|---|---|
| ~40 | 2 | 1000 |
| ~50 | 3 | 965 |
| ~75 | 4 | 915 |
| 95+ | 5 | 758 — už moc, přeformuluj |

Zachovej čísla, neusekávej uprostřed věty, nepřidávej `…`.

---

## Krok 3 — Vyrenderuj vrstvy

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

Kategorie podle `category_id`: 1 ROSTLINNÁ VÝROBA · 2 ŽIVOČIŠNÁ VÝROBA · 3 TECHNIKA ·
4 LEGISLATIVA · 5 TRHY & CENY · 6 AGROEKOLOGIE. Datum ve tvaru `ZÁŘÍ 2026 · ČR`.

---

## Krok 4 — Sestav video

```bash
"$SKILL_DIR/scripts/png-to-reel.sh" --overlay "/tmp/reel_[ID].fg.png" \
  "/tmp/reel_[ID].bg.png" "/tmp/reel_[ID].mp4" 8
```

Výstup: 1080×1920, 30 fps, H.264 High/4.1, tichá AAC stopa, faststart, ~2–3 MB.

**ffmpeg v cloud kontejneru není** — skript si ho stáhne jako `ffmpeg-static` z npm.
Bez sudo, bez apt.

---

## Krok 5 — Cloudinary

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

Endpoint je `/video/upload`, ne `/image/upload`. Prefix `reel_` je povinný — feed i story
skilly píšou do stejné složky `SOCIALS` a s `overwrite=true` by si assety přepsaly.

---

## Krok 6 — Buffer

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

**Ověřeno proti živému Buffer schématu:**

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
do 10 s, ale zvládne i 4 minuty. Čekej, než ohlásíš výsledek.

---

## Krok 7 — Zapiš log

```bash
jq --arg id "[ARTICLE_ID]" --arg slug "[SLUG]" --arg d "$(date +%F)" \
   '. + [{id:$id, slug:$slug, posted_at:$d, layout:"gradient"}]' \
   posted-reels-log.json > /tmp/log.json && mv /tmp/log.json posted-reels-log.json
```

Log se **commituje**. Bez něj si běh v čerstvém kontejneru nepamatuje, co už vyšlo.

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
| `playwright not found` | renderer hledá Chromium v `PLAYWRIGHT_BROWSERS_PATH`, výchozí `/opt/pw-browsers` |

---

## Prostředí

- **Proměnné:** `AI_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
  `CLOUDINARY_API_SECRET`, `BUFFER_API_KEY`. Viz [`SECRETS.md`](../../../SECRETS.md).
- **Nástroje:** node 22+, Chromium (Playwright), jq, curl. ffmpeg se dotáhne sám.
- Běží v cloud Routine i ručně z chatu.
