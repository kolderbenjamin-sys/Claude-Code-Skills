// Naplní šablonu daty z JSON ({{klic}}, {{#pole}}...{{/pole}}) a zavolá render.js.
// node build.js <post|story|reel|carousel> templates/monitor-post.html data/ceny-2026-38.json out/k2-ceny-38-post.png
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { spawnSync } = require('child_process');
const [kind, tpl, dataFile, dst, ...rest] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// Fotky v datech (photo, photo_post, photo_story - vzdálené https:// URL z Cloudinary) stahujeme
// před renderem lokálně a nahrazujeme za file://: Chromium v kontejneru (na rozdíl od fetch/curl, které
// tenhle build.js/top5.js běžně používá) neumí spolehlivě dojít na vzdálené CDN, což 20. 9. 2026 způsobilo,
// že K2-top5-38 vyšlo se všemi fotkami černými. file:// z disku celou tu síťovou cestu obchází.
const PHOTO_KEY = /^photo(_|$)/;
async function downloadPhoto(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`stažení fotky selhalo (${r.status}): ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = (url.split(/[?#]/)[0].match(/\.(\w+)$/) || [, 'jpg'])[1];
  const file = path.join(os.tmpdir(), `kampan-photo-${crypto.createHash('sha1').update(url).digest('hex')}.${ext}`);
  fs.writeFileSync(file, buf);
  return file;
}
async function localizePhotos(obj) {
  if (Array.isArray(obj)) { for (const v of obj) await localizePhotos(v); return; }
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && PHOTO_KEY.test(k) && /^https?:\/\//.test(v)) obj[k] = 'file://' + (await downloadPhoto(v));
    else if (v && typeof v === 'object') await localizePhotos(v);
  }
}

function fill(t, ctx, parent) {
  t = t.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) =>
    (ctx[k] || []).map((item, i) => fill(body, { ...parent, ...ctx, ...item, i, i1: i + 1 }, ctx)).join(''));
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in ctx ? ctx[k] : (parent && k in parent ? parent[k] : '')));
}

(async () => {
  await localizePhotos(data);
  let src = fs.readFileSync(tpl, 'utf8');
  // {{>cesta}} = vložit soubor (cesta relativně ke složce šablon); hodnota může být i klíč z JSON
  src = src.replace(/\{\{>([\w./-]+)\}\}/g, (_, k) => fs.readFileSync(path.join(path.dirname(tpl), k in data ? data[k] : k), 'utf8'));
  const html = fill(src, data, {});
  const tmp = path.join(path.dirname(tpl), `_tmp-${path.basename(tpl)}`);
  fs.writeFileSync(tmp, html);
  const r = spawnSync('node', [path.join(__dirname, 'render.js'), kind, tmp, dst, ...rest], { stdio: 'inherit' });
  fs.unlinkSync(tmp);
  process.exit(r.status);
})().catch((e) => { console.error('[KAMPAN] build CHYBA', e.message); process.exit(1); });
