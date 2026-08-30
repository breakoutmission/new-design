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
const dataDir = await mkdtemp(path.join(outputRoot, "issue-18-textbox-drag-"));
const samplesDir = path.join(outputRoot, "issue-18-textbox-drag-samples");
await mkdir(samplesDir, { recursive: true });
const port = 4340;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const sampleDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>拖拽留白验收演示</title>",
  "<style>",
  "body{margin:0;overflow:hidden;background:#f4f1e8;font-family:sans-serif}",
  ".slide{width:100vw;height:100vh;box-sizing:border-box;padding:64px;position:relative}",
  "</style>",
  "</head>",
  "<body>",
  '<section class="slide">',
  "<h1>拖拽留白验收标题</h1>",
  "<p>第一页正文，用于验收文本框拖拽与原位留白。</p>",
  '<img data-editable-image="true" alt="验收配图" src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22260%22%3E%3Crect%20width%3D%22400%22%20height%3D%22260%22%20fill%3D%22%23173b2a%22%2F%3E%3C%2Fsvg%3E">',
  "</section>",
  '<section class="slide">',
  '<h1 style="transform:translate(0,-24px)">第二页标题</h1>',
  "<p>多页结构验证。</p>",
  "</section>",
  "</body>",
  "</html>",
].join("\n");

