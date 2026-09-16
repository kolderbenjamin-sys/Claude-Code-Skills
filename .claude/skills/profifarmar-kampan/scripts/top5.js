#!/usr/bin/env node
// Data pro "Nejčtenější týdne": veřejné API profifarmar.cz (stejný zdroj jako widget na homepage).
//   node top5.js <výstup.json> [YYYY-MM-DD dne vydání]
// Fotky = cover článků přes Cloudinary transformaci (4:5 pro post, 9:16 pro story), žádné stahování.
const fs = require('fs');
const [out, dateArg] = process.argv.slice(2);
if (!out) { console.error('usage: top5.js <out.json> [date]'); process.exit(1); }
const CAT = { 'rostlinna-vyroba': 'rostlinná výroba', 'zivocisna-vyroba': 'živočišná výroba', technika: 'technika',
  legislativa: 'legislativa a EU', 'trhy-a-ceny': 'trhy a ceny', agroekologie: 'agroekologie' };
const tf = (url, t) => url.replace('/image/upload/', `/image/upload/${t}/`);
const POST = 'w_1080,h_1350,c_fill,g_auto,q_auto:good,f_jpg,fl_progressive:none', STORY = 'w_1080,h_1920,c_fill,g_auto,q_auto:good,f_jpg,fl_progressive:none';
function isoWeek(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - n); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y) / 864e5 + 1) / 7); }
(async () => {
  const r = await fetch('https://profifarmar.cz/api/clanky.php?limit=5&order=popular&days=7', { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const j = await r.json(); const list = (j.data || j).slice(0, 5);
  if (list.length < 5) throw new Error(`API vrátilo jen ${list.length} článků`);
  const d = dateArg ? new Date(dateArg) : new Date();
  const days = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const short = (t) => t.length <= 72 ? t : t.slice(0, 72).replace(/\s+\S*$/, '') + '…';
  const data = {
    _zdroj: 'https://profifarmar.cz/api/clanky.php?limit=5&order=popular&days=7',
    chip: 'týdenní monitor · nejčtenější', eyebrow: `${isoWeek(d)}. týden · ${days[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`,
    title: '5 článků, které jste tento týden četli nejvíc',
    photo_post: tf(list[0].cover_image_url, POST), photo_story: tf(list[0].cover_image_url, STORY),
    foot_l: '↗ profifarmar.cz', acc: 'red',
    items: list.map((a) => ({ short: short(a.title), full: a.title, cat: CAT[a.category_slug] || a.category_name || '', photo: tf(a.cover_image_url, POST),
      slug: a.slug, views: a.view_count })),
  };
  fs.writeFileSync(out, JSON.stringify(data, null, 1));
  data.items.forEach((x, i) => console.log(`${i + 1}. [${x.views ?? '?'}] ${x.full}`));
})().catch((e) => { console.error('[KAMPAN] top5 CHYBA', e.message); process.exit(1); });
