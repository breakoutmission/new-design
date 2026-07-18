import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-template-image-gate-"));
const fixturePath = path.join(dataDir, "external-image.html");
await writeFile(
  fixturePath,
  [
    "<!doctype html><html><head><style>",
    ".slide{width:1280px;height:720px}.slide img{width:320px;height:180px}",
    "</style></head><body>",
    '<main class="slide"><h1>外部图片不兼容</h1>',
    '<img data-editable-image="true" alt="外部普通内容图片" src="https://example.com/content.png"></main>',
    '<section class="slide"><h2>第二页</h2></section>',
    "</body></html>",
  ].join(""),
  "utf8",
);

const port = 4332;
const baseUrl = "http://127.0.0.1:" + port;
const serverOutput = [];
const server = spawn(
  process.execPath,
  [
    "src/server.mjs",
    "--fixture",
    "--fixture-file",
    fixturePath,
    "--no-open",
    "--port",
    String(port),
    "--data-dir",
    dataDir,
  ],
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

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill("外部图片兼容性闸门");
  await page.getByRole("radio", { name: /^Blue Professional —/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await page.getByRole("heading", { name: "生成失败", exact: true }).waitFor({ timeout: 10_000 });
  await page.locator("#generation-message").getByText(/普通内容图片必须使用自包含 data:image/).waitFor();
  assert.equal(await page.getByTestId("preview").isHidden(), true, "不兼容图片不得进入安全预览");

  console.log("PASS: external ordinary content images are rejected before preview");
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
