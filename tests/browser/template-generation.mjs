import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-template-generation-"));
const port = 4327;
const baseUrl = "http://127.0.0.1:" + port;
const candidates = [
  { name: "Blue Professional", surface: "body", expectedBackground: "rgb(253, 250, 231)" },
  { name: "Biennale Yellow", surface: ".stage", expectedBackground: "rgb(233, 229, 219)" },
  { name: "Cobalt Grid", surface: ".stage", expectedBackground: "rgb(240, 235, 222)" },
  { name: "Studio", surface: ".slide", expectedBackground: "rgb(28, 28, 28)" },
  { name: "Grove", surface: ".slide", expectedBackground: "rgb(25, 43, 27)" },
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

  for (const candidate of candidates) {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "新建项目" }).click();
    await page
      .getByRole("textbox", { name: "源材料", exact: true })
      .fill(candidate.name + " 固定资格测试\n验证模板能够生成并进入安全预览。");
    await page.getByRole("radio", { name: new RegExp("^" + candidate.name + " —") }).check();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByTestId("preview").waitFor({ timeout: 10_000 });

    const preview = page.frameLocator('iframe[title="演示文稿预览"]');
    const firstSlide = preview.locator(candidate.surface).first();
    await firstSlide.waitFor();
    assert.equal(
      await firstSlide.evaluate((slide) => getComputedStyle(slide).backgroundColor),
      candidate.expectedBackground,
      candidate.name + " 必须保留自己的代表性画布颜色，而不是复用 Grove 外观",
    );
    assert.ok(
      (await preview.locator("img[data-editable-image]").count()) >= 1,
      candidate.name + " 必须提供自包含普通内容图片",
    );
  }

  console.log("PASS: every launch template reaches a visually distinct safe preview");
} catch (error) {
  throw new Error(error.message + "\n\nServer output:\n" + serverOutput.join(""));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill();
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
