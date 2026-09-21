---
name: profifarmar-kampan
description: "Denní release social kampaní @profi.farmar (K1 'Co umí profifarmar.cz' + K2 'Týdenní monitor') přes Buffer shareNow na Instagram, Facebook a YouTube shorts. Řídí se manifest.json: hotové kusy (post/carousel + story + reel na Cloudinary) jen vydá, K2 kusy (nejčtenější týdne v neděli, půdní monitor ve středu) nejdřív vyrenderuje z reálných dat (API profifarmar.cz, Intersucho) přes Chromium a ffmpeg, nahraje na Cloudinary a pak vydá. Neinteraktivní, pro cloud Routine v 11:55 a 16:55 Europe/Prague; nic neplánuje do fronty Bufferu (free limit 10), vše jde shareNow v čase běhu. Log v posted-kampan-log.json chrání před dvojím vydáním. Trigger keywords: kampaň release, profifarmar kampan, vydej dnešní kus kampaně, týdenní monitor, nejčtenější týdne, půdní monitor, co umí profifarmar, kampan routine."
---

# ProfiFarmář kampaně - release

Vydává kusy dvou kampaní podle `manifest.json` v této složce. Běží **dvakrát denně** jako cloud Routine
(11:55 pro slot 12:00 = K2 Týdenní monitor, 16:55 pro slot 17:00 = K1 Co umí profifarmar.cz).
Když na dnešek nic nepřipadá, skončí bez výstupu.

Pravidla, která platí vždy (dohodnuto s Benem 11. až 13. 9. 2026):
- **shareNow, nikdy plánovat.** Buffer free má strop 10 naplánovaných postů na kanál a tu frontu drží
  článkové routiny (3 posty + 3 story + 3 reely denně). Kampaň jde ven okamžitě v čase běhu.
- **Story bez textu** (IG i FB text překreslí přes vizuál). IG story má link sticker na `link` kusu.
- **Reel nejde do mřížky** (`shouldShareToFeed: false`), YouTube dostane stejný reel jako short s IG popiskem.
- **IG popisek bez URL** (adresa textem + "odkaz v biu"), **FB popisek s čistým URL** bez UTM.
- Nic se nepřerenderovává u hotových K1 kusů - jsou schválené 1:1, jen se vydají.

## Předpoklady (cloud Routine)

