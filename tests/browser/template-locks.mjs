import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-template-locks-"));
const port = 4330;
const baseUrl = "http://127.0.0.1:" + port;
const templates = [
  { name: "Blue Professional", decoration: ".cover-decoration" },
  { name: "Biennale Yellow", decoration: ".sunglow" },
  { name: "Cobalt Grid", decoration: ".pixel-glitch", svg: ".pixel-glitch svg" },
  { name: "Studio", decoration: ".cover-img-area" },
  { name: "Grove", decoration: ".accent", logo: 'img[alt="Grove 模板 Logo"]' },
];
const serverOutput = [];
const server = spawn(
  process.execPath,
  ["src/server.mjs", "--fixture", "--no-open", "--port", String(port), "--data-dir", dataDir],
  {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));
server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  for (const template of templates) {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
      template.name + " 锁定边界资格测试\n验证背景、装饰、SVG 和 Logo 不会进入内容编辑。",
    );
    await page.getByRole("radio", { name: new RegExp("^" + template.name + " —") }).check();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByTestId("preview").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByText("编辑模式", { exact: true }).waitFor();

    const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
    const firstSlide = editor.locator(".slide").first();
    await firstSlide.waitFor();
    const locked = page.locator("#selection-status", { hasText: "已锁定：这个元素不可编辑" });

    await firstSlide.click({ position: { x: 4, y: 4 }, force: true });
    assert.equal(await locked.isVisible(), true, template.name + " 背景点击必须显示锁定提示");
    await editor.locator(template.decoration).first().click({ position: { x: 2, y: 2 }, force: true });
    assert.equal(
      await locked.isVisible(),
      true,
      template.name + " 装饰点击必须显示锁定提示：" + template.decoration,
    );

    if (template.svg) {
      await editor.locator(template.svg).first().click({ position: { x: 2, y: 2 }, force: true });
      assert.equal(
        await locked.isVisible(),
        true,
        template.name + " SVG 点击必须显示锁定提示：" + template.svg,
      );
    }
    if (template.logo) {
      await editor.locator(template.logo).first().click({ position: { x: 2, y: 2 }, force: true });
      assert.equal(
        await locked.isVisible(),
        true,
        template.name + " Logo 点击必须显示锁定提示：" + template.logo,
      );
    }

    assert.equal(
      await page.locator("#text-controls").evaluate((element) => element.disabled),
      true,
      template.name + " 的非内容元素不得启用文字编辑",
    );
  }

  console.log("PASS: all five templates keep backgrounds and decorations locked; SVG and logo cases are covered");
} catch (error) {
  throw new Error(error.message + "\n\nServer output:\n" + serverOutput.join(""));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  throw new Error("Server did not become ready.\n" + serverOutput.join(""));
}
