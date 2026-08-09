import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "export-"));
const fixturePath = path.join(dataDir, "export-fixture.html");
const fixtureHtml = (await readFile(path.join(root, "fixtures", "grove-deck.html"), "utf8"))
  .replace(
    "</head>",
    '<link rel="stylesheet" disabled href="https://fonts.googleapis.com/example.css">\n</head>',
  )
  .replace(
    "</style>",
    "[data-anim]{opacity:0}.slide.is-active [data-anim]{opacity:1}</style>",
  )
  .replace('<section class="slide">', '<section class="slide is-active">')
  .replace("<h2>先跑通一条完整链路</h2>", '<h2 data-anim="fade-up">先跑通一条完整链路</h2>')
  .replace(
    'counter.textContent = current + 1 + " / " + slides.length;',
    'slides.forEach((slide, index) => slide.classList.toggle("is-active", index === current));\n          counter.textContent = current + 1 + " / " + slides.length;',
  )
  .replace(
    "</body>",
    `<script>
      if (window.location.hostname === "aps.invalid") {
        document.querySelector("h1").textContent = "PDF 渲染不应执行项目脚本";
        window["op" + "en"]("http://127.0.0.1:4323/api/health", "_blank");
        window.location.href = "http://127.0.0.1:4323/api/health";
      }
    </script></body>`,
  );
