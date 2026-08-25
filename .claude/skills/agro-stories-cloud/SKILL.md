---
name: agro-stories-cloud
description: "Vytvoří a naplánuje zemědělské STORY (9:16, 1080×1920) z publikovaných článků na Profifarmar.cz — na Instagram i Facebook přes Buffer. Jedním neinteraktivním během vezme 3 nejnovější články, pro každý vyrenderuje story vizuál v brandu ProfiFarmář (cover fotka + kategorie + datum + titulek), nahraje na Cloudinary a naplánuje je na ráno, poledne a večer, takže je na profilu živá story celý den. Na rozdíl od agro-socials-local a agro-socials-cloud, které dělají čtvercové 4:5 příspěvky do feedu, tento skill dělá výhradně vertikální story. Určeno pro Claude Code cloud Routine. Použij vždy, když uživatel chce dát článek na story, naplánovat story, udělat 9:16 příspěvek nebo vertikální vizuál. Trigger keywords: agro stories, story z článku, dej to na story, naplánuj story, 9:16 story, vertikální příspěvek, instagram story agro, facebook story agro, tři story denně, stories cloud, story routine."
---

# Agro-Stories Cloud Skill

Neinteraktivní varianta pro **Claude Code cloud Routine**. Jedním během:

1. vybere **3 publikované články**, ze kterých ještě story nebyla,
2. pro každý vyrenderuje **1080×1920 PNG** v brandu ProfiFarmář,
3. nahraje ho na Cloudinary,
4. naplánuje přes Buffer **3 story × 2 sítě = 6 postů** na **07:00**, **12:00** a **18:00**
   Europe/Prague.

Proč tři: na Profifarmar.cz vychází **každý den nad ránem tři nové články**, a přesně z těch tří se
dělají story. Tři sloty rozložené přes den drží profil živý od rána do večera a poslední story
dojíždí až do dalšího poledne (story žije 24 h).

> **Bez kontrolního bodu.** Skill běží autonomně. Nikdy se neptá, jen na konci vypíše shrnutí (Krok 8).
> Interaktivní feed varianta s potvrzením je `agro-socials-local`.

> **Vizuál se nedělá v Canvě.** Free Canva účet má vyčerpanou kvótu na `resize-design` i `export-design`,
> takže 9:16 šablonu v Canvě nelze vyrobit ani exportovat. Story se proto renderují lokálně přes
> Chromium (`scripts/render-story.mjs`) — barvy i písma jsou odměřené přímo z reálného 4:5 příspěvku
> `DAHOBdpJ1tk`, takže story a feed vypadají jako jedna rodina. Renderer navíc nemá žádnou kvótu,
> běží offline a pro stejný vstup vrací stejný výstup, což je pro nehlídanou Routine zásadní.

---

## Vstup — které články

Cílem jsou **3 nejnovější články z poslední redakční dávky**. To je běžný stav a tehdy se nic
nedomýšlí.

> **Dávka vzniká večer PŘEDEM.** Redakce píše články v podvečer dne před během Routine, takže když
> se skill v 6:20 probudí, „nové" články mají včerejší datum, ne dnešní. Nehledej proto dnešek —
> hledej **včerejšek**.
>
> Zároveň se dávka **láme přes půlnoc**: v reálných datech kulminují publikace v 18–23 h a část
> přeteče do 00–03 h následujícího dne. Proto se bere **okno včera + dnes**, ne jeden kalendářní
> den — jinak by ponoční část dávky vypadla. (Původní filtr na „dnešek" míjel pravý opak: celou
> večerní část.)

1. **Primárně** vezmi `published` články s `cover_image_url` publikované **včera nebo dnes**
   (podle `published_at` v Europe/Prague, ne UTC), které ještě nejsou v `posted-stories-log.json`.
   Seřaď od nejnovějšího.
2. **Když jich je míň než 3** (redakce nestihla, výpadek), doplň zbytek **staršími** články podle
   pravidel pro sezónní vhodnost níže. Starší článek na story vadit nemusí — vadí jen takový,
   u kterého je vidět, že je „ze špatného období".
