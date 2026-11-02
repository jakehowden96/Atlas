// Usage: node scripts/gallery-shots.mjs [--section <id>] [--width 1100]
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const only = opt("section");
const width = Number(opt("width", 1100));

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch {
  console.log("Chrome is not installed; skipping gallery screenshots.");
  process.exit(0);
}

const server = await createServer({
  configFile: "vite.gallery.config.ts",
  logLevel: "error",
});
await server.listen();
const url = server.resolvedUrls.local[0];
mkdirSync("gallery-shots", { recursive: true });

const page = await browser.newPage({
  viewport: { width: width + 300, height: 900 },
});
await page.goto(url + "gallery.html");
await page.locator("select").nth(1).selectOption(String(width));
const ids = await page.$$eval(".anchor", (els) => els.map((e) => e.id));
for (const theme of ["light", "dark"]) {
  await page.locator("select").nth(0).selectOption(theme);
  for (const id of ids) {
    if (only && id !== only) continue;
    const path = `gallery-shots/${id}-${theme}-${width}.png`;
    await page.locator(`[id="${id}"]`).screenshot({ path });
    console.log(path);
  }
}
await browser.close();
await server.close();
