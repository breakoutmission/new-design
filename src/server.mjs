import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const args = process.argv.slice(2);
const fixturePath = path.resolve(readArg("--fixture-file") || path.join(root, "fixtures", "grove-deck.html"));
const fixtureGeneratorPath = path.join(root, "fixtures", "fixture-generator.mjs");
const templateDir = path.join(root, "templates", "grove");
const port = Number(readArg("--port") || process.env.PORT || 4318);
const dataDir = path.resolve(
  readArg("--data-dir") || process.env.AI_PRESENTATION_DATA_DIR || path.join(root, ".app-data"),
);
const projectsDir = path.join(dataDir, "projects");
const generatorMode = args.includes("--fixture")
  ? "fixture"
  : process.env.AI_PRESENTATION_GENERATOR || "codex";
const shouldOpen = !args.includes("--no-open");

let activeGeneration = null;
let shuttingDown = false;
const projectOperations = new Map();
const fixturePdfFailures = new Set();

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
  res.json([
    {
      id: "zhangzara-grove",
      name: "Grove",
      description: "森林绿画布、米白文字、古典衬线标题和少量锈红强调色。",
      status: "qualified-prototype",
    },
  ]);
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
    res.status(204).end();
  } catch (error) {
    next(error);
  } finally {
    releaseProjectOperation(req.params.id, operation);
  }
});

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

    const prepared = preparePreviewHtml(html);
    project.html = prepared.html;
    project.report = prepared.report;
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

    const html = prepareSelfContainedHtml(project.html);
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
  const templateId = req.body?.templateId === "zhangzara-grove" ? req.body.templateId : "";
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
    templateName: "Grove",
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
  if (!res.headersSent) res.status(500).json({ error: userFacingError(error) });
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
  return JSON.parse(await readFile(file, "utf8"));
}

