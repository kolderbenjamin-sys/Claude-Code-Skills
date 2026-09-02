#!/usr/bin/env node
// ProfiFarmář — render a 1080x1920 REEL cover PNG from an article.
//
// Usage: node render-reel.mjs <input.json> <output.png>
//   input.json: { titulek, kategorie, datum, coverPath, assetsDir, layout? }
//     layout: "band" (výchozí) | "fullbleed" | "gradient" | "card"
//       band      — krémový pás přes celou šířku, fotka nad ním i pod ním
//       fullbleed — pás až ke spodní hraně jako u story
//       gradient  — fotka nezakrytá, sazba leží na tmavém přechodu
//       card      — fotka nezakrytá, sazba v krémové kartě odsazené od krajů
//     columns: "safe" (výchozí) | "wide"
//       safe — sloupec 60 → 920. Vlevo u kraje jako u story (tam UI nic
//              nekreslí), vpravo končí 38 px před sloupcem ikon (x≈958).
//       wide — sloupec 60 → 1014 jako u story. Vypadá to jako feed post, ale
//              pravý konec patičky leží pod ikonami sdílet / uložit.
//     layers: true → místo jednoho PNG uloží dvě vrstvy vedle <output.png>:
//             <output>.bg.png  (jen fotka, plné 1080x1920)
//             <output>.fg.png  (pás, štítek a sazba, s alfou)
//             Video pak zoomuje jen pozadí a sazbu drží nehybnou — jinak by
//             zoom odtáhl titulek z bezpečné zóny, kvůli které vznikl.
//
// Proti story rendereru (agro-stories-cloud/scripts/render-story.mjs, který se
// NEMĚNÍ) je posazená jinam sazba, protože reel má přes video vlastní UI:
//   - spodních ~500 px zabírá jméno účtu, popisek a řádek "Followed by",
//   - pravých ~220 px zabírá sloupec ikon (like / komentář / sdílet / uložit),
//     zhruba mezi y = 950 a y = 1700.
// Ověřeno na živém reelu 2. 9. 2026: titulek lezl pod ikonu záložky a patička
// s profifarmar.cz se kryla s uživatelským jménem.
//
// Every asset (fonts, cover) is inlined as a data: URI, so Chromium renders
// fully offline and the output is byte-stable for the same input.
//
// All type sizes, colours, rules and spacings below were measured pixel-for-pixel
// off a live 4:5 feed post so the story reads as the same design system.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node render-reel.mjs <input.json> <output.png>');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(inPath, 'utf8'));
const A = cfg.assetsDir;

// playwright is installed globally in the Claude Code container, which a plain
// ESM import from a scratch directory will not resolve — fall back to the global root.
async function loadChromium() {
  const pick = (m) => m.chromium ?? m.default?.chromium; // playwright ships as CommonJS
  try {
    const got = pick(await import('playwright'));
    if (got) return got;
  } catch { /* not resolvable from here — try the global root below */ }
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const entry = join(root, 'playwright', 'index.js');
  if (!existsSync(entry)) throw new Error(`playwright not found (looked in ${root})`);
  const got = pick(await import(pathToFileURL(entry).href));
  if (!got) throw new Error(`playwright at ${entry} exposes no chromium export`);
  return got;
}

