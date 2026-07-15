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
const port = 4319;
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
  await page.getByText("预览模式", { exact: true }).waitFor({ timeout: 2_000 });
  await page.getByRole("button", { name: "返回首页" }).click();
  const reopeningCard = page.getByRole("article", { name: "AI 演示工作流" });
  await reopeningCard.waitFor();
  const initialModifiedLabel = await reopeningCard.locator(".project-meta").textContent();
  await reopeningCard.click();
  await page.getByTestId("preview").waitFor({ timeout: 2_000 });
  await page.getByText("预览模式", { exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  await page.getByTestId("editor-canvas").waitFor({ timeout: 2_000 });
  const editorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const editableHeading = editorFrame.getByRole("heading", { level: 1 }).first();
  await editableHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.equal(
    await editableHeading.evaluate((element) => getComputedStyle(element).outlineStyle),
    "solid",
    "选中文字必须显示清楚的边框",
  );
  const otherParagraph = editorFrame.getByText(
    "把中文产品材料交给本机 Codex，一次生成完整 HTML 演示文稿，再进入安全预览。",
    { exact: true },
  );
  const untouchedParagraph = await otherParagraph.textContent();
  const textContent = page.getByRole("textbox", { name: "文字内容", exact: true });
  await textContent.fill("Grove 编辑后的标题");
  assert.equal(await editableHeading.textContent(), "Grove 编辑后的标题");

  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await editableHeading.textContent(), "AI 演示工作流");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.equal(await editableHeading.textContent(), "Grove 编辑后的标题");

  await page.getByRole("spinbutton", { name: "字号", exact: true }).fill("64");
  await page.getByLabel("文字颜色", { exact: true }).fill("#123456");
  await page.getByRole("spinbutton", { name: "行距", exact: true }).fill("1.4");
  await page.getByRole("button", { name: "居中对齐", exact: true }).click();
  const headingState = await editableHeading.evaluate((element) => {
    const computed = getComputedStyle(element);
    const computedFontSize = Number.parseFloat(computed.fontSize);
    return {
      color: computed.color,
      fontSize: computed.fontSize,
      lineHeightRatio: Number((Number.parseFloat(computed.lineHeight) / computedFontSize).toFixed(1)),
      textAlign: computed.textAlign,
    };
  });
  assert.deepEqual(headingState, {
    color: "rgb(18, 52, 86)",
    fontSize: "64px",
    lineHeightRatio: 1.4,
    textAlign: "center",
  });
  assert.equal(await otherParagraph.textContent(), untouchedParagraph);

  const lockedStatus = page.getByText("已锁定：这个元素不可编辑", { exact: true });
  await editorFrame.locator(".slide").first().click({ position: { x: 20, y: 20 }, force: true });
  await lockedStatus.waitFor();
  await editorFrame.locator(".accent").click({ force: true });
  await lockedStatus.waitFor();
  await editorFrame.getByRole("img", { name: "Grove 模板 Logo" }).click({ force: true });
  await lockedStatus.waitFor();
  await editorFrame.getByRole("img", { name: "Grove 模板 SVG 装饰" }).click({ force: true });
  await lockedStatus.waitFor();
  await page.getByText("这个元素不可编辑", { exact: true }).waitFor();
  await editorFrame.getByRole("button", { name: "下一页", exact: true }).click();
  const editableImage = editorFrame.getByRole("img", { name: "森林和演示页面的抽象示意" });
  await editableImage.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  const resizeHandles = page.locator("[data-resize-handle]");
  assert.equal(await resizeHandles.count(), 4, "普通内容图片必须显示四个角控制点");

  const imageBeforeMove = await editableImage.boundingBox();
  const slideBox = await editorFrame.locator(".slide.light").boundingBox();
  assert.ok(imageBeforeMove && slideBox);
  await editableImage.hover();
  await page.mouse.down();
  await editorFrame.locator(".slide.light").hover({ position: { x: 300, y: 250 } });
  await page.mouse.up();

  const imageAfterMove = await editableImage.boundingBox();
  assert.ok(imageAfterMove);
  assert.ok(
    Math.abs(imageAfterMove.x - imageBeforeMove.x) > 20 ||
      Math.abs(imageAfterMove.y - imageBeforeMove.y) > 20,
    "拖动必须改变图片位置",
  );
  assert.ok(imageAfterMove.x >= slideBox.x - 1 && imageAfterMove.y >= slideBox.y - 1);
  assert.ok(imageAfterMove.x + imageAfterMove.width <= slideBox.x + slideBox.width + 1);
  assert.ok(imageAfterMove.y + imageAfterMove.height <= slideBox.y + slideBox.height + 1);

  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const imageAfterUndo = await editableImage.boundingBox();
  assert.ok(imageAfterUndo);
  assert.ok(Math.abs(imageAfterUndo.x - imageBeforeMove.x) < 2);
  assert.ok(Math.abs(imageAfterUndo.y - imageBeforeMove.y) < 2);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  const imageAfterRedo = await editableImage.boundingBox();
  assert.ok(imageAfterRedo);
  assert.ok(Math.abs(imageAfterRedo.x - imageAfterMove.x) < 2);
  assert.ok(Math.abs(imageAfterRedo.y - imageAfterMove.y) < 2);

  const southeastHandle = page.locator('[data-resize-handle="se"]');
  const handleBox = await southeastHandle.boundingBox();
  assert.ok(handleBox);
  const ratioBeforeResize = imageAfterRedo.width / imageAfterRedo.height;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 90, handleBox.y + 50, { steps: 8 });
  await page.mouse.up();
  const imageAfterResize = await editableImage.boundingBox();
  assert.ok(imageAfterResize);
  assert.ok(imageAfterResize.width > imageAfterRedo.width + 20);
  assert.ok(Math.abs(imageAfterResize.width / imageAfterResize.height - ratioBeforeResize) < 0.02);
  assert.ok(imageAfterResize.x + imageAfterResize.width <= slideBox.x + slideBox.width + 1);
  assert.ok(imageAfterResize.y + imageAfterResize.height <= slideBox.y + slideBox.height + 1);


  const savedImageState = await editableImage.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      left: Number.parseFloat(computed.left),
      top: Number.parseFloat(computed.top),
      width: Number.parseFloat(computed.width),
      height: Number.parseFloat(computed.height),
    };
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor({ timeout: 2_000 });
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const preview = page.frameLocator('iframe[title="演示文稿预览"]');
  assert.equal(await preview.getByRole("heading", { level: 1 }).first().textContent(), "Grove 编辑后的标题");
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
  assert.notEqual(await projectCard.locator(".project-meta").textContent(), initialModifiedLabel);

  await projectCard.click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const reopenedPreview = page.frameLocator('iframe[title="演示文稿预览"]');
  assert.equal(
    await reopenedPreview.getByRole("heading", { level: 1 }).first().textContent(),
    "Grove 编辑后的标题",
  );
  await reopenedPreview.locator("body").press("ArrowRight");
  const reopenedImageState = await reopenedPreview
    .getByRole("img", { name: "森林和演示页面的抽象示意" })
    .evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        left: Number.parseFloat(computed.left),
        top: Number.parseFloat(computed.top),
        width: Number.parseFloat(computed.width),
        height: Number.parseFloat(computed.height),
      };
    });
  for (const property of ["left", "top", "width", "height"]) {
    assert.ok(Math.abs(reopenedImageState[property] - savedImageState[property]) < 2);
  }

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "重做", exact: true }).isDisabled(), true);
  const reopenedEditor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  assert.equal(
    await reopenedEditor.getByRole("heading", { level: 1 }).first().textContent(),
    "Grove 编辑后的标题",
  );

  await mkdir(path.join(root, "output", "playwright"), { recursive: true });
  await page.screenshot({ path: path.join(root, "output", "playwright", "foundation-green.png"), fullPage: true });
  console.log("PASS: browser foundation flow completed through the public UI");
} catch (error) {
  const enrichedMessage =
    error.message +
      "\n\nServer output:\n" +
      serverOutput.join("") +
      "\nBrowser output:\n" +
      browserOutput.join("\n");
  throw new Error(enrichedMessage);
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
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
