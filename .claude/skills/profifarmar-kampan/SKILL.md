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
  (`npm i ffmpeg-static`, bez sudo). Fonty se tahají z Google Fonts, kontejner potřebuje síť.
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

Zdroj je **Intersucho** (Mendelu + CzechGlobe, týdenní hodnocení k neděli), ne odhad z /pocasi:

```bash
curl -sS -m 60 -A "Mozilla/5.0" https://www.intersucho.cz/cz/ -o /tmp/k2/intersucho.html
```

Z textu stránky (aktuální hodnocení, odstavec "Situace" a mapové souhrny) vytáhni pro ČR:
1. podíl území zasaženého suchem (intenzita sucha, % území),
2. podíl území s extrémním/výjimečným suchem (% území),
3. deficit půdní vláhy (mm) nebo nasycení profilu 0 až 100 cm (%),
4. nejhůř postižená oblast (kraj/region slovy),
5. trend proti minulému týdnu (zlepšení/zhoršení/beze změny) a datum hodnocení.

Vyplň `/tmp/k2/puda.json` podle tohoto vzoru (5 řádků `rows`, `dir` = `up` dobrá zpráva / `down` špatná):

```json
{"chip":"týdenní monitor · půda","eyebrow":"39. týden · středa 23. 9. 2026",
 "title":"Půda před setím ozimů: <hlavní sdělení z Intersucha>",
 "photo_post":"puda-post.jpg","photo_story":"puda-story.jpg","acc":"green",
 "rows":[
  {"n":"Území v suchu · ČR","v":"38","u":"%","d":"▼ méně než minulý týden","dir":"up"},
  {"n":"Extrémní a výjimečné sucho","v":"16","u":"% území","d":"▲","dir":"down"},
  {"n":"Deficit půdní vláhy · 0 až 100 cm","v":"−40","u":"mm","d":"proti normálu","dir":"down"},
  {"n":"Nejhůř","v":"jižní Morava","u":"","d":"▼","dir":"down"},
  {"n":"Hodnocení Intersucho","v":"k 20. 9.","u":"","d":"aktualizace týdně","dir":"up"}],
 "foot_l":"↗ profifarmar.cz/pocasi","foot_r":"zdroj: intersucho.cz"}
```

Čísla, která na stránce nejsou, **nevymýšlej** - řádek nahraď jiným údajem, který tam je (např. nasycení
půdy, zásoba vody v půdě). Titulek vždy říká, co to znamená pro polní práce v daném týdnu (setí ozimů,
sklizeň cukrovky, podzimní orba).

```bash
[ -d node_modules/ffmpeg-static ] || npm i --no-audit --no-fund ffmpeg-static >/dev/null 2>&1 || true
export FFMPEG="$(node -p "require('ffmpeg-static')" 2>/dev/null || echo ffmpeg)"
node "$SK/scripts/build.js" post  "$SK/templates/monitor-post.html"  /tmp/k2/puda.json /tmp/k2/puda-post.png
node "$SK/scripts/build.js" story "$SK/templates/monitor-story.html" /tmp/k2/puda.json /tmp/k2/puda-story.png
node "$SK/scripts/build.js" reel  "$SK/templates/monitor-reel.html"  /tmp/k2/puda.json /tmp/k2/puda-reel.mp4 8 30
```

Popisek: hook = hlavní sdělení + 1 číslo, tělo = "Půdní monitor: každou středu souhrn z Intersucha (Mendelu
a CzechGlobe) za celou ČR. Detail počasí pro váš kraj na profifarmar.cz/pocasi." Hashtagy
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
(`get_post` každých 15 s, max 8 min, `--wait` mění): `sent` = OK, `error` = post smaže a jednou pošle znovu,
podruhé = chyba. Po timeoutu `pending` (Buffer ještě zpracovává, typicky YT) se bere jako OK s poznámkou.
Každý slot hned zapíše do logu s `postId` a `status`; při opakovaném spuštění sloty s `ok: true` přeskočí,
takže po chybě stačí pustit znovu. Exit 2 = část selhala (výpis i log říká která a proč).

Obrázky posílá vždy jako **JPEG** (Cloudinary `f_jpg,q_auto:good` v URL, bez nového uploadu). Důvod: 14. 9. 2026
Instagram odmítl PNG story ("There is an issue with the media included"), FB stejný soubor vzal; publish.js
to tehdy zalogoval jako OK, protože kontroloval jen přijetí Bufferem. Od té doby se ověřuje `sent`.

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
| Reel bez ffmpeg | `npm i ffmpeg-static` a `export FFMPEG=$(node -p "require('ffmpeg-static')")` |
| Buffer 406 | header `Accept: text/event-stream, application/json` (publish.js ho posílá) |
| Buffer odmítne story kvůli textu | publish.js zkusí znovu s názvem kusu jako textem |
| Post skončí `error` "issue with the media" | IG nebere PNG story; publish.js posílá JPEG přes `f_jpg` a při erroru jednou znovu. Když padne i podruhé, zkontroluj URL v prohlížeči |
| Slot skončí `pending` | Buffer ještě zpracovává (YT až 10 min): `get_post {postId}` z logu; když je `sent`, nic nedělej |
| Reel se objevil v mřížce IG | `shouldShareToFeed` musí být `false` (publish.js) |
| Kus vydán dvakrát | log se nekomitnul, viz Krok 0 a 4 |
| Fotky v K2 renderu prázdné | Cloudinary transformace v URL (`w_1080,h_1350,c_fill`) a síť z kontejneru; `networkidle` čeká na načtení |
