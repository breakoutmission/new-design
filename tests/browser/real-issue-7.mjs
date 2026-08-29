import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
const dataDir = path.join(root, "output", "real-acceptance", "issue-7-" + runId);
const relativeDataDir = path.relative(path.join(root, "output"), dataDir);
assert.ok(
  relativeDataDir && !relativeDataDir.startsWith("..") && !path.isAbsolute(relativeDataDir),
  "Issue #7 只允许使用当前 worktree 的 output 独立数据目录",
);
const artifactDir = path.join(root, "output", "issue-7-evidence", runId);
const backupDir = path.join(root, "output", "issue-7-evidence", "backup");
const backupDataDir = path.join(root, "output", "issue-7-evidence", "backup-data");
await mkdir(dataDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });
await mkdir(backupDir, { recursive: true });
await mkdir(path.join(backupDataDir, "projects"), { recursive: true });

const sourcePath = path.join(
  root,
  "output",
  "issue-7-evidence",
  "source",
  "ai-presentation-studio-8-slide-source.md",
);
const sourceMaterial = await readFile(sourcePath, "utf8");
assert.ok(sourceMaterial.length > 500, "Issue #7 必须使用用户确认的完整作品集材料");
const originalSourcePath =
  "G:\\AITOOLS\\NEW-DESIGN\\docs\\portfolio\\ai-presentation-studio-8-slide-source.md";
const originalSource = await readFile(originalSourcePath, "utf8");
assert.equal(
  sourceMaterial,
  originalSource,
  "ignored 证据副本必须与用户确认的原始作品集材料一致",
);
const originalSourceHash = sha256(originalSource);
const originalProjectsDir = "G:\\AITOOLS\\NEW-DESIGN\\.app-data\\projects";
const originalProjectHashesBefore = await snapshotJsonHashes(originalProjectsDir);

const template = {
  id: "zhangzara-grove",
  name: "Grove",
  slug: "grove",
  surface: ".slide",
  background: [25, 43, 27],
};
const projectName = sourceMaterial.split(/\r?\n/).find((line) => line.trim())?.trim();
assert.ok(projectName, "真实材料第一行必须能够作为项目名称");
const marker = "ISSUE7 REAL DEMO SAVED";
const evidencePath = path.join(artifactDir, "acceptance.json");
const port = 4337;
const baseUrl = "http://127.0.0.1:" + port;
const serverOutput = [];
const browserOutput = [];
const evidence = {
  issue: 7,
  runId,
  templateSelection: {
    chosen: "Grove",
    templateId: template.id,
    rationale: [
      "Issue #6 五个首发模板均已通过固定回归与一次真实 Codex 资格验收。",
      "Grove 拥有最多轮真实回归（foundation、Issue #8 CSS 保真、Issue #9 多页编辑、real-grove）。",
      "Issue #6 本次资格矩阵中 Grove 耗时最短（364.231 秒），且完成 12 页生成、编辑、保存重开与 HTML/PDF。",
      "本地曾存在可编辑 Grove 项目线索，但最终源材料由用户确认为作品集正式材料。",
      "以上只记录当前本机、当前代码与本次材料下的选择依据，不是长期稳定率或外部用户效果。",
    ],
    notClaimed: [
      "长期稳定率",
      "平均生成速度",
      "账单金额",
      "外部用户价值",
    ],
  },
  source: {
    confirmedByUser: true,
    path: "output/issue-7-evidence/source/ai-presentation-studio-8-slide-source.md",
    origin:
      "G:\\AITOOLS\\NEW-DESIGN\\docs\\portfolio\\ai-presentation-studio-8-slide-source.md（只读复制，未修改原文件）",
    charCount: sourceMaterial.length,
    sha256: originalSourceHash,
    firstLine: sourceMaterial.split(/\r?\n/).find((line) => line.trim()) || "",
  },
  originalAppDataProtection: {
    path: originalProjectsDir,
    before: originalProjectHashesBefore,
  },
  steps: [],
};