// PLAYWRIGHT_BROWSERS_PATH is preset, but pin the binary if a version-stamped dir exists.
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const bin = join(base, dir, 'chrome-linux', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

const b64 = (p) => readFileSync(p).toString('base64');
const font = (f) => `data:font/ttf;base64,${b64(join(A, f))}`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Sniff the cover by magic bytes — Profifarmar serves .png URLs that are sometimes JPEG.
const coverBuf = readFileSync(cfg.coverPath);
const coverMime =
  coverBuf[0] === 0x89 && coverBuf[1] === 0x50 ? 'image/png'
  : coverBuf[0] === 0xff && coverBuf[1] === 0xd8 ? 'image/jpeg'
  : coverBuf.slice(8, 12).toString() === 'WEBP' ? 'image/webp'
  : 'image/jpeg';

// --- Brand tokens, sampled off the live feed visual --------------------------
const C = {
  cream: '#F4EFE5',
  pill: '#B8473B',
  pillText: '#FFFBF1',
  headline: '#130F0A',
  gold: '#8A6A2E',
  rule: '#C49A2E',      // the thick divider under the cover
  hairline: '#D5D1C7',  // the thin rule above the footer
  footer: '#2A261F',
};

const LAYOUT = ['fullbleed', 'gradient', 'card'].includes(cfg.layout) ? cfg.layout : 'band';
const CARD_INSET = 48;   // vnitřní okraj krémové karty (layout "card")
const COLUMNS = cfg.columns === 'wide' ? 'wide' : 'safe';

// Sloupec ikon Instagramu (like / komentář / sdílet / uložit) leží zhruba na
// x = 958-1036, y = 1040-1620 — odměřeno ze snímku živého reelu 2. 9. 2026.
const COL = COLUMNS === 'wide'
  ? { marginX: 60, textW: 954 }   // až k x=1014 — konec patičky leží pod ikonami
  : { marginX: 60, textW: 860 };  // až k x=920 — těsně před sloupec ikon

const M = {
  W: 1080, H: 1920,
  ...COL,
  ruleH: 7,            // gold divider, full-bleed
  padTop: 40,          // cream edge → date ink
  dateGap: 35,         // date ink → headline ink
  hairlineGap: 60,     // headline ink → hairline
  footerGap: 24,       // hairline → footer ink
  footerBottom: 1400,  // poslední ink řádek nad UI vrstvou reelu (~500 px)
  panelTopMin: 700,
  panelTopMax: 1000,
  bandBottomPad: 56,   // cream pod patičkou, než band skončí (jen layout "band")
  pillH: 60,
  pillGap: 31,         // pill bottom → top of the gold divider
  sizeMax: 80,
  sizeMin: 46,
  leading: 1.09,       // measured off the feed post — deliberately tight
};

const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<style>
  @font-face { font-family:'Playfair Display'; font-weight:700; src:url('${font('PlayfairDisplay-Bold.ttf')}') format('truetype'); }
  @font-face { font-family:'Montserrat';       font-weight:600; src:url('${font('Montserrat-SemiBold.ttf')}') format('truetype'); }
  @font-face { font-family:'Roboto Mono';      font-weight:500; src:url('${font('RobotoMono-Medium.ttf')}') format('truetype'); }
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:${M.W}px; height:${M.H}px; }
  body{ background:${C.cream}; position:relative; overflow:hidden;
        -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }

  /* No logo or wordmark over the cover: Instagram already draws the account name
     and avatar in the top overlay, so repeating the brand there just competes with it. */
  #cover{ position:absolute; top:0; left:0; width:${M.W}px; height:${M.H}px; overflow:hidden; z-index:0; }
  #pill,#rule,#panel,#ruleBottom,#textblock,#hairline,#footer{ z-index:2; }
  #cover img{ width:100%; height:100%; object-fit:cover; object-position:center; display:block; }

  #pill{ position:absolute; left:${M.marginX - 7}px; top:900px;
         height:${M.pillH}px; display:inline-flex; align-items:center;
         padding:0 35px 0 36px; background:${C.pill}; border-radius:${M.pillH / 2}px;
         font-family:'Montserrat',sans-serif; font-weight:600; font-size:24px;
         letter-spacing:.02em; color:${C.pillText}; white-space:nowrap; }

  /* thick gold rule that separates cover from panel — full bleed */
  #rule{ position:absolute; left:0; top:993px; width:${M.W}px; height:${M.ruleH}px; background:${C.rule}; }
  #panel{ position:absolute; top:1000px; left:0; width:${M.W}px; height:920px; background:${C.cream}; }
  /* spodní hrana krémového pásu — jen v layoutu "band", kde pod ním pokračuje fotka */
  #ruleBottom{ position:absolute; left:0; top:0; width:${M.W}px; height:${M.ruleH}px;
               background:${C.rule}; display:none; }

  /* tmavý přechod pod sazbou — layout "gradient". Fotka zůstane celá vidět,
     text drží kontrast i na světlé obloze nebo strništi. */
  #scrim{ position:absolute; left:0; top:0; width:${M.W}px; height:${M.H}px; display:none;
          background:linear-gradient(to bottom,
            rgba(19,15,10,0) 0%, rgba(19,15,10,.10) 34%, rgba(19,15,10,.62) 54%,
            rgba(19,15,10,.88) 70%, rgba(19,15,10,.94) 100%); }

  body.gradient #scrim{ display:block; }
  body.gradient #panel, body.gradient #rule, body.gradient #ruleBottom{ display:none; }
  body.gradient #titulek{ color:#F7F2E8; }
  body.gradient #datum{ color:#E8C874; }
  body.gradient #hairline{ background:rgba(244,239,229,.32); }
  body.gradient #footer .l{ color:#EFE9DC; }
  body.gradient #footer .r{ color:#E8C874; }

  body.card #rule, body.card #ruleBottom{ display:none; }
  body.card #panel{ border-radius:14px; box-shadow:0 24px 60px rgba(19,15,10,.34); }

  /* bottom-anchored so short and long headlines share the same optical rhythm */
  #textblock{ position:absolute; left:${M.marginX}px; width:${M.textW}px; bottom:400px; }
  #datum{ font-family:'Montserrat',sans-serif; font-weight:600; font-size:25px;
          letter-spacing:.12em; color:${C.gold}; white-space:nowrap; margin-bottom:${M.dateGap - 10}px; }
  #titulek{ font-family:'Playfair Display',serif; font-weight:700; color:${C.headline};
            font-size:${M.sizeMax}px; line-height:${M.leading};
            hyphens:none; overflow-wrap:break-word; }

  #hairline{ position:absolute; left:${M.marginX}px; top:1600px;
             width:${M.textW}px; height:2px; background:${C.hairline}; }
  #footer{ position:absolute; top:1624px; left:${M.marginX}px; width:${M.textW}px;
           display:flex; justify-content:space-between; align-items:baseline; }
  #footer .l{ font-family:'Roboto Mono',monospace; font-weight:500; font-size:24px;
              letter-spacing:.096em; color:${C.footer}; }
  #footer .r{ font-family:'Montserrat',sans-serif; font-weight:600; font-size:26px;
              letter-spacing:.051em; color:${C.gold}; }
