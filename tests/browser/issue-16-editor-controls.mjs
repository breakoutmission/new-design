// Issue #16 公开浏览器行为测试：编辑面板排版扩展（字体/粗细/字间距）
// 与本地图片替换。生成项目与导入项目两条路径都要覆盖：
// 即时生效、撤销/重做、保存重开保持、锁定元素不可替换得到明确提示。
// 注意：导入检查报告的断言区归 #20 重写（tests/browser/import.mjs），本文件
// 只在导入路径上断言与编辑体验直接相关的盘点行，不改既有报告断言。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
await mkdir(path.join(root, "output", "playwright"), { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "issue-16-"));
const samplesDir = path.join(outputRoot, "issue-16-samples");
await mkdir(samplesDir, { recursive: true });
const port = 4336;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const replacementPng = png1x1([31, 82, 255]);
const initialPng = png1x1([23, 59, 42]);

// 导入样本：普通内容图片不带 data-editable-image 标记（按报告口径接入编辑），
// 页眉含 Logo 图片（锁定，不可替换），两页文字可编辑。
const importedDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>导入编辑验收</title>",
  "<style>",
  "body{margin:0;overflow:hidden;background:#f4f1e8}",
  ".slide{width:100vw;height:100vh;box-sizing:border-box;padding:64px;position:relative}",
  "</style>",
  "</head>",
  "<body>",
  '<header><img class="logo" alt="品牌标识" src="' + pngDataUrl(png1x1([90, 90, 90])) + '"></header>',
  '<section class="slide"><h1>导入编辑验收标题</h1><p>第一页正文，用于验收排版扩展。</p>',
  '<img alt="城市天际线配图" src="' + pngDataUrl(initialPng) + '"></section>',
  '<section class="slide"><h1>第二页标题</h1><p>第二页正文。</p></section>',
  "</body>",
  "</html>",
].join("\n");
const importedDeckPath = path.join(samplesDir, "导入编辑验收.html");
await writeFile(importedDeckPath, importedDeckHtml, "utf8");

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

  // ---------------------------------------------------------------------------
  // 路径一：生成项目上的排版扩展与图片替换。
  // ---------------------------------------------------------------------------
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    ["排版扩展验收项目", "验证字体、粗细、字间距与图片替换在生成项目上可用。"].join("\n"),
  );
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();

  const editorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const heading = editorFrame.getByRole("heading", { level: 1 }).first();
  await heading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();

  // 原型屏幕 10：面板补齐字体、粗细、字间距，原有控件仍在。
  for (const label of ["文字内容", "字体", "字号", "粗细", "文字颜色", "字间距", "行距"]) {
    assert.ok(await page.getByLabel(label, { exact: true }).isVisible(), "面板缺少控件：" + label);
  }

  const fontFamily = page.getByLabel("字体", { exact: true });
  const fontWeight = page.getByLabel("粗细", { exact: true });
  const letterSpacing = page.getByLabel("字间距", { exact: true });

  await fontFamily.selectOption({ label: "Inter（无衬线）" });
  assert.match(await heading.evaluate((element) => getComputedStyle(element).fontFamily), /Inter/i,
    "字体修改必须即时生效");
  await fontWeight.selectOption({ label: "粗体 700" });
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).fontWeight), "700",
    "粗细修改必须即时生效");
  await letterSpacing.fill("2");
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).letterSpacing), "2px",
    "字间距修改必须即时生效");
  await page.screenshot({
    path: path.join(root, "output", "playwright", "issue-16-panel-text.png"),
    clip: { x: 1090, y: 100, width: 350, height: 620 },
  });

  // 排版修改可撤销/重做（逐项回退再逐项重做）。
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).letterSpacing), "normal",
    "撤销必须回退字间距");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.notEqual(await heading.evaluate((element) => getComputedStyle(element).fontWeight), "700",
    "撤销必须回退粗细");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.doesNotMatch(await heading.evaluate((element) => getComputedStyle(element).fontFamily), /Inter/i,
    "撤销必须回退字体");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.match(await heading.evaluate((element) => getComputedStyle(element).fontFamily), /Inter/i);
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).fontWeight), "700");
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).letterSpacing), "2px");

  // 原有四项排版不回退。
  await page.getByRole("spinbutton", { name: "字号", exact: true }).fill("58");
  await page.getByRole("button", { name: "居中对齐", exact: true }).click();
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).fontSize), "58px");
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).textAlign), "center");

  // 图片替换：替换后画布立即更新，可撤销/重做。
  const editableImage = editorFrame.getByRole("img", { name: "森林和演示页面的抽象示意" });
  await editorFrame.getByRole("button", { name: "下一页", exact: true }).click();
  await editableImage.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  await page.getByText("拖动改变位置，四角控制点等比例缩放", { exact: false }).waitFor();
  assert.equal(await page.locator("#text-controls").isVisible(), false,
    "选中图片时文字控件区应隐藏（对齐原型屏幕 11）");
  await page.getByRole("button", { name: "替换图片", exact: true }).waitFor();
  await page.screenshot({
    path: path.join(root, "output", "playwright", "issue-16-image-selected.png"),
    fullPage: true,
  });
  const srcBefore = await editableImage.evaluate((element) => element.getAttribute("src"));
  await page.locator("#image-file-input").setInputFiles({
    name: "替换图.png",
    mimeType: "image/png",
    buffer: replacementPng,
  });
  const srcAfterReplace = await editableImage.evaluate((element) => element.getAttribute("src"));
  assert.notEqual(srcAfterReplace, srcBefore, "替换后画布图片必须立即更新");
  assert.match(srcAfterReplace, /^data:image\/png;base64,/, "替换图片必须读入为内嵌数据");
  await page.screenshot({
    path: path.join(root, "output", "playwright", "issue-16-panel-image.png"),
    clip: { x: 1090, y: 100, width: 350, height: 300 },
  });

  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await editableImage.evaluate((element) => element.getAttribute("src")), srcBefore,
    "撤销必须回退图片替换");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.equal(await editableImage.evaluate((element) => element.getAttribute("src")), srcAfterReplace,
    "重做必须恢复图片替换");

  // 保存重开：排版与替换后的图片都保持。
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const previewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  await previewFrame.getByRole("img", { name: "森林和演示页面的抽象示意" }).waitFor();
  assert.match(
    await previewFrame.getByRole("img", { name: "森林和演示页面的抽象示意" }).evaluate((element) =>
      element.getAttribute("src"),
    ),
    /^data:image\/png;base64,/,
    "预览中的替换图片必须保持",
  );

  await page.getByRole("button", { name: "返回首页" }).click();
  const generatedCard = page.getByRole("article", { name: "排版扩展验收项目" });
  await generatedCard.waitFor();
  await generatedCard.click();
  await page.getByTestId("preview").waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const reopenedFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const reopenedHeading = reopenedFrame.getByRole("heading", { level: 1 }).first();
  await reopenedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.match(await page.getByLabel("字体", { exact: true }).inputValue(), /Inter/i,
    "重开后字体选择必须与保存一致");
  assert.equal(await page.getByLabel("粗细", { exact: true }).inputValue(), "700",
    "重开后粗细选择必须与保存一致");
  assert.equal(await page.getByLabel("字间距", { exact: true }).inputValue(), "2",
    "重开后字间距必须与保存一致");

  // ---------------------------------------------------------------------------
  // 路径二：导入项目的普通内容图片接入编辑（无需 data-editable-image 标记）。
  // ---------------------------------------------------------------------------
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: /导入演示/ }).click();
  await page.locator("#import-file-input").setInputFiles(importedDeckPath);
  await page.getByRole("button", { name: "开始检查", exact: true }).click();
  await page.getByTestId("import-report").waitFor();
  await page.getByText("可编辑文字 4 处", { exact: true }).waitFor();
  await page.getByText("可编辑图片 1 张", { exact: true }).waitFor();
  await page.getByRole("button", { name: "仍要进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();

  const importEditorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const importedImage = importEditorFrame.getByRole("img", { name: "城市天际线配图" });
  await importedImage.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  const importedSrcBefore = await importedImage.evaluate((element) => element.getAttribute("src"));
  await page.locator("#image-file-input").setInputFiles({
    name: "新配图.png",
    mimeType: "image/png",
    buffer: replacementPng,
  });
  const importedSrcAfter = await importedImage.evaluate((element) => element.getAttribute("src"));
  assert.notEqual(importedSrcAfter, importedSrcBefore, "导入项目的普通内容图片必须可以替换");
  assert.match(importedSrcAfter, /^data:image\/png;base64,/);

  // 导入项目文字同样支持排版扩展。
  const importedHeading = importEditorFrame.getByRole("heading", { level: 1 }).first();
  await importedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByLabel("字体", { exact: true }).selectOption({ label: "Noto Sans SC（中文无衬线）" });
  await page.getByLabel("粗细", { exact: true }).selectOption({ label: "中等 500" });
  await page.getByLabel("字间距", { exact: true }).fill("1.5");
  assert.match(await importedHeading.evaluate((element) => getComputedStyle(element).fontFamily),
    /Noto Sans SC/i);
  assert.equal(await importedHeading.evaluate((element) => getComputedStyle(element).fontWeight), "500");
  assert.equal(await importedHeading.evaluate((element) => getComputedStyle(element).letterSpacing), "1.5px");

  // 锁定元素（页眉 Logo）不可替换，得到明确提示。
  const importPreviewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  void importPreviewFrame;
  const lockedLogo = importEditorFrame.locator("header img");
  await lockedLogo.click({ force: true });
  await page.getByText("这个元素不可编辑", { exact: true }).waitFor();
  await page.getByText("点击 SVG 装饰、Logo 或背景时出现", { exact: false }).waitFor();

  // 保存重开：导入项目的替换与排版保持。
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返回首页" }).click();
  const importedCard = page.getByRole("article", { name: "导入编辑验收" });
  await importedCard.waitFor();
  await importedCard.click();
  await page.getByTestId("preview").waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const reopenedImportFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const reopenedImportImage = reopenedImportFrame.getByRole("img", { name: "城市天际线配图" });
  await reopenedImportImage.waitFor();
  assert.equal(
    await reopenedImportImage.evaluate((element) => element.getAttribute("src")),
    importedSrcAfter,
    "重开后导入项目的替换图片必须保持",
  );
  const reopenedImportHeading = reopenedImportFrame.getByRole("heading", { level: 1 }).first();
  await reopenedImportHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.match(await page.getByLabel("字体", { exact: true }).inputValue(), /Noto Sans SC/i);
  assert.equal(await page.getByLabel("粗细", { exact: true }).inputValue(), "500");
  assert.equal(await page.getByLabel("字间距", { exact: true }).inputValue(), "1.5");

  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-16-controls.png"), fullPage: true });
  console.log("PASS: issue 16 typography and image replace work on generated and imported projects");
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

function pngDataUrl(buffer) {
  return "data:image/png;base64," + buffer.toString("base64");
}

// 生成指定纯色 1×1 PNG（真彩 RGB，无依赖）。
function png1x1([red, green, blue]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const scanline = Buffer.from([0, red, green, blue]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanline)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & (-(crc & 1) & 0xffffffff));
    }
  }
  return ~crc;
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
