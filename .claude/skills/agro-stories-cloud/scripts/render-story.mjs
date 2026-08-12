#!/usr/bin/env node
// ProfiFarmář — render a 1080x1920 Instagram/Facebook story PNG from an article.
//
// Usage: node render-story.mjs <input.json> <output.png>
//   input.json: { titulek, kategorie, datum, coverPath, assetsDir }
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
  console.error('usage: node render-story.mjs <input.json> <output.png>');
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

const M = {
  W: 1080, H: 1920,
  marginX: 60,
  textW: 954,          // 60 → 1014, same as the feed post
  ruleH: 7,            // gold divider, full-bleed
  padTop: 40,          // cream edge → date ink
  dateGap: 35,         // date ink → headline ink
  hairlineGap: 60,     // headline ink → hairline
  footerGap: 24,       // hairline → footer ink
  footerBottom: 1709,  // last ink row before IG's ~200px reply-bar zone
  panelTopMin: 900,
  panelTopMax: 1240,
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
  #cover{ position:absolute; top:0; left:0; width:${M.W}px; height:1000px; overflow:hidden; }
  #cover img{ width:100%; height:100%; object-fit:cover; object-position:center; display:block; }

  #pill{ position:absolute; left:${M.marginX - 7}px; top:900px;
         height:${M.pillH}px; display:inline-flex; align-items:center;
         padding:0 35px 0 36px; background:${C.pill}; border-radius:${M.pillH / 2}px;
         font-family:'Montserrat',sans-serif; font-weight:600; font-size:24px;
         letter-spacing:.02em; color:${C.pillText}; white-space:nowrap; }

  /* thick gold rule that separates cover from panel — full bleed */
  #rule{ position:absolute; left:0; top:993px; width:${M.W}px; height:${M.ruleH}px; background:${C.rule}; }
  #panel{ position:absolute; top:1000px; left:0; width:${M.W}px; height:920px; background:${C.cream}; }

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
</style></head><body>
  <div id="cover"><img src="data:${coverMime};base64,${coverBuf.toString('base64')}" alt=""></div>
  <div id="pill">${esc(cfg.kategorie)}</div>
  <div id="rule"></div>
  <div id="panel"></div>
  <div id="textblock"><div id="datum">${esc(cfg.datum)}</div><div id="titulek">${esc(cfg.titulek)}</div></div>
  <div id="hairline"></div>
  <div id="footer"><span class="l">↗ profifarmar.cz</span><span class="r">VÍCE V ČLÁNKU</span></div>
</body></html>`;

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

  // 3. Let the cream panel hug the content; the cover takes whatever is left.
  const panelTop = Math.round(
    Math.min(m.panelTopMax, Math.max(m.panelTopMin, block.getBoundingClientRect().top - m.padTop)),
  );
  $('cover').style.height = panelTop + 'px';
  $('rule').style.top = panelTop - m.ruleH + 'px';
  $('panel').style.top = panelTop + 'px';
  $('panel').style.height = m.H - panelTop + 'px';
  $('pill').style.top = panelTop - m.ruleH - m.pillGap - m.pillH + 'px';

  return { size, panelTop, footerTop, hairlineTop,
           lines: Math.round(title.getBoundingClientRect().height / (size * m.leading)) };
}, M);

await page.screenshot({ path: outPath, type: 'png' });
await browser.close();
console.log(
  `rendered ${outPath}  headline ${layout.size}px / ${layout.lines} lines  ` +
  `panelTop ${layout.panelTop}  hairline ${layout.hairlineTop}  footer ${layout.footerTop}`,
);