3. **Když ani po doplnění nejsou 3**, naplánuj kolik jich je (sloty ber odshora: 07:00, pak 12:00,
   pak 18:00) a napiš to do shrnutí. Nikdy neopakuj článek, který už v logu je.
4. **S tématem od uživatele** → vyber odpovídající články; dedupe proti logu platí pořád.

Log je **záměrně oddělený** od `posted-log.json` (feed). Story _smí_ propagovat článek, který už
na feedu byl — to je žádoucí. Nesmí se jen zopakovat **story** ze stejného článku.

### Sezónní vhodnost staršího článku

Otázka, kterou si u každého kandidáta polož: **„Kdyby to někdo viděl dnes, poznal by, že je to
staré, a působilo by to divně?"** Když ano, přeskoč ho a vezmi dalšího.

**Nedávej na story:**

- Články vázané na **fázi zemědělského roku**, která už je jinde — setí, sklizeň konkrétní plodiny,
  jarní mrazy, žně, orba, senoseč, vinobraní. („Jarní mrazy poškodily meruňky" v srpnu.)
- **Počasí a jeho následky** — sucho, povodně, kroupy, vlna veder. Tohle stárne nejrychleji.
- **Termíny a lhůty** — dotační výzvy, uzávěrky žádostí, přechodná období, „od pondělí platí".
- Cokoli s **„aktuálně", „tento týden", „právě teď"** v titulku nebo se živým vývojem
  (protesty, jednání, hlasování), kde už dávno padlo rozhodnutí.
- **Ceny a trhy** starší než ~2 měsíce — čísla už neplatí.

**Klidně dej na story (stárne pomalu):**

- Historie a kontext (např. „Sedm století rybníkářství na Třeboňsku").
- Technika a technologie — stroje, roboti, převodovky, senzory.
- Portréty farem a lidí, reportáže z provozu.
- Legislativa s dlouhým horizontem (rozpočty na roky dopředu, víceleté programy).
- Vysvětlovací a přehledové články, agronomické principy.

**Rychlý test podle měsíce:** když je `published_at` staršího článku od dneška vzdálený víc než
**~6 týdnů** a téma spadá do některé zakázané kategorie výše, zahoď ho. Když je téma z té druhé
skupiny, stáří nevadí a klidně sáhni i o půl roku zpět.

Když musíš sáhnout po starším článku, **v shrnutí to napiš** — ať je vidět, že dávka neměla tři.

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

## Krok 0 — Srovnej se na aktuální stav `main`

Skill i `posted-stories-log.json` žijí v `main`. Každý běh musí začít od jejího
posledního stavu, jinak uvidí zastaralý log a vybral by **stejné články znovu**.

```bash
# Routine session startuje s PRÁZDNÝM adresářem — repo tam není, musí se naklonovat.
# Při ručním spuštění v session, která repo už má, se klon přeskočí.
if [ ! -d .git ]; then
  cd ~ && rm -rf Claude-Code-Skills
  git clone https://github.com/kolderbenjamin-sys/Claude-Code-Skills.git
  cd Claude-Code-Skills
fi
git fetch origin main
git checkout -B main origin/main
jq length posted-stories-log.json    # kolik story už proběhlo
```

> Log se zapisuje přímo do `main` (Krok 7) — **nezakládej pull request** ani
> vlastní větev. Běh je čistě přírůstkový zápis do logu, žádná revize není potřeba.

---

## Krok 1 — Vyber 3 články

```bash
set -euo pipefail
: "${AI_API_KEY:?AI_API_KEY chybí — nastav ji v sekci Environment u Routine}"

# Bez ?limit vrací API tiše jen 100 záznamů, a ne spolehlivě těch nejnovějších podle
# published_at (ověřeno 17.8.2026: DB měla 221 článků, výchozích 100 vynechalo jeden
# ze tří dnešních čerstvých článků). ?limit=10000 vrátí vše.
curl -sS -m 60 -H "Authorization: Bearer $AI_API_KEY" \
  "https://profifarmar.cz/api/webhook.php?limit=10000" -o /tmp/articles.json

posted_ids=$(jq '[.[].id]' posted-stories-log.json 2>/dev/null || echo "[]")
dnes=$(TZ="Europe/Prague" date +%Y-%m-%d)
vcera=$(TZ="Europe/Prague" date -d "yesterday" +%Y-%m-%d)

# Všichni nepoužití kandidáti, od nejnovějšího
jq --argjson posted "$posted_ids" '
  (.data // .)
  | map(select(.status == "published" and .cover_image_url != null))
  | map(select(.id as $id | ($posted | index($id)) == null))
  | sort_by(.published_at) | reverse
' /tmp/articles.json > /tmp/candidates.json

# published_at má tvar "2026-08-12 18:19:20+02" — prefix data stačí.
# Bereme VČERA i DNES, protože večerní dávka přetéká přes půlnoc.
jq --arg v "$vcera" --arg d "$dnes" '
  [ .[] | select((.published_at | startswith($v)) or (.published_at | startswith($d))) ]
' /tmp/candidates.json > /tmp/cerstve.json

echo "čerstvé ($vcera + $dnes): $(jq length /tmp/cerstve.json) článků"
jq -r '.[] | "  ČERSTVÝ \(.published_at)  cat=\(.category_id)  \(.title)"' /tmp/cerstve.json
jq -r --arg v "$vcera" --arg d "$dnes" '.[]
       | select(((.published_at|startswith($v)) or (.published_at|startswith($d))) | not)
       | "  starší  \(.published_at)  cat=\(.category_id)  \(.title)"' /tmp/candidates.json | head -15
```

**Výběr:**

- Jsou-li čerstvé **3**, ber je a nic dalšího neřeš.
- Je-li jich **míň**, doplň ze seznamu „starší" tolik, aby byly 3 — ale jen ty, které projdou
  **sezónní vhodností** (viz sekce Vstup). Ber od nejnovějšího a nevhodné přeskakuj.
- Nejsou-li ani tak 3, naplánuj kolik jich je a uveď to ve shrnutí.

Když máš na výběr, dej přednost **různým kategoriím**, ať tři story za den nevypadají stejně.

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

**Vizuální parita s feedem.** Všechny hodnoty v konstantách `C` a `M` ve skriptu jsou odměřené
pixel po pixelu z reálného 4:5 feed příspěvku, ne odhadnuté. Konkrétně: krémová `#F4EFE5`,
pilulka `#B8473B`, titulek `#130F0A`, zlatá `#8A6A2E`, **plnošířková zlatá dělící linka `#C49A2E`
vysoká 7 px** pod coverem, **vlasová linka `#D5D1C7`** nad patičkou, titulek Playfair Display 80 px
s **prokladem 1.09** (záměrně těsný), datum Montserrat 25 px / `.12em`, patička vlevo
**Roboto Mono** 24 px, vpravo Montserrat 26 px. Levý okraj 60 px, šířka textu 954 px — stejně
jako na feedu. Když budeš cokoli z toho měnit, změň to i na feedu, jinak se formáty rozejdou.

**Bezpečné zóny Instagramu** jsou už zadrátované v rozvržení. Spodních **~200 px** (lišta odpovědí
a link sticker) zůstává prázdných — řídí to `M.footerBottom`, od kterého se rozvržení kotví
směrem nahoru. Nahoře **není žádné logo ani nápis „Profi Farmář"**: Instagram tam sám kreslí
avatar a jméno účtu, takže by si to jen konkurovalo. Cover proto začíná rovnou fotkou.

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

## Krok 6 — Buffer: naplánuj 6 postů

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
compute_due_utc() {        # $1 = "07:00" | "12:00" | "18:00"
  local now_epoch due_epoch
  now_epoch=$(date -u +%s)
  due_epoch=$(TZ="Europe/Prague" date -d "today $1" +%s)
  [ "$due_epoch" -le "$now_epoch" ] && due_epoch=$(TZ="Europe/Prague" date -d "tomorrow $1" +%s)
  date -u -d "@$due_epoch" +"%Y-%m-%dT%H:%M:%SZ"
}

# seřaď chronologicky — při ranním startu Routine vyjdou všechny tři dnes
mapfile -t sloty < <(for t in "07:00" "12:00" "18:00"; do
                       echo "$(compute_due_utc "$t")|$t"
                     done | sort)
printf 'slot: %s\n' "${sloty[@]}"
```

> **Přiřazení článků ke slotům:** seřaď časy **chronologicky** (to dělá `sort` výše, ISO tvar
> s `Z` se řadí správně jako text) a dej **novější článek do dřívějšího slotu**. Při ranním
> startu Routine vyjdou 07:00, 12:00 i 18:00 ještě dnes. Když skill pustíš ručně odpoledne,
> už proběhlé sloty se posunou na zítřek a `sort` je správně přeskládá dozadu.

> ⚠️ **Musí to jít přes epoch.** `TZ=Europe/Prague date -d "tomorrow 07:00" -u` vrátí `07:00Z`,
> což je špatně — `-u` přebije zónu i při parsování. Správně je Prague 07:00 = **05:00Z** v létě.
> Nikdy nehardcoduj `+02:00` / `+01:00`, přechod na zimní čas by to rozbil.
>
> ⚠️ Routine musí startovat **před 07:00 Prague**, jinak `compute_due_utc` odsune první slot
> na zítřek a story se rozjedou přes dva dny. Zároveň musí startovat **až po tom, co vyjdou
> ranní články** — proto 05:00–06:00 Prague.

### Vytvoření story postu — s automatickým únikem přes `shareNow`

Fronta naplánovaných postů má na free plánu strop 10. Když do něj narazíš, **story se nezahazuje** —
pošle se rovnou ven přes `shareNow`. U story to nevadí: žijí 24 h, je běžné mít jich na profilu
několik za sebou, a lepší je vydaná story v nevhodnou hodinu než žádná.

```bash
create_story() {   # $1 channel  $2 text  $3 image  $4 alt  $5 dueAt  $6 instagram|facebook  $7 clanek_url
  local meta base out
  if [ "$6" = "instagram" ]; then
    meta=$(jq -n --arg l "$7" '{instagram:{type:"story",shouldShareToFeed:false,link:$l}}')
  else
    meta='{"facebook":{"type":"story"}}'
  fi
  base=$(jq -n --arg ch "$1" --arg t "$2" --arg u "$3" --arg a "$4" --argjson m "$meta" '
    { channelId: $ch, text: $t,
      assets: [ { image: { url: $u, metadata: { altText: $a } } } ],
      schedulingType: "automatic", metadata: $m }')

  # 1. pokus — na svůj slot
  out=$(call_buffer create_post \
        "$(jq -n --argjson b "$base" --arg d "$5" '$b + {mode:"customScheduled", dueAt:$d}')" | unwrap)

  # 2. pokus — jen když to vypadá na limit fronty, jinak chybu vrať tak jak je
  if printf '%s' "$out" | grep -qiE 'limit|quota|maximum|too many|upgrade|plan'; then
    echo "  ⚠ slot $5 zamítnut (plná fronta) — posílám rovnou přes shareNow" >&2
    out=$(call_buffer create_post \
          "$(jq -n --argjson b "$base" '$b + {mode:"shareNow"}')" | unwrap)
    printf '%s' "$out" | jq -c '. + {_fallback:"shareNow"}' 2>/dev/null || printf '%s' "$out"
    return
  fi
  printf '%s' "$out"
}
```

Celkem **6 volání**: každá ze tří story jde na svůj slot na IG i na FB.

> **Kdy fallback nespustit.** Na `shareNow` přepínej **jen při chybě, která vypadá na limit**.
> Kdyby ses přepnul při každé chybě, rozbitá URL obrázku nebo špatné `metadata` by skončily
> okamžitě publikovanou vadnou story. Cokoli jiného než limit nahlaš a ten jeden post vynech.
>
> **Co to udělá s časem.** `shareNow` odešle story hned, ne v 12:00 nebo v 18:00. Rozložení přes
> den se tím u toho jednoho postu ztrácí. **Vždy to napiš do shrnutí** (Krok 8) a v logu ulož
> `slot` jako `shareNow (fallback)`, ať je zpětně poznat, proč story vyšla mimo plán.

**Kontrola kapacity předem** (levnější než narazit uprostřed):

```bash
volno=$(call_buffer list_posts "$(jq -n --arg o "$org_id" \
          '{organizationId:$o, status:["scheduled"], limit:50}')" | unwrap \
        | jq '[.edges[].node.channelService] | group_by(.) | map({(.[0]): length}) | add')
echo "ve frontě: $volno"
```

Když už tam je blízko 10, počítej s tím, že část story půjde přes `shareNow`, a nediv se tomu.

**Povinnosti ověřené proti živému Buffer schématu:**

| Věc | Detail |
|---|---|
| `metadata.instagram.type` | enum je `story` \| `reel` \| `post` — pro story `"story"` |
| `metadata.instagram.shouldShareToFeed` | **povinné i u story** (schéma má `required: [type, shouldShareToFeed]`), hodnota `false` |
| `metadata.instagram.link` | URL link stickeru — jen Instagram, Facebook ho nemá |
| `metadata.facebook.type` | enum je `post` \| `reel` \| `story` — pro story `"story"` |
| `assets` | musí zůstat **pole** objektů `{ image: { url, metadata: { altText } } }` |
| `schedulingType` | **povinné vždy**, i při `mode: "shareNow"` — je v `required` u nástroje. Bez něj přijde `Invalid option: expected one of "notification"\|"automatic"` |
| `Accept` hlavička | `text/event-stream, application/json`, jinak **406** |

> **Okamžitá publikace.** Když chceš story ven hned (ruční běh, ne Routine), nahraď
> `mode: "customScheduled"` + `dueAt` za `mode: "shareNow"` — `schedulingType: "automatic"`
> tam ale **nech**. Odpověď se vrátí se `status: "sent"` (Instagram) nebo `"sending"` (Facebook,
> dojede za pár sekund) a v poli `externalLink` je přímý odkaz na hotovou story.
>
> **`shareNow` limit fronty obchází.** Ověřeno 13. 8. 2026 na plné frontě 10/10 (5 na kanál):
> oba `shareNow` posty prošly a odešly, a fronta zůstala na 10 — okamžitá publikace se do
> `scheduledPosts` vůbec nepočítá. Když ti tedy `customScheduled` spadne na limit, `shareNow`
> je funkční únik: post jde ven hned, jen nad ním ztrácíš kontrolu nad časem.

---

## Krok 7 — Zapiš stav

Zapisuj **až po úspěšném `create_post`**. Když post selže, článek se do logu nedostane a příští běh
ho zkusí znovu.

```bash
ts=$(date -u +%Y-%m-%d)
jq -n --arg ts "$ts" '[
  {id: "[ID_CLANKU_1]", slug: "[SLUG_1]", posted_at: $ts, slot: "07:00"},
  {id: "[ID_CLANKU_2]", slug: "[SLUG_2]", posted_at: $ts, slot: "12:00"},
  {id: "[ID_CLANKU_3]", slug: "[SLUG_3]", posted_at: $ts, slot: "18:00"}
]' > /tmp/new_stories.json
# u story, která šla přes únikový shareNow, ulož slot jako "shareNow (fallback)"

jq -s '.[0] + .[1]' posted-stories-log.json /tmp/new_stories.json > /tmp/merged.json
mv /tmp/merged.json posted-stories-log.json

git add posted-stories-log.json
git commit -m "agro-stories-cloud: naplánovány story $(date -u +%Y-%m-%d)"

# Rebase kvůli souběhu: main se mohl mezitím pohnout jinou session.
git pull --rebase origin main

# Push MUSÍ projít. Když ne, je to CHYBA BĚHU, ne varování — bez uloženého logu
# vybere zítřejší běh stejné články a story se zopakují.
if git push origin main; then
  echo "log uložen do main"
else
  echo "CHYBA: push do main odmítnut — zkouším záložní stavovou větev"
  git push -u origin HEAD:claude/stories-state && \
    echo "CHYBA BĚHU: log uložen jen do claude/stories-state, NE do main." && \
    echo "Uveď to ve shrnutí jako chybu a napiš přesný důvod odmítnutí z výstupu gitu —" && \
    echo "podle něj se pozná, která ze tří podmínek níže neplatí."
fi
```

> **Proč ta pojistka a co odmítnutí znamená.** Routine session smí do větve **bez prefixu
> `claude/`** pushovat, ale Claude Code push předem prověří a odmítne ho, když platí
> kterákoli z těchto tří podmínek ([dokumentace k Routines](https://code.claude.com/docs/en/routines),
> sekce „Repositories and branch permissions"):
>
> 1. větev je na GitHubu **chráněná** (branch protection),
> 2. **někdo jiný** má z té větve otevřenou pull request,
> 3. větev nese **commity od někoho jiného než tebe**.
>
> Stav k 14. 8. 2026: ověřeno, že žádná z podmínek na `main` neplatí — push do `main`
> reálně prošel. Kdyby se to změnilo, důvod bude ve výstupu gitu a řeší se na GitHubu,
> ne v nastavení Claude Code.
>
> ⚠️ **Žádný přepínač „Allow unrestricted branch pushes" neexistuje.** Tenhle název koluje
> ve starších poznámkách u `agro-socials-cloud`, ale v dokumentaci ani v UI nic takového
> není — nehledej ho a neposílej pro něj uživatele. Platí výhradně ty tři podmínky výše.
>
> Bez téhle pojistky by push do `main` selhal potichu, běh by se tvářil jako úspěšný a druhý
> den by vyjely stejné story. Záložní větev stav aspoň nezahodí — ale je to stav
> k opravě, ne provozní režim.

---

## Krok 8 — Shrnutí běhu

```
✅ AGRO-STORIES — naplánovány 3 story
   Zdroj: 3 čerstvé články z dávky [DATUM]   (nebo: 2 čerstvé + 1 starší — viz níže)

🌅 07:00 Europe/Prague ([due] UTC)
   "[TITULEK 1]" ([KATEGORIE 1])
   📸 Instagram story — ID: [post_id] | 🔗 link sticker: [CLANEK_URL 1]
   📘 Facebook story  — ID: [post_id]
   🖼️  [CLOUDINARY_URL 1]

☀️ 12:00 Europe/Prague ([due] UTC)
   "[TITULEK 2]" ([KATEGORIE 2])
   📸 Instagram story — ID: [post_id] | 🔗 link sticker: [CLANEK_URL 2]
   📘 Facebook story  — ID: [post_id]
   🖼️  [CLOUDINARY_URL 2]

🌆 18:00 Europe/Prague — ⚠️ ODESLÁNO IHNED, fronta byla plná
   "[TITULEK 3]" ([KATEGORIE 3])  ⚠️ starší článek z [DATUM] — v dávce byly jen 2
   📸 Instagram story — ID: [post_id] | 🔗 link sticker: [CLANEK_URL 3]
   📘 Facebook story  — ID: [post_id]
   🖼️  [CLOUDINARY_URL 3]

📝 posted-stories-log.json +3 záznamy, pushnuto
```

Dvě věci se ve shrnutí **musí** objevit, jinak zůstanou skryté:

- **starší článek** → označ u dané story a napiš, kolik čerstvých článků dávka měla (viz třetí výše);
- **únik přes `shareNow`** → napiš u slotu, že story šla ven ihned místo v plánovanou hodinu,
  protože fronta byla plná (viz třetí výše).

Když se nepodařilo naplnit všechny tři sloty, uveď to hned na prvním řádku.

---

## Nastavení Routine

- **Cron:** `0 4 * * *` UTC → 06:00 Prague v létě, 05:00 v zimě. Po ranních článcích a bezpečně
  před slotem 07:00.
- **Environment:** `AI_API_KEY`, `BUFFER_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
  `CLOUDINARY_API_SECRET`.
- **Kapacita Bufferu:** free plán hlásí v `get_account` limit `scheduledPosts: 10`. Tento skill
  přidá 6 postů (3 story × 2 sítě), feedová `agro-socials-cloud` další 4 (2 články × 2 sítě) —
  dohromady přesně 10, tedy 5 na kanál. Fronta se do toho vejde, ale rezerva je nulová.
  Jestli se limit počítá **na organizaci nebo na kanál, zatím nevíme** — dosud na něj nikdy
  nedošlo, takže žádné zamítnutí není čím změřit.

  **Limit už ale běh nezablokuje.** Když `customScheduled` narazí na strop, `create_story`
  pošle danou story rovnou ven přes `shareNow` (viz Krok 6) — u story to nevadí, žijí 24 h
  a víc jich za sebou je běžné. Jediná cena je ztráta plánované hodiny, což se hlásí ve shrnutí.

  Kdyby to začalo přetékat pravidelně, nejčistší je posunout Routines dál od sebe, ať se fronty
  nepřekrývají, nebo snížit počet feedových článků.

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
| Text ve story překrytý UI Instagramu | Sahal někdo na `M.footerBottom`? Spodních ~200 px musí zůstat prázdných, tam padá lišta odpovědí a link sticker |
| Cover je divně oříznutý | Renderer dělá `object-fit: cover` na střed. U extrémně širokých fotek radši vyber jiný článek |
| Cloudinary `Invalid Signature` | Parametry v podpisu musí být **abecedně** a `eager` v něm musí být; `file` a `api_key` naopak ne |
| Cloudinary `Invalid public_id` | Jen ASCII — použij `[DATUM_SLUG]`, ne `[DATUM]` s diakritikou a `·` |
| Story assety přepisují feed assety | `public_id` musí mít prefix `story_`, ne `social_` |
| Buffer **406 Not Acceptable** | Chybí hlavička `Accept: text/event-stream, application/json` |
| Buffer odpověď nejde naparsovat | Někdy je to čistý JSON, jindy SSE — payload je vždy v `.result.content[0].text` |
| `list_channels` chce `organizationId` | Získej ho z `get_account` → `.organizations[0].id` |
| `Invalid option: expected one of "notification"\|"automatic"` | Chybí `schedulingType` — je povinné i u `mode: "shareNow"` |
| `create_post` „projde", ale žádný post nevznikl | Chybu vracíš jako text v `.result.content[0].text`, ne jako `.error` — vždy zkontroluj, jestli odpověď nezačíná `MCP error`, a ne jen `.error` |
| IG story selže | Přidej `metadata.instagram.shouldShareToFeed` (je povinné i pro story) |
| FB story selže | `metadata.facebook.type` musí být `"story"` |
| Story vyšla ve špatný čas | `compute_due_utc` musí počítat přes epoch, ne přes `date -u -d`; Routine musí startovat mezi 05:00 a 07:00 Prague |
| Story se rozjely přes dva dny | Routine startovala po 07:00 — první slot se posunul na zítřek. Posuň cron dřív |
| Na story je článek „ze špatného období" | Sezónní filtr v sekci Vstup se nepoužil. Počasí, sklizeň a termíny se po ~6 týdnech nesmí brát |
| Buffer hlásí limit naplánovaných postů | Free plán má strop 10 na naplánované posty — zkontroluj `list_posts` se `status: ["scheduled"]`. Limit platí jen na frontu: `mode: "shareNow"` projde i při 10/10 (ověřeno), takže poslední story se dá poslat rovnou ven |
