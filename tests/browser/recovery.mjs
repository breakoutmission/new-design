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
const dataDir = await mkdtemp(path.join(outputRoot, "recovery-"));
const port = 4321;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

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
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();
  const originalSource = [
    "取消生成演示",
    "[fixture:slow]",
    "这份材料应该在取消后原样保留。",
  ].join("\n");
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(originalSource);
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await page.getByTestId("stage").getByText("正在生成演示文稿", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消生成", exact: true }).click();
  await page.getByRole("heading", { name: "已取消", exact: true }).waitFor();
  await page.getByText("生成已取消，源材料和演示模板已保留。", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("preview").isHidden(), true, "取消后不得展示残缺 HTML");
  assert.equal(await page.getByRole("textbox", { name: "源材料", exact: true }).inputValue(), originalSource);
  assert.equal(await page.getByRole("radio", { name: /Grove/ }).isChecked(), true);
  assert.equal(
    (await readProjectByName(page, "取消生成演示")).generation.events.at(-1)?.type,
    "canceled",
    "取消终止事件必须落盘",
  );
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  const lateCancelSource = [
    "完成阶段取消演示",
    "[fixture:slow-finalize]",
    "即使生成子进程已经退出，已接受的取消也必须得到已取消状态。",
  ].join("\n");
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(lateCancelSource);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("stage").getByText("正在检查 HTML", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消生成", exact: true }).click();
  await page.getByRole("heading", { name: "已取消", exact: true }).waitFor();
  assert.equal(await page.getByTestId("preview").isHidden(), true, "完成阶段取消后不得展示 HTML");
  assert.equal(await page.getByRole("textbox", { name: "源材料", exact: true }).inputValue(), lateCancelSource);
  assert.equal(await page.getByRole("radio", { name: /Grove/ }).isChecked(), true);
  assert.equal(
    (await readProjectByName(page, "完成阶段取消演示")).generation.events.at(-1)?.type,
    "canceled",
    "完成阶段的取消终止事件必须落盘",
  );

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  const slowCommitSource = [
    "成功结果原子提交演示",
    "[fixture:slow-commit]",
    "完整 HTML 和成功终止事件必须一起对外可见。",
  ].join("\n");
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(slowCommitSource);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("stage").getByText("正在检查 HTML", { exact: true }).waitFor();
  await delay(250);
  const projectDuringCommit = await readProjectByName(page, "成功结果原子提交演示");
  assert.equal(projectDuringCommit.status, "生成中", "完整成功结果落盘前项目必须保持生成中");
  assert.equal(projectDuringCommit.html, null, "完整成功结果落盘前不得对外暴露 HTML");
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });
  assert.equal(
    (await readProjectByName(page, "成功结果原子提交演示")).generation.events.at(-1)?.type,
    "result",
  );

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  const failOnceSource = [
    "失败后重试演示",
    "[fixture:fail-once]",
    "第一次失败后必须用同一份材料重试。",
  ].join("\n");
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(failOnceSource);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await page.getByRole("heading", { name: "生成失败", exact: true }).waitFor({ timeout: 10_000 });
  await page.locator("#generation-message").getByText(/Codex 生成失败：测试生成器未能完成演示文稿。/).waitFor();
  assert.equal(await page.getByTestId("preview").isHidden(), true, "失败后不得展示残缺 HTML");
  assert.equal(await page.getByRole("textbox", { name: "源材料", exact: true }).inputValue(), failOnceSource);
  assert.equal(await page.getByRole("radio", { name: /Grove/ }).isChecked(), true);
  assert.equal(
    (await readProjectByName(page, "失败后重试演示")).generation.events.at(-1)?.type,
    "error",
    "失败终止事件必须落盘",
  );

  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });
  assert.equal(
    (await readProjectByName(page, "失败后重试演示")).generation.events.at(-1)?.type,
    "result",
    "成功终止事件必须落盘",
  );

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    ["后台慢速生成", "[fixture:slow]", "[fixture:slow-delete]", "生成期间其他项目仍然可编辑。"].join("\n"),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("stage").getByText("正在生成演示文稿", { exact: true }).waitFor();

  const externalPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await externalPage.goto(baseUrl);
  await externalPage.getByRole("article", { name: "失败后重试演示" }).click();
  await externalPage.getByRole("button", { name: "编辑", exact: true }).click();
  const externalEditor = externalPage.frameLocator('iframe[title="演示文稿编辑画布"]');
  await externalEditor.getByRole("heading", { level: 1 }).first().click();
  await externalPage.getByRole("textbox", { name: "文字内容", exact: true }).fill("跨页面拒绝后仍保留的编辑");
  await externalPage.getByRole("button", { name: "重新生成", exact: true }).click();
  await externalPage.getByRole("button", { name: "确认重新生成", exact: true }).click();
  await externalPage
    .locator("#toast")
    .getByText("当前已有演示文稿正在生成，请等待完成或先取消。", { exact: true })
    .waitFor();
  assert.equal(await externalPage.getByText("编辑模式", { exact: true }).isVisible(), true);
  assert.equal(
    await externalPage.getByRole("textbox", { name: "文字内容", exact: true }).inputValue(),
    "跨页面拒绝后仍保留的编辑",
    "服务端拒绝重新生成后不得隐藏或销毁未保存编辑",
  );
  await externalPage.close();

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "失败后重试演示" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const otherProjectEditor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await otherProjectEditor.getByRole("heading", { level: 1 }).first().click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("生成期间保留的未保存编辑");
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  assert.equal(
    await page.getByRole("heading", { name: "重新生成并覆盖当前内容？", exact: true }).isHidden(),
    true,
    "已有生成任务时不应打开覆盖确认框",
  );
  await page.locator("#toast").getByText("当前已有演示文稿正在生成，请等待完成或先取消。", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "文字内容", exact: true }).inputValue(),
    "生成期间保留的未保存编辑",
    "被拒绝的重新生成不得销毁其他项目的编辑",
  );

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    ["不应启动第二任务", "同一时刻只能运行一个生成任务。"].join("\n"),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator("#toast").getByText("当前已有演示文稿正在生成，请等待完成或先取消。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返回首页" }).click();
  assert.equal(await page.getByRole("article", { name: "不应启动第二任务" }).count(), 0);

  await page.getByRole("article", { name: "失败后重试演示" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  await page.locator("#toast").getByText("后台慢速生成 生成完成", { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await page.locator("#preview-title").textContent(), "失败后重试演示");
  assert.equal(await page.getByText("编辑模式", { exact: true }).isVisible(), true);

  await page.getByRole("button", { name: "返回首页" }).click();
  const deletableCard = page.getByRole("article", { name: "失败后重试演示" });
  await deletableCard.getByRole("button", { name: "删除项目 失败后重试演示", exact: true }).click();
  await page.getByRole("heading", { name: "永久删除演示项目？", exact: true }).waitFor();
  await page.getByText("“失败后重试演示”将从本机永久删除，且无法恢复。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await deletableCard.isVisible(), true);

  await deletableCard.getByRole("button", { name: "删除项目 失败后重试演示", exact: true }).click();
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await deletableCard.waitFor({ state: "detached" });

  await page.getByRole("article", { name: "取消生成演示" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const regenerationEditor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await regenerationEditor.getByRole("heading", { level: 1 }).first().click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("将被覆盖的编辑");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();

  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await page.getByRole("heading", { name: "重新生成并覆盖当前内容？", exact: true }).waitFor();
  await page
    .getByText("将复用原源材料和 Grove 模板，覆盖当前 HTML 和已有编辑。", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    await page
      .frameLocator('iframe[title="演示文稿预览"]')
      .getByRole("heading", { level: 1 })
      .first()
      .textContent(),
    "将被覆盖的编辑",
  );

  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await page.getByRole("button", { name: "确认重新生成", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "源材料", exact: true }).inputValue(), originalSource);
  assert.equal(await page.getByRole("radio", { name: /Grove/ }).isChecked(), true);
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });
  assert.equal(
    await page
      .frameLocator('iframe[title="演示文稿预览"]')
      .getByRole("heading", { level: 1 })
      .first()
      .textContent(),
    "AI 演示工作流",
  );

  const rivalPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await rivalPage.goto(baseUrl);
  await rivalPage.getByRole("article", { name: "后台慢速生成" }).click();
  await rivalPage.getByTestId("preview").waitFor();

  await page.getByRole("button", { name: "返回首页" }).click();
  const slowDeleteCard = page.getByRole("article", { name: "后台慢速生成" });
  await slowDeleteCard.getByRole("button", { name: "删除项目 后台慢速生成", exact: true }).click();
  await page.getByRole("heading", { name: "永久删除演示项目？", exact: true }).waitFor();
  const deleteRequest = page.waitForRequest(
    (request) => request.method() === "DELETE" && request.url().includes("/api/projects/"),
  );
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await deleteRequest;
  await delay(250);

  await rivalPage.getByRole("button", { name: "重新生成", exact: true }).click();
  await rivalPage.getByRole("button", { name: "确认重新生成", exact: true }).click();
  await rivalPage
    .locator("#toast")
    .getByText("这个项目正在执行其他操作，请稍后再试。", { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.locator("#toast").getByText("项目已永久删除", { exact: true }).waitFor();
  await slowDeleteCard.waitFor({ state: "detached" });
  await rivalPage.getByRole("button", { name: "返回首页" }).click();
  assert.equal(await rivalPage.getByRole("article", { name: "后台慢速生成" }).count(), 0);

  await mkdir(path.join(root, "output", "playwright"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "output", "playwright", "issue-4-recovery-green.png"),
    fullPage: true,
  });
  console.log("PASS: every Issue #4 recovery and protected-operation flow works through the public UI");
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
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

async function readProjectByName(page, name) {
  return page.evaluate(async (projectName) => {
    const projects = await fetch("/api/projects").then((response) => response.json());
    const summary = projects.find((project) => project.name === projectName);
    if (!summary) throw new Error("没有找到验收项目：" + projectName);
    return fetch("/api/projects/" + encodeURIComponent(summary.id)).then((response) => response.json());
  }, name);
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
