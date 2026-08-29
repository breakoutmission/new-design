// 基线截图脚本（只读）：截取现有应用 4 个页面作为原型设计依据。
// 只做打开/查看/截图，不保存、不删除、不重新生成任何真实项目。
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "reference");
await mkdir(outDir, { recursive: true });
const baseUrl = "http://127.0.0.1:4318";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(15_000);

try {
  // ① 首页（项目中心）
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, "01-home.png") });
  console.log("shot 01-home");

  // ② 新建演示页
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.locator("#source").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "02-new.png") });
  console.log("shot 02-new");

  // ③ 安全预览页（打开最近项目，只读查看）
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article").first().waitFor();
  await page.getByRole("article").first().click();
  await page.locator('iframe[title="演示文稿预览"]').waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, "03-preview.png") });
  console.log("shot 03-preview");

  // ④ 编辑模式
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator('[data-testid="editor-canvas"], #gjs').first().waitFor();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(outDir, "04-edit.png") });
  console.log("shot 04-edit");
} finally {
  await browser.close();
}
console.log("DONE");
