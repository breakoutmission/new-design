import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  IMPORT_MAX_BYTES,
  isSlideTokenClass,
  prepareImportedHtml,
  runImportCheck,
} from "./import-checker.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const args = process.argv.slice(2);
const fixtureFileArg = readArg("--fixture-file");
const fixturePathOverride = fixtureFileArg ? path.resolve(fixtureFileArg) : null;
const fixtureGeneratorPath = path.join(root, "fixtures", "fixture-generator.mjs");
const templateRoot = path.join(root, "templates");
const port = Number(readArg("--port") || process.env.PORT || 4318);
const dataDir = path.resolve(
  readArg("--data-dir") || process.env.AI_PRESENTATION_DATA_DIR || path.join(root, ".app-data"),
);
const projectsDir = path.join(dataDir, "projects");
const originalsDir = path.join(dataDir, "originals");
const generatorMode = args.includes("--fixture")
  ? "fixture"
  : process.env.AI_PRESENTATION_GENERATOR || "codex";
const shouldOpen = !args.includes("--no-open");

let activeGeneration = null;
let shuttingDown = false;
const projectOperations = new Map();
const fixturePdfFailures = new Set();
const templates = [
  {
    id: "zhangzara-grove",
    name: "Grove",
    description: "森林绿画布、米白文字、古典衬线标题和少量锈红强调色。",
    directory: "grove",
  },
  {
    id: "zhangzara-blue-professional",
    name: "Blue Professional",
    description: "米白纸张、亮钴蓝强调和现代无衬线商务版式。",
    directory: "blue-professional",
  },
  {
    id: "zhangzara-biennale-yellow",
    name: "Biennale Yellow",
    description: "高饱和黄色画布、黑色编辑式排版和艺术展览海报结构。",
    directory: "biennale-yellow",
  },
  {
    id: "zhangzara-cobalt-grid",
    name: "Cobalt Grid",
    description: "奶油色网格纸、钴蓝衬线标题和严谨的研究出版物结构。",
    directory: "cobalt-grid",
  },
  {
    id: "zhangzara-studio",
    name: "Studio",
    description: "近黑画布、电光黄文字和高对比设计工作室构图。",
    directory: "studio",
  },
];

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.static(publicDir));
app.use("/vendor/grapesjs", express.static(path.join(root, "node_modules", "grapesjs", "dist")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, generatorMode });
});

app.get("/api/templates", (_req, res) => {
  res.json(templates.map(({ directory: _directory, ...template }) => template));
});

app.get("/api/projects", async (_req, res, next) => {
  try {
    res.json(await listProjects());
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id", async (req, res, next) => {
  try {
    const project = await readProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "没有找到这个演示项目。" });
      return;
    }
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:id", async (req, res, next) => {
  const operation = { type: "delete" };
  try {
    if (activeGeneration?.projectId === req.params.id) {
      res.status(409).json({ error: "请先取消这个项目的生成，再永久删除。" });
      return;
    }
    if (!claimProjectOperation(req.params.id, operation)) {
      res.status(409).json({ error: "这个项目正在执行其他操作，请稍后再试。" });
      return;
    }

    const project = await readProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "没有找到这个演示项目。" });
      return;
    }
    if (generatorMode === "fixture" && project.source.includes("[fixture:slow-delete]")) {
      await delay(1200);
    }

    await unlink(projectPath(project.id));
    if (project.sourceType === "imported" && project.originalFile) {
      await unlink(path.join(dataDir, project.originalFile)).catch(() => {
        // 原始副本缺失不阻塞项目删除。
      });
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  } finally {
    releaseProjectOperation(req.params.id, operation);
  }
});

const importRawHandler = express.raw({
  type: ["text/html", "application/xhtml+xml"],
  limit: IMPORT_MAX_BYTES,
});

app.post("/api/imports", (req, res, next) => {
  const fileName = String(req.query.filename || "").trim();
  if (!fileName) {
    res.status(400).json({ error: "上传请求缺少文件名。" });
    return;
  }
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > IMPORT_MAX_BYTES) {
    req.resume();
    const { report } = runImportCheck({ fileName, fileSize: declaredLength, html: null });
    res.status(422).json({ error: "这份文件暂时无法导入。", report });
    return;
  }

  importRawHandler(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }
    void importUpload({ req, res, fileName }).catch(next);
  });
});

