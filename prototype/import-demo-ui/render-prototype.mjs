// 渲染原型截图：逐屏打开 prototype.html?screen=N 并截图到 screens/。
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "screens");
await mkdir(outDir, { recursive: true });
const fileUrl = pathToFileURL(path.join(here, "prototype.html")).href;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const total = 12;
for (let i = 1; i <= total; i += 1) {
  await page.goto(`${fileUrl}?screen=${i}`);
  await page.locator("#screens .app").first().waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, `screen-${String(i).padStart(2, "0")}.png`) });
  console.log("shot", `screen-${String(i).padStart(2, "0")}.png`);
}
await browser.close();
console.log("DONE");