async function listProjects() {
  if (!existsSync(projectsDir)) return [];
  const files = (await readdir(projectsDir)).filter((file) => file.endsWith(".json"));
  const projects = await Promise.all(
    files.map((file) => readFile(path.join(projectsDir, file), "utf8").then(JSON.parse)),
  );
  return projects
    .map(
      ({
        html: _html,
        source: _source,
        generation: _generation,
        projectData: _projectData,
        ...summary
      }) => summary,
    )
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
        ? await generateWithFixture(project.source, project.generation.attempt, task)
        : await generateWithCodex(project.source, send, task);

    throwIfGenerationCanceled(task);

    send({ type: "stage", stage: "正在检查 HTML" });
    if (generatorMode === "fixture" && project.source.includes("[fixture:slow-finalize]")) {
      await delay(1200);
    }
    throwIfGenerationCanceled(task);

    const { html, report } = preparePreviewHtml(generated);
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

function generateWithFixture(source, attempt, task) {
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

function preparePreviewHtml(input) {
  let html = normalizePageCounter(normalizeTemplateImage(extractCompleteHtml(input)));
  const forbidden = [
    [/file:\/\//i, "HTML 包含本地文件地址。"],
    [/<form\b/i, "HTML 包含表单。"],
    [/<script\b[^>]*\bsrc\s*=/i, "HTML 包含外部脚本。"],
    [/<base\b/i, "HTML 试图改变页面地址基础。"],
    [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i, "HTML 包含外部数据请求。"],
    [/navigator\.sendBeacon\s*\(/i, "HTML 包含外部数据发送。"],
    [/window\.open\s*\(/i, "HTML 试图打开新窗口。"],
    [/<a\b[^>]*\bdownload(?:\s|=|>)/i, "HTML 包含下载操作。"],
  ];
  for (const [pattern, message] of forbidden) {
    if (pattern.test(html)) throw new Error(message);
  }

  const slideCount = countSlides(html);
  const editableImageCount = (html.match(/<img\b[^>]*data-editable-image/gi) || []).length;
  if (slideCount < 2) throw new Error("HTML 没有形成多页演示文稿。");
  if (editableImageCount < 1) throw new Error("HTML 没有兼容的普通内容图片。");

  const csp = [
    "default-src 'none'",
    "img-src data: blob: https:",
    "font-src data: https:",
    "style-src 'unsafe-inline' https:",
    "script-src 'unsafe-inline'",
    "connect-src 'none'",
    "media-src data: https:",
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

function normalizePageCounter(html) {
  if (/data-slide-counter(?:\s|=|>)/i.test(html)) return html;

  const counter = /(<[^>]+\bid=["']slide-counter["'][^>]*)(>)/i;
  if (!counter.test(html)) throw new Error("HTML 没有兼容的当前页码。");
  html = html.replace(counter, "$1 data-slide-counter$2");

  const style = [
    "<style data-product-page-counter>",
    "#slide-counter{",
    "display:block!important;position:fixed!important;right:24px!important;top:18px!important;",
    "z-index:9999!important;padding:8px 12px!important;border-radius:999px!important;",
    "color:#f7f4e8!important;background:rgba(20,35,24,.86)!important;",
    "font:600 13px/1 monospace!important;letter-spacing:.06em!important;",
    "}",
    "</style>",
  ].join("");
  return html.replace(/<\/head>/i, style + "</head>");
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
    '" style="position:absolute;left:55%;top:21%;width:38%;height:auto;object-fit:cover;border-radius:4px;" />';

  const placeholder = /<div\s+class=["']img-placeholder["'][^>]*>[\s\S]*?<\/div>/i;
  if (placeholder.test(html)) return html.replace(placeholder, image);

  const firstSlideEnd = html.search(/<\/section>/i);
  if (firstSlideEnd >= 0) return html.slice(0, firstSlideEnd) + image + html.slice(firstSlideEnd);
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
  return Array.from(html.matchAll(/class=["']([^"']*)["']/gi)).filter((match) =>
    match[1].split(/\s+/).includes("slide"),
  ).length;
}

function prepareSelfContainedHtml(html) {
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
    throw new Error("HTML 导出失败：演示仍包含未内嵌的外部资源。请重新生成后重试。");
  }
  return selfContained;
}

async function renderProjectPdf(html) {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(html, { waitUntil: "load" });
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
        "#deck{display:block!important;width:100%!important;height:auto!important;transform:none!important;transition:none!important}",
        ".slide{display:block!important;box-sizing:border-box!important;width:100vw!important;height:100vh!important;min-height:100vh!important;max-height:100vh!important;overflow:hidden!important;break-after:page!important;page-break-after:always!important;animation:none!important}",
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
    if (browser) await browser.close();
  }
}

function pdfExportError(error) {
  console.error(error);
  return "PDF 导出失败：本地浏览器未能完成渲染。项目已经保存，可以继续使用并重试。";
}

async function generateWithCodex(source, send, task) {
  const skillPath = path.join(templateDir, "SKILL.md");
  const examplePath = path.join(templateDir, "example.html");
  if (!existsSync(skillPath) || !existsSync(examplePath)) {
    throw new Error("Grove 正式模板资产尚未安装。请先完成模板接入。");
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

  child.stdin.end(buildCodexPrompt(source));
  return completed;
}

function buildCodexPrompt(source) {
  return [
    "你是一个无对话的 HTML 演示文稿生成器。不要向用户提问。",
    "先完整读取当前目录的 SKILL.md 和 example.html。",
    "以 example.html 为唯一工作基础，保留其视觉体系、页面结构、翻页脚本和装饰系统。",
    "把示例内容替换为下面的真实中文项目材料，由模板约束决定页数。",
    "不要引用本地文件，不要加入表单、下载、新窗口、外部脚本或外部 API。",
    "至少保留一张普通 img 内容图片，并为其添加 data-editable-image 属性；图片必须是自包含 data URI。",
    "最终回复只能包含完整 artifact，不要 Markdown 代码围栏，不要解释：",
    '<artifact identifier="zhangzara-grove" type="text/html" title="Deck Title">',
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
