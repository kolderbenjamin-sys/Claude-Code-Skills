---
name: agro-stories-cloud
description: "Vytvoří a naplánuje zemědělské STORY (9:16, 1080×1920) z publikovaných článků na Profifarmar.cz — na Instagram i Facebook přes Buffer. Jedním neinteraktivním během vybere 2 dosud nepoužité články, pro každý vyrenderuje story vizuál v brandu ProfiFarmář (cover fotka + kategorie + datum + titulek), nahraje na Cloudinary a naplánuje jednu story na ráno (08:00) a druhou na večer (19:00) Europe/Prague, aby byla na profilu pořád nějaká živá story. Na rozdíl od agro-socials-local a agro-socials-cloud, které dělají čtvercové 4:5 příspěvky do feedu přes Canva šablonu, tento skill dělá výhradně vertikální story a vizuál renderuje lokálně přes Chromium (nezávisle na Canva kvótě). Určeno pro Claude Code cloud Routine (Linux, bash/curl/jq/node, žádný interaktivní checkpoint). Použij vždy, když uživatel chce dát článek na story, naplánovat story, udělat 9:16 příspěvek nebo vertikální vizuál. Trigger keywords: agro stories, story z článku, dej to na story, naplánuj story, 9:16 story, vertikální příspěvek, instagram story agro, facebook story agro, ranní a večerní story, stories cloud, story routine."
---

# Agro-Stories Cloud Skill

Neinteraktivní varianta pro **Claude Code cloud Routine**. Jedním během:

1. vybere **2 publikované články**, ze kterých ještě story nebyla,
2. pro každý vyrenderuje **1080×1920 PNG** v brandu ProfiFarmář,
3. nahraje ho na Cloudinary,
4. naplánuje přes Buffer **2 story × 2 sítě = 4 posty** — jednu na **08:00**, druhou na **19:00** Europe/Prague.

Proč dvě: story na Instagramu i Facebooku žije **24 hodin**. Ranní kryje den, večerní noc a další ráno,
takže na profilu je pořád aspoň jedna živá — „jdeme vidět po celý den".

> **Bez kontrolního bodu.** Skill běží autonomně. Nikdy se neptá, jen na konci vypíše shrnutí (Krok 8).
> Interaktivní feed varianta s potvrzením je `agro-socials-local`.

> **Vizuál se nedělá v Canvě.** Free Canva účet má vyčerpanou kvótu na `resize-design` i `export-design`,
> takže 9:16 šablonu v Canvě nelze vyrobit ani exportovat. Story se proto renderují lokálně přes
> Chromium (`scripts/render-story.mjs`) — barvy, písma i logo jsou vytažené přímo ze 4:5 šablony
> `DAHOBdpJ1tk`, takže story a feed vypadají jako jedna rodina. Renderer navíc nemá žádnou kvótu,
> běží offline a pro stejný vstup vrací stejný výstup, což je pro nehlídanou Routine zásadní.

---

## Vstup — které články

- **Bez upřesnění** (běh z Routine) → vezmi **2 nejnovější `published` články s `cover_image_url`**,
  které ještě nejsou v `posted-stories-log.json`.
- **S tématem** → vyber odpovídající články, dedupe proti logu platí pořád.
- Log je **záměrně oddělený** od `posted-log.json` (feed). Story _smí_ propagovat článek, který už
  na feedu byl — to je žádoucí. Nesmí se jen zopakovat **story** ze stejného článku.

**Sdílené proměnné (per článek):**

| Proměnná | Zdroj | Poznámka |
|---|---|---|
| `[TITULEK]` | `title` | pro story zkrať na **max ~70 znaků** — viz Krok 2 |
| `[KATEGORIE]` | `category_id` → tabulka níže | velkými písmeny |
| `[DATUM]` | `published_at` | `SRPEN 2026 · ČR`, velkými písmeny |
| `[DATUM_SLUG]` | `published_at` | `2026-08` — jen ASCII, jde do Cloudinary `public_id` |
| `[COVER_URL]` | `cover_image_url` | |
| `[ID]` | odvoď z `slug` | krátký ASCII slug, např. `rybnikarstvi_trebonsko` |
| `[CLANEK_URL]` | `slug` | `https://profifarmar.cz/clanek/<slug>/` — **s koncovým lomítkem** |

