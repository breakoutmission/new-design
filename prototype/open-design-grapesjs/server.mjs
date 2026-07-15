import express from "express";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const publicDir = path.join(here, "public");
const templateDir = path.join(here, "vendor", "html-ppt-zhangzara-grove");
const templatePath = path.join(templateDir, "example.html");
const dataDir = path.join(here, ".prototype-data");
const projectPath = path.join(dataDir, "project.json");
const port = Number(process.env.PORT || 4317);

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.static(publicDir));

app.get("/vendor/grapes.min.js", (_req, res) => {
  res.sendFile(path.join(root, "node_modules", "grapesjs", "dist", "grapes.min.js"));
});

app.get("/vendor/grapes.min.css", (_req, res) => {
  res.sendFile(path.join(root, "node_modules", "grapesjs", "dist", "css", "grapes.min.css"));
});

app.get("/api/template", async (_req, res, next) => {
  try {
    const raw = await readFile(templatePath, "utf8");
    res.json({
      html: ensureEditableImage(raw),
      template: "zhangzara-grove",
      source: "Open Design design-templates/html-ppt-zhangzara-grove",
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/project", async (_req, res) => {
  if (!existsSync(projectPath)) {
    res.status(404).json({ error: "No prototype save exists yet." });
    return;
  }
  res.type("json").send(await readFile(projectPath, "utf8"));
});

app.put("/api/project", async (req, res, next) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object" || !payload.projectData || !payload.runtime) {
      res.status(400).json({ error: "projectData and runtime are required." });
      return;
    }
    await mkdir(dataDir, { recursive: true });
    await writeFile(projectPath, JSON.stringify(payload, null, 2), "utf8");
    res.json({ ok: true, path: ".prototype-data/project.json" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate", (req, res) => {
  const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
  if (!source) {
    res.status(400).json({ error: "Source material is required." });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.flushHeaders();

  sendEvent(res, { type: "stage", stage: "正在准备材料" });

  const args = [
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

  // Adapted from Open Design's Codex runtime contract: JSON event stream,
  // prompt through stdin (avoids Windows argv limits), and an explicit cwd.
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "codex";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "codex.cmd", ...args] : args;
  const child = spawn(command, commandArgs, {
    cwd: templateDir,
    env: process.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let finalMessage = "";
  let stderrBuffer = "";
  let closed = false;

  const consumeLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      sendEvent(res, { type: "log", message: line.slice(0, 800) });
      return;
    }

    if (event.type === "thread.started") {
      sendEvent(res, { type: "log", message: "Codex thread: " + event.thread_id });
      return;
    }
    if (event.type === "turn.started") {
      sendEvent(res, { type: "stage", stage: "正在生成演示文稿" });
      return;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      finalMessage = String(event.item.text || "");
      return;
    }
    if (event.type === "item.completed" && event.item?.type === "error") {
      sendEvent(res, { type: "log", message: String(event.item.message || "Codex event error") });
      return;
    }
    if (event.type === "turn.completed") {
      sendEvent(res, { type: "stage", stage: "正在检查 HTML" });
      if (event.usage) sendEvent(res, { type: "usage", usage: event.usage });
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    lines.forEach(consumeLine);
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || "";
    lines.filter(Boolean).slice(-4).forEach((line) => {
      sendEvent(res, { type: "log", message: line.slice(0, 800) });
    });
  });

  child.on("error", (error) => {
    closed = true;
    sendEvent(res, { type: "error", message: error.message });
    res.end();
  });

  child.on("close", (code) => {
    if (closed) return;
    if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
    if (stderrBuffer.trim()) sendEvent(res, { type: "log", message: stderrBuffer.trim().slice(-1200) });
    if (code !== 0) {
      sendEvent(res, { type: "error", message: "Codex exited with code " + code });
      res.end();
      return;
    }

    try {
      const artifact = extractArtifact(finalMessage);
      const html = ensureEditableImage(artifact);
      const report = validateDeck(html);
      sendEvent(res, { type: "stage", stage: "生成完成" });
      sendEvent(res, { type: "result", html, report });
    } catch (error) {
      sendEvent(res, { type: "error", message: error.message });
    }
    res.end();
  });

  res.on("close", () => {
    if (!res.writableEnded && !child.killed) child.kill();
  });

  child.stdin.end(buildCodexPrompt(source));
});

app.post("/api/export/pdf", async (req, res, next) => {
  let browser;
  try {
    const html = typeof req.body?.html === "string" ? req.body.html : "";
    if (!html.includes("<html") || !html.includes("slide")) {
      res.status(400).json({ error: "A deck HTML document is required." });
      return;
    }

    browser = await launchChrome();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.emulateMedia({ media: "print" });
    await page.setContent(injectPrintCss(html), { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(500);
    const pdf = await page.pdf({
      width: "13.333in",
      height: "7.5in",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="prototype-deck.pdf"');
    res.send(pdf);
  } catch (error) {
    next(error);
  } finally {
    if (browser) await browser.close();
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: error.message });
});

app.listen(port, "127.0.0.1", () => {
  const url = "http://127.0.0.1:" + port;
  console.log("THROWAWAY PROTOTYPE");
  console.log("Open Design + GrapesJS: " + url);
  if (process.env.PROTOTYPE_NO_OPEN !== "1" && process.platform === "win32") {
    const opener = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    opener.unref();
  }
});

function sendEvent(res, event) {
  if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
}

function ensureEditableImage(html) {
  if (html.includes("data-editable-image")) return html;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#173b2a"/><stop offset="1" stop-color="#c8524a"/></linearGradient></defs>' +
    '<rect width="1200" height="760" fill="url(#g)"/><circle cx="920" cy="180" r="110" fill="#e8e4d6" opacity=".85"/>' +
    '<path d="M0 640 260 350 430 520 680 250 950 640Z" fill="#d4cfbf" opacity=".78"/>' +
    '<text x="70" y="110" fill="#e8e4d6" font-family="Arial" font-size="48">Editable content image</text></svg>';
  const src = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  const image =
    '<img data-editable-image="true" alt="Prototype editable landscape" src="' +
    src +
    '" style="position:absolute;left:55%;top:21%;width:38%;height:auto;object-fit:cover;border-radius:4px;" />';

  const placeholder = /<div\s+class=["']img-placeholder["'][^>]*>[\s\S]*?<\/div>/i;
  if (placeholder.test(html)) return html.replace(placeholder, image);

  const firstSlideEnd = html.search(/<\/section>/i);
  if (firstSlideEnd >= 0) return html.slice(0, firstSlideEnd) + image + html.slice(firstSlideEnd);
  throw new Error("Template does not contain a usable slide.");
}

function buildCodexPrompt(source) {
  return [
    "你是一个无对话的 HTML 演示文稿生成器。不要向用户提问。",
    "先读取当前目录的 SKILL.md 和 example.html。",
    "以 example.html 为唯一工作基础，保留其 CSS、HTML 页面结构、翻页脚本、字体、颜色和装饰系统。",
    "把示例中的占位内容替换为下面的真实中文项目材料。为了本次技术验证，保留示例的 12 页结构。",
    "不要引用本地文件，不要加入表单、下载、新窗口或外部 API。",
    "保留一个 class 为 img-placeholder 的图片占位框；应用会在兼容性检查时将它转换为普通内容图片。",
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

function extractArtifact(message) {
  const artifact = message.match(/<artifact\b[^>]*>([\s\S]*?)<\/artifact>/i);
  let html = artifact ? artifact[1].trim() : message.trim();
  const fence = String.fromCharCode(96).repeat(3);
  const fenced = html.match(new RegExp(fence + "(?:html)?\\s*([\\s\\S]*?)" + fence, "i"));
  if (fenced) html = fenced[1].trim();
  if (!/<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html)) {
    throw new Error("Codex did not return a complete HTML artifact.");
  }
  return html;
}

function validateDeck(html) {
  if (/file:\/\//i.test(html)) throw new Error("Generated HTML contains a local file URL.");
  const slideCount = Array.from(html.matchAll(/class=["']([^"']*)["']/gi)).filter((match) =>
    match[1].split(/\s+/).includes("slide"),
  ).length;
  const imageCount = (html.match(/<img\b[^>]*data-editable-image/gi) || []).length;
  if (slideCount < 2) throw new Error("Generated HTML does not contain a multi-page deck.");
  if (imageCount < 1) throw new Error("Generated HTML has no compatible content image.");
  return { slideCount, editableImageCount: imageCount, localFileUrls: 0 };
}

function injectPrintCss(html) {
  const printCss = [
    "<style data-prototype-print>",
    "@page{size:13.333in 7.5in;margin:0}",
    "@media print{",
    "html,body{width:13.333in!important;height:auto!important;overflow:visible!important;margin:0!important;padding:0!important}",
    "#deck{display:block!important;width:13.333in!important;height:auto!important;transform:none!important;transition:none!important}",
    ".slide{display:grid!important;position:relative!important;width:13.333in!important;height:7.5in!important;min-height:7.5in!important;opacity:1!important;visibility:visible!important;transform:none!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}",
    ".slide:last-child{break-after:auto!important;page-break-after:auto!important}",
    "#nav-dots,#slide-counter,.nav-controls,.keyboard-hint,.progress-bar{display:none!important}",
    "[data-anim]{opacity:1!important;transform:none!important;animation:none!important;transition:none!important}",
    "}",
    "</style>",
  ].join("");
  return html.replace(/<\/head>/i, printCss + "</head>");
}

async function launchChrome() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (firstError) {
    const candidates = [
      path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    ].filter(Boolean);
    const executablePath = candidates.find((candidate) => existsSync(candidate));
    if (!executablePath) throw firstError;
    return chromium.launch({ executablePath, headless: true });
  }
}