const sampleDeckPath = path.join(samplesDir, "拖拽留白验收演示.html");
await writeFile(sampleDeckPath, sampleDeckHtml, "utf8");

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

  const undoButton = page.getByRole("button", { name: "撤销", exact: true });
  const redoButton = page.getByRole("button", { name: "重做", exact: true });

  // ============ 第一部分：生成项目（Grove fixture）============
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    [
      "文本框拖拽工作流",
      "这是验证文本框整框拖拽与原位留白的材料。",
      "拖拽移动文本框后，原位置留白，周围内容不回填。",
    ].join("\n"),
  );
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const editorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const heading = editorFrame.getByRole("heading", { level: 1 }).first();
  const neighborParagraph = editorFrame.locator(".slide").first().locator("p").first();

  // ---- 流式布局文本框：点击选中，光标呈现可拖拽提示 ----
  await heading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.equal(
    await heading.evaluate((element) => getComputedStyle(element).cursor),
    "move",
    "选中的文本框必须呈现可拖拽光标",
  );
  assert.equal(
    await heading.evaluate((element) => getComputedStyle(element, "::after").content),
    "none",
    "未发生拖拽时不得出现占位标注",
  );

  // ---- 选中原地点击（无位移）不得改写文档：无占位、不进入撤销历史 ----
  await heading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.equal(await editorFrame.locator("[data-aps-placeholder]").count(), 0, "原地点击不得产生占位留白");
  assert.equal(
    await heading.evaluate((element) => getComputedStyle(element).position),
    "static",
    "原地点击不得改变文本框定位",
  );
  assert.equal(await undoButton.isDisabled(), true, "原地点击不得进入撤销历史");

  // ---- 幻影拖拽回归：选中文字后点击宿主侧栏不得改写画布文档 ----
  await page.locator(".sidebar-nav").getByText("项目中心", { exact: true }).click();
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.getByRole("article", { name: "文本框拖拽工作流" }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  assert.equal(
    await editorFrame.locator("[data-aps-placeholder]").count(),
    0,
    "宿主侧栏点击不得在画布中留下占位留白",
  );
  assert.equal(
    await heading.evaluate((element) => getComputedStyle(element).position),
    "static",
    "宿主侧栏点击不得把画布文本框转为自由定位",
  );

  // ---- 整框拖拽：文本框到达新位置，原位置出现占位留白，相邻内容不回填 ----
  // （上一步重开了编辑器，需要重新选中再拖拽）
  await heading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const headingBefore = await heading.boundingBox();
  const paragraphBefore = await neighborParagraph.boundingBox();
  const slideBox = await editorFrame.locator(".slide").first().boundingBox();
  assert.ok(headingBefore && paragraphBefore && slideBox);
  const dragTargetInSlide = { x: 320, y: 260 };
  await heading.hover();
  await page.mouse.down();
  await editorFrame
    .locator(".slide")
    .first()
    .hover({ position: dragTargetInSlide, force: true });
  await page.mouse.up();
  const expectedDelta = {
    x: slideBox.x + dragTargetInSlide.x - (headingBefore.x + headingBefore.width / 2),
    y: slideBox.y + dragTargetInSlide.y - (headingBefore.y + headingBefore.height / 2),
  };

  const headingAfter = await heading.boundingBox();
  assert.ok(headingAfter);
  assert.ok(
    Math.abs(headingAfter.x - (headingBefore.x + expectedDelta.x)) < 8 &&
      Math.abs(headingAfter.y - (headingBefore.y + expectedDelta.y)) < 8,
    "拖拽后文本框必须到达新位置",
  );
  assert.equal(
    await heading.evaluate((element) => getComputedStyle(element).position),
    "absolute",
    "流式布局文本框拖拽后必须转为自由定位",
  );
  const placeholder = editorFrame.locator("[data-aps-placeholder]");
  assert.equal(await placeholder.count(), 1, "拖拽后原位置必须留下一个占位留白");
  const placeholderBox = await placeholder.first().boundingBox();
  assert.ok(placeholderBox);
  assert.ok(
    Math.abs(placeholderBox.x - headingBefore.x) < 4 && Math.abs(placeholderBox.y - headingBefore.y) < 4,
    "占位留白必须停在文本框原位置",
  );
  assert.equal(
    (await placeholder.first().textContent()) || "",
    "",
    "占位留白必须是空盒子，不得复制文字内容",
  );
  const paragraphAfter = await neighborParagraph.boundingBox();
  assert.ok(paragraphAfter);
  assert.ok(
    Math.abs(paragraphAfter.y - paragraphBefore.y) < 2,
    "周围内容不得回填，相邻元素必须保持原位",
  );

  // ---- 一次撤销复原原位，一次重做再现拖拽结果 ----
  await undoButton.click();
  assert.equal(
    await heading.evaluate((element) => getComputedStyle(element).position),
    "static",
    "撤销后文本框必须回到流式布局",
  );
  const headingAfterUndo = await heading.boundingBox();
  assert.ok(headingAfterUndo);
  assert.ok(
    Math.abs(headingAfterUndo.x - headingBefore.x) < 3 && Math.abs(headingAfterUndo.y - headingBefore.y) < 3,
    "一次撤销必须让文本框回到原位置",
  );
  assert.equal(await placeholder.count(), 0, "撤销后占位留白必须消失");
  const paragraphAfterUndo = await neighborParagraph.boundingBox();
  assert.ok(paragraphAfterUndo);
  assert.ok(Math.abs(paragraphAfterUndo.y - paragraphBefore.y) < 2, "撤销后相邻元素仍保持原位");

  await redoButton.click();
  const headingAfterRedo = await heading.boundingBox();
  assert.ok(headingAfterRedo);
  assert.ok(
    Math.abs(headingAfterRedo.x - headingAfter.x) < 3 && Math.abs(headingAfterRedo.y - headingAfter.y) < 3,
    "一次重做必须让文本框回到拖拽后的位置",
  );
  assert.equal(await placeholder.count(), 1, "重做后占位留白必须回来");
  const placeholderAfterRedo = await placeholder.first().boundingBox();
  assert.ok(placeholderAfterRedo);
  assert.ok(
    Math.abs(placeholderAfterRedo.x - headingBefore.x) < 4 &&
      Math.abs(placeholderAfterRedo.y - headingBefore.y) < 4,
    "重做后占位留白必须停在原位置",
  );

  // ---- 编辑器内占位显示虚线与「原位置留白」标注（与原型屏幕 12 一致）----
  assert.equal(
    await placeholder.first().evaluate((element) => getComputedStyle(element).outlineStyle),
    "dashed",
    "编辑画布中的占位留白必须显示虚线框",
  );
  assert.equal(
    await placeholder.first().evaluate((element) => getComputedStyle(element, "::after").content),
    '"原位置留白"',
    "编辑画布中的占位留白必须显示原位置留白标注",
  );

  // ---- 保存后预览：占位框只在编辑时显示，留白保持 ----
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const previewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  const previewPlaceholder = previewFrame.locator("[data-aps-placeholder]");
  assert.equal(await previewPlaceholder.count(), 1, "预览必须保留原位留白");
  assert.equal(
    await previewPlaceholder.first().evaluate((element) => getComputedStyle(element).outlineStyle),
    "none",
    "预览中占位留白不得显示虚线框",
  );
  assert.equal(
    (await previewPlaceholder.first().textContent()) || "",
    "",
    "预览中的占位留白必须是空盒子",
  );
  const previewSlideBox = await previewFrame.locator(".slide").first().boundingBox();
  const previewParagraphBox = await previewFrame.locator(".slide").first().locator("p").first().boundingBox();
  const previewPlaceholderBox = await previewPlaceholder.first().boundingBox();
  assert.ok(previewSlideBox && previewParagraphBox && previewPlaceholderBox);
  assert.ok(
    Math.abs(previewPlaceholderBox.height - headingBefore.height) < 4,
    "预览中的占位留白必须保留原文本框的高度，不得塌陷",
  );
  assert.ok(
    previewParagraphBox.y >= previewPlaceholderBox.y + previewPlaceholderBox.height - 2,
    "预览中相邻内容必须排在占位留白之后，不回填",
  );

  // ---- 跨会话：重开编辑器后位置与占位保持一致，历史清空 ----
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "文本框拖拽工作流" }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const reopenedFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const reopenedHeading = reopenedFrame.getByRole("heading", { level: 1 }).first();
  const reopenedParagraph = reopenedFrame.locator(".slide").first().locator("p").first();
  const reopenedBox = await reopenedHeading.boundingBox();
  assert.ok(reopenedBox);
  assert.ok(
    Math.abs(reopenedBox.x - headingAfter.x) < 3 && Math.abs(reopenedBox.y - headingAfter.y) < 3,
    "重开编辑器后文本框必须保持拖拽后的位置",
  );
  const reopenedPlaceholder = reopenedFrame.locator("[data-aps-placeholder]");
  assert.equal(await reopenedPlaceholder.count(), 1, "重开编辑器后占位留白必须保持");
  assert.equal(
    await reopenedPlaceholder.first().evaluate((element) => getComputedStyle(element).outlineStyle),
    "dashed",
    "重开编辑器后占位留白重新显示虚线框",
  );
  const reopenedPlaceholderBox = await reopenedPlaceholder.first().boundingBox();
  assert.ok(reopenedPlaceholderBox);
  assert.ok(
    Math.abs(reopenedPlaceholderBox.x - headingBefore.x) < 4 &&
      Math.abs(reopenedPlaceholderBox.y - headingBefore.y) < 4,
    "重开编辑器后占位留白仍停在原位置",
  );
  const reopenedSlideBox = await reopenedFrame.locator(".slide").first().boundingBox();
  assert.ok(reopenedSlideBox);
  assert.ok(
    Math.abs(
      (await reopenedParagraph.boundingBox())?.y -
        reopenedSlideBox.y -
        (paragraphBefore.y - slideBox.y),
    ) < 2,
    "重开编辑器后周围内容仍保持原位",
  );
  assert.equal(await undoButton.isDisabled(), true, "跨会话历史必须清空");
  assert.equal(await redoButton.isDisabled(), true, "跨会话历史必须清空");

  // ---- 绝对定位文本框：再次拖拽只移动自己，不新增占位、不影响其他元素 ----
  await reopenedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const absoluteSlideBox = await reopenedFrame.locator(".slide").first().boundingBox();
  assert.ok(absoluteSlideBox);
  const absoluteTargetInSlide = { x: 420, y: 360 };
  await reopenedHeading.hover();
  await page.mouse.down();
  await reopenedFrame
    .locator(".slide")
    .first()
    .hover({ position: absoluteTargetInSlide, force: true });
  await page.mouse.up();
  const absoluteExpectedDelta = {
    x:
      absoluteSlideBox.x +
      absoluteTargetInSlide.x -
      (reopenedBox.x + reopenedBox.width / 2),
    y:
      absoluteSlideBox.y +
      absoluteTargetInSlide.y -
      (reopenedBox.y + reopenedBox.height / 2),
  };
  const absoluteAfter = await reopenedHeading.boundingBox();
  assert.ok(absoluteAfter);
  assert.ok(
    Math.abs(absoluteAfter.x - (reopenedBox.x + absoluteExpectedDelta.x)) < 8 &&
      Math.abs(absoluteAfter.y - (reopenedBox.y + absoluteExpectedDelta.y)) < 8,
    "绝对定位文本框拖拽必须直接到达新位置",
  );
  assert.equal(await reopenedPlaceholder.count(), 1, "绝对定位文本框拖拽不得新增占位留白");
  const paragraphAfterAbsoluteDrag = await reopenedParagraph.boundingBox();
  assert.ok(paragraphAfterAbsoluteDrag);
  assert.ok(
    Math.abs(paragraphAfterAbsoluteDrag.y - paragraphBefore.y) < 2,
    "绝对定位文本框拖拽不得影响其他元素",
  );
  await undoButton.click();
  assert.ok(
    Math.abs((await reopenedHeading.boundingBox())?.x - reopenedBox.x) < 3 &&
      Math.abs((await reopenedHeading.boundingBox())?.y - reopenedBox.y) < 3,
    "绝对定位文本框拖拽可撤销",
  );
  await redoButton.click();
  assert.equal(await reopenedPlaceholder.count(), 1, "绝对定位拖拽重做后占位保持一个");

  // ---- 复制已拖拽文本框：副本不复制占位留白；删除副本后留白保持 ----
  await reopenedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const copyElementButton = page.getByRole("button", { name: "复制", exact: true });
  const deleteElementButton = page.getByRole("button", { name: "删除", exact: true });
  await copyElementButton.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const reopenedHeadings = reopenedFrame.getByRole("heading", { level: 1 });
  assert.equal(await reopenedHeadings.count(), 2, "复制后必须多出一个文本框");
  assert.equal(await reopenedPlaceholder.count(), 1, "复制不得复制占位留白");
  await deleteElementButton.click();
  assert.equal(await reopenedHeadings.count(), 1, "删除后副本必须消失");
  assert.equal(await reopenedPlaceholder.count(), 1, "删除副本后原位留白必须保持");

  // ---- 锁定元素：不可拖拽，点击仍走既有不可编辑提示 ----
  const lockedStatus = page.locator("#selection-status", { hasText: "已锁定：这个元素不可编辑" });
  const logo = editorFrame.getByRole("img", { name: "Grove 模板 Logo" });
  await logo.click({ force: true });
  await lockedStatus.waitFor();
  const logoBefore = await logo.boundingBox();
  assert.ok(logoBefore);
  await logo.hover();
  await page.mouse.down();
  await editorFrame.locator(".slide").first().hover({ position: { x: 300, y: 500 } });
  await page.mouse.up();
  const logoAfter = await logo.boundingBox();
  assert.ok(logoAfter);
  assert.ok(
    Math.abs(logoAfter.x - logoBefore.x) < 2 && Math.abs(logoAfter.y - logoBefore.y) < 2,
    "锁定元素不可拖拽",
  );
  await lockedStatus.waitFor();
  assert.equal(await editorFrame.locator("[data-aps-placeholder]").count(), 1, "锁定元素拖拽不得新增占位留白");

  await page.getByRole("button", { name: "返回首页" }).click();

  // ============ 第二部分：导入项目 ============
  const importEntry = page.getByRole("button", { name: /导入演示/ });
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(sampleDeckPath);
  await page.getByText("拖拽留白验收演示.html", { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始检查", exact: true }).click();
  await page.getByTestId("import-report").waitFor();
  await page.getByText("已创建演示项目「拖拽留白验收演示」", { exact: true }).waitFor();
  await page.getByRole("button", { name: "进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const importFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const importHeading = importFrame.getByRole("heading", { level: 1 }).first();
  const importParagraph = importFrame.locator(".slide").first().locator("p").first();

  await importHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const importHeadingBefore = await importHeading.boundingBox();
  const importParagraphBefore = await importParagraph.boundingBox();
  const importSlideBox = await importFrame.locator(".slide").first().boundingBox();
  assert.ok(importHeadingBefore && importParagraphBefore && importSlideBox);
  const importTargetInSlide = { x: 360, y: 300 };
  await importHeading.hover();
  await page.mouse.down();
  await importFrame
    .locator(".slide")
    .first()
    .hover({ position: importTargetInSlide, force: true });
  await page.mouse.up();
  const importExpectedDelta = {
    x: importSlideBox.x + importTargetInSlide.x - (importHeadingBefore.x + importHeadingBefore.width / 2),
    y: importSlideBox.y + importTargetInSlide.y - (importHeadingBefore.y + importHeadingBefore.height / 2),
  };

  const importHeadingAfter = await importHeading.boundingBox();
  assert.ok(importHeadingAfter);
  assert.ok(
    Math.abs(importHeadingAfter.x - (importHeadingBefore.x + importExpectedDelta.x)) < 8 &&
      Math.abs(importHeadingAfter.y - (importHeadingBefore.y + importExpectedDelta.y)) < 8,
    "导入项目文本框拖拽必须到达新位置",
  );
  const importPlaceholder = importFrame.locator("[data-aps-placeholder]");
  assert.equal(await importPlaceholder.count(), 1, "导入项目拖拽后原位置必须留下占位留白");
  const importPlaceholderBox = await importPlaceholder.first().boundingBox();
  assert.ok(importPlaceholderBox);
  assert.ok(
    Math.abs(importPlaceholderBox.x - importHeadingBefore.x) < 4 &&
      Math.abs(importPlaceholderBox.y - importHeadingBefore.y) < 4,
    "导入项目占位留白必须停在原位置",
  );
  assert.ok(
    Math.abs((await importParagraph.boundingBox())?.y - importParagraphBefore.y) < 2,
    "导入项目周围内容不得回填",
  );

  await undoButton.click();
  const importHeadingAfterUndo = await importHeading.boundingBox();
  assert.ok(importHeadingAfterUndo);
  assert.ok(
    Math.abs(importHeadingAfterUndo.x - importHeadingBefore.x) < 3 &&
      Math.abs(importHeadingAfterUndo.y - importHeadingBefore.y) < 3,
    "导入项目一次撤销必须让文本框回到原位置",
  );
  assert.equal(await importPlaceholder.count(), 0, "导入项目撤销后占位留白必须消失");
  await redoButton.click();
  assert.equal(await importPlaceholder.count(), 1, "导入项目重做后占位留白必须回来");

  // ---- 带样式表 transform 的流式文本框：落点不得偏移一个 transform 量 ----
  // 导入样本的第二页不带翻页按钮，元素本身在 DOM 中，直接定位拖拽。
  const transformedHeading = importFrame.getByRole("heading", { level: 1, name: "第二页标题" });
  await transformedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const transformedBefore = await transformedHeading.boundingBox();
  const transformedSlideBox = await importFrame.locator(".slide").nth(1).boundingBox();
  assert.ok(transformedBefore && transformedSlideBox);
  // 目标点须留在夹紧区间内（幻灯片宽 804、元素宽 676，横向余量 128px），
  // 避免断言混入边缘夹紧行为。
  const transformedTargetInSlide = { x: 420, y: 420 };
  const transformedExpected = {
    x:
      transformedSlideBox.x +
      transformedTargetInSlide.x -
      (transformedBefore.x + transformedBefore.width / 2),
    y:
      transformedSlideBox.y +
      transformedTargetInSlide.y -
      (transformedBefore.y + transformedBefore.height / 2),
  };
  await transformedHeading.hover();
  await page.mouse.down();
  await importFrame
    .locator(".slide")
    .nth(1)
    .hover({ position: transformedTargetInSlide, force: true });
  await page.mouse.up();
  const transformedAfter = await transformedHeading.boundingBox();
  assert.ok(transformedAfter);
  assert.ok(
    Math.abs(transformedAfter.x - (transformedBefore.x + transformedExpected.x)) < 8 &&
      Math.abs(transformedAfter.y - (transformedBefore.y + transformedExpected.y)) < 8,
    "带 transform 的流式文本框拖拽落点必须与松手位置一致，不得偏移一个 transform 量",
  );
  assert.equal(
    await transformedHeading.evaluate((element) => getComputedStyle(element).transform),
    "none",
    "转为自由定位后必须清除原 transform，落点才不漂移",
  );

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const importPreviewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  assert.equal(
    await importPreviewFrame.locator("[data-aps-placeholder]").count(),
    2,
    "导入项目保存后预览必须保留两处原位留白（两页各一处）",
  );
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "拖拽留白验收演示" }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const importReopenedFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const importReopenedHeading = importReopenedFrame.getByRole("heading", { level: 1 }).first();
  const importReopenedBox = await importReopenedHeading.boundingBox();
  assert.ok(importReopenedBox);
  assert.ok(
    Math.abs(importReopenedBox.x - importHeadingAfter.x) < 3 &&
      Math.abs(importReopenedBox.y - importHeadingAfter.y) < 3,
    "导入项目重开编辑器后文本框必须保持拖拽后的位置",
  );
  assert.equal(
    await importReopenedFrame.locator("[data-aps-placeholder]").count(),
    2,
    "导入项目重开编辑器后两处占位留白必须保持",
  );
  assert.equal(await undoButton.isDisabled(), true, "导入项目跨会话历史必须清空");
  assert.equal(await redoButton.isDisabled(), true, "导入项目跨会话历史必须清空");

  // ---- 删除已拖拽文本框：原位留白保留，撤销恢复文本框 ----
  const importReopenedDraggedHeading = importReopenedFrame.getByRole("heading", {
    level: 1,
    name: "拖拽留白验收标题",
  });
  await importReopenedDraggedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await deleteElementButton.click();
  assert.equal(await importReopenedDraggedHeading.count(), 0, "删除后文本框必须消失");
  assert.equal(
    await importReopenedFrame.locator("[data-aps-placeholder]").count(),
    2,
    "删除已拖拽文本框后原位留白必须保留",
  );
  await undoButton.click();
  assert.equal(await importReopenedDraggedHeading.count(), 1, "撤销必须恢复被删除的文本框");
  assert.equal(
    await importReopenedFrame.locator("[data-aps-placeholder]").count(),
    2,
    "撤销后原位留白保持",
  );

  await page.screenshot({
    path: path.join(root, "output", "playwright", "issue-18-textbox-drag.png"),
    fullPage: true,
  });
  console.log("PASS: textbox drag with in-place blank works through the public UI");
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