async function importUpload({ req, res, fileName }) {
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  const { verdict, passed, report, html } = runImportCheck({
    fileName,
    fileSize: bytes.length,
    html: bytes.toString("utf8"),
  });
  if (!passed) {
    res.status(422).json({ error: "这份文件暂时无法导入。", report });
    return;
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const project = {
    id,
    name: deriveImportedName(fileName),
    source: "",
    templateId: null,
    templateName: "导入",
    status: "可编辑",
    createdAt: now,
    updatedAt: now,
    html,
    report: null,
    generation: null,
    sourceType: "imported",
    originalFileName: fileName,
    originalFile: "originals/" + id + ".html",
    importReport: report,
    verdict,
  };
  await mkdir(originalsDir, { recursive: true });
  await writeFile(path.join(dataDir, "originals", id + ".html"), bytes);
  await writeProject(project);
  res.status(200).json({ project });
}

function deriveImportedName(fileName) {
  const base = String(fileName).replace(/\.html?$/i, "").trim();
  return (base || "导入演示").slice(0, 80);
}

app.patch("/api/projects/:id", async (req, res, next) => {
  const operation = { type: "save" };
  try {
    if (!claimProjectOperation(req.params.id, operation)) {
      res.status(409).json({ error: "这个项目正在执行其他操作，请稍后再试。" });
      return;
    }

    const project = await readProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "没有找到这个演示项目。" });
      return;
    }

    const html = typeof req.body?.html === "string" ? req.body.html.trim() : "";
    const projectData = req.body?.projectData;
    if (!html || !projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
      res.status(400).json({ error: "保存内容不完整。" });
      return;
    }

    if (project.sourceType === "imported") {
      project.html = prepareImportedPreviewHtml(html);
      project.report = null;
    } else {
      const prepared = preparePreviewHtml(html, project.templateId);
      project.html = prepared.html;
      project.report = prepared.report;
    }
    project.projectData = projectData;
    project.status = "可编辑";
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    res.json(project);
  } catch (error) {
    next(error);
  } finally {
    releaseProjectOperation(req.params.id, operation);
  }
});

app.post("/api/projects/:id/exports/html", async (req, res, next) => {
  const operation = { type: "export-html" };
  try {
    if (!claimProjectOperation(req.params.id, operation)) {
      res.status(409).json({ error: "这个项目正在执行其他操作，请稍后再试。" });
      return;
    }
    const project = await readProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "没有找到这个演示项目。" });
      return;
    }
    if (project.status !== "可编辑" || !project.html || !project.projectData) {
      res.status(409).json({ error: "请先保存演示项目，再导出 HTML。" });
      return;
    }

    const html =
      project.sourceType === "imported"
        ? prepareImportedExportHtml(project.html)
        : prepareSelfContainedHtml(project.html);
    const fileName = project.name + ".html";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(fileName));
    res.send(html);
  } catch (error) {
    next(error);
  } finally {
    releaseProjectOperation(req.params.id, operation);
  }
});

app.post("/api/projects/:id/exports/pdf", async (req, res, next) => {
  const operation = { type: "export-pdf" };
  try {
    if (!claimProjectOperation(req.params.id, operation)) {
      res.status(409).json({ error: "这个项目正在执行其他操作，请稍后再试。" });
      return;
    }
    const project = await readProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "没有找到这个演示项目。" });
      return;
    }
    if (project.status !== "可编辑" || !project.html || !project.projectData) {
      res.status(409).json({ error: "请先保存演示项目，再导出 PDF。" });
      return;
    }

    if (
      generatorMode === "fixture" &&
      project.source.includes("[fixture:pdf-fail-once]") &&
      !fixturePdfFailures.has(project.id)
    ) {
      fixturePdfFailures.add(project.id);
      throw new Error("固定夹具模拟本地浏览器首次渲染失败。");
    }
    const pdf = await renderProjectPdf(project.html);
    const fileName = project.name + ".pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(fileName));
    res.send(pdf);
  } catch (error) {
    if (res.headersSent) {
      next(error);
    } else {
      res.status(500).json({ error: pdfExportError(error) });
    }
  } finally {
    releaseProjectOperation(req.params.id, operation);
  }
});

app.post("/api/generations", async (req, res) => {
  const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
  const template = templates.find((candidate) => candidate.id === req.body?.templateId);
  const templateId = template?.id || "";
  if (!source) {
    res.status(400).json({ error: "请先粘贴源材料。" });
    return;
  }
  if (!templateId) {
    res.status(400).json({ error: "请选择演示模板。" });
    return;
  }
  if (activeGeneration) {
    res.status(409).json({ error: "当前已有演示文稿正在生成，请等待完成或先取消。" });
    return;
  }

  const now = new Date().toISOString();
  const project = {
    id: randomUUID(),
    name: deriveProjectName(source),
    source,
    templateId,
    templateName: template.name,
    status: "生成中",
    createdAt: now,
    updatedAt: now,
    html: null,
    report: null,
    generation: { mode: generatorMode, events: [] },
  };
  const task = createGenerationTask(project.id);
  claimProjectOperation(project.id, task);
  activeGeneration = task;
  try {
    await runGeneration(project, res, task);
  } catch (error) {
    releaseGenerationTask(task);
    throw error;
  }
});

