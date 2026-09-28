#!/usr/bin/env node
// Zapíše vygenerované soubory a popisky do položky manifestu.
//   node set-item.js <manifest.json> <ID> --images url1,url2,... [--story url] [--reel url] [--ig soubor.txt] [--fb soubor.txt]
const fs = require('fs');
const [manifestPath, id, ...flags] = process.argv.slice(2);
const opt = (n) => { const i = flags.indexOf(n); return i >= 0 ? flags[i + 1] : null; };
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let it = m.items.find((x) => x.id === id);
if (!it) { // opakovaný kus (K2-top5-2026-41): založ ho z pravidla v manifest.recurring
  it = require('./recurring').byId(m, id);
  if (!it) { console.error(`kus ${id} není v manifestu ani v recurring`); process.exit(1); }
  m.items.push(it); m.items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
if (opt('--images')) it.images = opt('--images').split(',');
if (opt('--story')) it.story = opt('--story');
if (opt('--reel')) it.reel = opt('--reel');
if (opt('--ig')) it.ig = fs.readFileSync(opt('--ig'), 'utf8').trim();
if (opt('--fb')) it.fb = fs.readFileSync(opt('--fb'), 'utf8').trim();
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 1) + '\n');
console.log(`${id}: images=${(it.images || []).length} story=${!!it.story} reel=${!!it.reel} ig=${(it.ig || '').length} fb=${(it.fb || '').length}`);