await writeFile(fixturePath, fixtureHtml, "utf8");
const artifactDir = path.join(root, "output", "playwright");
await mkdir(artifactDir, { recursive: true });
const port = 4323;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const server = spawn(
  process.execPath,
  [
    "src/server.mjs",
    "--fixture",
    "--fixture-file",
    fixturePath,
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
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    ["Issue 5 导出演示", "从当前编辑状态导出中文 HTML 和 PDF。"].join("\n"),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await editor.getByRole("heading", { level: 1 }).first().click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("导出后仍然存在的中文标题");

  const completedRequests = [];
  page.on("requestfinished", (request) => completedRequests.push(request.method() + " " + new URL(request.url()).pathname));
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  await page.getByText("保存成功，正在导出 HTML", { exact: true }).waitFor();
  const download = await downloadPromise;
  const htmlPath = path.join(artifactDir, "issue-5-exported-deck.html");
  await download.saveAs(htmlPath);
  const exportedHtml = await readFile(htmlPath, "utf8");
  assert.doesNotMatch(
    exportedHtml,
    /<link\b[^>]*\bhref=["']https?:\/\//i,
    "自包含 HTML 不得保留外部字体或样式表依赖",
  );

  const saveFinished = completedRequests.findIndex((entry) => entry.startsWith("PATCH /api/projects/"));
  const exportFinished = completedRequests.findIndex((entry) => entry.includes("/exports/html"));
  assert.ok(saveFinished >= 0, "导出前必须通过公开保存接口保存编辑状态");
  assert.ok(exportFinished > saveFinished, "HTML 导出请求只能在保存请求完成后发生");

  const standalone = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await standalone.context().setOffline(true);
  await standalone.goto(pathToFileURL(htmlPath).href);
  assert.equal(
    await standalone.getByRole("heading", { level: 1 }).first().textContent(),
    "导出后仍然存在的中文标题",
  );
  const counter = standalone.locator("[data-slide-counter]");
  assert.equal(await counter.textContent(), "1 / 3");
  await standalone.getByRole("button", { name: "下一页", exact: true }).click();
  assert.equal(await counter.textContent(), "2 / 3");
  await standalone.close();

  await page.evaluate(() => {
    window.__apsPrintCalls = 0;
    window.print = () => {
      window.__apsPrintCalls += 1;
    };
  });
  const pagesBeforePdfExport = browser.contexts().flatMap((context) => context.pages()).length;
  const pdfRequestStart = completedRequests.length;
  const pdfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await page.getByText("保存成功，正在导出 PDF", { exact: true }).waitFor();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = path.join(artifactDir, "issue-5-exported-deck.pdf");
  await pdfDownload.saveAs(pdfPath);

  const pdfRequests = completedRequests.slice(pdfRequestStart);
  const pdfSaveFinished = pdfRequests.findIndex((entry) => entry.startsWith("PATCH /api/projects/"));
  const pdfExportFinished = pdfRequests.findIndex((entry) => entry.includes("/exports/pdf"));
  assert.ok(pdfSaveFinished >= 0, "PDF 导出前必须保存当前编辑状态");
  assert.ok(pdfExportFinished > pdfSaveFinished, "PDF 后端渲染只能在保存请求完成后开始");
  assert.equal(await page.evaluate(() => window.__apsPrintCalls), 0, "应用不得调用浏览器打印窗口");
  assert.equal(
    browser.contexts().flatMap((context) => context.pages()).length,
    pagesBeforePdfExport,
    "PDF 导出不得打开额外浏览器页面",
  );

  const pdfBytes = await readFile(pdfPath);
  const pdfLoadingTask = getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await pdfLoadingTask.promise;
  assert.equal(pdf.numPages, 3, "每张幻灯片必须对应一页 PDF");
  const firstPdfPage = await pdf.getPage(1);
  const [, , pageWidth, pageHeight] = firstPdfPage.view;
  assert.ok(Math.abs(pageWidth - 960) < 0.5, `PDF 页面宽度应为 960pt，实际 ${pageWidth}`);
  assert.ok(Math.abs(pageHeight - 540) < 0.5, `PDF 页面高度应为 540pt，实际 ${pageHeight}`);

  const text = (await firstPdfPage.getTextContent()).items.map((item) => item.str).join("");
  assert.match(text.replaceAll(/\s/g, ""), /导出后仍然存在的中文标题/);
  const secondPdfPage = await pdf.getPage(2);
  const secondPageText = (await secondPdfPage.getTextContent()).items
    .map((item) => item.str)
    .join("")
    .replaceAll(/\s/g, "");
  assert.match(secondPageText, /先跑通一条完整链路/, "PDF 后续页的动画文字必须立即可见");
  const operators = await firstPdfPage.getOperatorList();
  const fillColors = operators.fnArray.flatMap((operator, index) => {
    if (operator !== OPS.setFillRGBColor) return [];
    const args = operators.argsArray[index];
    const values = args?.length === 1 && args[0]?.length ? args[0] : args;
    return [typeof values === "string" ? values : Array.from(values || [])];
  });
  assert.ok(
    fillColors.some((color) => {
      if (typeof color === "string") return color.toLowerCase() === "#192b1b";
      const [red, green, blue] = color;
      return Math.abs(red - 25) <= 2 && Math.abs(green - 43) <= 2 && Math.abs(blue - 27) <= 2;
    }),
    `PDF 必须保留代表性深绿背景，实际填充色：${JSON.stringify(fillColors)}`,
  );
  await pdfLoadingTask.destroy();

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    [
      "PDF 导出失败重试演示",
      "[fixture:pdf-fail-once]",
      "第一次后端渲染失败后，项目必须保持可用并允许重试。",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const retryEditor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await retryEditor.getByRole("heading", { level: 1 }).first().click();
  await page
    .getByRole("textbox", { name: "文字内容", exact: true })
    .fill("渲染失败前已保存的中文标题");

  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await page
    .locator("#export-status")
    .getByText(
      "PDF 导出失败：本地浏览器未能完成渲染。项目已经保存，可以继续使用并重试。",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "导出 PDF", exact: true }).isEnabled(), true);

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "PDF 导出失败重试演示" }).click();
  assert.equal(
    await page
      .frameLocator('iframe[title="演示文稿预览"]')
      .getByRole("heading", { level: 1 })
      .first()
      .textContent(),
    "渲染失败前已保存的中文标题",
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await retryEditor.getByRole("heading", { level: 1 }).first().click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("重试后导出的中文标题");

  const retryDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const retryDownload = await retryDownloadPromise;
  const retryPdfPath = path.join(artifactDir, "issue-5-export-retry.pdf");
  await retryDownload.saveAs(retryPdfPath);
  const retryPdfLoadingTask = getDocument({ data: new Uint8Array(await readFile(retryPdfPath)) });
  const retryPdf = await retryPdfLoadingTask.promise;
  const retryText = (await (await retryPdf.getPage(1)).getTextContent()).items
    .map((item) => item.str)
    .join("")
    .replaceAll(/\s/g, "");
  assert.match(retryText, /重试后导出的中文标题/);
  await retryPdfLoadingTask.destroy();

  await page.screenshot({ path: path.join(artifactDir, "issue-5-export-green.png"), fullPage: true });
  console.log(
    `EVIDENCE: standalone HTML reached 2 / 3 offline; PDF pages=${pdf.numPages}, size=${pageWidth}x${pageHeight}pt, background=#192b1b`,
  );
  console.log("PASS: Issue #5 HTML/PDF export and render-failure retry work through the public UI");
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverExit) {
      throw new Error(`Server exited before it became ready (${JSON.stringify(serverExit)}).\n${serverOutput.join("")}`);
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
