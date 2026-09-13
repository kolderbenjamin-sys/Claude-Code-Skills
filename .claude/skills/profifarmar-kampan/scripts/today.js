#!/usr/bin/env node
// Vypíše kusy k vydání pro dané datum (výchozí dnes v Europe/Prague), bez těch se status manual/waiting/done.
//   node today.js <manifest.json> [YYYY-MM-DD]
const fs = require('fs');
const [manifestPath, dateArg] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const today = dateArg || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
const due = m.items.filter((x) => x.date === today && !['manual', 'waiting', 'done', 'skip'].includes(x.status || ''));
if (!due.length) { console.log(`NIC ${today}`); process.exit(0); }
for (const x of due) console.log(`${x.id}\t${x.time}\t${x.generate ? 'generate=' + x.generate : 'ready'}\t${x.name}`);
