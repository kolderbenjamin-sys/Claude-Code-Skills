#!/usr/bin/env node
// ProfiFarmář — render a 1080x1920 Instagram/Facebook story PNG from an article.
//
// Usage: node render-story.mjs <input.json> <output.png>
//   input.json: { titulek, kategorie, datum, coverPath, assetsDir }
//
// Every asset (fonts, logo, cover) is inlined as a data: URI, so Chromium renders
// fully offline and the output is byte-stable for the same input.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

// playwright is installed globally in the Claude Code container, which a plain
// ESM import from a scratch directory will not resolve — fall back to the global root.
async function loadChromium() {
  // playwright ships as CommonJS, so a dynamic import may expose it under `default`.
  const pick = (m) => m.chromium ?? m.default?.chromium;
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

// PLAYWRIGHT_BROWSERS_PATH is preset, but pin the binary if the version-stamped dir exists.
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

const chromium = await loadChromium();

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node render-story.mjs <input.json> <output.png>');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(inPath, 'utf8'));
const A = cfg.assetsDir;

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

// --- Brand tokens, sampled pixel-for-pixel from the 4:5 template DAHOBdpJ1tk ---
const C = {
  cream: '#F4EFE5',
  pill: '#B8473B',
  pillText: '#FFFBF1',
  headline: '#130F0A',
  gold: '#8A6A2E',
  footer: '#2A261F',
};

// Horizontal metrics match the feed post exactly, so both formats read as one system.
// Vertically the cream panel is sized to its content: the headline block is anchored
// to a fixed baseline and the cover takes whatever height is left over.
const M = {
  W: 1080, H: 1920,
  marginX: 62,
  textW: 956,
  textBottom: 1500,   // bottom edge of the headline block — constant across all stories
  footerTop: 1596,    // last safe line before IG's ~250px reply-bar / link-sticker zone
  padTop: 54,         // cream padding above the date line
  panelTopMin: 880,   // clamp: never let the cover shrink past this
  panelTopMax: 1180,  // clamp: never let the cover grow past this
  logoTop: 300,       // below Instagram's ~250px profile-name overlay
  logoSize: 76,
  pillH: 61,
  pillGap: 30,        // the pill floats this far above the cream panel edge
  sizeMax: 82,
  sizeMin: 46,
};

const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<style>
  @font-face { font-family:'Playfair Display'; font-weight:700; src:url('${font('PlayfairDisplay-Bold.ttf')}') format('truetype'); }
  @font-face { font-family:'Montserrat';       font-weight:600; src:url('${font('Montserrat-SemiBold.ttf')}') format('truetype'); }
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:${M.W}px; height:${M.H}px; }
  body{ background:${C.cream}; position:relative; overflow:hidden;
        -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }

  #cover{ position:absolute; top:0; left:0; width:${M.W}px; height:1000px; overflow:hidden; }
  #cover img{ width:100%; height:100%; object-fit:cover; object-position:center; display:block; }
  /* keeps the cream wordmark legible over a bright sky */
  .scrim{ position:absolute; top:0; left:0; width:${M.W}px; height:520px;
          background:linear-gradient(180deg, rgba(0,0,0,.36) 0%, rgba(0,0,0,.13) 48%, rgba(0,0,0,0) 100%); }

  .brand{ position:absolute; top:${M.logoTop}px; left:${M.marginX}px;
          display:flex; align-items:center; gap:26px; }
  .brand img{ width:${M.logoSize}px; height:${M.logoSize}px; display:block; }
  .brand span{ font-family:'Playfair Display',serif; font-weight:700; font-size:56px;
               color:#FBF7EF; letter-spacing:.005em; text-shadow:0 2px 10px rgba(0,0,0,.28); }

  #pill{ position:absolute; left:${M.marginX}px; top:909px;
         height:${M.pillH}px; display:inline-flex; align-items:center; padding:0 30px;
         background:${C.pill}; border-radius:${M.pillH / 2}px;
         font-family:'Montserrat',sans-serif; font-weight:600; font-size:24px;
         letter-spacing:.13em; color:${C.pillText}; white-space:nowrap; }

  #panel{ position:absolute; top:1000px; left:0; width:${M.W}px; height:920px; background:${C.cream}; }

  /* bottom-anchored so short and long headlines share the same optical rhythm */
  #textblock{ position:absolute; left:${M.marginX}px; width:${M.textW}px;
              bottom:${M.H - M.textBottom}px; }
  #datum{ font-family:'Montserrat',sans-serif; font-weight:600; font-size:29px;
          letter-spacing:.19em; color:${C.gold}; white-space:nowrap; margin-bottom:26px; }
  #titulek{ font-family:'Playfair Display',serif; font-weight:700; color:${C.headline};
            font-size:${M.sizeMax}px; line-height:1.16; letter-spacing:-.004em;
            hyphens:none; overflow-wrap:break-word; }

  .footer{ position:absolute; top:${M.footerTop}px; left:${M.marginX}px;
           width:${M.W - 2 * M.marginX}px; display:flex; justify-content:space-between;
           align-items:baseline; font-family:'Montserrat',sans-serif; font-weight:600;
           font-size:25px; letter-spacing:.10em; }
  .footer .l{ color:${C.footer}; }
  .footer .r{ color:${C.gold}; }
</style></head><body>
  <div id="cover"><img src="data:${coverMime};base64,${coverBuf.toString('base64')}" alt=""><div class="scrim"></div></div>
  <div class="brand"><img src="data:image/png;base64,${b64(join(A, 'logo-profifarmar.png'))}" alt=""><span>Profi Farmář</span></div>
  <div id="pill">${esc(cfg.kategorie)}</div>
  <div id="panel"></div>
  <div id="textblock"><div id="datum">${esc(cfg.datum)}</div><div id="titulek">${esc(cfg.titulek)}</div></div>
  <div class="footer"><span class="l">↗ profifarmar.cz</span><span class="r">VÍCE V ČLÁNKU</span></div>
</body></html>`;

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ['--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text'],
});
const page = await browser.newPage({ viewport: { width: M.W, height: M.H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const layout = await page.evaluate((m) => {
  const title = document.getElementById('titulek');
  const block = document.getElementById('textblock');

  // 1. Shrink the headline until the whole text block fits inside the panel budget.
  const budget = m.textBottom - (m.panelTopMin + m.padTop);
  let size = m.sizeMax;
  title.style.fontSize = size + 'px';
  while (size > m.sizeMin && block.getBoundingClientRect().height > budget) {
    size -= 2;
    title.style.fontSize = size + 'px';
  }

  // 2. Let the cream panel hug the content: its top follows the measured block.
  const blockTop = block.getBoundingClientRect().top;
  const panelTop = Math.round(
    Math.min(m.panelTopMax, Math.max(m.panelTopMin, blockTop - m.padTop)),
  );

  document.getElementById('cover').style.height = panelTop + 'px';
  document.getElementById('panel').style.top = panelTop + 'px';
  document.getElementById('panel').style.height = m.H - panelTop + 'px';
  document.getElementById('pill').style.top = panelTop - m.pillGap - m.pillH + 'px';

  return { size, panelTop, blockTop: Math.round(blockTop), lines: Math.round(title.getBoundingClientRect().height / (size * 1.16)) };
}, M);

await page.screenshot({ path: outPath, type: 'png' });
await browser.close();
console.log(
  `rendered ${outPath}  headline ${layout.size}px / ${layout.lines} lines  panelTop ${layout.panelTop}px`,
);
