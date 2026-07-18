import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-template-editor-nav-"));
const port = 4333;
const baseUrl = "http://127.0.0.1:" + port;
const templates = ["Blue Professional", "Biennale Yellow", "Cobalt Grid", "Studio", "Grove"];
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
      template + " 编辑页导航资格测试\n验证后续页面能够进入编辑画布。",
    );
    await page.getByRole("radio", { name: new RegExp("^" + template + " —") }).check();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByTestId("preview").waitFor({ timeout: 10_000 });
    const preview = page.frameLocator('iframe[title="演示文稿预览"]');
    const slideCount = await preview.locator(".slide").count();
    assert.ok(slideCount >= 2);

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
    await editor.locator(".slide").first().waitFor();
    const navigation = page.getByRole("navigation", { name: "编辑页导航" });
    assert.equal(
      await page.locator("#editor-slide-counter").textContent(),
      "1 / " + slideCount,
      template + " 编辑模式必须显示真实总页数",
    );
    await navigation.getByRole("button", { name: "下一页", exact: true }).click();
    assert.equal(
      await page.locator("#editor-slide-counter").textContent(),
      "2 / " + slideCount,
      template + " 编辑模式必须进入第 2 页",
    );
    assert.equal(
      await editor.locator(".slide").nth(1).isVisible(),
      true,
      template + " 第 2 页必须在编辑画布中可见",
    );
  }

  console.log("PASS: all five templates expose later pages through editor navigation");
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
