#!/usr/bin/env node
// Vypíše kusy k vydání pro dané datum (výchozí dnes v Europe/Prague): jednorázové z manifest.items
// (bez status manual/waiting/done/skip) + opakované z manifest.recurring (každou neděli nejčtenější, každou středu půda).
//   node today.js <manifest.json> [YYYY-MM-DD]
const fs = require('fs');
const { expand } = require('./recurring');
const [manifestPath, dateArg] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const today = dateArg || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
const due = m.items.filter((x) => x.date === today && !['manual', 'waiting', 'done', 'skip'].includes(x.status || ''));
for (const r of expand(m, today)) {
  if (due.some((x) => x.id === r.id || (x.generate === r.generate && x.date === r.date))) continue;
  const saved = m.items.find((x) => x.id === r.id);
  if (saved && ['done', 'skip'].includes(saved.status || '')) continue;
  due.push(saved && saved.images && saved.images.length ? saved : r); // už vygenerovaný (opakovaný běh) = jen dovydat
}
if (!due.length) { console.log(`NIC ${today}`); process.exit(0); }
for (const x of due) console.log(`${x.id}\t${x.time}\t${x.generate && !(x.images && x.images.length) ? 'generate=' + x.generate : 'ready'}\t${x.name}`);
