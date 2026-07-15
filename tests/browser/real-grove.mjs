import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "real-acceptance");
await mkdir(outputRoot, { recursive: true });
const reuseLatest = process.argv.includes("--reuse-latest");
const replayProject = reuseLatest ? await findLatestRealProject() : null;
const dataDir = await mkdtemp(path.join(outputRoot, "grove-"));
const replayPath = path.join(dataDir, "real-grove-replay.html");
if (replayProject) await writeFile(replayPath, replayProject.html, "utf8");
const port = 4320;
const baseUrl = "http://127.0.0.1:" + port;
const serverOutput = [];
const browserOutput = [];

const serverArgs = ["src/server.mjs", "--no-open", "--port", String(port), "--data-dir", dataDir];
if (replayProject) serverArgs.push("--fixture", "--fixture-file", replayPath);
const server = spawn(
  process.execPath,
  serverArgs,
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
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    [
      "AI Presentation Studio 一周 MVP",
      "",
      "目标用户是不懂 HTML 和 CSS、但需要把中文产品项目材料制作成演示文稿的人。",
      "用户双击启动本地应用，在首页新建项目，把中文材料粘贴到一个文本框，选择 Grove 模板后点击发送。",
      "应用调用本机已经登录的 Codex，一次生成完整 HTML，不进入聊天，也不追问。",
      "生成时显示准备材料、生成演示文稿、检查 HTML 和生成完成四个阶段。",
      "合格结果进入安全预览，允许使用按钮和键盘左右方向键翻页。",
      "后续版本将支持文字编辑、普通图片拖动缩放、保存、重新打开，以及 HTML 和 PDF 导出。",
      "一周目标是在当前 Windows 电脑上，用真实材料完整演示核心链路。",
    ].join("\n"),
  );
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await page
    .getByTestId("preview")
    .waitFor({ timeout: replayProject ? 30_000 : 12 * 60 * 1000 });
  const history = await page.getByTestId("stage-history").locator("li").allTextContents();
  assert.deepEqual(history, ["正在准备材料", "正在生成演示文稿", "正在检查 HTML", "生成完成"]);

  const preview = page.frameLocator('iframe[title="演示文稿预览"]');
  const slides = preview.locator(".slide");
  await slides.first().waitFor({ timeout: 30_000 });
  const slideCount = await slides.count();
  const editableImageCount = await preview.locator("img[data-editable-image]").count();
  assert.ok(slideCount >= 2, "真实 Grove 结果必须包含至少两页");
  assert.ok(editableImageCount >= 1, "真实 Grove 结果必须包含普通内容图片");
  const counter = preview.locator("[data-slide-counter]");
  await counter.waitFor({ timeout: 30_000 });
  assert.match(await counter.textContent(), /^1\s*\/\s*\d+$/);
  assert.ok(await counter.isVisible(), "当前页码必须对用户可见");

  await mkdir(path.join(root, "output", "playwright"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "output", "playwright", "real-grove-foundation.png"),
    fullPage: true,
  });
  console.log(
    "PASS: " +
      (replayProject ? "replayed real Grove output" : "real Grove generation") +
      " reached safe preview with " +
      slideCount +
      " slides and " +
      editableImageCount +
      " editable image(s)",
  );
  if (browserOutput.length) console.log(browserOutput.join("\n"));
} catch (error) {
  throw new Error(
    error.message +
      "\n\nServer output:\n" +
      serverOutput.join("") +
      "\nBrowser output:\n" +
      browserOutput.join("\n"),
  );
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverExit) {
      throw new Error(
        "Server exited before it became ready (" +
          JSON.stringify(serverExit) +
          ").\n" +
          serverOutput.join(""),
      );
    }
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

async function findLatestRealProject() {
  const directories = (await readdir(outputRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outputRoot, entry.name));
  const dated = await Promise.all(
    directories.map(async (directory) => ({ directory, modified: (await stat(directory)).mtimeMs })),
  );
  dated.sort((left, right) => right.modified - left.modified);

  for (const item of dated) {
    const projectsDir = path.join(item.directory, "projects");
    try {
      const projectFiles = (await readdir(projectsDir)).filter((name) => name.endsWith(".json"));
      for (const name of projectFiles) {
        const project = JSON.parse(await readFile(path.join(projectsDir, name), "utf8"));
        if (project.generation?.mode === "codex" && project.status === "可编辑" && project.html) {
          return project;
        }
      }
    } catch {
      // This test directory did not reach a saved project.
    }
  }
  throw new Error("没有找到可以回放的真实 Grove 生成结果。");
}