> ⚠️ `[CLANEK_URL]` musí končit lomítkem. Bez něj vrací web **301** a link sticker by zbytečně
> přesměrovával. API v seznamu vrací jen `id, title, slug, status, category_id, cover_image_url,
> published_at` — pole `url` ani `perex` tam **nejsou**, URL se vždy skládá ze `slug`.

**Mapování kategorií:**

| ID | `[KATEGORIE]` |
|---|---|
| 1 | ROSTLINNÁ VÝROBA |
| 2 | ŽIVOČIŠNÁ VÝROBA |
| 3 | TECHNIKA |
| 4 | LEGISLATIVA |
| 5 | TRHY & CENY |
| 6 | AGROEKOLOGIE |

**Měsíce do `[DATUM]`:** LEDEN, ÚNOR, BŘEZEN, DUBEN, KVĚTEN, ČERVEN, ČERVENEC, SRPEN, ZÁŘÍ, ŘÍJEN,
LISTOPAD, PROSINEC.

**Region (suffix `[DATUM]`) — auto podle tématu:** defaultně `· ČR`; `· EU` u celoevropských témat;
`· FINSKO`, `· DÁNSKO`, `· FRANCIE` apod. u článků primárně o konkrétní zemi. Když si nejsi jistý, `· ČR`.

---

## Krok 0 — Mergni zbylou PR z minulého běhu

`posted-stories-log.json` se commituje na větev `claude/…`, ne rovnou do `main`. Když PR z minulého
běhu zůstane nemergnutá, tento běh uvidí zastaralý log a vybral by **stejné články znovu**.

Zkontroluj otevřené PR z větve `claude/*` do `main`. Pokud existuje a `mergeable_state` je `clean`,
mergni ji a až pak pokračuj.

---

## Krok 1 — Vyber 2 články

```bash
set -euo pipefail
: "${AI_API_KEY:?AI_API_KEY chybí — nastav ji v sekci Environment u Routine}"

curl -sS -m 60 -H "Authorization: Bearer $AI_API_KEY" \
  "https://profifarmar.cz/api/webhook.php" -o /tmp/articles.json

posted_ids=$(jq '[.[].id]' posted-stories-log.json 2>/dev/null || echo "[]")

jq --argjson posted "$posted_ids" '
  (.data // .)
  | map(select(.status == "published" and .cover_image_url != null))
  | map(select(.id as $id | ($posted | index($id)) == null))
  | sort_by(.published_at) | reverse
' /tmp/articles.json > /tmp/candidates.json

jq -r '.[:10][] | "\(.published_at)  cat=\(.category_id)  \(.title)"' /tmp/candidates.json
```

Z prvních ~10 kandidátů vyber **2**. Přeskoč **sezónní nesoulad** (článek o jarních mrazech nedávej
na story v září), i kdyby byl novější. Preferuj dva **různé kategorie**, ať ranní a večerní story
nevypadají stejně.

---

## Krok 2 — Zkrať titulek

Renderer si titulek sám zmenší, aby se vešel, ale **story se čte na jeden pohled** — dlouhý titulek
se scvrkne na 6 řádků drobného písma a nikdo ho nepřečte.

- Cíl **max ~70 znaků** (feed má ~75).
- Zachovej hlavní sdělení a **čísla** (`600–1200 Kč`, `22 procent`, `300 miliard eur`).
- Nikdy neusekávej uprostřed slova ani věty a nepřidávej `…` — přeformuluj.
- Vypusť redakční ocásky za pomlčkou/dvojtečkou, když nenesou pointu.

Příklad: `Brusel navrhuje zemědělský rozpočet 300 miliard eur pro roky 2028-2034 - propad o 22 procent
vůči současné CAP rozpoutal protesty českých farmářů` (145 zn.) →
`Brusel navrhuje rozpočet 300 miliard eur, propad o 22 procent` (60 zn.).

