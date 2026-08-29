import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
await mkdir(path.join(root, "output", "playwright"), { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "imported-export-"));
const samplesDir = path.join(outputRoot, "imported-export-samples");
await mkdir(samplesDir, { recursive: true });
const port = 4335;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const REMOTE_IMAGE_URL = "https://example.com/remote-photo.png";
const REMOTE_IMAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const INLINE_SVG_DATA_URL =
  "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22260%22%3E%3Crect%20width%3D%22400%22%20height%3D%22260%22%20fill%3D%22%23173b2a%22%2F%3E%3C%2Fsvg%3E";

// 含 https 图片、外部样式表与脚本的导入样本：导出必须保留图片链接，
// 移除脚本与外部样式表依赖，并注入产品提供的纯 CSS 静态翻页。
const remoteImageDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>远程图片演示</title>",
  '<link rel="stylesheet" href="https://cdn.example.com/deck.css">',
  "<style>",
  "body{margin:0;overflow:hidden;background:#f4f1e8;font-family:sans-serif}",
  "#deck{display:flex;width:300vw}",
  ".slide{width:100vw;height:100vh;box-sizing:border-box;padding:64px;position:relative}",
  "</style>",
  "</head>",
  "<body>",
  '<div id="deck">',
  '<section class="slide"><h1>远程图片演示</h1>',
  '<img class="remote-photo" alt="远程配图" src="' + REMOTE_IMAGE_URL + '">',
  "<p>第一页使用 https 远程图片。</p></section>",
  '<section class="slide"><h1>第二页</h1><p>翻页验证第二页。</p></section>',
  '<section class="slide"><h1>第三页</h1><p>翻页验证第三页。</p></section>',
  "</div>",
  "<script>",
  "window.__importedDeckScriptRan = true;",
  "</script>",
  "</body>",
  "</html>",
].join("\n");
const remoteImageDeckPath = path.join(samplesDir, "远程图片演示.html");
await writeFile(remoteImageDeckPath, remoteImageDeckHtml, "utf8");

// 仅自包含图片的导入样本：用于 PDF 页数与页面尺寸验收（渲染不受外部网络影响）。
const dataImageDeckHtml = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '<meta charset="UTF-8">',
  "<title>导入 PDF 演示</title>",
  "<style>",
  "body{margin:0;font-family:sans-serif}",
  ".slide{width:100vw;height:100vh;box-sizing:border-box;padding:64px;position:relative}",
  "</style>",
  "</head>",
  "<body>",
  '<section class="slide"><h1>导入 PDF 演示</h1>',
  '<img alt="内嵌配图" src="' + INLINE_SVG_DATA_URL + '">',
  "<p>第一页内容。</p></section>",
  '<section class="slide"><h1>第二页</h1><p>PDF 分页验证。</p></section>',
  "</body>",
  "</html>",
].join("\n");
const dataImageDeckPath = path.join(samplesDir, "导入 PDF 演示.html");
await writeFile(dataImageDeckPath, dataImageDeckHtml, "utf8");

// 生成项目回归夹具：生成结果带普通 https 图片时，生成检查仍然拒绝
// （自包含检查照旧）；data-editable-image 用 data: 来源以先通过图片兼容检查。
const generatedRejectFixturePath = path.join(samplesDir, "generated-external-reject.html");
const generatedRejectFixtureHtml = [
  "<!doctype html>",
  "<html>",
  "<head>",
  '<meta charset="UTF-8">',
  "<style>.slide{width:100vw;height:100vh;box-sizing:border-box;padding:64px}</style>",
  "</head>",
  "<body>",
  '<section class="slide"><h1>生成项目外部资源拒绝回归</h1>',
  '<img data-editable-image="true" alt="内嵌演示图" src="' + INLINE_SVG_DATA_URL + '">',
  '<img class="external-photo" alt="外链配图" src="https://cdn.example.com/external-photo.png"></section>',
  '<section class="slide"><h1>第二页</h1></section>',
  "</body>",
  "</html>",
].join("\n");
await writeFile(generatedRejectFixturePath, generatedRejectFixtureHtml, "utf8");

