// Renders template.html -> PNG (1080x1350) via headless Chromium.
// Usage: node render.js '{"category":"...","date":"...","title":"...","coverUrl":"...","logoUrl":"...","outPath":"..."}'
//
// Remote images (coverUrl, logoUrl) are fetched with Node's own https client and
// inlined as base64 data: URIs before handing the HTML to Chromium. Chromium's
// network stack behind this environment's HTTPS proxy has been observed to fail
// (net::ERR_CONNECTION_RESET) on requests it makes itself, even though the same
// URL fetched directly (curl, Node https) succeeds — so we avoid the browser
// fetching anything over the network at all.
const fs = require("fs");
const path = require("path");
const https = require("https");
const { chromium } = require("playwright");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fetchAsDataUri(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error(`Too many redirects for ${url}`));
          return resolve(fetchAsDataUri(res.headers.location, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        }
        const contentType = res.headers["content-type"] || "image/png";
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const b64 = Buffer.concat(chunks).toString("base64");
          resolve(`data:${contentType};base64,${b64}`);
        });
      })
      .on("error", reject);
  });
}

async function main() {
  const args = JSON.parse(process.argv[2]);
  const required = ["category", "date", "title", "coverUrl", "logoUrl", "outPath"];
  for (const k of required) {
    if (!args[k]) throw new Error(`Missing required arg: ${k}`);
  }

  const [coverDataUri, logoDataUri] = await Promise.all([
    fetchAsDataUri(args.coverUrl),
    fetchAsDataUri(args.logoUrl),
  ]);

  const templatePath = path.join(__dirname, "template.html");
  let html = fs.readFileSync(templatePath, "utf-8");
  html = html
    .replace("{{CATEGORY}}", escapeHtml(args.category))
    .replace("{{DATE}}", escapeHtml(args.date))
    .replace("{{TITLE}}", escapeHtml(args.title))
    .replace("{{COVER_URL}}", coverDataUri)
    .replace("{{LOGO_URL}}", logoDataUri);

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
