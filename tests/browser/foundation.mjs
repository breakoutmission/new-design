import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "foundation-"));
const port = 4318;
const baseUrl = `http://127.0.0.1:${port}`;
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

let serverExit = null;
server.once("exit", (code, signal) => {
  serverExit = { code, signal };
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.getByRole("button", { name: "新建项目" }).click();

  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    [
      "AI 演示工作流",
      "这是一个把中文产品材料制作成演示文稿的本地工具。",
      "用户选择模板后，由本机 Codex 一次性生成完整 HTML。",
    ].join("\n"),
  );
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();

  const stage = page.getByTestId("stage");
  await stage.waitFor();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });
  assert.equal(await stage.textContent(), "生成完成");

  const stageHistory = await page.getByTestId("stage-history").locator("li").allTextContents();
  assert.deepEqual(stageHistory, ["正在准备材料", "正在生成演示文稿", "正在检查 HTML", "生成完成"]);

  const details = page.getByTestId("technical-log");
  assert.equal(await details.getAttribute("open"), null, "技术日志默认应折叠");

  const previewFrameElement = page.locator('iframe[title="演示文稿预览"]');
  assert.equal(await previewFrameElement.getAttribute("sandbox"), "allow-scripts");
  const preview = page.frameLocator('iframe[title="演示文稿预览"]');
  const counter = preview.locator("[data-slide-counter]");
  await counter.waitFor();
  assert.equal(await counter.textContent(), "1 / 3");
  await preview.locator("body").press("ArrowRight");
  assert.equal(await counter.textContent(), "2 / 3");

  const security = await preview.locator("body").evaluate(async () => {
    let hostAccessBlocked = false;
    let networkBlocked = false;
    try {
      void parent.document.title;
    } catch {
      hostAccessBlocked = true;
    }
    try {
      await fetch("https://example.com", { mode: "no-cors" });
    } catch {
      networkBlocked = true;
    }
    const popupBlocked = window.open("about:blank") === null;
    return { hostAccessBlocked, networkBlocked, popupBlocked };
  });
  assert.deepEqual(security, {
    hostAccessBlocked: true,
    networkBlocked: true,
    popupBlocked: true,
  });

  await page.getByRole("button", { name: "返回首页" }).click();
  const projectCard = page.getByRole("article", { name: "AI 演示工作流" });
  await projectCard.waitFor();
  assert.match(await projectCard.textContent(), /可编辑/);
  assert.match(await projectCard.textContent(), /最后修改/);

  await mkdir(path.join(root, "output", "playwright"), { recursive: true });
  await page.screenshot({ path: path.join(root, "output", "playwright", "foundation-green.png"), fullPage: true });
  console.log("PASS: browser foundation flow completed through the public UI");
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverExit) {
      throw new Error(
        `Server exited before it became ready (${JSON.stringify(serverExit)}).\n${serverOutput.join("")}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Server did not become ready.\n${serverOutput.join("")}`);
}