app.post("/api/projects/:id/generations", async (req, res) => {
  if (activeGeneration) {
    res.status(409).json({ error: "当前已有演示文稿正在生成，请等待完成或先取消。" });
    return;
  }

  const task = createGenerationTask(req.params.id);
  if (!claimProjectOperation(req.params.id, task)) {
    res.status(409).json({ error: "这个项目正在执行其他操作，请稍后再试。" });
    return;
  }
  activeGeneration = task;
  try {
    const project = await readProject(req.params.id);
    if (!project) {
      releaseGenerationTask(task);
      res.status(404).json({ error: "没有找到这个演示项目。" });
      return;
    }
    if (project.sourceType === "imported") {
      releaseGenerationTask(task);
      res.status(409).json({ error: "导入的演示项目没有源材料，不能重新生成。" });
      return;
    }
    if (!["可编辑", "生成失败", "已取消"].includes(project.status)) {
      releaseGenerationTask(task);
      res.status(409).json({ error: "这个项目当前不能重新生成。" });
      return;
    }

    project.status = "生成中";
    project.updatedAt = new Date().toISOString();
    project.html = null;
    project.report = null;
    delete project.projectData;
    delete project.error;
    project.generation = {
      mode: generatorMode,
      events: [],
      attempt: Number(project.generation?.attempt || 0),
    };

    await runGeneration(project, res, task);
  } catch (error) {
    releaseGenerationTask(task);
    throw error;
  }
});

app.post("/api/generations/:id/cancel", async (req, res, next) => {
  try {
    const task = activeGeneration;
    if (!task || task.projectId !== req.params.id) {
      res.status(409).json({ error: "这个项目当前没有正在运行的生成任务。" });
      return;
    }
    if (!task.acceptingCancel) {
      res.status(409).json({ error: "生成已经进入完成处理，不能再取消。" });
      return;
    }

    task.acceptingCancel = false;
    task.cancelRequested = true;
    await terminateProcessTree(task.child);
    await task.finished;
    const project = await readProject(req.params.id);
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (!res.headersSent) {
    const status = Number(error.statusCode || error.status || 500);
    const message =
      status === 413
        ? "文件超过 " + Math.round(IMPORT_MAX_BYTES / (1024 * 1024)) + " MB 大小上限。"
        : userFacingError(error);
    res.status(status).json({ error: message });
  }
});

app.get("*path", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

await mkdir(projectsDir, { recursive: true });
const server = app.listen(port, "127.0.0.1", () => {
  const url = "http://127.0.0.1:" + port;
  console.log("AI Presentation Studio (" + generatorMode + "): " + url);
  if (shouldOpen && process.platform === "win32") openBrowser(url);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown());
}

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function deriveProjectName(source) {
  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || "未命名项目").slice(0, 80);
}

function projectPath(id) {
  if (!/^[0-9a-f-]+$/i.test(id)) throw new Error("项目编号无效。");
  return path.join(projectsDir, id + ".json");
}

async function writeProject(project) {
  await mkdir(projectsDir, { recursive: true });
  await writeFile(projectPath(project.id), JSON.stringify(project, null, 2), "utf8");
}

async function readProject(id) {
  const file = projectPath(id);
  if (!existsSync(file)) return null;
  const project = JSON.parse(await readFile(file, "utf8"));
  if (!project.sourceType) project.sourceType = "generated";
  return project;
}

async function listProjects() {
  if (!existsSync(projectsDir)) return [];
  const files = (await readdir(projectsDir)).filter((file) => file.endsWith(".json"));
  const projects = await Promise.all(
    files.map((file) => readFile(path.join(projectsDir, file), "utf8").then(JSON.parse)),
  );
  return projects
    .map((project) => {
      const {
        html: _html,
        source: _source,
        generation: _generation,
        projectData: _projectData,
        ...summary
      } = project;
      return { sourceType: project.sourceType || "generated", ...summary };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function claimProjectOperation(projectId, operation) {
  if (projectOperations.has(projectId)) return false;
  projectOperations.set(projectId, operation);
  return true;
}

function releaseProjectOperation(projectId, operation) {
  if (projectOperations.get(projectId) === operation) projectOperations.delete(projectId);
}

function createGenerationTask(projectId) {
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  return {
    projectId,
    child: null,
    acceptingCancel: true,
    cancelRequested: false,
    finished,
    finish,
  };
}

function releaseGenerationTask(task) {
  task.acceptingCancel = false;
  if (activeGeneration === task) activeGeneration = null;
  releaseProjectOperation(task.projectId, task);
  task.finish();
}

async function runGeneration(project, res, task) {
  project.generation.attempt = Number(project.generation.attempt || 0) + 1;
  await writeProject(project);
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.flushHeaders();

  const recordEvent = (event) => {
    const stamped = { timestamp: new Date().toISOString(), ...event };
    const recorded = event.project
      ? {
          timestamp: stamped.timestamp,
          type: event.type,
          projectId: event.project.id,
          ...(event.message ? { message: event.message } : {}),
        }
      : stamped;
    project.generation.events.push(recorded);
    return { stamped, recorded };
  };
  const emitEvent = ({ stamped }) => {
    if (!res.destroyed) res.write(JSON.stringify(stamped) + "\n");
  };
  const send = (event) => {
    const entry = recordEvent(event);
    emitEvent(entry);
    return entry;
  };
  const discardEvents = (entries) => {
    const discarded = new Set(entries.map((entry) => entry.recorded));
    project.generation.events = project.generation.events.filter((event) => !discarded.has(event));
  };

  try {
    send({ type: "project", project });
    send({ type: "stage", stage: "正在准备材料" });
    send({ type: "stage", stage: "正在生成演示文稿" });
    const generated =
      generatorMode === "fixture"
        ? await generateWithFixture(project.source, project.generation.attempt, task, project.templateId)
        : await generateWithCodex(project.source, send, task, project.templateId);

    throwIfGenerationCanceled(task);

    send({ type: "stage", stage: "正在检查 HTML" });
    if (generatorMode === "fixture" && project.source.includes("[fixture:slow-finalize]")) {
      await delay(1200);
    }
    throwIfGenerationCanceled(task);

    const { html, report } = preparePreviewHtml(generated, project.templateId);
    throwIfGenerationCanceled(task);
    task.acceptingCancel = false;

    project.status = "可编辑";
    project.updatedAt = new Date().toISOString();
    project.html = html;
    project.report = report;
    delete project.error;
    const terminalEvents = [
      recordEvent({ type: "stage", stage: "生成完成" }),
      recordEvent({ type: "result", project }),
    ];
    try {
      if (generatorMode === "fixture" && project.source.includes("[fixture:slow-commit]")) {
        await delay(1200);
      }
      await writeProject(project);
    } catch (error) {
      discardEvents(terminalEvents);
      throw error;
    }
    terminalEvents.forEach(emitEvent);
  } catch (error) {
    task.acceptingCancel = false;
    project.updatedAt = new Date().toISOString();
    project.html = null;
    project.report = null;
    delete project.projectData;

    if (task.cancelRequested) {
      project.status = "已取消";
      delete project.error;
      const terminalEvent = recordEvent({ type: "canceled", project });
      await writeProject(project);
      emitEvent(terminalEvent);
    } else {
      project.status = "生成失败";
      project.error = userFacingError(error);
      const terminalEvent = recordEvent({ type: "error", message: project.error, project });
      await writeProject(project);
      emitEvent(terminalEvent);
    }
  } finally {
    releaseGenerationTask(task);
    res.end();
  }
}

function throwIfGenerationCanceled(task) {
  if (task.cancelRequested) throw new Error("生成已取消。");
}

function registerGenerationChild(task, child) {
  task.child = child;
  if (task.cancelRequested) void terminateProcessTree(child);
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;

  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }

  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => {
      child.kill();
      resolve();
    });
    killer.once("exit", (code) => {
      if (code !== 0) child.kill();
      resolve();
    });
  });
}