---

## Krok 3 — Vyrenderuj story PNG

```bash
SKILL_DIR=".claude/skills/agro-stories-cloud"

curl -sS -m 90 "[COVER_URL]" -o "/tmp/cover_[ID].bin"

cat > "/tmp/story_[ID].json" <<JSON
{
  "titulek":   "[TITULEK]",
  "kategorie": "[KATEGORIE]",
  "datum":     "[DATUM]",
  "coverPath": "/tmp/cover_[ID].bin",
  "assetsDir": "$SKILL_DIR/assets"
}
JSON

node "$SKILL_DIR/scripts/render-story.mjs" "/tmp/story_[ID].json" "/tmp/story_[ID].png"
```

Renderer vypíše např. `rendered /tmp/story_x.png  headline 82px / 3 lines  panelTop 1100px`.

**Co dělá:** vloží cover, písma i logo jako `data:` URI (Chromium tedy renderuje **offline**),
zmenší titulek dokud se nevejde, a podle výšky textu dopočítá, kde začíná krémový panel — takže
krátký i dlouhý titulek mají stejný spodní rytmus. Výstup je vždy **1080×1920 PNG bez alfa kanálu**.

**Bezpečné zóny Instagramu** jsou už zadrátované v rozvržení: horních ~250 px (jméno profilu)
a spodních ~250 px (lišta odpovědí a link sticker) zůstávají prázdné. Nesahej na `M.logoTop`,
`M.footerTop` ani `M.textBottom` ve skriptu, pokud tohle neřešíš vědomě.

**Ověření (nepovinné, ale levné):**
```bash
python3 -c "
from PIL import Image; im=Image.open('/tmp/story_[ID].png')
assert im.size==(1080,1920), im.size
print('OK', im.size, im.mode)"
```

---

## Krok 4 — Cloudinary upload

> 🔐 Credentials čti **jen z env proměnných**, nikdy je nepiš do kódu ani do výstupu:
> `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

```bash
: "${CLOUDINARY_CLOUD_NAME:?}"; : "${CLOUDINARY_API_KEY:?}"; : "${CLOUDINARY_API_SECRET:?}"

upload_story() {           # $1 = lokální PNG, $2 = public_id
  local png="$1" public_id="$2"
  local folder="SOCIALS" eager="w_1080,c_scale,q_100,f_png" ts sig
  ts=$(date +%s)
  # parametry v podpisu MUSÍ být abecedně; file a api_key se do něj nepočítají
  sig=$(printf "eager=%s&folder=%s&overwrite=true&public_id=%s&timestamp=%s%s" \
        "$eager" "$folder" "$public_id" "$ts" "$CLOUDINARY_API_SECRET" | sha1sum | cut -d' ' -f1)

  curl -sS -m 120 -X POST "https://api.cloudinary.com/v1_1/$CLOUDINARY_CLOUD_NAME/image/upload" \
    -F "file=@$png" -F "api_key=$CLOUDINARY_API_KEY" -F "timestamp=$ts" -F "signature=$sig" \
    -F "folder=$folder" -F "public_id=$public_id" -F "overwrite=true" -F "eager=$eager"
}

result=$(upload_story "/tmp/story_[ID].png" "story_[DATUM_SLUG]_[ID]")
cloudinary_url=$(echo "$result" | jq -r '.eager[0].secure_url // .secure_url')
echo "$cloudinary_url"
```

- `public_id = story_[DATUM_SLUG]_[ID]` — **prefix `story_` je povinný**. Feed skilly píšou do stejné
  složky `SOCIALS` pod `social_[DATUM_SLUG]_[ID]` a s `overwrite=true` by si assety přepsaly.
- `public_id` smí obsahovat **jen ASCII**, číslice, pomlčky a podtržítka. Proto `[DATUM_SLUG]`
  (`2026-08`), nikdy `[DATUM]` (`SRPEN 2026 · ČR`).
- Nahrává se **lokální soubor** (`file=@…`), ne URL — proti `agro-socials-cloud`, kde se Cloudinary
  posílá odkaz na Canva export.
- **Retry:** při chybě počkej 5 s a zkus 1× znovu.

---

## Krok 5 — Copywriting

Story nemá klasický popisek jako feed — text je jen krátký doprovod v Bufferu a hlavní sdělení nese
vizuál. Proto:

- **1 věta, max ~90 znaků.** Vytáhni z titulku hlavní fakt nebo číslo.
- **Žádné hashtagy** — ve story nemají dosahový efekt jako na feedu.
- **Žádné „odkaz v biu"** — na Instagramu je přímo v story link sticker (Krok 6).
- Stejný text použij pro Instagram i Facebook.

---

## Krok 6 — Buffer: naplánuj 4 posty

```bash
: "${BUFFER_API_KEY:?}"

