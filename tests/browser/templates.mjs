import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-five-templates-"));
const port = 4326;
const baseUrl = "http://127.0.0.1:" + port;
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
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();

  const templateOptions = page.getByRole("radio");
  assert.equal(
    await templateOptions.count(),
    5,
    "新建项目页面必须恰好提供五个首发模板",
  );
  assert.deepEqual(
    await templateOptions.evaluateAll((radios) => radios.map((radio) => radio.getAttribute("aria-label"))),
    [
      "Grove — 森林绿画布、米白文字、古典衬线标题和少量锈红强调色。",
      "Blue Professional — 米白纸张、亮钴蓝强调和现代无衬线商务版式。",
      "Biennale Yellow — 高饱和黄色画布、黑色编辑式排版和艺术展览海报结构。",
      "Cobalt Grid — 奶油色网格纸、钴蓝衬线标题和严谨的研究出版物结构。",
      "Studio — 近黑画布、电光黄文字和高对比设计工作室构图。",
    ],
    "五个选项必须使用可辨认的模板名称和视觉说明",
  );

  console.log("PASS: new-project flow exposes exactly five distinct launch templates");
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
