// Renders template.html -> PNG (1080x1350) via headless Chromium.
// Usage: node render.js '{"category":"...","date":"...","title":"...","coverUrl":"...","logoUrl":"...","outPath":"..."}'
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function main() {
  const args = JSON.parse(process.argv[2]);
  const required = ["category", "date", "title", "coverUrl", "logoUrl", "outPath"];
  for (const k of required) {
    if (!args[k]) throw new Error(`Missing required arg: ${k}`);
  }

  const templatePath = path.join(__dirname, "template.html");
  let html = fs.readFileSync(templatePath, "utf-8");
  html = html
    .replace("{{CATEGORY}}", escapeHtml(args.category))
    .replace("{{DATE}}", escapeHtml(args.date))
    .replace("{{TITLE}}", escapeHtml(args.title))
    .replace("{{COVER_URL}}", args.coverUrl)
    .replace("{{LOGO_URL}}", args.logoUrl);

  const tmpHtml = path.join(__dirname, `_render_${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html, "utf-8");

  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await page.goto("file://" + tmpHtml, { waitUntil: "networkidle" });
    await page.screenshot({ path: args.outPath });
  } finally {
    await browser.close();
    fs.unlinkSync(tmpHtml);
  }
  console.log("OK", args.outPath);
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