function generateWithFixture(source, attempt, task, templateId) {
  const template = templates.find((candidate) => candidate.id === templateId);
  const fixturePath =
    fixturePathOverride ||
    (template?.id === "zhangzara-grove"
      ? path.join(root, "fixtures", "grove-deck.html")
      : path.join(templateRoot, template?.directory || "", "example.html"));
  const fixtureDelay = source.includes("[fixture:slow]") ? 5000 : 60;
  const shouldFail =
    source.includes("[fixture:fail]") ||
    (source.includes("[fixture:fail-once]") && attempt === 1);
  const childArgs = [
    fixtureGeneratorPath,
    "--file",
    fixturePath,
    "--delay",
    String(fixtureDelay),
    ...(shouldFail ? ["--fail"] : []),
  ];
  const child = spawn(process.execPath, childArgs, {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  registerGenerationChild(task, child);

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "固定生成器没有成功返回演示文稿。"));
      } else {
        resolve(stdout);
      }
    });
  });
}

const FORBIDDEN_HTML_PATTERNS = [
  [/file:\/\//i, "HTML 包含本地文件地址。"],
  [/<form\b/i, "HTML 包含表单。"],
  [/<script\b[^>]*\bsrc\s*=/i, "HTML 包含外部脚本。"],
  [/<base\b/i, "HTML 试图改变页面地址基础。"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i, "HTML 包含外部数据请求。"],
  [/navigator\.sendBeacon\s*\(/i, "HTML 包含外部数据发送。"],
  [/window\.open\s*\(/i, "HTML 试图打开新窗口。"],
  [/<a\b[^>]*\bdownload(?:\s|=|>)/i, "HTML 包含下载操作。"],
];

function assertNoForbiddenPatterns(html) {
  for (const [pattern, message] of FORBIDDEN_HTML_PATTERNS) {
    if (pattern.test(html)) throw new Error(message);
  }
}

function preparePreviewHtml(input, templateId) {
  let html = normalizePageCounter(normalizeTemplateImage(extractCompleteHtml(input)), templateId);
  assertNoForbiddenPatterns(html);

  const editableImages = Array.from(
    html.matchAll(/<img\b[^>]*\bdata-editable-image(?=[\s=>])[^>]*>/gi),
    (match) => match[0],
  );
  const slideCount = countSlides(html);
  const editableImageCount = editableImages.length;
  if (slideCount < 2) throw new Error("HTML 没有形成多页演示文稿。");
  if (editableImageCount < 1) throw new Error("HTML 没有兼容的普通内容图片。");
  const hasNonSelfContainedImage = editableImages.some((image) => {
    const srcMatch = image.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = (srcMatch?.[1] || srcMatch?.[2] || srcMatch?.[3] || "").trim();
    return !/^data:image\//i.test(src);
  });
  if (hasNonSelfContainedImage) {
    throw new Error("普通内容图片必须使用自包含 data:image 来源。");
  }

  html = prepareSelfContainedHtml(html, "HTML 兼容性检查失败");

  const csp = [
    "default-src 'none'",
    "img-src data: blob:",
    "font-src data:",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "connect-src 'none'",
    "media-src data: blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + csp + '">';
  if (!/<meta\b[^>]*http-equiv=["']Content-Security-Policy["']/i.test(html)) {
    html = /<head[\s>]/i.test(html)
      ? html.replace(/<head([^>]*)>/i, "<head$1>" + meta)
      : html.replace(/<html([^>]*)>/i, "<html$1><head>" + meta + "</head>");
  }

  return {
    html,
    report: { slideCount, editableImageCount, localFileUrls: 0, sandbox: "allow-scripts" },
  };
}

// 导入项目的保存准备：不做模板专用处理（页码/可编辑图片注入），
// 只做完整性与安全禁令校验后重新安全化（脚本/内联事件移除 + 导入 CSP）。
function prepareImportedPreviewHtml(html) {
  if (!/<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error("保存内容不是完整的 HTML。");
  }
  assertNoForbiddenPatterns(html);
  return prepareImportedHtml(html).html;
}

// ---------------------------------------------------------------------------
// 导入项目的 HTML 导出准备（ADR-0013 导出放宽，Issue #19）：仅 https 图片引用
// 允许保留——<img> 的 src/srcset 与 CSS url() 引用的远程图片/字体，与导出文件
// 自带的导入 CSP（img-src/font-src https:）一致；外部样式表 link 仍剥离，
// 其余元素上的 http(s) 引用、@import、javascript: 地址一律拒绝。
// file:// 与任何脚本绝对禁止（assertNoForbiddenPatterns + 二次安全化）。
// 最后注入产品提供的静态翻页片段（纯 CSS 逐页吸附 + 写死的 DOM 页码徽章）：
// 导入副本无脚本，导出成果离线打开即可逐页翻阅；先剥离旧片段保证重复导出幂等。
// ---------------------------------------------------------------------------

const IMPORT_EXPORT_REJECTED_PATTERNS = [
  /<(?:source|video|audio|track|iframe|embed|object|use)\b[^>]*\b(?:src|srcset|poster|data|href)=["']https?:\/\//i,
  /<img\b[^>]*\b(?:src|srcset)=["'][^"']*http:\/\//i,
  /@import\s+(?:url\()?\s*["']?https?:\/\//i,
  /url\(\s*["']?http:\/\//i,
  /(?:href|src)\s*=\s*["']\s*javascript:/i,
];

const PRODUCT_STATIC_PAGING_STYLE_PATTERN = /<style data-product-static-paging>[\s\S]*?<\/style\s*>/gi;
const PRODUCT_PAGE_BADGE_PATTERN = /<span data-product-page-badge>[\s\S]*?<\/span\s*>/gi;

function prepareImportedExportHtml(html) {
  if (!/<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error("导出内容不是完整的 HTML。");
  }
  assertNoForbiddenPatterns(html);
  // 二次安全化（幂等）：即使项目记录未经保存接口被改动，导出也不带脚本与内联事件。
  const clean = prepareImportedHtml(html).html;
  const relaxed = clean
    .replace(/<link\b(?=[^>]*\bhref=["']https?:\/\/)[^>]*>\s*/gi, "")
    .replace(PRODUCT_STATIC_PAGING_STYLE_PATTERN, "")
    .replace(PRODUCT_PAGE_BADGE_PATTERN, "");
  if (IMPORT_EXPORT_REJECTED_PATTERNS.some((pattern) => pattern.test(relaxed))) {
    throw new Error("导出失败：演示包含不允许保留的外部资源，只有 https 图片链接可以保留。");
  }
  const slideCount = countSlides(relaxed);
  if (slideCount < 1) {
    throw new Error("导出失败：演示没有可翻阅的页面。");
  }
  return injectStaticPaging(relaxed, slideCount);
}

function injectStaticPaging(html, slideCount) {
  // 页码徽章在导出时写死为真实 DOM 文本（总数与 PDF 分页同源 countSlides），
  // 不依赖 CSS 计数器（getComputedStyle 不解析 counter，且各浏览器渲染有差异）。
  // 页面判定与 countSlides 使用同一谓词（isSlideTokenClass），slide-content、
  // slide-counter 等页内复合类名不得获得徽章（#21 真实样本修订）。
  let pageIndex = 0;
  const withBadges = html.replace(/<[a-z][\w-]*\b[^>]*>/gi, (tag) => {
    const classValue =
      tag.match(/\bclass\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bclass\s*=\s*'([^']*)'/i)?.[1];
    if (!classValue || !isSlideTokenClass(classValue)) return tag;
    pageIndex += 1;
    return tag + '<span data-product-page-badge>' + pageIndex + " / " + slideCount + "</span>";
  });
  const style = [
    '<style data-product-static-paging>',
    // 翻页由纯 CSS 完成：所有页面纵向排布，视口滚动逐页吸附，无需任何脚本。
    "html{scroll-snap-type:y mandatory!important}",
    "html,body{margin:0!important;padding:0!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important}",
    "#deck,.deck,.stage,.slides,#slides{position:static!important;inset:auto!important;display:block!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;transform:none!important;transition:none!important}",
    "*:has(> .slide){position:static!important;inset:auto!important;display:block!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;transform:none!important;transition:none!important}",
    "nav{display:none!important}",
    ".slide{position:relative!important;inset:auto!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;display:block!important;box-sizing:border-box!important;width:100vw!important;height:100vh!important;min-height:100vh!important;max-height:100vh!important;overflow:hidden!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:none!important;transition:none!important;animation:none!important;float:none!important;scroll-snap-align:start!important;scroll-snap-stop:always!important}",
    "[data-anim]{opacity:1!important;visibility:visible!important;transform:none!important;clip-path:none!important}",
    "*{animation-delay:0s!important;animation-duration:0s!important;transition:none!important}",
    '[data-product-page-badge]{position:absolute!important;right:24px!important;bottom:18px!important;z-index:9999!important;padding:8px 12px!important;border-radius:999px!important;color:#f7f4e8!important;background:rgba(20,35,24,.86)!important;font:600 13px/1 monospace!important;letter-spacing:.06em!important}',
    "</style>",
  ].join("");
  const styled = /<\/head>/i.test(withBadges)
    ? withBadges.replace(/<\/head>/i, style + "</head>")
    : withBadges.replace(/<\/html>/i, style + "</body></html>");
  return styled;
}

function normalizePageCounter(html, templateId) {
  if (/data-slide-counter(?:\s|=|>)/i.test(html)) return html;

  const counter =
    /(<[^>]+(?:\bid=["'](?:slide-counter|slideCounter)["']|\bclass=["'][^"']*\bslide-counter\b[^"']*["'])[^>]*)(>)/i;
  let generated = false;
  if (counter.test(html)) {
    html = html.replace(counter, "$1 data-slide-counter$2");
  } else {
    const slideCount = countSlides(html);
    const markup =
      '<div id="product-slide-counter" data-slide-counter data-product-page-counter-generated>1 / ' +
      slideCount +
      "</div>";
    html = html.replace(/<\/body>/i, markup + "</body>");
    generated = true;
  }

  const shouldStyle = generated || templateId === "zhangzara-grove";
  if (!shouldStyle) return html;

  const selector = generated ? "[data-product-page-counter-generated]" : "[data-slide-counter]";
  const style = [
    "<style data-product-page-counter>",
    selector + "{",
    "display:block!important;position:fixed!important;right:24px!important;top:18px!important;",
    "z-index:9999!important;padding:8px 12px!important;border-radius:999px!important;",
    "color:#f7f4e8!important;background:rgba(20,35,24,.86)!important;",
    "font:600 13px/1 monospace!important;letter-spacing:.06em!important;",
    "}",
    "</style>",
  ].join("");
  html = html.replace(/<\/head>/i, style + "</head>");
  if (!generated) return html;

  const script = [
    "<script data-product-page-counter>",
    "(()=>{",
    'const slides=[...document.querySelectorAll(".slide")];',
    'const counter=document.querySelector("[data-product-page-counter-generated]");',
    "const update=()=>{",
    'let index=slides.findIndex((slide)=>slide.classList.contains("active")||slide.classList.contains("is-active"));',
    "if(index<0) index=0;",
    'counter.textContent=(index+1)+" / "+slides.length;',
    "};",
    'new MutationObserver(update).observe(document.body,{attributes:true,subtree:true,attributeFilter:["class","style"]});',
    'document.addEventListener("keydown",()=>setTimeout(update,0));',
    "update();",
    "})();",
    "</script>",
  ].join("");
  return html.replace(/<\/body>/i, script + "</body>");
}

function normalizeTemplateImage(html) {
  if (/<img\b[^>]*data-editable-image/i.test(html)) return html;

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    '<stop stop-color="#173b2a"/><stop offset="1" stop-color="#c8524a"/>',
    "</linearGradient></defs>",
    '<rect width="1200" height="760" fill="url(#g)"/>',
    '<circle cx="920" cy="180" r="110" fill="#e8e4d6" opacity=".85"/>',
    '<path d="M0 640 260 350 430 520 680 250 950 640Z" fill="#d4cfbf" opacity=".78"/>',
    '<text x="70" y="110" fill="#e8e4d6" font-family="Arial" font-size="48">',
    "Editable content image",
    "</text></svg>",
  ].join("");
  const src = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  const image =
    '<img data-editable-image="true" alt="内置演示图片" src="' +
    src +
    '" style="position:absolute;left:55%;top:21%;width:38%;height:auto;object-fit:cover;border-radius:4px;z-index:9;" />';

  const placeholder = /<div\s+class=["']img-placeholder["'][^>]*>[\s\S]*?<\/div>/i;
  if (placeholder.test(html)) return html.replace(placeholder, image);

  const firstSlide = html.match(/<(?:section|div)\b[^>]*class=["'][^"']*\bslide\b[^"']*["'][^>]*>/i);
  if (firstSlide?.index !== undefined) {
    const insertionPoint = firstSlide.index + firstSlide[0].length;
    return html.slice(0, insertionPoint) + image + html.slice(insertionPoint);
  }
  throw new Error("模板没有可以放置普通内容图片的幻灯片。");
}

function extractCompleteHtml(input) {
  const value = String(input || "").trim();
  const artifact = value.match(/<artifact\b[^>]*>([\s\S]*?)<\/artifact>/i);
  const html = (artifact ? artifact[1] : value).trim();
  if (!/<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error("Codex 没有返回完整 HTML。");
  }
  return html;
}

function countSlides(html) {
  // 页面口径与导入检查器一致（isSlideTokenClass）：完整词 slide / slide+纯数字编号，
  // 排除 slide-content、slide-counter 等页内复合类名（#21 真实样本修订）。
  return Array.from(html.matchAll(/class=["']([^"']*)["']/gi)).filter((match) =>
    isSlideTokenClass(match[1]),
  ).length;
}

function prepareSelfContainedHtml(html, errorPrefix = "HTML 导出失败") {
  const selfContained = html.replace(
    /<link\b(?=[^>]*\bhref=["']https?:\/\/)[^>]*>\s*/gi,
    "",
  );
  const externalResources = [
    /<(?:img|source|video|audio|track|iframe|embed|object|script|use)\b[^>]*\b(?:src|srcset|poster|data|href)=["']https?:\/\//i,
    /url\(\s*["']?https?:\/\//i,
    /@import\s+(?:url\()?\s*["']?https?:\/\//i,
  ];
  if (externalResources.some((pattern) => pattern.test(selfContained))) {
    throw new Error(errorPrefix + "：演示仍包含未内嵌的外部资源。请重新生成后重试。");
  }
  return selfContained;
}

async function renderProjectPdf(html) {
  let browser;
  let context;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const renderUrl = "http://aps.invalid/render";
    const renderHtml = preparePdfRenderHtml(html);
    const renderCsp = [
      "default-src 'none'",
      "img-src data: blob: https:",
      "font-src data: https:",
      "style-src 'unsafe-inline' https:",
      "script-src 'none'",
      "connect-src 'none'",
      "media-src data: https:",
      "object-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join("; ");
    await context.route("**/*", async (route) => {
      const request = route.request();
      const blockedConnection = ["xhr", "fetch", "eventsource", "websocket"].includes(
        request.resourceType(),
      );
      if (request.isNavigationRequest() && request.url() === renderUrl) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: { "Content-Security-Policy": renderCsp },
          body: renderHtml,
        });
      } else if (request.isNavigationRequest() || blockedConnection) {
        await route.abort("blockedbyclient");
      } else {
        await route.continue();
      }
    });
    page.on("popup", (popup) => void popup.close());
    await page.goto(renderUrl, { waitUntil: "load" });
    await page.waitForFunction(() =>
      Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
    );
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    await page.emulateMedia({ media: "screen" });
    await page.addStyleTag({
      content: [
        "@page{size:13.333333in 7.5in;margin:0}",
        "html,body{margin:0!important;padding:0!important;width:100%!important;height:auto!important;overflow:visible!important}",
        "#deck,.deck,.stage{position:static!important;inset:auto!important;display:block!important;width:100%!important;height:auto!important;min-height:0!important;overflow:visible!important;transform:none!important;transition:none!important}",
        ".slide{position:relative!important;inset:auto!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;display:block!important;box-sizing:border-box!important;width:100vw!important;height:100vh!important;min-height:100vh!important;max-height:100vh!important;overflow:hidden!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:none!important;z-index:auto!important;flex:none!important;break-after:page!important;page-break-after:always!important;animation:none!important}",
        ".slide:last-of-type{break-after:auto!important;page-break-after:auto!important}",
        "nav{display:none!important}",
        "[data-anim]{opacity:1!important;visibility:visible!important;transform:none!important;clip-path:none!important}",
        "*{animation-delay:0s!important;animation-duration:0s!important;transition:none!important}",
      ].join(""),
    });
    return await page.pdf({
      width: "13.333333in",
      height: "7.5in",
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
    });
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

function preparePdfRenderHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi, "")
    .replace(
      /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:["']refresh["']|refresh\b))[^>]*>\s*/gi,
      "",
    )
    .replace(/<base\b[^>]*>\s*/gi, "")
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function pdfExportError(error) {
  console.error(error);
  return "PDF 导出失败：本地浏览器未能完成渲染。项目已经保存，可以继续使用并重试。";
}

async function generateWithCodex(source, send, task, templateId) {
  const template = templates.find((candidate) => candidate.id === templateId);
  const templateDir = path.join(templateRoot, template?.directory || "");
  const skillPath = path.join(templateDir, "SKILL.md");
  const examplePath = path.join(templateDir, "example.html");
  if (!existsSync(skillPath) || !existsSync(examplePath)) {
    throw new Error((template?.name || "所选") + " 正式模板资产尚未安装。请先完成模板接入。");
  }

  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "codex";
  const codexArgs = [
    "exec",
    "--ephemeral",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--disable",
    "plugins",
    "-C",
    templateDir,
  ];
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", "codex.cmd", ...codexArgs] : codexArgs;
  const child = spawn(command, commandArgs, {
    cwd: templateDir,
    env: process.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  registerGenerationChild(task, child);

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalMessage = "";
  const startedAt = new Date().toISOString();

  const consume = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      send({ type: "log", message: line.slice(0, 800) });
      return;
    }
    if (event.type === "thread.started") {
      send({ type: "log", message: "Codex thread: " + event.thread_id });
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      finalMessage = String(event.item.text || "");
    }
    if (event.type === "item.completed" && event.item?.type === "error") {
      send({ type: "log", message: String(event.item.message || "Codex 运行错误") });
    }
    if (event.type === "turn.completed" && event.usage) {
      send({
        type: "usage",
        startedAt,
        finishedAt: new Date().toISOString(),
        usage: event.usage,
      });
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    lines.forEach(consume);
  });
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
  });

  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (stdoutBuffer.trim()) consume(stdoutBuffer);
      if (code !== 0) {
        reject(new Error("Codex 退出，代码 " + code + "。" + stderrBuffer.trim().slice(-800)));
      } else if (!finalMessage) {
        reject(new Error("Codex 没有返回演示文稿。"));
      } else {
        resolve(finalMessage);
      }
    });
  });

  child.stdin.end(buildCodexPrompt(source, template));
  return completed;
}

function buildCodexPrompt(source, template) {
  return [
    "你是一个无对话的 HTML 演示文稿生成器。不要向用户提问。",
    "先完整读取当前目录的 SKILL.md 和 example.html。",
    "以 example.html 为唯一工作基础，保留其视觉体系、页面结构、翻页脚本和装饰系统。",
    "把示例内容替换为下面的真实中文项目材料，由模板约束决定页数。",
    "不要引用本地文件，不要加入表单、下载、新窗口、外部脚本或外部 API。",
    "至少保留一张普通 img 内容图片，并为其添加 data-editable-image 属性；图片必须是自包含 data URI。",
    "最终回复只能包含完整 artifact，不要 Markdown 代码围栏，不要解释：",
    '<artifact identifier="' + template.id + '" type="text/html" title="Deck Title">',
    "<!doctype html><html>...</html>",
    "</artifact>",
    "",
    "<source-material>",
    source,
    "</source-material>",
  ].join("\n");
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  const task = activeGeneration;
  if (task) {
    if (task.acceptingCancel) {
      task.acceptingCancel = false;
      task.cancelRequested = true;
      await terminateProcessTree(task.child);
    }
    await task.finished;
  }
  server.close(() => process.exit(0));
}

function openBrowser(url) {
  const opener = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  opener.unref();
}

function userFacingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(root, "应用目录");
}
