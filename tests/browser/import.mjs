import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
await mkdir(path.join(root, "output", "playwright"), { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "import-"));
const samplesDir = path.join(outputRoot, "import-samples");
await mkdir(samplesDir, { recursive: true });
const port = 4334;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const IMPORT_SIZE_LIMIT_TEXT = "10 MB";

const sampleDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>导入验收演示</title>",
  "<style>",
  "body{margin:0;overflow:hidden;background:#f4f1e8;font-family:sans-serif}",
  "#deck{display:flex;width:300vw;transition:transform .3s}",
  ".slide{width:100vw;height:100vh;box-sizing:border-box;padding:64px;position:relative}",
  "@keyframes fade{from{opacity:0}to{opacity:1}}",
  "h1{animation:fade 1s ease both}",
  "</style>",
  "</head>",
  "<body>",
  '<div id="deck">',
  '<section class="slide"><h1>导入验收演示</h1><p onclick="void(0)">第一页内容，用于验收导入检查。</p>',
  '<img data-editable-image="true" alt="示例配图" src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22260%22%3E%3Crect%20width%3D%22400%22%20height%3D%22260%22%20fill%3D%22%23173b2a%22%2F%3E%3C%2Fsvg%3E"></section>',
  '<section class="slide page-two"><h1>第二页</h1><p>多页结构验证。</p></section>',
  '<section class="slide"><h1>第三页</h1><p>结束页。</p></section>',
  "</div>",
  '<nav><button data-prev>上一页</button><button data-next>下一页</button></nav>',
  "<script>",
  "window.__importedScriptRan = true;",
  "document.addEventListener('keydown', () => { window.__importedKeyHandlerRan = true; });",
  "</script>",
  "</body>",
  "</html>",
].join("\n");

const sampleDeckPath = path.join(samplesDir, "导入验收演示.html");
await writeFile(sampleDeckPath, sampleDeckHtml, "utf8");
const sampleDeckBytes = await readFile(sampleDeckPath);

const noPagesHtml = [
  "<!doctype html>",
  "<html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><title>无页面结构</title></head>",
  "<body><article><h1>一份没有页面结构的文档</h1><p>只有单个内容块，识别不出演示页面。</p></article></body></html>",
].join("\n");
const noPagesPath = path.join(samplesDir, "no-pages.html");
await writeFile(noPagesPath, noPagesHtml, "utf8");

const partialDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>部分可编辑演示</title>",
  "</head>",
  "<body>",
  '<header><img class="logo" src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22%23173b2a%22%2F%3E%3C%2Fsvg%3E" alt="品牌标识"></header>',
  '<section class="slide">',
  '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#e8f0e4"></circle></svg>',
  "<h1>部分可编辑验收演示标题</h1>",
  "<p>第一页带 SVG 装饰，正文文字仍可编辑。</p>",
  "</section>",
  '<section class="slide" style="background:linear-gradient(#f7f4e8,#e2ddd0)">',
  "<h1>第二页渐变背景</h1>",
  "<p>本页背景渐变将被锁定为原样显示。</p>",
  "</section>",
  "</body>",
  "</html>",
].join("\n");
const partialDeckPath = path.join(samplesDir, "部分可编辑演示.html");
await writeFile(partialDeckPath, partialDeckHtml, "utf8");

const reactAppHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>React 演示</title>",
  "</head>",
  "<body>",
  '<div id="root"></div>',
  '<script src="https://cdn.example.com/react.production.min.js"></script>',
  "<script>ReactDOM.createRoot(document.getElementById(\"root\")).render(children);</script>",
  "</body>",
  "</html>",
].join("\n");
const reactAppPath = path.join(samplesDir, "react-app.html");
await writeFile(reactAppPath, reactAppHtml, "utf8");

const textPath = path.join(samplesDir, "说明文档.txt");
await writeFile(textPath, "这不是 HTML 文件，只是普通文本。", "utf8");

