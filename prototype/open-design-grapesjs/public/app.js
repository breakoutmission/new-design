/* global grapesjs */

const PROTOTYPE_EDITOR_CSS = [
  "html,body{height:auto!important;min-height:100%!important;overflow:auto!important;background:#d8ddd7!important}",
  "body{padding:16px!important}",
  "#deck{display:block!important;width:100%!important;height:auto!important;transform:none!important;transition:none!important}",
  ".slide{display:grid!important;position:relative!important;width:calc(100vw - 32px)!important;height:auto!important;min-height:620px!important;aspect-ratio:16/9!important;transform:none!important;opacity:1!important;visibility:visible!important;margin:0 auto 18px!important;overflow:hidden!important}",
  "#nav-dots,#slide-counter,.nav-controls,.keyboard-hint,.progress-bar{display:none!important}",
  "[data-anim]{opacity:1!important;transform:none!important;animation:none!important;transition:none!important}",
  "[data-editable-image]{outline:3px solid rgba(200,82,74,.35)!important;outline-offset:2px}",
].join("\n");

const state = {
  prototype: "THROWAWAY",
  question: "Can the generated deck survive GrapesJS edit, save/reopen, HTML export, and PDF export?",
  stage: "正在准备材料",
  loadedFrom: null,
  sourceLength: 0,
  slideCount: 0,
  editableImageCount: 0,
  selected: null,
  dirty: false,
  saved: false,
  lastExport: null,
  codexUsage: null,
};

const runtime = {
  title: "Prototype Deck",
  baseCss: "",
  headHtml: "",
  scripts: [],
};

const logs = [];
let clamping = false;
let toastTimer;

const editor = grapesjs.init({
  container: "#gjs",
  height: "100%",
  width: "auto",
  fromElement: false,
  storageManager: false,
  panels: { defaults: [] },
  styleManager: {
    appendTo: "#style-panel",
    sectors: [
      {
        name: "文字",
        open: true,
        properties: [
          { property: "font-size", type: "number", units: ["px", "rem", "vw"], defaults: "16px" },
          { property: "color", type: "color" },
          { property: "line-height", type: "number", units: ["", "px"], defaults: "1.5" },
          {
            property: "text-align",
            type: "radio",
            defaults: "left",
            options: [
              { id: "left", label: "左" },
              { id: "center", label: "中" },
              { id: "right", label: "右" },
              { id: "justify", label: "齐" },
            ],
          },
        ],
      },
    ],
  },
});

editor.setDragMode("absolute");

editor.on("load", () => {
  injectCanvasStyles();
  renderState();
});

editor.on("component:selected", (component) => {
  const tag = String(component.get("tagName") || component.get("type") || "component").toLowerCase();
  state.selected = { tag, editableImage: isEditableImage(component) };
  renderState();
});

editor.on("component:update", () => {
  state.dirty = true;
  state.saved = false;
  renderState();
});

editor.on("component:update:style", (component) => {
  if (isEditableImage(component)) scheduleClamp(component);
});

const sourceEl = document.querySelector("#source");
const stageEl = document.querySelector("#stage");
const stateEl = document.querySelector("#state");
const logEl = document.querySelector("#log");
const toastEl = document.querySelector("#toast");
const generateButton = document.querySelector("#generate");

sourceEl.addEventListener("input", () => {
  state.sourceLength = sourceEl.value.length;
  renderState();
});

document.querySelector("#load-template").addEventListener("click", loadTemplateFixture);
document.querySelector("#generate").addEventListener("click", generateWithCodex);
document.querySelector("#undo").addEventListener("click", () => editor.UndoManager.undo());
document.querySelector("#redo").addEventListener("click", () => editor.UndoManager.redo());
document.querySelector("#save").addEventListener("click", saveProject);
document.querySelector("#reload").addEventListener("click", reopenProject);
document.querySelector("#export-html").addEventListener("click", exportHtml);
document.querySelector("#export-pdf").addEventListener("click", exportPdf);

loadTemplateFixture();

async function loadTemplateFixture() {
  setStage("正在准备材料");
  const response = await fetch("/api/template");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Template load failed.");
  loadHtml(payload.html, "Open Design Grove fixture");
  log("Loaded " + payload.source);
  setStage("生成完成");
}