call_buffer() {            # $1 = tool name, $2 = arguments JSON
  local body raw
  body=$(jq -n --arg n "$1" --argjson a "$2" \
    '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')
  raw=$(curl -sS -m 90 -X POST "https://mcp.buffer.com/mcp" \
    -H "Authorization: Bearer $BUFFER_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream, application/json" \
    -d "$body")
  # Odpověď je někdy čistý JSON, jindy SSE (řádky "data: ") — sjednoť to na JSON.
  if printf '%s' "$raw" | grep -q '^data: '; then
    printf '%s' "$raw" | grep '^data: ' | tail -1 | sed 's/^data: //'
  else
    printf '%s' "$raw"
  fi
}

# Užitečný payload je vždy v .result.content[0].text
unwrap() {
  jq -r 'if .error then ("BUFFER_ERROR " + (.error|tostring)) else .result.content[0].text end'
}

org_id=$(call_buffer get_account '{}' | unwrap | jq -r '.organizations[0].id')
channels=$(call_buffer list_channels "$(jq -n --arg o "$org_id" '{organizationId:$o}')" | unwrap)
ig_id=$(echo "$channels" | jq -r '.[] | select(.service=="instagram") | .id')
fb_id=$(echo "$channels" | jq -r '.[] | select(.service=="facebook")  | .id')
```

> Kanály **nikdy nehardcoduj** — zjišťuj je vždy za běhu přes `list_channels`.

### Časy — DST-safe

```bash
compute_due_utc() {        # $1 = "08:00" | "19:00"
  local now_epoch due_epoch
  now_epoch=$(date -u +%s)
  due_epoch=$(TZ="Europe/Prague" date -d "today $1" +%s)
  [ "$due_epoch" -le "$now_epoch" ] && due_epoch=$(TZ="Europe/Prague" date -d "tomorrow $1" +%s)
  date -u -d "@$due_epoch" +"%Y-%m-%dT%H:%M:%SZ"
}

