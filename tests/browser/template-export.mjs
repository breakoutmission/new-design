import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aps-template-export-"));
const artifactDir = path.join(root, "output", "playwright", "issue-6-fixed");
await mkdir(artifactDir, { recursive: true });
const port = 4331;
const baseUrl = "http://127.0.0.1:" + port;
const templates = [
  { name: "Blue Professional", slug: "blue-professional", background: [253, 250, 231] },
  { name: "Biennale Yellow", slug: "biennale-yellow", background: [233, 229, 219] },
  { name: "Cobalt Grid", slug: "cobalt-grid", background: [240, 235, 222] },
  { name: "Studio", slug: "studio", background: [28, 28, 28] },
  { name: "Grove", slug: "grove", background: [25, 43, 27] },
];
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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  for (const template of templates) {
    const projectName = template.name + " 导出资格测试";
    const editedText = "ISSUE6 " + template.slug.toUpperCase() + " EXPORT";
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
      projectName + "\n验证离线 HTML 和本地 PDF。",
    );
    await page.getByRole("radio", { name: new RegExp("^" + template.name + " —") }).check();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByTestId("preview").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "编辑", exact: true }).click();

    const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
    const editableText = editor.locator(".slide").first().locator("h1,h2,h3,h4,h5,h6,p").first();
    await editableText.click();
    await page.getByRole("textbox", { name: "文字内容", exact: true }).fill(editedText);

    const htmlDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
    const htmlDownload = await htmlDownloadPromise;
    const htmlPath = path.join(artifactDir, template.slug + ".html");
    await htmlDownload.saveAs(htmlPath);
    const exportedHtml = await readFile(htmlPath, "utf8");
    assert.doesNotMatch(exportedHtml, /file:\/\//i, template.name + " HTML 不得引用本地文件");
    assert.doesNotMatch(
      exportedHtml,
      /<(?:link|script|img|source|video|audio|iframe)\b[^>]*(?:href|src)=["']https?:\/\//i,
      template.name + " HTML 不得保留运行时外部资源",
    );
    assert.match(exportedHtml, new RegExp(editedText), template.name + " HTML 必须包含当前编辑文字");
    const slideCount = Array.from(exportedHtml.matchAll(/class=["']([^"']*)["']/gi)).filter((match) =>
      match[1].split(/\s+/).includes("slide"),
    ).length;
    assert.ok(slideCount >= 2, template.name + " HTML 必须保留完整多页结构");

    const standaloneContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      offline: true,
    });
    const standalone = await standaloneContext.newPage();
    await standalone.goto(pathToFileURL(htmlPath).href);
    await standalone.getByText(editedText, { exact: true }).waitFor();
    const counter = standalone.locator("[data-slide-counter]");
    const counterBefore = (await counter.textContent()).trim();
    await standalone.locator("body").press("ArrowRight");
    await standalone.waitForFunction(
      (before) => document.querySelector("[data-slide-counter]")?.textContent.trim() !== before,
      counterBefore,
    );
    assert.notEqual((await counter.textContent()).trim(), counterBefore, template.name + " 离线 HTML 必须可翻页");
    await standaloneContext.close();

    const pdfDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = path.join(artifactDir, template.slug + ".pdf");
    await pdfDownload.saveAs(pdfPath);
    const pdfTask = getDocument({ data: new Uint8Array(await readFile(pdfPath)) });
    const pdf = await pdfTask.promise;
    assert.equal(pdf.numPages, slideCount, template.name + " 每张幻灯片必须对应一页 PDF");
    const firstPage = await pdf.getPage(1);
    const text = (await firstPage.getTextContent()).items
      .map((item) => item.str)
      .join("")
      .replaceAll(/\s/g, "");
    assert.match(text, new RegExp(editedText.replaceAll(/\s/g, "")), template.name + " PDF 必须包含编辑文字");
    const operators = await firstPage.getOperatorList();
    const colors = operators.fnArray.flatMap((operator, index) => {
      if (operator !== OPS.setFillRGBColor) return [];
      const args = operators.argsArray[index];
      const values = args?.length === 1 && args[0]?.length ? args[0] : args;
      return [typeof values === "string" ? values : Array.from(values || [])];
    });
    assert.ok(
      colors.some((color) => matchesColor(color, template.background)),
      template.name + " PDF 必须保留代表背景色，实际 " + JSON.stringify(colors),
    );
    await pdfTask.destroy();
    console.log(
      "EVIDENCE: " +
        template.name +
        " offline HTML advanced from " +
        counterBefore +
        "; PDF pages=" +
        slideCount,
    );
  }

  console.log("PASS: all five templates export standalone HTML and background-faithful PDF");
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

function matchesColor(color, expected) {
  if (typeof color === "string") {
    const normalized = color.toLowerCase();
    return normalized === "#" + expected.map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return expected.every((value, index) => Math.abs(Number(color[index]) - value) <= 2);
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
