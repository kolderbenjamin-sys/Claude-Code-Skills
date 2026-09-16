#!/usr/bin/env node
// Vydá jeden kus kampaně z manifest.json přes Buffer (shareNow) na IG + FB + YT
// a OVĚŘÍ, že post skutečně odešel (get_post → status sent), ne jen že ho Buffer přijal.
//
//   node publish.js <manifest.json> <log.json> <ID> [--dry] [--due 2026-10-20T15:00:00Z] [--only ig-post,fb-story,...] [--wait 480]
//
// Formáty podle obsahu kusu: ig-post (carousel nebo 1 obrázek), ig-story, ig-reel,
// fb-post, fb-story, fb-reel, yt-reel (short). Co už je v logu jako ok, se přeskočí (idempotentní).
// Obrázky jdou vždy jako JPEG (Cloudinary f_jpg v URL): Instagram odmítl PNG story
// "There is an issue with the media included" 14. 9. 2026, FB stejný PNG vzal.
// Když post skončí na Bufferu ve stavu error, až 2x se smaže a pošle znovu (s prodlevou mezi pokusy -
// selhání u videí je nekonzistentní fetch z Cloudinary přes Metu, ne vada souboru, viz 16. 9. 2026:
// stejné video jednou prošlo, podruhé ne). Po 3. pokusu = chyba (exit 2).
// Proč Node a ne bash+jq: payloady pro Buffer jsou vnořené JSONy, v Node se skládají bez escapování.
const fs = require('fs');
const [manifestPath, logPath, id, ...flags] = process.argv.slice(2);
if (!manifestPath || !logPath || !id) { console.error('usage: publish.js <manifest> <log> <ID> [--dry] [--due ISO] [--only a,b] [--wait s]'); process.exit(1); }
const opt = (n) => { const i = flags.indexOf(n); return i >= 0 ? flags[i + 1] : null; };
const DRY = flags.includes('--dry'), DUE = opt('--due'), ONLY = (opt('--only') || '').split(',').filter(Boolean);
const WAIT = Number(opt('--wait') || 480) * 1000; // jak dlouho max čekat na status sent (reely a YT trvají 2 až 6 min)
const TOKEN = process.env.BUFFER_API_KEY;
if (!TOKEN && !DRY) { console.error('[KAMPAN] CHYBA - BUFFER_API_KEY chybí (viz SECRETS.md)'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const item = manifest.items.find((x) => x.id === id);
if (!item) { console.error(`[KAMPAN] kus ${id} v manifestu není`); process.exit(1); }
if (!item.images || !item.images.length) { console.error(`[KAMPAN] kus ${id} nemá vyrenderované soubory (generate=${item.generate || '-'})`); process.exit(1); }
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
const done = new Set(log.filter((l) => l.id === id && l.ok).map((l) => l.slot));
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function buffer(name, args) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  let raw;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch('https://mcp.buffer.com/mcp', { method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        body: JSON.stringify(body) });
      raw = await r.text(); break;
    } catch (e) { if (attempt === 2) throw e; await sleep(5000); }
  }
  const data = raw.split('\n').filter((l) => l.startsWith('data: ')).pop();
  const j = JSON.parse(data ? data.slice(6) : raw);
  if (j.error) throw new Error('BUFFER_ERROR ' + JSON.stringify(j.error));
  const txt = j.result?.content?.[0]?.text ?? '';
  try { return JSON.parse(txt); } catch { return txt; }
}

// Cloudinary: PNG → JPEG přímo v URL, žádný nový upload. fl_progressive:none = baseline JPEG,
// protože q_auto progresivní JPEG Instagram Graph API odmítá ("issue with the media", FB ho bez problému vezme).
const jpg = (url) => /res\.cloudinary\.com\/[^/]+\/image\/upload\/(?!.*f_jpg)/.test(url) ? url.replace('/image/upload/', '/image/upload/f_jpg,q_auto:good,fl_progressive:none/') : url;
const img = (url) => ({ image: { url: jpg(url), metadata: { altText: item.alt || item.name } } });
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

function postId(res) { return typeof res === 'string' ? null : (res.id || res.postId || null); }