</style></head><body class="${LAYOUT}">
  <div id="scrim" style="z-index:1"></div>
  <div id="cover"><img src="data:${coverMime};base64,${coverBuf.toString('base64')}" alt=""></div>
  <div id="pill">${esc(cfg.kategorie)}</div>
  <div id="rule"></div>
  <div id="panel"></div>
  <div id="ruleBottom"></div>
  <div id="textblock"><div id="datum">${esc(cfg.datum)}</div><div id="titulek">${esc(cfg.titulek)}</div></div>
  <div id="hairline"></div>
  <div id="footer"><span class="l">↗ profifarmar.cz</span><span class="r">VÍCE V ČLÁNKU</span></div>
</body></html>`;

const LAYERS = cfg.layers === true;

const chromium = await loadChromium();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ['--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text'],
});
const page = await browser.newPage({ viewport: { width: M.W, height: M.H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const layout = await page.evaluate((m) => {
  const $ = (id) => document.getElementById(id);
  const title = $('titulek'), block = $('textblock'), footer = $('footer');

  // Karta je odsazená od krajů, takže sazba uvnitř ní má vlastní, užší sloupec.
  // Musí se nastavit dřív, než se měří zalomení titulku.
  if (m.layout === 'card') {
    const inner = m.textW - 2 * m.cardInset;
    for (const el of [block, $('hairline'), footer]) {
      el.style.left = m.marginX + m.cardInset + 'px';
      el.style.width = inner + 'px';
    }
    $('pill').style.left = m.marginX + m.cardInset - 7 + 'px';
  }

  // 1. Pin the footer so its last ink row lands on m.footerBottom, then hang the
  //    hairline and the headline block off it using the measured feed-post gaps.
  const fb = footer.getBoundingClientRect();
  const footerInkBottom = Math.max(
    ...[...footer.children].map((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom - parseFloat(getComputedStyle(el).fontSize) * 0.22; // drop the descender slack
    }),
  );
  const footerShift = m.footerBottom - footerInkBottom;
  const footerTop = Math.round(fb.top + footerShift);
  footer.style.top = footerTop + 'px';
  const hairlineTop = footerTop - m.footerGap;
  $('hairline').style.top = hairlineTop + 'px';

  // 2. Shrink the headline until the block fits the panel budget, then anchor it.
  const blockBottom = hairlineTop - m.hairlineGap;
  const budget = blockBottom - (m.panelTopMin + m.padTop);
  let size = m.sizeMax;
  title.style.fontSize = size + 'px';
  while (size > m.sizeMin && block.getBoundingClientRect().height > budget) {
    size -= 2;
    title.style.fontSize = size + 'px';
  }
  block.style.bottom = m.H - blockBottom + 'px';

  // 3. Krémový pás obepne obsah. V layoutu "band" končí pod patičkou a fotka
  //    pokračuje pod ním (tam už kreslí své UI Instagram); ve "fullbleed" jde
  //    pás jako u story až ke spodní hraně.
  const panelTop = Math.round(
    Math.min(m.panelTopMax, Math.max(m.panelTopMin, block.getBoundingClientRect().top - m.padTop)),
  );
  const hugsContent = m.layout === 'band' || m.layout === 'card';
  const bandBottom = hugsContent
    ? Math.round(footer.getBoundingClientRect().bottom + m.bandBottomPad)
    : m.H;

  // Fotka je celá jen tam, kde ji panel nezakrývá odshora dolů.
  $('cover').style.height = (m.layout === 'fullbleed' ? panelTop : m.H) + 'px';
  $('rule').style.top = panelTop - m.ruleH + 'px';
  $('panel').style.top = panelTop + 'px';
  $('panel').style.height = bandBottom - panelTop + 'px';
  $('pill').style.top = panelTop - m.ruleH - m.pillGap - m.pillH + 'px';

  if (m.layout === 'band') {
    const rb = $('ruleBottom');
    rb.style.display = 'block';
    rb.style.top = bandBottom + 'px';
  }
  if (m.layout === 'card') {
    // karta drží okraje sloupce, ne celou šířku
    $('panel').style.left = m.marginX + 'px';
    $('panel').style.width = m.textW + 'px';
    $('panel').style.top = panelTop - m.cardInset + 'px';
    $('panel').style.height = bandBottom - panelTop + 2 * m.cardInset + 'px';
    $('pill').style.top = panelTop - m.cardInset - m.pillGap - m.pillH + 'px';
  }
  if (m.layout === 'gradient') {
    // štítek sedí nad datem, panel se nekreslí
    $('pill').style.top = panelTop - m.pillGap - m.pillH + 'px';
  }

  return { size, panelTop, bandBottom, footerTop, hairlineTop,
           lines: Math.round(title.getBoundingClientRect().height / (size * m.leading)) };
}, { ...M, layout: LAYOUT, cardInset: CARD_INSET });

await page.screenshot({ path: outPath, type: 'png' });

if (LAYERS) {
  const stem = outPath.replace(/\.png$/i, '');
  const setVis = (sel, on) =>
    page.evaluate(([s, v]) => {
      for (const el of document.querySelectorAll(s)) el.style.visibility = v ? 'visible' : 'hidden';
    }, [sel, on]);
  const OVERLAY = '#scrim,#pill,#rule,#ruleBottom,#panel,#textblock,#hairline,#footer';

  // pozadí — jen fotka
  await setVis(OVERLAY, false);
  await page.screenshot({ path: `${stem}.bg.png`, type: 'png' });

  // popředí — sazba s průhledným pozadím
  await setVis(OVERLAY, true);
  await setVis('#cover', false);
  await page.evaluate(() => { document.body.style.background = 'transparent'; });
  await page.screenshot({ path: `${stem}.fg.png`, type: 'png', omitBackground: true });
  console.log(`layers  ${stem}.bg.png  ${stem}.fg.png`);
}

await browser.close();
console.log(
  `rendered ${outPath}  layout ${LAYOUT}  headline ${layout.size}px / ${layout.lines} lines  ` +
  `panelTop ${layout.panelTop}  bandBottom ${layout.bandBottom}  footer ${layout.footerTop}`,
);