due_rano=$(compute_due_utc "08:00")
due_vecer=$(compute_due_utc "19:00")
```

> **Přiřazení článků ke slotům:** seřaď oba časy **chronologicky** a dej **novější článek do
> dřívějšího slotu**. Podle hodiny, kdy Routine běží, může být dřívější slot kterýkoli z nich —
> při ranním startu je to `due_rano`, při odpoledním spuštění naopak `due_vecer` (dnes večer),
> zatímco `due_rano` už spadne na zítřek.

> ⚠️ **Musí to jít přes epoch.** `TZ=Europe/Prague date -d "tomorrow 08:00" -u` vrátí `08:00Z`,
> což je špatně — `-u` přebije zónu i při parsování. Správně je Prague 08:00 = **06:00Z** v létě.
> Nikdy nehardcoduj `+02:00` / `+01:00`, přechod na zimní čas by to rozbil.
>
> ⚠️ Routine musí startovat **před 08:00 Prague** (ideálně 05:00–06:00), jinak `compute_due_utc`
> odsune ranní slot až na zítřek a obě story vyjdou ve špatném pořadí.

### Vytvoření story postu

```bash
schedule_story() {   # $1 channel  $2 text  $3 image  $4 alt  $5 dueAt  $6 instagram|facebook  $7 clanek_url
  local meta args
  if [ "$6" = "instagram" ]; then
    meta=$(jq -n --arg l "$7" '{instagram:{type:"story",shouldShareToFeed:false,link:$l}}')
  else
    meta='{"facebook":{"type":"story"}}'
  fi
  args=$(jq -n --arg ch "$1" --arg t "$2" --arg u "$3" --arg a "$4" --arg d "$5" --argjson m "$meta" '
    { channelId: $ch, text: $t,
      assets: [ { image: { url: $u, metadata: { altText: $a } } } ],
      mode: "customScheduled", schedulingType: "automatic", dueAt: $d,
      metadata: $m }')
  call_buffer create_post "$args" | unwrap
}
```

Celkem **4 volání**: story 1 → `due_rano` (IG + FB), story 2 → `due_vecer` (IG + FB).

**Povinnosti ověřené proti živému Buffer schématu:**

| Věc | Detail |
|---|---|
| `metadata.instagram.type` | enum je `story` \| `reel` \| `post` — pro story `"story"` |
| `metadata.instagram.shouldShareToFeed` | **povinné i u story** (schéma má `required: [type, shouldShareToFeed]`), hodnota `false` |
| `metadata.instagram.link` | URL link stickeru — jen Instagram, Facebook ho nemá |
| `metadata.facebook.type` | enum je `post` \| `reel` \| `story` — pro story `"story"` |
| `assets` | musí zůstat **pole** objektů `{ image: { url, metadata: { altText } } }` |
| `Accept` hlavička | `text/event-stream, application/json`, jinak **406** |

---

## Krok 7 — Zapiš stav

Zapisuj **až po úspěšném `create_post`**. Když post selže, článek se do logu nedostane a příští běh
ho zkusí znovu.

```bash
ts=$(date -u +%Y-%m-%d)
jq -n --arg ts "$ts" '[
  {id: "[ID_CLANKU_1]", slug: "[SLUG_1]", posted_at: $ts, slot: "08:00"},
  {id: "[ID_CLANKU_2]", slug: "[SLUG_2]", posted_at: $ts, slot: "19:00"}
]' > /tmp/new_stories.json

jq -s '.[0] + .[1]' posted-stories-log.json /tmp/new_stories.json > /tmp/merged.json
mv /tmp/merged.json posted-stories-log.json

git add posted-stories-log.json
git commit -m "agro-stories-cloud: naplánovány story $(date -u +%Y-%m-%d)"
git push -u origin claude/profifarmář-stories-posts-qvrj8u
```

---

## Krok 8 — Shrnutí běhu

```
✅ AGRO-STORIES — naplánovány 2 story

🌅 RÁNO 08:00 Europe/Prague ([due_rano] UTC)
   "[TITULEK 1]" ([KATEGORIE 1])
   📸 Instagram story — ID: [post_id] | 🔗 link sticker: [CLANEK_URL 1]
   📘 Facebook story  — ID: [post_id]
   🖼️  [CLOUDINARY_URL 1]

🌆 VEČER 19:00 Europe/Prague ([due_vecer] UTC)
   "[TITULEK 2]" ([KATEGORIE 2])
   📸 Instagram story — ID: [post_id] | 🔗 link sticker: [CLANEK_URL 2]
   📘 Facebook story  — ID: [post_id]
   🖼️  [CLOUDINARY_URL 2]

📝 posted-stories-log.json +2 záznamy, pushnuto
```

---

## Nastavení Routine

- **Cron:** `0 4 * * *` UTC → 06:00 Prague v létě, 05:00 v zimě. Bezpečně před ranním slotem.
- **Environment:** `AI_API_KEY`, `BUFFER_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
  `CLOUDINARY_API_SECRET`.
- **Kapacita Bufferu:** free plán má limit **10 naplánovaných postů**. Tento skill přidá 4,
  `agro-socials-cloud` 6 — dohromady přesně na stropě. Když poběží obojí denně, rozhoď je na různé
  dny nebo hlídej `list_posts` se `status: ["scheduled"]`.

---

## Když Buffer story odmítne