async function create(s) {
  const args = { channelId: s.ch, text: s.text, assets: s.assets, schedulingType: 'automatic', metadata: s.meta,
    ...(DUE ? { mode: 'customScheduled', dueAt: DUE } : { mode: 'shareNow' }) };
  let res;
  try { res = await buffer('create_post', args); }
  catch (e) {
    // story bez textu: když to Buffer odmítne, pošli název kusu (text se u story nezobrazuje)
    if (s.slot.endsWith('-story') && /text/i.test(String(e.message))) { args.text = item.name; res = await buffer('create_post', args); }
    else throw e;
  }
  if (typeof res === 'string' && /error|invalid|fail/i.test(res)) throw new Error(res.slice(0, 300));
  if (res.error || res.errors) throw new Error(JSON.stringify(res.error || res.errors).slice(0, 300));
  const pid = postId(res);
  if (!pid) throw new Error('create_post bez id: ' + JSON.stringify(res).slice(0, 200));
  return pid;
}

// Čeká, až post na Bufferu skončí: sent = ok, error = chyba, jinak po timeoutu pending.
async function finalStatus(pid, deadline) {
  let last = '';
  while (Date.now() < deadline) {
    try {
      const p = await buffer('get_post', { postId: pid });
      last = p.status || '';
      if (last === 'sent') return { status: 'sent' };
      if (last === 'error') return { status: 'error', error: (p.error && (p.error.message || JSON.stringify(p.error))) || 'Buffer error' };
    } catch (e) { last = 'get_post: ' + e.message; }
    await sleep(15000);
  }
  return { status: 'pending', error: last };
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
  if (DRY) { for (const s of todo) console.log(`--- ${s.slot}\n${JSON.stringify({ channelId: s.ch, text: s.text, assets: s.assets, metadata: s.meta }, null, 1)}`); return; }

  // 1) vytvoř všechny posty
  const results = [];
  for (const s of todo) {
    const r = { id, slot: s.slot, ok: false, postId: null, status: '', info: '', at: new Date().toISOString(), mode: DUE ? 'scheduled' : 'shareNow', retried: false };
    try { r.postId = await create(s); r.status = 'created'; console.log(`created ${s.slot} ${r.postId}`); }
    catch (e) { r.status = 'create_failed'; r.info = String(e.message).slice(0, 300); console.log(`ERR ${s.slot} create: ${r.info}`); }
    results.push(r);
  }
  const save = () => fs.writeFileSync(logPath, JSON.stringify([...log, ...results], null, 1) + '\n');
  save();
  if (DUE) { for (const r of results) if (r.postId) r.ok = true; save(); console.log(`[KAMPAN] ${id}: naplánováno ${results.filter((r) => r.ok).length}/${results.length}`); return; }

  // 2) ověř skutečný stav; při error až 2x smaž a pošli znovu, s prodlevou (dej přechodné chybě šanci zmizet)
  const deadline = Date.now() + WAIT;
  const MAX_RETRIES = 2, RETRY_DELAY = 90000;
  for (const r of results) {
    if (!r.postId) continue;
    let f = await finalStatus(r.postId, deadline);
    let tries = 0;
    while (f.status === 'error' && tries < MAX_RETRIES) {
      tries++;
      console.log(`retry ${tries}/${MAX_RETRIES} ${r.slot}: ${f.error}`);
      try { await buffer('delete_post', { postId: r.postId }); } catch {}
      r.retried = true; r.info = (r.info ? r.info + ' | ' : '') + `pokus ${tries}: ` + f.error;
      await sleep(RETRY_DELAY);
      try { r.postId = await create(todo.find((s) => s.slot === r.slot)); f = await finalStatus(r.postId, Math.max(deadline, Date.now() + 180000)); }
      catch (e) { f = { status: 'error', error: e.message }; }
    }
    r.status = f.status; r.ok = f.status === 'sent' || f.status === 'pending';
    if (f.status !== 'sent') r.info = (r.info ? r.info + ' | ' : '') + String(f.error || '').slice(0, 300);
    console.log(`${f.status === 'sent' ? 'OK ' : f.status === 'pending' ? 'WAIT' : 'ERR'} ${id} ${r.slot} ${r.postId} ${f.status}${r.info ? ' ' + r.info : ''}`);
    save();
  }
  const bad = results.filter((r) => !r.ok), pend = results.filter((r) => r.status === 'pending');
  console.log(`[KAMPAN] ${id}: ${results.length - bad.length}/${results.length} odesláno${pend.length ? ` (${pend.map((p) => p.slot).join(', ')} ještě zpracovává Buffer, zkontroluj get_post)` : ''}${bad.length ? ', selhalo: ' + bad.map((b) => b.slot + ' (' + b.info + ')').join(', ') : ''}`);
  if (bad.length) process.exit(2);
})().catch((e) => { console.error('[KAMPAN] CHYBA', e.message); process.exit(1); });
