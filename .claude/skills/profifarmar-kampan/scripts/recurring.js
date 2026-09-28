// Opakované rubriky (manifest.recurring): kus se vytvoří z pravidla podle dne v týdnu, bez ručního zápisu do manifestu.
// ID = <prefix>-<ISO rok>-<ISO týden>, např. K2-top5-2026-41. Do manifestu se zapíše až při set-item.js (historie).
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z'); const n = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - n);
  const y = d.getUTCFullYear(), w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return { y, w };
}
function fromRule(r, date) {
  const { y, w } = isoWeek(date);
  const sub = (s) => String(s || '').replace(/\{w\}/g, w).replace(/\{y\}/g, y);
  return { id: `${r.prefix}-${y}-${String(w).padStart(2, '0')}`, date, time: r.time, campaign: r.campaign, generate: r.generate,
    week: w, name: sub(r.name), yt_title: sub(r.yt_title), link: r.link, alt: sub(r.alt), recurring: r.prefix };
}
// Kusy z pravidel pro dané datum (weekday: 0 = neděle ... 6 = sobota), jen pravidla enabled a v rozsahu from/until.
function expand(m, date) {
  const wd = new Date(date + 'T12:00:00Z').getUTCDay();
  return (m.recurring || []).filter((r) => r.enabled !== false && r.weekday === wd && (!r.from || date >= r.from) && (!r.until || date <= r.until))
    .map((r) => fromRule(r, date));
}
// Najde pravidlo podle ID (K2-top5-2026-41) a vrátí kus pro jeho datum.
function byId(m, id) {
  const mm = id.match(/^(.*)-(\d{4})-(\d{2})$/); if (!mm) return null;
  const r = (m.recurring || []).find((x) => x.prefix === mm[1]); if (!r) return null;
  // den v daném ISO týdnu: pondělí týdne + (weekday-1), neděle = +6
  const jan4 = new Date(Date.UTC(+mm[2], 0, 4)); const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (+mm[3] - 1) * 7);
  const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + ((r.weekday || 7) - 1));
  return fromRule(r, d.toISOString().slice(0, 10));
}
module.exports = { expand, byId, isoWeek };
