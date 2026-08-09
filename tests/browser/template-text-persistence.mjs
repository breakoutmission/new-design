import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-template-text-"));
const port = 4328;
const baseUrl = "http://127.0.0.1:" + port;
const templates = ["Blue Professional", "Biennale Yellow", "Cobalt Grid", "Studio", "Grove"];
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

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  for (const template of templates) {
    const projectName = template + " 文字持久化资格测试";
    const editedText = template + " 已保存文字";
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
      projectName + "\n验证模板文字编辑、保存与重开。",
    );
    await page.getByRole("radio", { name: new RegExp("^" + template + " —") }).check();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByTestId("preview").waitFor({ timeout: 10_000 });

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByText("编辑模式", { exact: true }).waitFor();
    const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
    const firstSlide = editor.locator(".slide").first();
    await firstSlide.waitFor();
    const editableText = firstSlide.locator("h1,h2,h3,h4,h5,h6,p").first();
    await editableText.click();
    await page.getByText("已选中文字", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "文字内容", exact: true }).fill(editedText);
    assert.equal(await editableText.textContent(), editedText, template + " 必须允许修改普通内容文字");

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存成功", { exact: true }).waitFor();
    await page.getByRole("button", { name: "完成编辑", exact: true }).click();
    await page.getByText("预览模式", { exact: true }).waitFor();
    const preview = page.frameLocator('iframe[title="演示文稿预览"]');
    await preview.getByText(editedText, { exact: true }).waitFor();

    await page.getByRole("button", { name: "返回首页" }).click();
    await page.getByRole("article", { name: projectName }).click();
    await page.getByText("预览模式", { exact: true }).waitFor();
    await preview.getByText(editedText, { exact: true }).waitFor();
  }

  console.log("PASS: all five templates preserve visible text edits after save and reopen");
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