const server = spawn(
  process.execPath,
  [
    "src/server.mjs",
    "--fixture",
    "--fixture-file",
    generatedRejectFixturePath,
    "--no-open",
    "--port",
    String(port),
    "--data-dir",
    dataDir,
  ],
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
let viewerBrowser;
let page;
let standalone;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));
  page.on("requestfailed", (request) =>
    browserOutput.push(
      "requestfailed: " + request.method() + " " + request.url() + " " + (request.failure()?.errorText || ""),
    ),
  );

  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();

  // ---------------------------------------------------------------------------
  // 1. 含 https 图片的导入项目导出 HTML：图片链接保留，脚本与 file:// 不出现。
  // ---------------------------------------------------------------------------
  await importDeck(page, remoteImageDeckPath, "远程图片演示.html");
  await page.getByRole("button", { name: "进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const editorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await editorFrame.getByRole("heading", { level: 1 }).first().click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("远程图片演示改过的标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();

  // 导出流程先保存再请求导出接口；本地导出完成极快，等待接口响应而不是
  // 瞬时即逝的中间状态文案，最后断言导出完成的终态提示。
  const exportResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/exports/html") && response.request().method() === "POST",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  const exportResponse = await exportResponsePromise;
  assert.equal(exportResponse.status(), 200, "HTML 导出接口应成功返回");
  const download = await downloadPromise;
  await page.getByText("HTML 导出成功", { exact: true }).waitFor();
  assert.equal(download.suggestedFilename(), "远程图片演示.html", "导出文件名应为项目名");
  const exportedPath = path.join(root, "output", "playwright", "issue-19-imported-export.html");
  await download.saveAs(exportedPath);
  const exportedHtml = await readFile(exportedPath, "utf8");

  assert.match(
    exportedHtml,
    /<img\b[^>]*\bsrc=["']https:\/\/example\.com\/remote-photo\.png["'][^>]*>/i,
    "导出的 HTML 必须保留 https 图片链接",
  );
  assert.match(
    exportedHtml,
    /<img\b[^>]*class=["'][^"']*remote-photo[^"']*["'][^>]*>/i,
    "https 图片应保留其标记便于断言",
  );
  assert.doesNotMatch(exportedHtml, /<script\b/i, "导出的 HTML 不得包含任何脚本");
  assert.doesNotMatch(exportedHtml, /file:\/\//i, "导出的 HTML 不得包含本地 file:// 引用");
  assert.doesNotMatch(
    exportedHtml,
    /<link\b[^>]*\bhref=["']https?:\/\//i,
    "导出的 HTML 不得保留外部样式表依赖",
  );
  assert.match(exportedHtml, /data-product-static-paging/, "导出的 HTML 必须注入产品静态翻页片段");

  // 离线打开：逐页翻页（产品提供的纯 CSS 静态翻页，无脚本参与）。
  // 用独立浏览器模拟用户前台打开导出文件：共享同一浏览器时后台页的
  // 合成器帧会被挂起，逐页吸附动画不推进，翻页断言会假性超时。
  const viewerBrowser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  standalone = await viewerBrowser.newPage({ viewport: { width: 1280, height: 720 } });
  await standalone.context().setOffline(true);
  standalone.on("requestfailed", (request) =>
    browserOutput.push("standalone requestfailed: " + request.method() + " " + request.url() + " " + (request.failure()?.errorText || "")),
  );
  standalone.on("console", (message) => browserOutput.push("standalone console: " + message.text()));
  await standalone.goto(pathToFileURL(exportedPath).href);
  assert.equal(await standalone.evaluate(() => window.scrollY), 0, "离线打开应停留在第一页");
  await assertSlideOnScreen(standalone, "远程图片演示改过的标题");

  await standalone.keyboard.press("PageDown");
  await waitFor(standalone, (p) => p.evaluate(() => Math.abs(window.scrollY - window.innerHeight) < 4));
  await assertSlideOnScreen(standalone, "第二页");

  await standalone.keyboard.press("PageDown");
  await waitFor(standalone, (p) => p.evaluate(() => Math.abs(window.scrollY - window.innerHeight * 2) < 4));
  await assertSlideOnScreen(standalone, "第三页");

  // 翻页是逐页吸附：滚动到页间位置会被拉回最近的页界。
  await standalone.evaluate(() => window.scrollTo(0, Math.floor(window.innerHeight / 2)));
  // 逐页吸附会把页间滚动拉回页界；从 Node 侧轮询，后台页的 rAF/定时器会被节流。
  await waitFor(
    standalone,
    (p) =>
      p.evaluate(() => {
        const halfway = Math.floor(window.innerHeight / 2);
        return Math.abs(window.scrollY - halfway) > 2;
      }),
  );
  const snapped = await standalone.evaluate(() => window.scrollY);
  assert.ok(
    Math.abs(snapped) < 4 || Math.abs(snapped - 720) < 4,
    `页间滚动必须吸附回页界，实际 scrollY=${snapped}`,
  );

  assert.equal(
    await standalone.locator("img.remote-photo").getAttribute("src"),
    REMOTE_IMAGE_URL,
    "离线打开时 https 图片元素与链接仍保留",
  );
  const badgeTexts = await standalone.locator("[data-product-page-badge]").allTextContents();
  assert.deepEqual(badgeTexts, ["1 / 3", "2 / 3", "3 / 3"], "每页应显示导出时写定的页码徽章");
  await standalone.screenshot({ path: path.join(root, "output", "playwright", "issue-19-offline-paging.png") });
  await standalone.close();
  standalone = null;

  // 在线打开：https 图片真实加载（远程请求由测试路由固定返回）。
  const online = await viewerBrowser.newPage({ viewport: { width: 1280, height: 720 } });
  await online.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === REMOTE_IMAGE_URL) {
      await route.fulfill({ status: 200, contentType: "image/png", body: REMOTE_IMAGE_PNG });
      return;
    }
    if (/^https?:\/\//i.test(url)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  await online.route(
    "http://aps.export.test/exported.html",
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: exportedHtml,
      }),
  );
  await online.goto("http://aps.export.test/exported.html");
  await waitFor(online, (p) =>
    p.evaluate(() => {
      const image = document.querySelector("img.remote-photo");
      return Boolean(image && image.complete && image.naturalWidth > 0);
    }),
  );
  console.log("EVIDENCE: exported imported deck renders its https image online (naturalWidth > 0)");
  await online.close();
  await viewerBrowser.close();

  // ---------------------------------------------------------------------------
  // 2. 导入项目导出 PDF：页数与页面尺寸符合演示页面设定（1280x720 -> 960x540pt）。
  // ---------------------------------------------------------------------------
  await page.getByRole("button", { name: "返回首页" }).click();
  await importDeck(page, dataImageDeckPath, "导入 PDF 演示.html");
  await page.getByRole("button", { name: "进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const pdfEditorFrame = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await pdfEditorFrame.getByRole("heading", { level: 1 }).first().click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("导入 PDF 演示改过的标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();

  const pdfResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/exports/pdf") && response.request().method() === "POST",
  );
  const pdfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const pdfResponse = await pdfResponsePromise;
  assert.equal(pdfResponse.status(), 200, "PDF 导出接口应成功返回");
  const pdfDownload = await pdfDownloadPromise;
  await page.getByText("PDF 导出成功", { exact: true }).waitFor();
  const pdfPath = path.join(root, "output", "playwright", "issue-19-imported-export.pdf");
  await pdfDownload.saveAs(pdfPath);

  const pdfBytes = await readFile(pdfPath);
  const pdfLoadingTask = getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await pdfLoadingTask.promise;
  assert.equal(pdf.numPages, 2, "每张导入幻灯片必须对应一页 PDF");
  const [, , pageWidth, pageHeight] = (await pdf.getPage(1)).view;
  assert.ok(Math.abs(pageWidth - 960) < 0.5, `PDF 页面宽度应为 960pt，实际 ${pageWidth}`);
  assert.ok(Math.abs(pageHeight - 540) < 0.5, `PDF 页面高度应为 540pt，实际 ${pageHeight}`);
  const firstPageText = (await (await pdf.getPage(1)).getTextContent()).items
    .map((item) => item.str)
    .join("")
    .replaceAll(/\s/g, "");
  assert.match(firstPageText, /导入PDF演示改过的标题/, "PDF 首页必须保留导入项目的编辑内容");
  await pdfLoadingTask.destroy();

  // ---------------------------------------------------------------------------
  // 3. 生成项目回归：外部资源仍被拒绝，失败提示仍清晰。
  // ---------------------------------------------------------------------------
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    ["生成项目外部资源拒绝回归", "带普通 https 图片的材料不能通过生成检查。"].join("\n"),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("heading", { name: "生成失败", exact: true }).waitFor({ timeout: 15_000 });
  await page
    .locator("#generation-message")
    .getByText(/演示仍包含未内嵌的外部资源/)
    .waitFor();
  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-19-generated-reject.png"), fullPage: true });

  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-19-imported-export.png"), fullPage: true });
  console.log(
    "EVIDENCE: imported deck exported with https image kept, offline paging 1/3 -> 3/3, no scripts or file://; imported PDF 2 pages at 960x540pt; generated deck with external image still rejected",
  );
  console.log("PASS: Issue #19 imported HTML export relaxation works through the public UI");
} catch (error) {
  try {
    if (page) {
      browserOutput.push(
        "export-status: " + (await page.locator("#export-status").textContent().catch(() => "(n/a)")),
      );
      await page
        .screenshot({ path: path.join(root, "output", "playwright", "issue-19-failure.png"), fullPage: true })
        .catch(() => {});
    }
  } catch {}
  throw new Error(
    error.message +
      "\n\nServer output:\n" +
      serverOutput.join("") +
      "\nBrowser output:\n" +
      browserOutput.join("\n"),
  );
} finally {
  if (viewerBrowser) await viewerBrowser.close().catch(() => {});
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

// 独立页在后台会被 Chrome 节流 rAF 与定时器，waitForFunction 的页面内轮询
// 可能长期不执行；条件检测从 Node 侧定时 evaluate，不受节流影响。
async function waitFor(page, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate(page)) return;
    await delay(200);
  }
  throw new Error("等待条件超时（" + timeoutMs + "ms）。");
}

async function importDeck(page, samplePath, fileName) {
  await page.getByRole("button", { name: /导入演示/ }).click();
  await page.locator("#import-dialog").waitFor();
  await page.locator("#import-file-input").setInputFiles(samplePath);
  await page.getByText(fileName, { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始检查", exact: true }).click();
  await page.getByTestId("import-report").waitFor();
  assert.equal(await page.getByTestId("import-verdict").textContent(), "完全可编辑");
  await page.getByText("已创建演示项目", { exact: false }).waitFor();
}

async function assertSlideOnScreen(page, headingName) {
  const box = await page.getByRole("heading", { name: headingName, exact: true }).boundingBox();
  assert.ok(box, `当前页应显示标题「${headingName}」`);
  assert.ok(
    box.y >= -2 && box.y < 720,
    `标题「${headingName}」应在当前视口内，实际 y=${box.y}`,
  );
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