const largePath = path.join(samplesDir, "超大演示.html");
const largePadding = "<!-- " + "x".repeat(1024) + " -->\n";
await writeFile(
  largePath,
  "<!doctype html><html><head><title>超大</title></head><body><!--pad--></body></html>",
  "utf8",
);
await appendPadding(largePath, 10 * 1024 * 1024 + 512, largePadding);

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

  // 1. 首页「导入演示」同级入口。
  const importEntry = page.getByRole("button", { name: /导入演示/ });
  await importEntry.waitFor();
  await importEntry.click();

  // 2. 上传对话框：说明文案、未选文件禁用、可取消。
  const importDialog = page.locator("#import-dialog");
  await importDialog.waitFor();
  await page.getByText("上传 HTML 演示文稿", { exact: true }).waitFor();
  await page.getByText("仅支持单个自包含 HTML 文件", { exact: true }).waitFor();
  const startButton = page.getByRole("button", { name: "开始检查", exact: true });
  assert.equal(await startButton.isDisabled(), true, "未选择文件时开始检查必须禁用");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await importDialog.evaluate((element) => element.open), false, "取消后对话框应关闭");

  // 3. 拖拽选择文件。
  await importEntry.click();
  const dropzone = page.locator("#import-dropzone");
  const dataTransfer = await page.evaluateHandle((content) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], "拖拽导入.html", { type: "text/html" }));
    return transfer;
  }, sampleDeckHtml);
  await dropzone.dispatchEvent("drop", { dataTransfer });
  await page.getByText("拖拽导入.html", { exact: true }).waitFor();
  assert.equal(await startButton.isDisabled(), false, "选择文件后开始检查必须可用");
  await page.getByRole("button", { name: "移除", exact: true }).click();
  assert.equal(await startButton.isDisabled(), true, "移除文件后开始检查必须回到禁用");

  // 4. 点击选择文件，走完整导入链路。
  await page.locator("#import-file-input").setInputFiles(sampleDeckPath);
  await page.getByText("导入验收演示.html", { exact: true }).waitFor();
  await startButton.click();

  const reportView = page.getByTestId("import-report");
  await reportView.waitFor();
  await page.getByText("导入检查报告", { exact: false }).waitFor();
  const verdictPill = page.getByTestId("import-verdict");
  assert.equal(await verdictPill.textContent(), "完全可编辑");
  await page.getByText("未修改原文件", { exact: false }).waitFor();
  await page.getByText("页面结构识别", { exact: true }).waitFor();
  await page.getByText("通过「slide 类名规则」识别出 3 页幻灯片", { exact: true }).waitFor();
  await page.getByText("已移除 1 段脚本", { exact: true }).waitFor();
  await page.getByText("3 处 CSS 动画已转为静态", { exact: true }).waitFor();
  await page.getByText("识别出 6 处可编辑文字、1 张可编辑图片", { exact: true }).waitFor();
  await page.getByText("文件类型", { exact: true }).waitFor();
  await page.getByText("文件大小", { exact: true }).waitFor();
  const passBadges = await page.getByText("通过", { exact: true }).count();
  assert.ok(passBadges >= 7, "每条通过规则都应显示通过徽章");
  await page.getByText("已创建演示项目「导入验收演示」", { exact: true }).waitFor();

  // 5. 进入现有安全预览：脚本不得运行，导入项目没有「重新生成」。
  await page.getByRole("button", { name: "进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByText("预览模式", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "重新生成", exact: true }).count(),
    0,
    "导入项目不得显示重新生成入口",
  );
  const previewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  const scriptRan = await previewFrame.locator("body").evaluate(() => window.__importedScriptRan === true);
  assert.equal(scriptRan, false, "导入副本不得运行原文件脚本");
  await previewFrame.getByRole("heading", { name: "导入验收演示", level: 1 }).waitFor();

  // 6. 现有编辑器编辑导入项目并保存。
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const editorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  const editableHeading = editorFrame.getByRole("heading", { level: 1 }).first();
  await editableHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  const textContent = page.getByRole("textbox", { name: "文字内容", exact: true });
  await textContent.fill("导入验收改过的标题");
  assert.equal(await editableHeading.textContent(), "导入验收改过的标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  await previewFrame
    .getByRole("heading", { name: "导入验收改过的标题", level: 1 })
    .waitFor({ timeout: 5_000 });

  // 7. 从首页重新打开，修改保持；原始文件字节不变；项目记录带契约新字段。
  await page.getByRole("button", { name: "返回首页" }).click();
  const importedCard = page.getByRole("article", { name: "导入验收演示" });
  await importedCard.waitFor();
  assert.match(await importedCard.textContent(), /导入 · 最后修改/);
  await importedCard.click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await previewFrame
    .getByRole("heading", { name: "导入验收改过的标题", level: 1 })
    .waitFor({ timeout: 5_000 });

  const listed = await fetch(baseUrl + "/api/projects").then((response) => response.json());
  const importedRecord = listed.find((project) => project.originalFileName === "导入验收演示.html");
  assert.ok(importedRecord, "项目列表必须包含导入项目");
  assert.equal(importedRecord.sourceType, "imported");
  assert.equal(importedRecord.verdict, "完全可编辑");
  assert.ok(importedRecord.importReport, "项目记录必须包含导入检查报告");
  assert.equal(importedRecord.importReport.slideCount, 3);
  assert.equal(importedRecord.importReport.scriptCount, 1);
  assert.equal(importedRecord.name, "导入验收演示");
  const originalCopy = await readFile(path.join(dataDir, importedRecord.originalFile));
  assert.ok(
    originalCopy.equals(sampleDeckBytes),
    "原始上传文件副本必须与上传内容逐字节一致",
  );
  const recordDetail = await fetch(baseUrl + "/api/projects/" + importedRecord.id).then((response) =>
    response.json(),
  );
  assert.ok(
    recordDetail.importReport.rules.some((rule) => rule.id === "page-structure" && rule.status === "pass"),
    "导入检查报告必须包含页面识别规则结果",
  );

  // 8. 文件类型不符：只显示原因，不创建项目。
  await page.getByRole("button", { name: "返回首页" }).click();
  const countBadge = page.locator("#project-count");
  const countBefore = await countBadge.textContent();
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(textPath);
  await startButton.click();
  await reportView.waitFor();
  assert.equal(await page.getByTestId("import-verdict").textContent(), "暂不支持");
  await page.getByText("仅支持 .html 演示文稿文件", { exact: true }).waitFor();
  await page.getByText("未创建演示项目", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "进入编辑", exact: true }).count(),
    0,
    "暂不支持时不得提供进入编辑入口",
  );
  await page.locator(".import-report-actions").getByRole("button", { name: "返回首页" }).click();
  await page.locator("#project-count").waitFor();
  assert.equal(await countBadge.textContent(), countBefore, "被拒绝的文件不得创建项目记录");

  // 9. 超过大小上限：只显示原因，不创建项目。
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(largePath);
  await startButton.click();
  await reportView.waitFor();
  assert.equal(await page.getByTestId("import-verdict").textContent(), "暂不支持");
  await page.getByText("文件超过 " + IMPORT_SIZE_LIMIT_TEXT + " 大小上限", { exact: true }).waitFor();
  await page.getByText("未创建演示项目", { exact: true }).waitFor();
  await page.locator(".import-report-actions").getByRole("button", { name: "返回首页" }).click();
  await page.locator("#project-count").waitFor();
  assert.equal(await countBadge.textContent(), countBefore, "超大小上限不得创建项目记录");

  // 10. 无法识别页面：只显示原因，不创建项目。
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(noPagesPath);
  await startButton.click();
  await reportView.waitFor();
  assert.equal(await page.getByTestId("import-verdict").textContent(), "暂不支持");
  await page.getByText("无法识别演示页面", { exact: true }).waitFor();
  await page.getByText("未创建演示项目", { exact: true }).waitFor();
  await page.locator(".import-report-actions").getByRole("button", { name: "返回首页" }).click();
  await page.locator("#project-count").waitFor();
  assert.equal(await countBadge.textContent(), countBefore, "无法识别页面不得创建项目记录");

  // 11. 部分可编辑档：锁定清单支撑原型屏幕 8，报告与实际编辑体验一致。
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(partialDeckPath);
  await page.getByText("部分可编辑演示.html", { exact: true }).waitFor();
  await startButton.click();
  await reportView.waitFor();
  const partialPill = page.getByTestId("import-verdict");
  assert.equal(await partialPill.textContent(), "部分可编辑");
  assert.match((await partialPill.getAttribute("class")) || "", /is-partial/);
  await page.getByText("锁定元素清单", { exact: true }).waitFor();
  await page
    .getByText("SVG 装饰图形 1 处、背景渐变 1 处、页眉 Logo 1 处保持原样显示，不可编辑", { exact: true })
    .waitFor();
  const lockBadges = await page.getByText("锁定", { exact: true }).count();
  assert.ok(lockBadges >= 1, "锁定内容规则应显示锁定徽章");
  await page.getByText("已创建演示项目「部分可编辑演示」", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "output", "playwright", "import-partial.png"), fullPage: true });

  const partialRecord = await fetch(baseUrl + "/api/projects")
    .then((response) => response.json())
    .then((projects) => projects.find((project) => project.originalFileName === "部分可编辑演示.html"));
  assert.ok(partialRecord, "项目列表必须包含部分可编辑项目");
  assert.equal(partialRecord.verdict, "部分可编辑");
  const lockedInventory = partialRecord.importReport.lockedElements;
  assert.deepEqual(
    lockedInventory.map((item) => [item.category, item.count]),
    [
      ["SVG 装饰图形", 1],
      ["背景渐变", 1],
      ["页眉 Logo", 1],
    ],
    "锁定元素清单必须逐类别给出数量（支撑原型屏幕 8）",
  );
  for (const item of lockedInventory) {
    assert.ok(typeof item.reason === "string" && item.reason.length > 0, "每个锁定类别必须有原因");
  }

  await page.getByRole("button", { name: "进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const partialEditorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  assert.ok(
    (await partialEditorFrame.locator("svg circle").count()) >= 1,
    "锁定 SVG 必须在编辑画布中原样保留",
  );
  const partialHeading = partialEditorFrame.getByRole("heading", { level: 1 }).first();
  await partialHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("部分可编辑改过的标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const partialPreviewFrame = page.frameLocator('iframe[title="演示文稿预览"]');
  await partialPreviewFrame
    .getByRole("heading", { name: "部分可编辑改过的标题", level: 1 })
    .waitFor({ timeout: 5_000 });
  assert.ok(
    (await partialPreviewFrame.locator("svg circle").count()) >= 1,
    "锁定 SVG 在预览中保持原样显示",
  );
  await page.getByRole("button", { name: "返回首页" }).click();

  // 12. React 框架样本：并列给出框架与脚本生成内容两个原因（对齐原型屏幕 9）。
  const countAfterPartial = await countBadge.textContent();
  await importEntry.click();
  await page.locator("#import-file-input").setInputFiles(reactAppPath);
  await page.getByText("react-app.html", { exact: true }).waitFor();
  await startButton.click();
  await reportView.waitFor();
  assert.equal(await page.getByTestId("import-verdict").textContent(), "暂不支持");
  await page.getByText("检测到 React 框架", { exact: true }).waitFor();
  await page.getByText("页面内容由脚本动态生成", { exact: true }).waitFor();
  await page.getByText("未创建演示项目", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "进入编辑", exact: true }).count(),
    0,
    "暂不支持时不得提供进入编辑入口",
  );
  assert.equal(await countBadge.textContent(), countAfterPartial, "React 样本不得创建项目记录");
  await page.screenshot({ path: path.join(root, "output", "playwright", "import-react.png"), fullPage: true });

  await page.screenshot({ path: path.join(root, "output", "playwright", "import-green.png"), fullPage: true });
  console.log("PASS: import demo minimal flow works through the public UI");
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

async function appendPadding(target, targetSize, paddingUnit) {
  const unit = Buffer.byteLength(paddingUnit, "utf8");
  let current = (await readFile(target)).length;
  let extra = "";
  while (current < targetSize) {
    extra += paddingUnit;
    current += unit;
  }
  await writeFile(target, extra, { encoding: "utf8", flag: "a" });
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