- Env: `BUFFER_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (K2 render).
  `AI_API_KEY` není potřeba (nejčtenější jde z veřejného endpointu).
- Nástroje: node 22+ (fetch, FormData), pro K2 navíc Chromium (Playwright, globálně v kontejneru) a ffmpeg
  (obstará `scripts/ensure-ffmpeg.sh`: npm `ffmpeg-static`, záložně johnvansickle static / apt,
  při výpadku sítě opakuje až 30 min - má doběhnout, ne selhat). Fonty se tahají z Google Fonts, kontejner potřebuje síť.
- Repo: `posted-kampan-log.json` v kořeni (na začátku `[]`). Commit logu + manifestu po každém běhu.
  Push jde jen na `claude/`-prefixed větev, pokud není povoleno "Allow unrestricted branch pushes";
  proto Krok 0 slučuje PR z minulého běhu.

## Krok 0 - sluč PR z minulého běhu

Stejně jako `agro-socials-cloud`: otevřený PR `claude/*` → `main` s `mergeable_state: clean` sluč, jinak by
tento běh četl starý log a manifest a mohl vydat kus dvakrát.

## Krok 1 - co je dnes na řadě

```bash
set -euo pipefail
SK=".claude/skills/profifarmar-kampan"
node "$SK/scripts/today.js" "$SK/manifest.json"
```

Výstup `NIC <datum>` → konec, žádná notifikace. Jinak řádky `ID  čas  ready|generate=top5|generate=puda  název`.
Vydávej jen kusy, jejichž `čas` odpovídá slotu tohoto běhu (11:55 → 12:00, 16:55 → 17:00); druhý slot
nech druhému běhu. Kus se `status: manual|waiting|done` today.js sám vynechá.

## Krok 2 - K2 kus: vyrenderuj (jen `generate=...`)

### 2a - nejčtenější týdne (`generate=top5`, neděle)

```bash
mkdir -p /tmp/k2
node "$SK/scripts/top5.js" /tmp/k2/top5.json "$(TZ=Europe/Prague date +%F)"
```

Otevři `/tmp/k2/top5.json` a **přepiš `short`** u každé položky: max 60 znaků, celá myšlenka, žádné "…" na konci
(top5.js je jen ořízne). `full` nech, jde na vlastní slide. Pomlčky "—" v titulcích nahraď ":" nebo čárkou.

```bash
node "$SK/scripts/build.js" carousel "$SK/templates/top5-carousel.html" /tmp/k2/top5.json /tmp/k2/top5-carousel
node "$SK/scripts/build.js" story    "$SK/templates/top5-story.html"    /tmp/k2/top5.json /tmp/k2/top5-story.png
```

Vznikne 6 slidů (`top5-carousel-1..6.png`) + story. Zkontroluj, že existuje všech 7 souborů.

**Popisek** (IG do `/tmp/k2/ig.txt`, FB do `/tmp/k2/fb.txt`), vzor:

```
IG:  <5 krátkých titulků oddělených čárkou>. Pět článků, které jste tento týden četli nejvíc.

     Nejčtenější týdne: každou neděli žebříček z profifarmar.cz. Kdo něco minul, má druhou šanci. Celé články na webu.

     👉 profifarmar.cz (odkaz v biu)

     #zemedelstvi #agro #profifarmar #zpravy #agronom #tydennimonitor

FB:  <stejný hook>

     👉 https://profifarmar.cz/

     <stejné tělo>

     #zemedelstvi #agro #profifarmar #zpravy #agronom
```

### 2b - půdní monitor (`generate=puda`, středa)

Zdroj je **Intersucho** (CzechGlobe + Mendelu), ne odhad z /pocasi. Postup ověřený 21. 9. 2026
(web je na `/cs/`, `/cz/` vrací 301, proto vždy `-L`). Čtyři podklady:

```bash
mkdir -p /tmp/k2 && cd /tmp/k2
UA="Mozilla/5.0"
curl -sS -m 60 -L -A "$UA" https://www.intersucho.cz/cs/ -o intersucho.html
# 1) perex posledního týdenního hodnocení (vychází v úterý, ve středu je tedy čerstvé)
grep -o 'tydenni-aktuality-c-[0-9]*-2026' intersucho.html | sort -t- -k4 -n | tail -1      # např. tydenni-aktuality-c-38-2026
# 2) PDF týdenního hodnocení (odkaz je na stránce aktuality)
W=$(grep -o 'tydenni-aktuality-c-[0-9]*-2026' intersucho.html | sort -t- -k4 -n | tail -1)
curl -sS -m 60 -L -A "$UA" "https://www.intersucho.cz/cs/$W/" -o tyden.html
PDF=$(grep -o '/runtime/cache/files/original/[^"]*\.pdf' tyden.html | head -1)
curl -sS -m 120 -L -A "$UA" "https://www.intersucho.cz$PDF" -o tyden.pdf
(command -v pdftotext >/dev/null && pdftotext -enc UTF-8 -layout tyden.pdf tyden.txt) || python3 -c "import pypdf,sys;print('\n'.join(p.extract_text() or '' for p in pypdf.PdfReader('tyden.pdf').pages))" > tyden.txt || echo "PDF text nejde, použij jen perex"
# 3) graf podílu území podle stupně sucha (0 až 100 cm, denně, s předpovědí)
curl -sS -m 60 -L -A "$UA" https://www.intersucho.cz/runtime/cache/maps/cz/awp/graf_AWP.png -o graf.png
# 4) mapa intenzity sucha k včerejšku (nejhůř postižené oblasti)
D=$(date -u -d "yesterday" +%Y_%m_%d)
curl -sS -m 60 -L -A "$UA" "https://www.intersucho.cz/runtime/cache/maps/cz/awp/$D/awp_${D}_CZ_country.png" -o mapa.png
```

Perex hodnocení je i v HTML (`tyden.html`, odstavec za nadpisem "Týdenní aktuality č. N/2026"). `tyden.txt`
obsahuje kapitoly s čísly (srážky za 10 dní, % území, výhled na 9 dní). **`graf.png` a `mapa.png` si otevři
přes Read** (jsou to obrázky): z grafu odečti k dnešnímu dni podíl území se suchem S1 a horším a S3 a horším
(svislá osa = % území, barvy podle legendy), z mapy pojmenuj nejhůř postižené oblasti (kraje/regiony slovy).
Odečtené hodnoty piš s "≈", čísla z PDF přesně.

Vyplň `/tmp/k2/puda.json`. **Texty v řádcích musí být krátké**, jinak se v postu lámou po slovech:
`n` max 24 znaků, `v` max 18, `d` max 20. Vzor (reálná data 20. 9. 2026):

```json
{"chip":"týdenní monitor · půda","eyebrow":"39. týden · středa 23. 9. 2026",
 "title":"Půda před setím ozimů: povrch se doplnil, hlouběji sucho trvá",
 "photo_post":"puda-post.jpg","photo_story":"puda-story.jpg","acc":"green",
 "rows":[
  {"n":"Půdní sucho · území ČR","v":"≈ 40","u":"%","d":"▼ z 90 % v srpnu","dir":"up"},
  {"n":"Výrazné a horší sucho","v":"≈ 5","u":"%","d":"▼ po deštích","dir":"up"},
  {"n":"Vrstva 0 až 40 cm","v":"doplněná","u":"","d":"✓ Morava, jih Čech","dir":"up"},
  {"n":"Vrstva do 100 cm","v":"sucho trvá","u":"","d":"▼ málo vody","dir":"down"},
  {"n":"Nejhůř","v":"jih Čech, Vysočina","u":"","d":"▼","dir":"down"}],
 "foot_l":"↗ profifarmar.cz/pocasi","foot_r":"zdroj: intersucho.cz"}
```

`dir` = `up` dobrá zpráva (zelené), `down` špatná (červené). Eyebrow = ISO týden a datum vydání. Čísla, která
v podkladech nejsou, **nevymýšlej** - řádek nahraď jiným údajem, který tam je (srážky za 10 dní v mm, výhled
na 9 dní, nasycení půdy). Titulek vždy říká, co to znamená pro polní práce v daném týdnu (setí ozimů, sklizeň
cukrovky a brambor, podzimní orba).

```bash
export FFMPEG="$(bash "$SK/scripts/ensure-ffmpeg.sh")"   # npm ffmpeg-static → johnvansickle → apt, opakuje až 30 min
node "$SK/scripts/build.js" post  "$SK/templates/monitor-post.html"  /tmp/k2/puda.json /tmp/k2/puda-post.png
node "$SK/scripts/build.js" story "$SK/templates/monitor-story.html" /tmp/k2/puda.json /tmp/k2/puda-story.png
node "$SK/scripts/build.js" reel  "$SK/templates/monitor-reel.html"  /tmp/k2/puda.json /tmp/k2/puda-reel.mp4 8 30
```

Popisek: hook = hlavní sdělení + 1 číslo (např. "Půda před setím ozimů: deště doplnily vrstvu do 40 cm, hlouběji
sucho drží. Půdní sucho zasahuje už jen asi 40 % území, v srpnu to bylo 90 %."), tělo = "Půdní monitor: každou
středu souhrn z Intersucha (Mendelu a CzechGlobe) za celou ČR. Nejhůř je na tom <oblast>. Detail počasí pro váš
kraj na profifarmar.cz/pocasi." Hashtagy
`#zemedelstvi #agro #profifarmar #pocasi #seti #tydennimonitor` (FB bez posledního). IG s "👉 profifarmar.cz/pocasi (odkaz v biu)",
FB s "👉 https://profifarmar.cz/pocasi/".

### 2c - nahraj a zapiš do manifestu

```bash
ID=K2-top5-39   # z Kroku 1
urls=""
for f in /tmp/k2/top5-carousel-*.png; do u=$(node "$SK/scripts/upload.js" "$f" "${ID}_$(basename "$f" .png)"); urls="${urls:+$urls,}$u"; done
story=$(node "$SK/scripts/upload.js" /tmp/k2/top5-story.png "${ID}_story")
node "$SK/scripts/set-item.js" "$SK/manifest.json" "$ID" --images "$urls" --story "$story" --ig /tmp/k2/ig.txt --fb /tmp/k2/fb.txt
```

U půdy: `--images "$(node "$SK/scripts/upload.js" /tmp/k2/puda-post.png "${ID}_post")" --story ... --reel "$(... puda-reel.mp4 "${ID}_reel")"`.
`upload.js` vypíše jen URL; když selže i po retry, skončí nenulově → notifikace (Krok 5).

## Krok 3 - vydej

```bash
node "$SK/scripts/publish.js" "$SK/manifest.json" posted-kampan-log.json "$ID"
```

Skript sám vybere formáty podle obsahu kusu: `ig-post` (carousel = víc obrázků), `ig-story`, `ig-reel`,
`fb-post`, `fb-story`, `fb-reel`, `yt-reel`. Nejdřív všechny posty vytvoří, pak **čeká na skutečný stav**
(`get_post` každých 15 s, max 8 min, `--wait` mění): `sent` = OK, `error` = post smaže a s 90s prodlevou
pošle znovu, až 2x (celkem 3 pokusy) - po 3. chybě = chyba. Po timeoutu `pending` (Buffer ještě zpracovává,
typicky YT) se bere jako OK s poznámkou. Každý slot hned zapíše do logu s `postId` a `status`; při opakovaném
spuštění sloty s `ok: true` přeskočí, takže po chybě stačí pustit znovu. Exit 2 = část selhala (výpis i log
říká která a proč).

Obrázky posílá vždy jako **JPEG** (Cloudinary `f_jpg,q_auto:good,fl_progressive:none` v URL, bez nového
uploadu). Důvod: 14. 9. 2026 Instagram odmítl PNG story ("There is an issue with the media included"), FB
stejný soubor vzal; publish.js to tehdy zalogoval jako OK, protože kontroloval jen přijetí Bufferem. Od té
doby se ověřuje `sent`. `fl_progressive:none` přibyl 16. 9. 2026 - `q_auto` u větších obrázků dělá
progresivní JPEG, který IG odmítá stejnou hláškou i když je to už JPEG.

**Reely a videa (16. 9. 2026):** selhání "issue with the media"/"check specifications" u `-reel`/`yt-reel`
**není vada souboru** - ověřeno ručním re-uploadem přes Buffer UI (stejné video, které API cestou padalo,
tudy prošlo bez chyby) i tím, že stejné video ve stejné dávce prošlo na jednom kanálu (YouTube) a na druhém
ne (Instagram). Příčina: `create_post` s `video: {url}}` nechá Instagram natáhnout video přímo z Cloudinary
URL, a ten fetch je nekonzistentní (pravděpodobně Cloudflare/Cloudinary na straně Mety) - kdežto ruční upload
v Bufferu si video nejdřív nahraje na vlastní S3 a to je spolehlivé. Buffer API/GraphQL neumožňuje soubor
nahrát napřímo (jen `url`), takže z publish.js se ta spolehlivější cesta nedá zopakovat - jediná dostupná
zmírnění jsou víc pokusů s prodlevou (viz výše) a případně eskalace na Buffer support.

Ověřeno proti živému Bufferu: carousel 5 obrázků, story s prázdným textem (IG i FB), YouTube short
(`metadata.youtube {title, categoryId:"22"}`), reel s `shouldShareToFeed:false`, run 14. 9. 7/7 `sent`.

## Krok 4 - commit

```bash
git add posted-kampan-log.json "$SK/manifest.json"
git commit -m "profifarmar-kampan: $ID vydán $(TZ=Europe/Prague date +%F)"
git push
```

## Krok 5 - notifikace jen při chybě

Tichý běh = úspěch, žádná notifikace. `PushNotification` (`status: "proactive"`, text v `<routine_summary>`)
jen když: chybí env proměnná, today.js/top5.js/build.js/upload.js spadne, publish.js skončí 1 nebo 2
(uveď, které sloty prošly a které ne), nebo se nepodaří commit (hrozí dvojí vydání). První věta = co se
stalo a co má Ben udělat ručně (typicky: pustit routine znovu, nebo vydat zbylý formát ručně ze souborů
na Cloudinary, URL jsou v manifestu).

## Run summary (do transcriptu)

```
✅ K1-03 Počasí pro farmáře: přehled · 2026-09-18 17:00
IG carousel 4 + story · FB carousel + story · YT: -
log: 4/4 · commit ok
```

## Údržba manifestu

- `status: manual` = Ben vydal ručně (K1-01 14. 9., K2-puda-38 16. 9.), `waiting` = čeká na obsah
  (K1-15 O nás, odpovědi Bena a Ondry), `done` lze nastavit ručně pro vynechání.
- Nový hotový kus: nahrát soubory (`upload.js`) a doplnit `images/story/reel/ig/fb` přes `set-item.js`.
- Assety leží v Cloudinary složce **`KAMPAN/`**, ne v `SOCIALS/`: pondělní úklidová routine maže v `SOCIALS/`
  vše starší 48 h bez odeslaného postu, což by kampaňové kusy nahrané dopředu smazalo.
- K1-06 Cenový pásek a K2 Ceny komodit nejsou v manifestu: čekají na Kč/t na webu.
- Zdrojové šablony, data a rendery všech K1 kusů jsou lokálně u Bena v
  `Claude-Workspace/Agro/ProfiFarmar-info/social-kampane/` (`make_manifest.py` manifest přegeneruje).

## Troubleshooting

| Problém | Řešení |
|---|---|
| `playwright not found` | globální playwright v kontejneru: `npm root -g`; jinak `CHROMIUM_PATH=/cesta/chrome` |
| Chromium spadne na sandbox | render.js už používá `--no-sandbox` |
| Reel bez ffmpeg | `export FFMPEG="$(bash "$SK/scripts/ensure-ffmpeg.sh")"` (čeká až 30 min, než to vzdá) |
| Buffer 406 | header `Accept: text/event-stream, application/json` (publish.js ho posílá) |
| Buffer odmítne story kvůli textu | publish.js zkusí znovu s názvem kusu jako textem |
| Post skončí `error` "issue with the media" | IG nebere PNG story; publish.js posílá JPEG přes `f_jpg` a při erroru jednou znovu. Když padne i podruhé, zkontroluj URL v prohlížeči |
| Slot skončí `pending` | Buffer ještě zpracovává (YT až 10 min): `get_post {postId}` z logu; když je `sent`, nic nedělej |
| Reel se objevil v mřížce IG | `shouldShareToFeed` musí být `false` (publish.js) |
| Kus vydán dvakrát | log se nekomitnul, viz Krok 0 a 4 |
| Fotky v K2 renderu prázdné | Cloudinary transformace v URL (`w_1080,h_1350,c_fill`) a síť z kontejneru; `networkidle` čeká na načtení |