Ověřeno, že Buffer story payload přijímá a Instagram je připojený jako **Business** účet s přímým
publikováním (`defaultToReminders: false`). Kdyby konkrétní volání přesto selhalo, degraduj v tomto
pořadí a **vždy vypiš Cloudinary URL i text**, ať se práce neztratí:

1. **Reminder mode** — když Meta odmítne přímý push, Buffer umí post doručit jako upomínku do mobilu
   (`notificationStatus` na postu). Ťukneš a odešle se ručně.
2. **Meta Graph API napřímo** — IG `POST /{ig-user-id}/media?media_type=STORIES&image_url=…`
   + `/media_publish`; FB Page `POST /{page-id}/photo_stories`. Vyžaduje vlastní Meta app,
   long-lived page token a App Review → **samostatný projekt, ne fallback na jeden běh**.
3. **Manuál** — shrnutí obsahuje hotový 1080×1920 PNG a text. **Log v tomto případě nezapisuj**,
   ať to příští běh zkusí znovu.

---

## Troubleshooting

| Problém | Řešení |
|---|---|
| `AI_API_KEY` / `BUFFER_API_KEY` / Cloudinary proměnná chybí | Doplň ji v sekci Environment u Routine na claude.ai/code |
| Žádný kandidát v `/tmp/candidates.json` | Všechny publikované články už story měly — buď počkej na nové, nebo vyprázdni `posted-stories-log.json` |
| `posted-stories-log.json` neexistuje | Seed je `[]`; `jq … 2>/dev/null \|\| echo "[]"` to ošetří, ale soubor commitni |
| Příští běh vybral stejné články | Nemergnutá PR z minulého běhu — viz Krok 0 |
| `Cannot find package 'playwright'` | Renderer si sáhne do `npm root -g` sám; když ani tam není, doinstaluj `npm i -g playwright` (Chromium doinstalovávat **nemusíš**, je v `/opt/pw-browsers`) |
| Chromium se nespustí | Skript hledá binárku v `$PLAYWRIGHT_BROWSERS_PATH`; případně přebij přes `CHROMIUM_PATH=/cesta/chrome` |
| V titulku jsou místo háčků obdélníky | Někdo vyměnil TTF za `latin`-only subset — vrať nesubsetované soubory z Google Fonts (viz `assets/FONTS-LICENSE.md`) |
| Titulek přeteče nebo je titěrný | Zkrať ho v Kroku 2 na ~70 znaků; auto-fit je jen záchranná brzda (82 px → min 46 px) |
| Text ve story překrytý UI Instagramu | Sahal někdo na `M.logoTop` / `M.footerTop` / `M.textBottom`? Horních i spodních ~250 px musí zůstat prázdných |
| Cover je divně oříznutý | Renderer dělá `object-fit: cover` na střed. U extrémně širokých fotek radši vyber jiný článek |
| Cloudinary `Invalid Signature` | Parametry v podpisu musí být **abecedně** a `eager` v něm musí být; `file` a `api_key` naopak ne |
| Cloudinary `Invalid public_id` | Jen ASCII — použij `[DATUM_SLUG]`, ne `[DATUM]` s diakritikou a `·` |
| Story assety přepisují feed assety | `public_id` musí mít prefix `story_`, ne `social_` |
| Buffer **406 Not Acceptable** | Chybí hlavička `Accept: text/event-stream, application/json` |
| Buffer odpověď nejde naparsovat | Někdy je to čistý JSON, jindy SSE — payload je vždy v `.result.content[0].text` |
| `list_channels` chce `organizationId` | Získej ho z `get_account` → `.organizations[0].id` |
| IG story selže | Přidej `metadata.instagram.shouldShareToFeed` (je povinné i pro story) |
| FB story selže | `metadata.facebook.type` musí být `"story"` |
| Story vyšla ve špatný čas | `compute_due_utc` musí počítat přes epoch, ne přes `date -u -d`; Routine musí startovat před 08:00 Prague |
| Buffer hlásí limit naplánovaných postů | Free plán má strop 10 — zkontroluj `list_posts` se `status: ["scheduled"]` a rozhoď Routines na jiné dny |