async function generateWithCodex() {
  const source = sourceEl.value.trim();
  if (!source) {
    showToast("请先粘贴材料");
    return;
  }

  generateButton.disabled = true;
  logs.length = 0;
  state.sourceLength = source.length;
  state.codexUsage = null;
  setStage("正在准备材料");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json();
      throw new Error(payload.error || "Generation request failed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resultReceived = false;

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "stage") setStage(event.stage);
        if (event.type === "log") log(event.message);
        if (event.type === "usage") {
          state.codexUsage = event.usage;
          renderState();
        }
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "result") {
          loadHtml(event.html, "real Codex output");
          log("Compatibility report: " + JSON.stringify(event.report));
          resultReceived = true;
        }
      }
    }

    if (!resultReceived) throw new Error("Codex stream ended without an HTML result.");
    showToast("生成完成");
  } catch (error) {
    setStage("生成失败");
    log(error.message);
    showToast("生成失败");
  } finally {
    generateButton.disabled = false;
  }
}

function loadHtml(html, loadedFrom) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const scripts = Array.from(parsed.body.querySelectorAll("script")).map((node) => node.outerHTML);
  parsed.body.querySelectorAll("script").forEach((node) => node.remove());

  runtime.title = parsed.title || "Prototype Deck";
  runtime.baseCss = Array.from(parsed.head.querySelectorAll("style"))
    .map((node) => node.textContent)
    .join("\n");
  runtime.headHtml = Array.from(parsed.head.children)
    .filter((node) => !["STYLE", "SCRIPT", "TITLE"].includes(node.tagName))
    .map((node) => node.outerHTML)
    .join("\n");
  runtime.scripts = scripts;

  editor.setStyle("");
  editor.setComponents(parsed.body.innerHTML);
  editor.select(null);
  state.selected = null;
  window.setTimeout(() => {
    configureComponents();
    injectCanvasStyles();
    editor.UndoManager.clear();
    refreshCounts();
    state.loadedFrom = loadedFrom;
    state.dirty = false;
    state.saved = false;
    renderState();
  }, 0);
}

function configureComponents() {
  const visit = (component) => {
    const tag = String(component.get("tagName") || "").toLowerCase();
    const textTags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "span", "strong", "em", "blockquote"];

    component.set({ copyable: false, removable: false, draggable: false });

    if (isEditableImage(component)) {
      component.set({
        selectable: true,
        hoverable: true,
        draggable: true,
        editable: false,
        resizable: {
          tl: 1,
          tc: 0,
          tr: 1,
          cl: 0,
          cr: 0,
          bl: 1,
          bc: 0,
          br: 1,
          ratioDefault: 1,
          minDim: 40,
        },
      });
      if (typeof component.setDragMode === "function") component.setDragMode("absolute");
    } else if (textTags.includes(tag)) {
      component.set({
        selectable: true,
        hoverable: true,
        editable: true,
        stylable: ["font-size", "color", "line-height", "text-align"],
      });
    } else {
      component.set({ selectable: false, hoverable: false });
    }

    component.components().forEach(visit);
  };

  editor.getWrapper().components().forEach(visit);
}

function injectCanvasStyles() {
  const doc = editor.Canvas.getDocument();
  if (!doc) return;

  doc.querySelectorAll("[data-prototype-base],[data-prototype-editor]").forEach((node) => node.remove());

  const base = doc.createElement("style");
  base.setAttribute("data-prototype-base", "true");
  base.textContent = runtime.baseCss;
  doc.head.insertBefore(base, doc.head.firstChild);

  const overrides = doc.createElement("style");
  overrides.setAttribute("data-prototype-editor", "true");
  overrides.textContent = PROTOTYPE_EDITOR_CSS;
  doc.head.appendChild(overrides);

  if (!doc.documentElement.hasAttribute("data-prototype-mouseup")) {
    doc.documentElement.setAttribute("data-prototype-mouseup", "true");
    doc.addEventListener("mouseup", () => {
      const selected = editor.getSelected();
      if (selected && isEditableImage(selected)) clampImage(selected);
    });
  }
}

function isEditableImage(component) {
  const tag = String(component.get("tagName") || "").toLowerCase();
  const attributes = component.getAttributes ? component.getAttributes() : {};
  return tag === "img" && Object.prototype.hasOwnProperty.call(attributes, "data-editable-image");
}

