import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
await mkdir(path.join(root, "output", "playwright"), { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "element-copy-delete-"));
const samplesDir = path.join(outputRoot, "element-copy-delete-samples");
await mkdir(samplesDir, { recursive: true });
const port = 4338;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const sampleDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>复制删除验收演示</title>",
  "<style>",
  "body{margin:0;overflow:hidden;background:#f4f1e8;font-family:sans-serif}",
  ".slide{width:100vw;height:100vh;box-sizing:border-box;padding:64px;position:relative}",
  "</style>",
  "</head>",
  "<body>",
  '<section class="slide">',
  "<h1>复制删除验收标题</h1>",
  "<p>第一页正文，用于验收复制与删除。</p>",
  '<img data-editable-image="true" alt="验收配图" src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22260%22%3E%3Crect%20width%3D%22400%22%20height%3D%22260%22%20fill%3D%22%23173b2a%22%2F%3E%3C%2Fsvg%3E">',
  "</section>",
  '<section class="slide">',
  "<h1>第二页标题</h1>",
  "<p>多页结构验证。</p>",
  "</section>",
  "</body>",
  "</html>",
].join("\n");

const sampleDeckPath = path.join(samplesDir, "复制删除验收演示.html");
await writeFile(sampleDeckPath, sampleDeckHtml, "utf8");

const partialDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>复制删除锁定演示</title>",
  "</head>",
  "<body>",
  '<section class="slide">',
  '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#e8f0e4"></circle></svg>',
  "<h1>锁定元素验收标题</h1>",
  "<p>本页带 SVG 装饰，装饰保持原样显示。</p>",
  "</section>",
  '<section class="slide" style="background:linear-gradient(#f7f4e8,#e2ddd0)">',
  "<h1>渐变背景页标题</h1>",
  "<p>本页背景渐变保持原样显示。</p>",
  "</section>",
  "</body>",
  "</html>",
].join("\n");

