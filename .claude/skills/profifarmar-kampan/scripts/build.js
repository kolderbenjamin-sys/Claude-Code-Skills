// Naplní šablonu daty z JSON ({{klic}}, {{#pole}}...{{/pole}}) a zavolá render.js.
// node build.js <post|story|reel|carousel> templates/monitor-post.html data/ceny-2026-38.json out/k2-ceny-38-post.png
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const [kind, tpl, dataFile, dst, ...rest] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
function fill(t, ctx, parent) {
  t = t.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) =>
    (ctx[k] || []).map((item, i) => fill(body, { ...parent, ...ctx, ...item, i, i1: i + 1 }, ctx)).join(''));
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in ctx ? ctx[k] : (parent && k in parent ? parent[k] : '')));
}
let src = fs.readFileSync(tpl, 'utf8');
// {{>cesta}} = vložit soubor (cesta relativně ke složce šablon); hodnota může být i klíč z JSON
src = src.replace(/\{\{>([\w./-]+)\}\}/g, (_, k) => fs.readFileSync(path.join(path.dirname(tpl), k in data ? data[k] : k), 'utf8'));
const html = fill(src, data, {});
const tmp = path.join(path.dirname(tpl), `_tmp-${path.basename(tpl)}`);
fs.writeFileSync(tmp, html);
const r = spawnSync('node', [path.join(__dirname, 'render.js'), kind, tmp, dst, ...rest], { stdio: 'inherit' });
fs.unlinkSync(tmp);
process.exit(r.status);