const server = spawn(
  "cmd.exe",
  [
    "/d",
    "/s",
    "/c",
    `call start-ai-presentation-studio.cmd --acceptance --no-open --port ${port} --data-dir ${dataDir}`,
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

let browser;
let backupServer;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  page.setDefaultTimeout(8_000);
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  // 1) Home page
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  evidence.steps.push({ step: "home", ok: true });
  await page.screenshot({ path: path.join(artifactDir, "01-home.png"), fullPage: true });

  // 2) New project + exact real source + Grove + real Codex. Final acceptance never resumes.
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(sourceMaterial);
  await page.getByRole("radio", { name: /^Grove —/ }).check();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitForGeneration(page);
  const finishedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startedMs;
  const stage = await page.getByTestId("stage").textContent();
  if (stage !== "生成完成") {
    throw new Error("Issue #7 真实生成失败：" + (await page.locator("#technical-log").textContent()));
  }
  assert.deepEqual(
    await page.getByTestId("stage-history").locator("li").allTextContents(),
    ["正在准备材料", "正在生成演示文稿", "正在检查 HTML", "生成完成"],
  );
  let project = await readProjectFromBrowser(page, projectName);
  const usageEvent = project.generation.events.findLast((event) => event.type === "usage");
  evidence.steps.push({
    step: "real-codex-generation",
    projectId: project.id,
    startedAt,
    finishedAt,
    elapsedMs,
    ok: true,
  });

  assert.equal(project.templateId, template.id);
  assert.equal(project.generation.mode, "codex");
  assert.ok(usageEvent?.usage, "必须保存 Codex usage 事件");
  const usage = normalizeUsage(usageEvent.usage);
  assert.equal(typeof usage.inputTokens, "number");
  assert.equal(typeof usage.cachedInputTokens, "number");
  assert.equal(typeof usage.outputTokens, "number");
  assert.equal(typeof usage.reasoningOutputTokens, "number");

  // 3) Safe preview + pagination
  let preview = page.frameLocator('iframe[title="演示文稿预览"]');
  const slides = preview.locator(".slide");
  await slides.first().waitFor();
  const slideCount = await slides.count();
  assert.ok(slideCount >= 2, "真实结果必须包含至少两页");
  assert.ok(
    (await preview.locator("img[data-editable-image]").count()) >= 1,
    "真实结果必须包含普通内容图片",
  );
  const counter = preview.locator("[data-slide-counter]");
  await counter.waitFor();
  assert.ok(await counter.isVisible());
  const firstCounter = (await counter.textContent()).trim();
  assert.match(firstCounter, /^1\s*\/\s*\d+$/);
  await waitForPreviewInput(preview);
  const secondCounter = await pressPreviewArrow(page, preview, "ArrowRight");
  assert.notEqual(secondCounter, firstCounter, "安全预览必须能够通过键盘方向键翻页");
  const returnedCounter = await pressPreviewArrow(page, preview, "ArrowLeft");
  assert.equal(returnedCounter, firstCounter, "编辑前必须回到第 1 页");
  await page.screenshot({ path: path.join(artifactDir, "02-preview.png"), fullPage: true });
  evidence.steps.push({ step: "safe-preview-and-pagination", slideCount, ok: true });

  // 4) Simple text + image edit
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await editor.locator(".slide").first().waitFor();
  const editableText = await selectVisibleText(page, editor);
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill(marker);
  assert.equal(await editableText.textContent(), marker);
  const imageResult = await editFirstImage(page, editor, slideCount);
  await returnToFirstEditorSlide(page, imageResult.slideIndex);
  await assertLockedPageCounter(page, editor);
  evidence.steps.push({
    step: "text-and-image-edit",
    editedImageSlide: imageResult.slideIndex + 1,
    ok: true,
  });
  await page.screenshot({ path: path.join(artifactDir, "03-edit.png"), fullPage: true });

  // 5) Save
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  preview = page.frameLocator('iframe[title="演示文稿预览"]');
  await preview.getByText(marker, { exact: true }).waitFor();
  await navigatePreview(page, preview, imageResult.slideIndex);
  let previewImage = preview.locator("img[data-editable-image]").first();
  await previewImage.waitFor({ state: "visible" });
  assertImageState(await readImageState(previewImage), imageResult.state, "完成编辑");
  evidence.steps.push({ step: "save-and-complete-edit", ok: true });

  // 6) Return home + reopen
  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: projectName }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  preview = page.frameLocator('iframe[title="演示文稿预览"]');
  await preview.getByText(marker, { exact: true }).waitFor();
  await navigatePreview(page, preview, imageResult.slideIndex);
  previewImage = preview.locator("img[data-editable-image]").first();
  await previewImage.waitFor({ state: "visible" });
  assertImageState(await readImageState(previewImage), imageResult.state, "重新打开");
  evidence.steps.push({ step: "reopen", ok: true });
  await page.screenshot({ path: path.join(artifactDir, "04-reopen.png"), fullPage: true });

  // 7) HTML export
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const htmlDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlPath = path.join(artifactDir, "issue-7-real-demo.html");
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
  evidence.steps.push({
    step: "html-export",
    path: "issue-7-real-demo.html",
    offlineAdvancedFrom: counterBefore,
    ok: true,
  });

  // 8) PDF export
  const pdfDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = path.join(artifactDir, "issue-7-real-demo.pdf");
  await pdfDownload.saveAs(pdfPath);
  const pdfTask = getDocument({ data: new Uint8Array(await readFile(pdfPath)) });
  const pdf = await pdfTask.promise;
  assert.equal(pdf.numPages, slideCount, "PDF 必须一张幻灯片对应一页");
  const firstPdfPage = await pdf.getPage(1);
  const pdfText = (await firstPdfPage.getTextContent()).items
    .map((item) => item.str)
    .join("")
    .replaceAll(/\s/g, "");
  assert.match(pdfText, new RegExp(marker.replaceAll(/\s/g, "")));
  const colors = await readFillColors(firstPdfPage);
  assert.ok(
    colors.some((color) => matchesColor(color, template.background)),
    "PDF 必须保留 Grove 代表背景，实际 " + JSON.stringify(colors),
  );
  await pdfTask.destroy();
  evidence.steps.push({
    step: "pdf-export",
    path: "issue-7-real-demo.pdf",
    pdfPages: slideCount,
    ok: true,
  });
  await page.screenshot({ path: path.join(artifactDir, "05-exported.png"), fullPage: true });

  project = await readProjectFromBrowser(page, projectName);
  const projectFileName = project.id + ".json";
  await copyFile(
    path.join(dataDir, "projects", projectFileName),
    path.join(backupDir, projectFileName),
  );
  await copyFile(
    path.join(dataDir, "projects", projectFileName),
    path.join(backupDataDir, "projects", projectFileName),
  );
  await copyFile(htmlPath, path.join(backupDir, "issue-7-real-demo.html"));
  await copyFile(pdfPath, path.join(backupDir, "issue-7-real-demo.pdf"));

  const originalProjectHashesAfter = await snapshotJsonHashes(originalProjectsDir);
  assert.deepEqual(
    originalProjectHashesAfter,
    originalProjectHashesBefore,
    "真实验收不得修改用户原始 .app-data 项目",
  );
  assert.equal(
    sha256(await readFile(originalSourcePath, "utf8")),
    originalSourceHash,
    "真实验收不得修改用户确认的原始作品集材料",
  );
  evidence.originalAppDataProtection.after = originalProjectHashesAfter;
  evidence.originalAppDataProtection.unchanged = true;

  // 9) Verify the fallback project and copied deliverables from their backup locations.
  const backupPort = 4338;
  const backupBaseUrl = "http://127.0.0.1:" + backupPort;
  const backupOutput = [];
  backupServer = spawn(
    "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      `call start-ai-presentation-studio.cmd --acceptance --no-open --port ${backupPort} --data-dir ${backupDataDir}`,
    ],
    {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backupServer.stdout.on("data", (chunk) => backupOutput.push(chunk.toString("utf8")));
  backupServer.stderr.on("data", (chunk) => backupOutput.push(chunk.toString("utf8")));
  await waitForHealth(backupBaseUrl, backupOutput);

  const backupPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await backupPage.goto(backupBaseUrl);
  await backupPage.getByRole("article", { name: projectName }).click();
  const backupPreview = backupPage.frameLocator('iframe[title="演示文稿预览"]');
  await backupPreview.getByText(marker, { exact: true }).waitFor();
  await backupPage.close();

  const backupHtmlPath = path.join(backupDir, "issue-7-real-demo.html");
  const backupHtmlContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    offline: true,
  });
  const backupHtmlPage = await backupHtmlContext.newPage();
  await backupHtmlPage.goto(pathToFileURL(backupHtmlPath).href);
  await backupHtmlPage.getByText(marker, { exact: true }).waitFor();
  const backupCounter = backupHtmlPage.locator("[data-slide-counter]");
  const backupCounterBefore = (await backupCounter.textContent()).trim();
  await backupHtmlPage.locator("body").press("ArrowRight");
  await backupHtmlPage.waitForFunction(
    (before) => document.querySelector("[data-slide-counter]")?.textContent.trim() !== before,
    backupCounterBefore,
  );
  await backupHtmlContext.close();

  const backupPdfTask = getDocument({
    data: new Uint8Array(await readFile(path.join(backupDir, "issue-7-real-demo.pdf"))),
  });
  const backupPdf = await backupPdfTask.promise;
  assert.equal(backupPdf.numPages, slideCount, "备用 PDF 页数必须与最终演示一致");
  await backupPdfTask.destroy();
  evidence.steps.push({
    step: "verified-fallback-project-html-pdf",
    backupDataDir,
    backupHtmlAdvancedFrom: backupCounterBefore,
    backupPdfPages: slideCount,
    ok: true,
  });

  evidence.result = {
    ok: true,
    projectId: project.id,
    projectName,
    templateId: template.id,
    templateName: template.name,
    startedAt,
    finishedAt,
    elapsedMs,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
    usage,
    rawUsage: usageEvent.usage,
    slideCount,
    editableImageCount: project.report?.editableImageCount ?? null,
    editedImageSlide: imageResult.slideIndex + 1,
    artifacts: {
      dataDir,
      artifactDir,
      backupDir,
      backupDataDir,
      html: "issue-7-real-demo.html",
      pdf: "issue-7-real-demo.pdf",
      screenshots: [
        "01-home.png",
        "02-preview.png",
        "03-edit.png",
        "04-reopen.png",
        "05-exported.png",
      ],
    },
    diagnosticOnlyNote:
      "耗时与 Codex usage 字段只记录本次运行，不是账单、平均速度、长期稳定率或外部用户效果。",
  };

  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  await writeFile(
    path.join(artifactDir, "acceptance-summary.md"),
    [
      "# Issue #7 真实验收摘要",
      "",
      "- 模板：Grove（`zhangzara-grove`）",
      "- 源材料：用户确认的作品集正式材料",
      "- 项目名：" + projectName,
      "- 项目 ID：" + project.id,
      "- 页数：" + slideCount,
      "- 耗时：" + evidence.result.elapsedSeconds + " 秒",
      "- Input tokens：" + usage.inputTokens,
      "- Cached input tokens：" + usage.cachedInputTokens,
      "- Output tokens：" + usage.outputTokens,
      "- Reasoning output tokens：" + usage.reasoningOutputTokens,
      "- HTML：" + htmlPath,
      "- PDF：" + pdfPath,
      "- 备用项目目录：" + backupDataDir,
      "",
      "以上 usage 与耗时只是本次诊断证据，不是性能承诺或账单。",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log("EVIDENCE: " + evidencePath);
  console.log(
    "PASS: Issue #7 real material Grove demo; slides=" +
      slideCount +
      ", elapsedMs=" +
      elapsedMs +
      ", usage=" +
      JSON.stringify(usage),
  );
} catch (error) {
  evidence.result = { ok: false, error: error.message };
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
  try {
    if (browser) await browser.close();
  } finally {
    stopLauncherTree(backupServer);
    stopLauncherTree(server);
  }
}

async function waitForGeneration(page) {
  await page.waitForFunction(
    () => {
      const preview = document.querySelector("#preview-view");
      const stage = document.querySelector('[data-testid="stage"]');
      return !preview?.hidden || ["生成失败", "已取消"].includes(stage?.textContent || "");
    },
    null,
    { timeout: 15 * 60 * 1000 },
  );
}

async function findProjectFromBrowser(page, name) {
  return page.evaluate(async (projectName) => {
    const projects = await (await fetch("/api/projects")).json();
    const summary = projects.find((project) => project.name === projectName);
    if (!summary) return null;
    return (await fetch("/api/projects/" + encodeURIComponent(summary.id))).json();
  }, name);
}

async function readProjectFromBrowser(page, name) {
  const project = await findProjectFromBrowser(page, name);
  if (!project) throw new Error("没有找到项目：" + name);
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
      // Covered text; try next candidate.
    }
  }
  throw new Error("首屏没有可点击的普通内容文字。");
}