function scheduleClamp(component) {
  if (clamping) return;
  window.requestAnimationFrame(() => clampImage(component));
}

function clampImage(component) {
  if (clamping) return;
  const element = component.getEl && component.getEl();
  const slide = element && element.closest(".slide");
  if (!element || !slide) return;

  const slideRect = slide.getBoundingClientRect();
  const imageRect = element.getBoundingClientRect();
  if (!slideRect.width || !slideRect.height || !imageRect.width || !imageRect.height) return;

  let width = Math.min(imageRect.width, slideRect.width);
  let height = imageRect.height * (width / imageRect.width);
  if (height > slideRect.height) {
    height = slideRect.height;
    width = imageRect.width * (height / imageRect.height);
  }

  const currentLeft = imageRect.left - slideRect.left;
  const currentTop = imageRect.top - slideRect.top;
  const left = Math.max(0, Math.min(currentLeft, slideRect.width - width));
  const top = Math.max(0, Math.min(currentTop, slideRect.height - height));

  clamping = true;
  component.addStyle({
    position: "absolute",
    left: Math.round(left) + "px",
    top: Math.round(top) + "px",
    width: Math.round(width) + "px",
    height: Math.round(height) + "px",
    "object-fit": "cover",
  });
  clamping = false;
}

async function saveProject() {
  const payload = {
    savedAt: new Date().toISOString(),
    projectData: editor.getProjectData(),
    runtime: {
      title: runtime.title,
      baseCss: runtime.baseCss,
      headHtml: runtime.headHtml,
      scripts: runtime.scripts,
    },
  };

  const response = await fetch("/api/project", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Save failed.");

  state.saved = true;
  state.dirty = false;
  renderState();
  showToast("保存成功");
  return payload;
}

async function reopenProject() {
  const response = await fetch("/api/project");
  const payload = await response.json();
  if (!response.ok) {
    showToast("还没有保存内容");
    return;
  }

  Object.assign(runtime, payload.runtime);
  editor.loadProjectData(payload.projectData);
  window.setTimeout(() => {
    configureComponents();
    injectCanvasStyles();
    editor.UndoManager.clear();
    refreshCounts();
    state.loadedFrom = "saved GrapesJS project data";
    state.saved = true;
    state.dirty = false;
    setStage("生成完成");
    renderState();
    showToast("已重新打开");
  }, 0);
}

async function exportHtml() {
  await saveProject();
  const html = buildExportHtml();
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), "prototype-deck.html");
  state.lastExport = "HTML " + new Date().toLocaleTimeString();
  renderState();
}

async function exportPdf() {
  await saveProject();
  setStage("正在导出 PDF");
  try {
    const response = await fetch("/api/export/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: buildExportHtml() }),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "PDF export failed.");
    }
    const blob = await response.blob();
    downloadBlob(blob, "prototype-deck.pdf");
    state.lastExport = "PDF " + new Date().toLocaleTimeString();
    setStage("生成完成");
    renderState();
    showToast("PDF 导出成功");
  } catch (error) {
    setStage("PDF 导出失败");
    log(error.message);
    showToast("PDF 导出失败");
  }
}

function buildExportHtml() {
  const dynamicCss = editor.getCss();
  const bodyHtml = editor.getHtml();
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="UTF-8">',
    "<title>" + escapeHtml(runtime.title) + "</title>",
    runtime.headHtml,
    "<style>",
    runtime.baseCss,
    dynamicCss,
    "</style>",
    "</head>",
    "<body>",
    bodyHtml,
    runtime.scripts.join("\n"),
    "</body>",
    "</html>",
  ].join("\n");
}

function refreshCounts() {
  const wrapper = editor.getWrapper();
  state.slideCount = wrapper.find(".slide").length;
  state.editableImageCount = wrapper.find("img").filter((component) => isEditableImage(component)).length;
}

function setStage(stage) {
  state.stage = stage;
  stageEl.textContent = stage;
  renderState();
}

function log(message) {
  logs.push(String(message));
  if (logs.length > 80) logs.shift();
  logEl.textContent = logs.join("\n");
}

function renderState() {
  state.sourceLength = sourceEl.value.length;
  stateEl.textContent = JSON.stringify(state, null, 2);
  stageEl.textContent = state.stage;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