const partialDeckPath = path.join(samplesDir, "复制删除锁定演示.html");
await writeFile(partialDeckPath, partialDeckHtml, "utf8");

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

  const copyButton = page.getByRole("button", { name: "复制", exact: true });
  const deleteButton = page.getByRole("button", { name: "删除", exact: true });
  const undoButton = page.getByRole("button", { name: "撤销", exact: true });
  const redoButton = page.getByRole("button", { name: "重做", exact: true });
  const textContent = page.getByRole("textbox", { name: "文字内容", exact: true });

  // ============ 第一部分：生成项目（Grove fixture）============
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    [
      "复制删除工作流",
      "这是验证可编辑元素复制与删除的材料。",
      "复制生成副本，删除移除元素，两者都可撤销重做。",
    ].join("\n"),
  );
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const editorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');

  // ---- 文字复制：副本内容与样式一致、不与原件完全重叠、可立即继续编辑 ----
  const deckHeadings = editorFrame.locator("h1");
  assert.equal(await deckHeadings.count(), 1, "fixture 演示只有一页含一级标题");
  const originalHeading = editorFrame.getByRole("heading", { level: 1 }).first();
  await originalHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await copyButton.waitFor();
  await page.screenshot({
    path: path.join(root, "output", "playwright", "element-copy-delete-selected.png"),
    fullPage: true,
  });
  assert.equal(await copyButton.isVisible(), true, "选中文字后必须出现复制入口");
  assert.equal(await deleteButton.isVisible(), true, "选中文字后必须出现删除入口");

  const originalBox = await originalHeading.boundingBox();
  const originalStyle = await originalHeading.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { fontSize: computed.fontSize, color: computed.color, fontWeight: computed.fontWeight };
  });
  await copyButton.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();

  assert.equal(await deckHeadings.count(), 2, "复制后必须多出一个标题");
  assert.equal(await deckHeadings.nth(1).textContent(), "AI 演示工作流", "副本内容必须与原件一致");
  const copiedBox = await deckHeadings.nth(1).boundingBox();
  assert.ok(copiedBox && originalBox);
  assert.ok(
    Math.abs(copiedBox.x - originalBox.x) > 2 || Math.abs(copiedBox.y - originalBox.y) > 2,
    "副本不得与原件完全重叠",
  );
  const copiedStyle = await deckHeadings.nth(1).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { fontSize: computed.fontSize, color: computed.color, fontWeight: computed.fontWeight };
  });
  assert.deepEqual(copiedStyle, originalStyle, "副本样式必须与原件一致");

  // 副本内容与原件一致的断言见上；复制纳入撤销/重做：
  await undoButton.click();
  assert.equal(await deckHeadings.count(), 1, "撤销后副本必须消失");
  await redoButton.click();
  assert.equal(await deckHeadings.count(), 2, "重做后副本必须回来");
  assert.equal(await deckHeadings.nth(1).textContent(), "AI 演示工作流", "重做恢复的副本必须保留内容");

  // 副本可立即继续编辑：点击副本并直接改文字内容，原件不动。
  await deckHeadings.nth(1).click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await textContent.fill("副本已改写");
  assert.equal(await deckHeadings.nth(1).textContent(), "副本已改写");
  assert.equal(await deckHeadings.nth(0).textContent(), "AI 演示工作流");

  // ---- 删除：元素消失、撤销恢复、重做再现 ----
  await deleteButton.click();
  assert.equal(await deckHeadings.count(), 1, "删除后副标题必须消失");
  await undoButton.click();
  assert.equal(await deckHeadings.count(), 2, "删除后撤销必须恢复元素");
  assert.equal(await deckHeadings.nth(1).textContent(), "副本已改写", "撤销恢复的元素必须保留内容");
  await redoButton.click();
  assert.equal(await deckHeadings.count(), 1, "重做必须再次删除元素");

  // ---- 锁定元素：不出现复制/删除入口，仍显示既有不可编辑提示 ----
  const lockedStatus = page.locator("#selection-status", { hasText: "已锁定：这个元素不可编辑" });
  await editorFrame.locator(".slide").first().click({ position: { x: 20, y: 20 }, force: true });
  await lockedStatus.waitFor();
  assert.equal(await copyButton.isVisible(), false, "锁定元素不得出现复制入口");
  assert.equal(await deleteButton.isVisible(), false, "锁定元素不得出现删除入口");
  await editorFrame.locator(".accent").click({ force: true });
  await lockedStatus.waitFor();
  await editorFrame.getByRole("img", { name: "Grove 模板 Logo" }).click({ force: true });
  await lockedStatus.waitFor();
  await editorFrame.getByRole("img", { name: "Grove 模板 SVG 装饰" }).click({ force: true });
  await lockedStatus.waitFor();
  await page.getByText("这个元素不可编辑", { exact: true }).waitFor();
  assert.equal(await copyButton.isVisible(), false, "锁定元素不得出现复制入口");
  assert.equal(await deleteButton.isVisible(), false, "锁定元素不得出现删除入口");

  // ---- 图片复制/删除（生成项目）----
  await editorFrame.getByRole("button", { name: "下一页", exact: true }).click();
  const editableImage = editorFrame.getByRole("img", { name: "森林和演示页面的抽象示意" });
  await editableImage.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  assert.equal(await copyButton.isVisible(), true, "选中图片后必须出现复制入口");
  assert.equal(await deleteButton.isVisible(), true, "选中图片后必须出现删除入口");

  const imageOriginalBox = await editableImage.boundingBox();
  await copyButton.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  const copiedImages = editorFrame.getByRole("img", { name: "森林和演示页面的抽象示意" });
  assert.equal(await copiedImages.count(), 2, "复制后必须多出一张内容一致的图片");
  const imageCopiedBox = await copiedImages.nth(1).boundingBox();
  assert.ok(imageCopiedBox && imageOriginalBox);
  assert.ok(
    Math.abs(imageCopiedBox.x - imageOriginalBox.x) > 2 || Math.abs(imageCopiedBox.y - imageOriginalBox.y) > 2,
    "图片副本不得与原件完全重叠",
  );
  assert.equal(
    await copiedImages.nth(1).getAttribute("src"),
    await copiedImages.nth(0).getAttribute("src"),
    "图片副本内容必须与原件一致",
  );
  const slideBox = await editorFrame.locator(".slide.light").boundingBox();
  assert.ok(slideBox);
  assert.ok(imageCopiedBox.x >= slideBox.x - 1 && imageCopiedBox.y >= slideBox.y - 1, "图片副本必须留在幻灯片内");
  assert.ok(
    imageCopiedBox.x + imageCopiedBox.width <= slideBox.x + slideBox.width + 1 &&
      imageCopiedBox.y + imageCopiedBox.height <= slideBox.y + slideBox.height + 1,
    "图片副本必须留在幻灯片内",
  );
  const copiedImageHandles = page.locator("[data-resize-handle]");
  assert.equal(await copiedImageHandles.count(), 4, "副本图片必须自动选中并显示四角控制点");

  await undoButton.click();
  assert.equal(await copiedImages.count(), 1, "撤销后图片副本必须消失");
  await redoButton.click();
  assert.equal(await copiedImages.count(), 2, "重做后图片副本必须回来");

  await copiedImages.nth(1).click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  await deleteButton.click();
  assert.equal(await copiedImages.count(), 1, "删除后图片副本必须消失");
  await undoButton.click();
  assert.equal(await copiedImages.count(), 2, "图片删除后撤销必须恢复");
  await redoButton.click();
  assert.equal(await copiedImages.count(), 1, "重做必须再次删除图片副本");

  // ---- 复制跨保存/重开保持；删除跨保存/重开保持 ----
  await editableImage.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  await copyButton.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  assert.equal(await copiedImages.count(), 2);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const previewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  assert.equal(
    await previewFrame.getByRole("img", { name: "森林和演示页面的抽象示意" }).count(),
    2,
    "保存后预览必须包含图片副本",
  );

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "复制删除工作流" }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const reopenedEditorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const reopenedImages = reopenedEditorFrame.getByRole("img", { name: "森林和演示页面的抽象示意" });
  assert.equal(
    await reopenedImages.count(),
    2,
    "重开编辑器后图片副本必须保持",
  );
  assert.equal(await undoButton.isDisabled(), true, "跨会话历史必须清空");
  assert.equal(await redoButton.isDisabled(), true, "跨会话历史必须清空");

  // 删除副本并保存重开，确认删除状态一致。
  await reopenedImages.nth(1).click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  await deleteButton.click();
  assert.equal(await reopenedImages.count(), 1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  assert.equal(
    await previewFrame.getByRole("img", { name: "森林和演示页面的抽象示意" }).count(),
    1,
    "删除保存后预览必须只剩一张图片",
  );
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "复制删除工作流" }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  assert.equal(
    await page.frameLocator('iframe[title="演示文稿编辑画布"]').getByRole("img", { name: "森林和演示页面的抽象示意" }).count(),
    1,
    "重开编辑器后删除必须保持",
  );
  await page.getByRole("button", { name: "返回首页" }).click();

  // ============ 第二部分：导入项目 ============
  const importEntry = page.getByRole("button", { name: /导入演示/ });
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(sampleDeckPath);
  await page.getByText("复制删除验收演示.html", { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始检查", exact: true }).click();
  await page.getByTestId("import-report").waitFor();
  await page.getByText("已创建演示项目「复制删除验收演示」", { exact: true }).waitFor();
  await page.getByRole("button", { name: "进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const importEditorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');

  // ---- 导入项目文字复制/删除/撤销/重做 ----
  const importHeading = importEditorFrame.getByRole("heading", { level: 1 }).first();
  await importHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const importOriginalBox = await importHeading.boundingBox();
  await copyButton.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const importHeadings = importEditorFrame.getByRole("heading", { level: 1, name: "复制删除验收标题" });
  assert.equal(await importHeadings.count(), 2, "导入项目复制后必须多出一个内容一致的标题");
  const importCopiedBox = await importHeadings.nth(1).boundingBox();
  assert.ok(importCopiedBox && importOriginalBox);
  assert.ok(
    Math.abs(importCopiedBox.x - importOriginalBox.x) > 2 || Math.abs(importCopiedBox.y - importOriginalBox.y) > 2,
    "导入项目副本不得与原件完全重叠",
  );
  await undoButton.click();
  assert.equal(await importHeadings.count(), 1, "导入项目撤销后副本必须消失");
  await redoButton.click();
  assert.equal(await importHeadings.count(), 2, "导入项目重做后副本必须回来");

  await importHeadings.nth(1).click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await deleteButton.click();
  assert.equal(await importHeadings.count(), 1, "导入项目删除后副本必须消失");
  await undoButton.click();
  assert.equal(await importHeadings.count(), 2, "导入项目删除后撤销必须恢复");
  await redoButton.click();
  assert.equal(await importHeadings.count(), 1, "导入项目重做必须再次删除");

  // ---- 导入项目图片复制/删除（当前基线可编辑范围：带 data-editable-image 的图片）----
  const importImage = importEditorFrame.getByRole("img", { name: "验收配图" });
  await importImage.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  await copyButton.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  const importImages = importEditorFrame.getByRole("img", { name: "验收配图" });
  assert.equal(await importImages.count(), 2, "导入项目图片复制后必须多出一张");
  const importImageBoxes = [];
  for (const index of [0, 1]) {
    importImageBoxes.push(await importImages.nth(index).boundingBox());
  }
  assert.ok(importImageBoxes.every(Boolean));
  assert.ok(
    Math.abs(importImageBoxes[1].x - importImageBoxes[0].x) > 2 ||
      Math.abs(importImageBoxes[1].y - importImageBoxes[0].y) > 2,
    "导入项目图片副本不得与原件完全重叠",
  );
  await undoButton.click();
  assert.equal(await importImages.count(), 1, "导入项目图片撤销后副本必须消失");
  await redoButton.click();
  assert.equal(await importImages.count(), 2, "导入项目图片重做后副本必须回来");

  await importImages.nth(1).click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  await deleteButton.click();
  assert.equal(await importImages.count(), 1, "导入项目图片删除后必须消失");
  await undoButton.click();
  assert.equal(await importImages.count(), 2, "导入项目图片删除后撤销必须恢复");
  await redoButton.click();
  assert.equal(await importImages.count(), 1, "导入项目图片重做必须再次删除");

  // ---- 导入项目文字复制跨保存/重开保持 ----
  await importHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await copyButton.click();
  assert.equal(await importHeadings.count(), 2);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const importPreviewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  assert.equal(
    await importPreviewFrame.getByRole("heading", { level: 1, name: "复制删除验收标题" }).count(),
    2,
    "导入项目保存后预览必须包含标题副本",
  );
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "复制删除验收演示" }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  assert.equal(
    await page
      .frameLocator('iframe[title="演示文稿编辑画布"]')
      .getByRole("heading", { level: 1, name: "复制删除验收标题" })
      .count(),
    2,
    "导入项目重开编辑器后标题副本必须保持",
  );
  await page.getByRole("button", { name: "返回首页" }).click();

  // ---- 导入项目锁定元素：不出现复制/删除入口 ----
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(partialDeckPath);
  await page.getByText("复制删除锁定演示.html", { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始检查", exact: true }).click();
  await page.getByTestId("import-report").waitFor();
  await page.getByText("部分可编辑", { exact: true }).waitFor();
  await page.getByText("将被锁定的内容", { exact: true }).waitFor();
  await page.getByRole("button", { name: "仍要进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const partialEditorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  assert.ok(
    (await partialEditorFrame.locator("svg circle").count()) >= 1,
    "锁定 SVG 必须在编辑画布中原样保留",
  );
  await partialEditorFrame.locator("svg circle").click({ force: true });
  await page.locator("#selection-status", { hasText: "已锁定：这个元素不可编辑" }).waitFor();
  assert.equal(await copyButton.isVisible(), false, "导入项目锁定元素不得出现复制入口");
  assert.equal(await deleteButton.isVisible(), false, "导入项目锁定元素不得出现删除入口");
  assert.ok(
    (await partialEditorFrame.locator("svg circle").count()) >= 1,
    "锁定元素不得被复制或删除流程改动",
  );

  // 背景渐变同样锁定：点击后不出现复制/删除入口，渐变保持原样。
  await partialEditorFrame.locator(".slide").nth(1).click({ position: { x: 40, y: 600 }, force: true });
  await page.locator("#selection-status", { hasText: "已锁定：这个元素不可编辑" }).waitFor();
  assert.equal(await copyButton.isVisible(), false, "背景渐变不得出现复制入口");
  assert.equal(await deleteButton.isVisible(), false, "背景渐变不得出现删除入口");
  assert.ok(
    await partialEditorFrame
      .locator(".slide")
      .nth(1)
      .evaluate((element) => getComputedStyle(element).backgroundImage.includes("linear-gradient")),
    "背景渐变必须保持原样显示",
  );

  await page.screenshot({
    path: path.join(root, "output", "playwright", "element-copy-delete.png"),
    fullPage: true,
  });
  console.log("PASS: element copy and delete work through the public UI");
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
