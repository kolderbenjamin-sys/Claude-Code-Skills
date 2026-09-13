// Render kampaňových šablon přes Chromium (playwright-core + lokální Chrome).
// Použití:
//   node render.js post  templates/k1-newsletter-post.html  out/k1-01-newsletter-post.png
//   node render.js story templates/k1-newsletter-story.html out/k1-01-newsletter-story.png
//   node render.js reel  templates/k1-newsletter-reel.html  out/k1-01-newsletter-reel.mp4  [sekundy=8] [fps=30]
const { existsSync, readdirSync } = require('fs');
function loadChromium() {
  for (const m of ['playwright', 'playwright-core']) { try { return require(m).chromium; } catch {} }
  const root = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, 'playwright')).chromium;
}
function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const win = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (existsSync(win)) return win;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const bin = path.join(base, d, 'chrome-linux', 'chrome'); if (existsSync(bin)) return bin;
  }
  return undefined;
}
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const SIZES = { post: [1080, 1350], story: [1080, 1920], reel: [1080, 1920], carousel: [1080, 1350] };

async function main() {
  const [kind, src, dst, secArg, fpsArg] = process.argv.slice(2);
  if (!SIZES[kind] || !src || !dst) { console.error('usage: node render.js <post|story|reel> <src.html> <dst> [sec] [fps]'); process.exit(1); }
  const [w, h] = SIZES[kind];
  fs.mkdirSync(path.dirname(dst), { recursive: true });

  const browser = await loadChromium().launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: kind === 'carousel' ? w + 80 : w, height: h }, deviceScaleFactor: 1 });
  await page.goto('file:///' + path.resolve(src).replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  if (kind === 'carousel') {
    // dst = prefix; každý .canvas se uloží jako prefix-1.png, prefix-2.png ...
    const slides = await page.$$('.canvas');
    for (let i = 0; i < slides.length; i++) {
      const out = `${dst}-${i + 1}.png`;
      await slides[i].screenshot({ path: out, type: 'png' });
      console.log('ok', out);
    }
  } else if (kind !== 'reel') {
    await page.screenshot({ path: dst, clip: { x: 0, y: 0, width: w, height: h }, type: 'png' });
    console.log('ok', dst);
  } else {
    const sec = Number(secArg || 8), fps = Number(fpsArg || 30);
    const frames = Math.round(sec * fps);
    const tmp = fs.mkdtempSync(path.join(path.dirname(dst), 'frames-'));
    // animace řídíme ručně: pauza + currentTime
    await page.evaluate(() => document.getAnimations().forEach(a => a.pause()));
    for (let i = 0; i < frames; i++) {
      const t = (i / fps) * 1000;
      await page.evaluate(ms => document.getAnimations().forEach(a => { a.currentTime = ms; }), t);
      await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: w, height: h } });
      if (i % 60 === 0) console.log(`frame ${i}/${frames}`);
    }
    const ff = spawnSync(FFMPEG, ['-y', '-framerate', String(fps), '-i', path.join(tmp, 'f%04d.jpg'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', '-an', dst], { encoding: 'utf8' });
    if (ff.status !== 0) { console.error(ff.stderr.slice(-2000)); process.exit(1); }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('ok', dst, `${sec}s @${fps}fps`);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
