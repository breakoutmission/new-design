import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
const resumeDataIndex = process.argv.indexOf("--resume-data-dir");
const resumeDataDir = resumeDataIndex >= 0 ? process.argv[resumeDataIndex + 1] : null;
const dataDir = resumeDataDir ? path.resolve(resumeDataDir) : path.join(root, "output", "real-acceptance", "issue-6-" + runId);
const artifactDir = path.join(root, "output", "playwright", "issue-6-real", runId);
await mkdir(dataDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });
const evidencePath = path.join(artifactDir, "qualification.json");
const port = 4332;
const baseUrl = "http://127.0.0.1:" + port;
const templates = [
  {
    id: "zhangzara-blue-professional",
    name: "Blue Professional",
    slug: "blue-professional",
    surface: "body",
    background: [253, 250, 231],
  },
  {
    id: "zhangzara-biennale-yellow",
    name: "Biennale Yellow",
    slug: "biennale-yellow",
    surface: ".stage",
    background: [233, 229, 219],
  },
  {
    id: "zhangzara-cobalt-grid",
    name: "Cobalt Grid",
    slug: "cobalt-grid",
    surface: ".stage",
    background: [240, 235, 222],
  },
  {
    id: "zhangzara-studio",
    name: "Studio",
    slug: "studio",
    surface: ".slide",
    background: [28, 28, 28],
  },
  {
    id: "zhangzara-grove",
    name: "Grove",
    slug: "grove",
    surface: ".slide",
    background: [25, 43, 27],
  },
];
const sourceBody = [
  "目标用户：不懂 HTML 和 CSS、但要把中文产品材料制作成演示文稿的人。",
  "核心流程：双击启动本地应用，新建项目，粘贴材料，选择模板，由已登录 Codex 一次生成完整 HTML。",
  "编辑边界：普通文字可以改内容、字号、颜色、行距和对齐；普通内容图片可以拖动和等比缩放。",
  "锁定边界：背景、SVG、Logo 和装饰元素不开放编辑。",
  "交付结果：保存后可以重开，并导出自包含 HTML 与本地渲染 PDF。",
  "验证原则：只记录真实运行证据，不把单机资格测试写成外部用户效果或性能承诺。",
].join("\n");
const serverOutput = [];
const browserOutput = [];
const evidence = [];
const server = spawn(
  process.execPath,
  ["src/server.mjs", "--no-open", "--port", String(port), "--data-dir", dataDir],
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
  page.setDefaultTimeout(5_000);
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  for (const template of templates) {
    console.log("START: " + template.name + " real Codex qualification");
    const projectName = "Issue 6 " + template.name + " 真实资格验收";
    const marker = "ISSUE6 " + template.slug.toUpperCase() + " SAVED";
    await page.goto(baseUrl);
    let project = await findProjectFromBrowser(page, projectName);
    let startedAt;
    let finishedAt;
    let elapsedMs;
    let usageEvent;
    if (project?.generation?.mode === "codex" && project.status === "可编辑" && project.html) {
      console.log("RESUME: " + template.name + " from completed real Codex project " + project.id);
      await page.getByRole("article", { name: projectName }).click();
      await page.getByTestId("preview").waitFor();
      usageEvent = project.generation.events.findLast((event) => event.type === "usage");
      startedAt = usageEvent?.startedAt || project.createdAt;
      finishedAt = usageEvent?.finishedAt || project.updatedAt;
      elapsedMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    } else {
      await page.getByRole("button", { name: "新建项目" }).click();
      await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
        projectName + "\n\n" + sourceBody,
      );
      await page.getByRole("radio", { name: new RegExp("^" + template.name + " —") }).check();
      startedAt = new Date().toISOString();
      const startedMs = Date.now();
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await waitForGeneration(page);
      finishedAt = new Date().toISOString();
      elapsedMs = Date.now() - startedMs;
      const stage = await page.getByTestId("stage").textContent();
      if (stage !== "生成完成") {
        throw new Error(template.name + " 真实生成失败：" + (await page.locator("#technical-log").textContent()));
      }
      assert.deepEqual(
        await page.getByTestId("stage-history").locator("li").allTextContents(),
        ["正在准备材料", "正在生成演示文稿", "正在检查 HTML", "生成完成"],
      );
      project = await readProjectFromBrowser(page, projectName);
      usageEvent = project.generation.events.findLast((event) => event.type === "usage");
    }
    assert.equal(project.templateId, template.id);
    assert.deepEqual(
      project.generation.events.filter((event) => event.type === "stage").map((event) => event.stage),
      ["正在准备材料", "正在生成演示文稿", "正在检查 HTML", "生成完成"],
    );
    assert.ok(usageEvent?.usage, template.name + " 必须保存 Codex usage 事件");
    const usage = normalizeUsage(usageEvent.usage);
    assert.equal(typeof usage.inputTokens, "number", template.name + " 必须记录 input tokens");
    assert.equal(typeof usage.cachedInputTokens, "number", template.name + " 必须记录 cached input tokens");
    assert.equal(typeof usage.outputTokens, "number", template.name + " 必须记录 output tokens");

    let preview = page.frameLocator('iframe[title="演示文稿预览"]');
    const slides = preview.locator(".slide");
    await slides.first().waitFor();
    const slideCount = await slides.count();
    assert.ok(slideCount >= 2, template.name + " 真实结果必须包含至少两页");
    assert.ok(
      (await preview.locator("img[data-editable-image]").count()) >= 1,
      template.name + " 真实结果必须包含普通内容图片",
    );
    const counter = preview.locator("[data-slide-counter]");
    await counter.waitFor();
    assert.ok(await counter.isVisible(), template.name + " 必须显示当前页码");
    assert.equal(
      await preview.locator(template.surface).first().evaluate((element) => {
        const color = getComputedStyle(element).backgroundColor;
        return color;
      }),
      "rgb(" + template.background.join(", ") + ")",
      template.name + " 真实输出必须保留模板代表背景",
    );
    await page.screenshot({
      path: path.join(artifactDir, template.slug + "-generated.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByText("编辑模式", { exact: true }).waitFor();
    const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
    await editor.locator(".slide").first().waitFor();
    const editableText = await selectVisibleText(page, editor);
    await page.getByRole("textbox", { name: "文字内容", exact: true }).fill(marker);
    assert.equal(await editableText.textContent(), marker, template.name + " 必须允许文字编辑");

    const imageResult = await editFirstImage(page, editor, slideCount, template.name);
    await returnToFirstEditorSlide(page, imageResult.slideIndex);
    await assertLockedPageCounter(page, editor, template.name);

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存成功", { exact: true }).waitFor();
    await page.getByRole("button", { name: "完成编辑", exact: true }).click();
    await page.getByText("预览模式", { exact: true }).waitFor();
    preview = page.frameLocator('iframe[title="演示文稿预览"]');
    await preview.getByText(marker, { exact: true }).waitFor();
    await navigatePreview(preview, imageResult.slideIndex);
    let previewImage = preview.locator("img[data-editable-image]").first();
    await previewImage.waitFor({ state: "visible" });
    assertImageState(await readImageState(previewImage), imageResult.state, template.name + " 完成编辑");

    await page.getByRole("button", { name: "返回首页" }).click();
    await page.getByRole("article", { name: projectName }).click();
    await page.getByText("预览模式", { exact: true }).waitFor();
    preview = page.frameLocator('iframe[title="演示文稿预览"]');
    await preview.getByText(marker, { exact: true }).waitFor();
    await navigatePreview(preview, imageResult.slideIndex);
    previewImage = preview.locator("img[data-editable-image]").first();
    await previewImage.waitFor({ state: "visible" });
    assertImageState(await readImageState(previewImage), imageResult.state, template.name + " 重新打开");

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const htmlDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
    const htmlDownload = await htmlDownloadPromise;
    const htmlPath = path.join(artifactDir, template.slug + ".html");
    await htmlDownload.saveAs(htmlPath);
    const exportedHtml = await readFile(htmlPath, "utf8");
    assert.match(exportedHtml, new RegExp(marker));
    assert.doesNotMatch(exportedHtml, /file:\/\//i);
    assert.doesNotMatch(
      exportedHtml,
      /<(?:link|script|img|source|video|audio|iframe)\b[^>]*(?:href|src)=["']https?:\/\//i,
    );
    const standaloneContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      offline: true,
    });
    const standalone = await standaloneContext.newPage();
    await standalone.goto(pathToFileURL(htmlPath).href);
    await standalone.getByText(marker, { exact: true }).waitFor();
    const offlineCounter = standalone.locator("[data-slide-counter]");
    const counterBefore = (await offlineCounter.textContent()).trim();
    await standalone.locator("body").press("ArrowRight");
    await standalone.waitForFunction(
      (before) => document.querySelector("[data-slide-counter]")?.textContent.trim() !== before,
      counterBefore,
    );
    await standaloneContext.close();

    const pdfDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = path.join(artifactDir, template.slug + ".pdf");
    await pdfDownload.saveAs(pdfPath);
    const pdfTask = getDocument({ data: new Uint8Array(await readFile(pdfPath)) });
    const pdf = await pdfTask.promise;
    assert.equal(pdf.numPages, slideCount, template.name + " 真实结果必须一张幻灯片对应一页 PDF");
    const firstPdfPage = await pdf.getPage(1);
    const pdfText = (await firstPdfPage.getTextContent()).items
      .map((item) => item.str)
      .join("")
      .replaceAll(/\s/g, "");
    assert.match(pdfText, new RegExp(marker.replaceAll(/\s/g, "")));
    const colors = await readFillColors(firstPdfPage);
    assert.ok(
      colors.some((color) => matchesColor(color, template.background)),
      template.name + " 真实 PDF 必须保留代表背景，实际 " + JSON.stringify(colors),
    );
    await pdfTask.destroy();

    project = await readProjectFromBrowser(page, projectName);
    evidence.push({
      templateId: template.id,
      templateName: template.name,
      projectId: project.id,
      startedAt,
      finishedAt,
      elapsedMs,
      usage,
      rawUsage: usageEvent.usage,
      slideCount,
      editableImageCount: project.report.editableImageCount,
      editedImageSlide: imageResult.slideIndex + 1,
      standaloneHtmlAdvancedFrom: counterBefore,
      pdfPages: slideCount,
      artifacts: {
        screenshot: template.slug + "-generated.png",
        html: template.slug + ".html",
        pdf: template.slug + ".pdf",
      },
    });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    console.log(
      "PASS: " +
        template.name +
        " real Codex qualification; slides=" +
        slideCount +
        ", elapsedMs=" +
        elapsedMs +
        ", usage=" +
        JSON.stringify(usage),
    );
  }

  console.log("EVIDENCE: " + evidencePath);
  console.log("PASS: all five real templates completed generation, edit, save/reopen, HTML and PDF");
} catch (error) {
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  throw new Error(
    error.message +
      "\n\nPartial evidence:\n" +
      evidencePath +
      "\nServer output:\n" +
      serverOutput.join("") +
      "\nBrowser output:\n" +
      browserOutput.join("\n"),
  );
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

async function waitForGeneration(page) {
  await page.waitForFunction(
    () => {
      const preview = document.querySelector("#preview-view");
      const stage = document.querySelector('[data-testid="stage"]');
      return !preview?.hidden || ["生成失败", "已取消"].includes(stage?.textContent || "");
    },
    null,
    { timeout: 12 * 60 * 1000 },
  );
}

async function findProjectFromBrowser(page, projectName) {
  return page.evaluate(async (name) => {
    const projects = await (await fetch("/api/projects")).json();
    const summary = projects.find((project) => project.name === name);
    if (!summary) return null;
    return (await fetch("/api/projects/" + encodeURIComponent(summary.id))).json();
  }, projectName);
}

async function readProjectFromBrowser(page, projectName) {
  const project = await findProjectFromBrowser(page, projectName);
  if (!project) throw new Error("没有找到项目：" + projectName);
  return project;
}

function normalizeUsage(usage) {
  return {
    inputTokens: usage.input_tokens ?? usage.inputTokens ?? null,
    cachedInputTokens: usage.cached_input_tokens ?? usage.cachedInputTokens ?? null,
    outputTokens: usage.output_tokens ?? usage.outputTokens ?? null,
    reasoningOutputTokens:
      usage.reasoning_output_tokens ??
      usage.reasoningOutputTokens ??
      usage.output_tokens_details?.reasoning_tokens ??
      null,
  };
}

async function selectVisibleText(page, editor) {
  const candidates = editor.locator(".slide").first().locator("h1,h2,h3,h4,h5,h6,p");
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible())) continue;
    try {
      await candidate.click({ timeout: 1_000 });
      if (await page.getByText("已选中文字", { exact: true }).isVisible()) return candidate;
    } catch {
      // A higher visual layer covers this text; try the next visible content block.
    }
  }
  throw new Error("首屏没有可点击的普通内容文字。");
}

