#!/usr/bin/env node
// Vydá jeden kus kampaně z manifest.json přes Buffer (shareNow) na IG + FB + YT.
//
//   node publish.js <manifest.json> <log.json> <ID> [--dry] [--due 2026-10-20T15:00:00Z] [--only ig-post,fb-story,...]
//
// Formáty podle obsahu kusu: ig-post (carousel nebo 1 obrázek), ig-story, ig-reel,
// fb-post, fb-story, fb-reel, yt-reel (short). Co už je v logu, se přeskočí (idempotentní).
// Proč Node a ne bash+jq: payloady pro Buffer jsou vnořené JSONy, v Node se skládají bez escapování.
const fs = require('fs');
const [manifestPath, logPath, id, ...flags] = process.argv.slice(2);
if (!manifestPath || !logPath || !id) { console.error('usage: publish.js <manifest> <log> <ID> [--dry] [--due ISO] [--only a,b]'); process.exit(1); }
const opt = (n) => { const i = flags.indexOf(n); return i >= 0 ? flags[i + 1] : null; };
const DRY = flags.includes('--dry'), DUE = opt('--due'), ONLY = (opt('--only') || '').split(',').filter(Boolean);
const TOKEN = process.env.BUFFER_API_KEY;
if (!TOKEN && !DRY) { console.error('[KAMPAN] CHYBA - BUFFER_API_KEY chybí (viz SECRETS.md)'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const item = manifest.items.find((x) => x.id === id);
if (!item) { console.error(`[KAMPAN] kus ${id} v manifestu není`); process.exit(1); }
if (!item.images || !item.images.length) { console.error(`[KAMPAN] kus ${id} nemá vyrenderované soubory (generate=${item.generate || '-'})`); process.exit(1); }
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
const done = new Set(log.filter((l) => l.id === id && l.ok).map((l) => l.slot));

async function buffer(name, args) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  let raw;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch('https://mcp.buffer.com/mcp', { method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        body: JSON.stringify(body) });
      raw = await r.text(); break;
    } catch (e) { if (attempt === 2) throw e; await new Promise((s) => setTimeout(s, 5000)); }
  }
  const data = raw.split('\n').filter((l) => l.startsWith('data: ')).pop();
  const j = JSON.parse(data ? data.slice(6) : raw);
  if (j.error) throw new Error('BUFFER_ERROR ' + JSON.stringify(j.error));
  const txt = j.result?.content?.[0]?.text ?? '';
  try { return JSON.parse(txt); } catch { return txt; }
}

const img = (url) => ({ image: { url, metadata: { altText: item.alt || item.name } } });
const vid = (url) => ({ video: { url, metadata: { title: item.name, thumbnailOffset: 1000 } } });
const link = item.link || 'https://profifarmar.cz/';

function slots(ch) {
  const S = [];
  S.push({ slot: 'ig-post', ch: ch.instagram, text: item.ig, assets: item.images.map(img), meta: { instagram: { type: 'post', shouldShareToFeed: true } } });
  if (item.story) S.push({ slot: 'ig-story', ch: ch.instagram, text: '', assets: [img(item.story)], meta: { instagram: { type: 'story', shouldShareToFeed: false, link } } });
  if (item.reel) S.push({ slot: 'ig-reel', ch: ch.instagram, text: item.ig, assets: [vid(item.reel)], meta: { instagram: { type: 'reel', shouldShareToFeed: false } } });
  S.push({ slot: 'fb-post', ch: ch.facebook, text: item.fb, assets: item.images.map(img), meta: { facebook: { type: 'post' } } });
  if (item.story) S.push({ slot: 'fb-story', ch: ch.facebook, text: '', assets: [img(item.story)], meta: { facebook: { type: 'story' } } });
  if (item.reel) S.push({ slot: 'fb-reel', ch: ch.facebook, text: item.fb, assets: [vid(item.reel)], meta: { facebook: { type: 'reel' } } });
  if (item.reel && ch.youtube) S.push({ slot: 'yt-reel', ch: ch.youtube, text: item.ig, assets: [vid(item.reel)], meta: { youtube: { title: item.yt_title || item.name, categoryId: '22', notifySubscribers: false } } });
  return S.filter((s) => !ONLY.length || ONLY.includes(s.slot)).filter((s) => !done.has(s.slot));
}

(async () => {
  let ch = { instagram: 'IG', facebook: 'FB', youtube: 'YT' };
  if (!DRY) {
    const acc = await buffer('get_account', {});
    const org = acc.organizations[0].id;
    const list = await buffer('list_channels', { organizationId: org });
    ch = {}; for (const c of list) ch[c.service] = c.id;
    for (const s of ['instagram', 'facebook']) if (!ch[s]) throw new Error(`Buffer nemá kanál ${s}`);
  }
  const todo = slots(ch);
  if (!todo.length) { console.log(`[KAMPAN] ${id}: nic k vydání (vše už v logu)`); return; }
  const results = [];
  for (const s of todo) {
    const args = { channelId: s.ch, text: s.text, assets: s.assets, schedulingType: 'automatic', metadata: s.meta,
      ...(DUE ? { mode: 'customScheduled', dueAt: DUE } : { mode: 'shareNow' }) };
    if (DRY) { console.log(`--- ${s.slot}\n${JSON.stringify(args, null, 1)}`); continue; }
    let ok = false, info = '';
    try {
      let res;
      try { res = await buffer('create_post', args); }
      catch (e) {
        // story bez textu: když to Buffer odmítne, pošli název kusu (text se u story nezobrazuje)
        if (s.slot.endsWith('-story') && /text/i.test(String(e.message))) { args.text = item.name; res = await buffer('create_post', args); }
        else throw e;
      }
      const err = typeof res === 'string' ? res : (res.error || res.errors);
      if (typeof res === 'string' && /error|invalid|fail/i.test(res)) throw new Error(res.slice(0, 300));
      if (err) throw new Error(JSON.stringify(err).slice(0, 300));
      ok = true; info = typeof res === 'string' ? res.slice(0, 120) : (res.id || res.postId || JSON.stringify(res).slice(0, 120));
    } catch (e) { info = String(e.message).slice(0, 300); }
    console.log(`${ok ? 'OK ' : 'ERR'} ${id} ${s.slot} ${info}`);
    results.push({ id, slot: s.slot, ok, info, at: new Date().toISOString(), mode: DUE ? 'scheduled' : 'shareNow' });
    log.push(results[results.length - 1]);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 1) + '\n');
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`[KAMPAN] ${id}: ${results.length - bad.length}/${results.length} vydáno${bad.length ? ', selhalo: ' + bad.map((b) => b.slot).join(', ') : ''}`);
  if (bad.length) process.exit(2);
})().catch((e) => { console.error('[KAMPAN] CHYBA', e.message); process.exit(1); });
