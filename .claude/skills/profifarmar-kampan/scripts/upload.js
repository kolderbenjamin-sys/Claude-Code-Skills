#!/usr/bin/env node
// Nahraje soubor na Cloudinary (složka SOCIALS/kampan) a vypíše secure_url.
//   node upload.js <soubor> <public_id>
const fs = require('fs'), crypto = require('crypto');
const [file, publicId] = process.argv.slice(2);
const { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: KEY, CLOUDINARY_API_SECRET: SECRET } = process.env;
if (!file || !publicId) { console.error('usage: upload.js <file> <public_id>'); process.exit(1); }
if (!CLOUD || !KEY || !SECRET) { console.error('[KAMPAN] CHYBA - Cloudinary proměnné chybí (viz SECRETS.md)'); process.exit(1); }
(async () => {
  const kind = file.endsWith('.mp4') ? 'video' : 'image', folder = 'SOCIALS/kampan', ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHash('sha1').update(`folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${ts}${SECRET}`).digest('hex');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)]), file.split(/[\/]/).pop());
  for (const [k, v] of Object.entries({ api_key: KEY, timestamp: ts, signature: sig, folder, public_id: publicId, overwrite: 'true' })) fd.append(k, v);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${kind}/upload`, { method: 'POST', body: fd, signal: AbortSignal.timeout(600000) });
    const j = await r.json();
    if (j.secure_url) { console.log(j.secure_url); return; }
    console.error('pokus', attempt, JSON.stringify(j).slice(0, 300));
    await new Promise((s) => setTimeout(s, 5000));
  }
  process.exit(1);
})().catch((e) => { console.error('[KAMPAN] upload CHYBA', e.message); process.exit(1); });
