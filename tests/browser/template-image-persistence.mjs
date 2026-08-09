import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-template-image-"));
const port = 4329;
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
    const projectName = template + " 图片持久化资格测试";
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
      projectName + "\n验证普通内容图片拖动、保存与重开。",
    );
    await page.getByRole("radio", { name: new RegExp("^" + template + " —") }).check();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByTestId("preview").waitFor({ timeout: 10_000 });

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByText("编辑模式", { exact: true }).waitFor();
    const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
    await editor.locator(".slide").first().waitFor();
    if (template === "Grove") {
      await page
        .getByRole("navigation", { name: "编辑页导航" })
        .getByRole("button", { name: "下一页", exact: true })
        .click();
    }
    const editableImage = editor.locator("img[data-editable-image]").first();
    await editableImage.waitFor({ state: "visible" });
    await editableImage.click();
    await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-resize-handle]").count(), 4);

    const before = await editableImage.boundingBox();
    assert.ok(before, template + " 普通内容图片必须在编辑画布中可见");
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 - 40, before.y + before.height / 2 + 30, {
      steps: 6,
    });
    await page.mouse.up();
    const after = await editableImage.boundingBox();
    assert.ok(after);
    assert.ok(
      Math.abs(after.x - before.x) > 10 || Math.abs(after.y - before.y) > 10,
      template + " 必须允许拖动普通内容图片",
    );
    const savedState = await readImageState(editableImage);

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存成功", { exact: true }).waitFor();
    await page.getByRole("button", { name: "完成编辑", exact: true }).click();
    await page.getByText("预览模式", { exact: true }).waitFor();
    let preview = page.frameLocator('iframe[title="演示文稿预览"]');
    if (template === "Grove") await preview.locator("body").press("ArrowRight");
    const completedImage = preview.locator("img[data-editable-image]").first();
    await completedImage.waitFor({ state: "visible" });
    assertImageState(await readImageState(completedImage), savedState, template + " 完成编辑预览");

    await page.getByRole("button", { name: "返回首页" }).click();
    await page.getByRole("article", { name: projectName }).click();
    await page.getByText("预览模式", { exact: true }).waitFor();
    preview = page.frameLocator('iframe[title="演示文稿预览"]');
    if (template === "Grove") await preview.locator("body").press("ArrowRight");
    const reopenedImage = preview.locator("img[data-editable-image]").first();
    await reopenedImage.waitFor({ state: "visible" });
    assertImageState(await readImageState(reopenedImage), savedState, template + " 重新打开");
  }

  console.log("PASS: all five templates preserve visible image moves after save and reopen");
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

async function readImageState(image) {
  return image.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      left: Number.parseFloat(computed.left),
      top: Number.parseFloat(computed.top),
      width: Number.parseFloat(computed.width),
      height: Number.parseFloat(computed.height),
    };
  });
}

function assertImageState(actual, expected, label) {
  for (const property of ["left", "top", "width", "height"]) {
    assert.ok(
      Math.abs(actual[property] - expected[property]) < 2,
      label + " 必须保留图片 " + property + "，实际 " + actual[property] + "，预期 " + expected[property],
    );
  }
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