async function assertLockedPageCounter(page, editor) {
  const counter = editor.locator("[data-slide-counter]").first();
  await counter.waitFor({ state: "visible" });
  await counter.click({ force: true });
  assert.equal(
    await page.locator("#selection-status", { hasText: "已锁定：这个元素不可编辑" }).isVisible(),
    true,
    "页码装饰必须保持锁定",
  );
}

async function editFirstImage(page, editor, slideCount) {
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
      "必须允许拖动真实普通内容图片",
    );
    return { slideIndex, state: await readImageState(image) };
  }
  throw new Error("真实普通内容图片无法在编辑器中找到。");
}

async function returnToFirstEditorSlide(page, slideIndex) {
  const previous = page
    .getByRole("navigation", { name: "编辑页导航" })
    .getByRole("button", { name: "上一页", exact: true });
  for (let index = slideIndex; index > 0; index -= 1) await previous.click();
}

async function navigatePreview(page, preview, slideIndex) {
  for (let index = 0; index < slideIndex; index += 1) {
    await pressPreviewArrow(page, preview, "ArrowRight");
  }
}

async function waitForPreviewInput(preview) {
  await preview.locator("body").evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }),
  );
}

async function pressPreviewArrow(page, preview, key) {
  const counter = preview.locator("[data-slide-counter]");
  const before = (await counter.textContent()).trim();
  await preview.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press(key);
  await counter.evaluate(
    (element, previous) =>
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 2_000;
        const check = () => {
          if (element.textContent.trim() !== previous) return resolve();
          if (Date.now() >= deadline) return reject(new Error("preview counter did not change"));
          setTimeout(check, 20);
        };
        check();
      }),
    before,
  );
  // Grove blocks repeated navigation while its 0.9 s transition is active.
  await delay(1_000);
  return (await counter.textContent()).trim();
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
      label + " 必须保留图片 " + property,
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
  await waitForHealth(baseUrl, serverOutput);
}

async function waitForHealth(url, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url + "/api/health")).ok) return;
    } catch {
      // still starting
    }
    await delay(100);
  }
  throw new Error("Server did not become ready.\n" + output.join(""));
}

function stopLauncherTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    child.kill("SIGKILL");
  }
}

async function snapshotJsonHashes(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => ({ name, sha256: sha256(await readFile(path.join(directory, name))) })),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