async function assertLockedPageCounter(page, editor, templateName) {
  const counter = editor.locator("[data-slide-counter]").first();
  await counter.waitFor({ state: "visible" });
  await counter.click({ force: true });
  const locked = page.getByText("已锁定：这个元素不可编辑", { exact: true });
  assert.equal(
    await locked.isVisible(),
    true,
    templateName + " 的页码装饰必须保持锁定",
  );
}

async function editFirstImage(page, editor, slideCount, templateName) {
  const navigation = page.getByRole("navigation", { name: "编辑页导航" });
  for (let slideIndex = 0; slideIndex < slideCount; slideIndex += 1) {
    if (slideIndex > 0) {
      await navigation.getByRole("button", { name: "下一页", exact: true }).click();
    }
    const image = editor.locator(".slide").nth(slideIndex).locator("img[data-editable-image]").first();
    if (!(await image.isVisible())) continue;
    await image.click();
    await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
    const before = await image.boundingBox();
    assert.ok(before);
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 - 32, before.y + before.height / 2 + 24, {
      steps: 6,
    });
    await page.mouse.up();
    const after = await image.boundingBox();
    assert.ok(after);
    assert.ok(
      Math.abs(after.x - before.x) > 8 || Math.abs(after.y - before.y) > 8,
      templateName + " 必须允许拖动真实普通内容图片",
    );
    return { slideIndex, state: await readImageState(image) };
  }
  throw new Error(templateName + " 的真实普通内容图片无法在编辑器中找到。");
}

async function returnToFirstEditorSlide(page, slideIndex) {
  const previous = page
    .getByRole("navigation", { name: "编辑页导航" })
    .getByRole("button", { name: "上一页", exact: true });
  for (let index = slideIndex; index > 0; index -= 1) await previous.click();
}

async function navigatePreview(preview, slideIndex) {
  for (let index = 0; index < slideIndex; index += 1) {
    await preview.locator("body").press("ArrowRight");
  }
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

async function readFillColors(page) {
  const operators = await page.getOperatorList();
  return operators.fnArray.flatMap((operator, index) => {
    if (operator !== OPS.setFillRGBColor) return [];
    const args = operators.argsArray[index];
    const values = args?.length === 1 && args[0]?.length ? args[0] : args;
    return [typeof values === "string" ? values : Array.from(values || [])];
  });
}

function matchesColor(color, expected) {
  if (typeof color === "string") {
    return color.toLowerCase() === "#" + expected.map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return expected.every((value, index) => Math.abs(Number(color[index]) - value) <= 2);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(baseUrl + "/api/health")).ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  throw new Error("Server did not become ready.\n" + serverOutput.join(""));
}
