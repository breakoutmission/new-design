import { mountPresentationEditor } from "./editor.js";
const state = {
  templates: [],
  projects: [],
  selectedTemplate: null,
  currentProject: null,
  stageHistory: [],
  mode: "preview",
  editor: null,
  editorProjectId: null,
};

const views = {
  home: document.querySelector("#home-view"),
  new: document.querySelector("#new-view"),
  preview: document.querySelector("#preview-view"),
};

const source = document.querySelector("#source");
const sendButton = document.querySelector("#send");
const generationPanel = document.querySelector("#generation-panel");
const stageElement = generationPanel.querySelector('[data-testid="stage"]');
const stageHistory = generationPanel.querySelector('[data-testid="stage-history"]');
const logElement = document.querySelector("#technical-log");
const toast = document.querySelector("#toast");
const workspaceMode = document.querySelector("#workspace-mode");
const editToggle = document.querySelector("#edit-toggle");
const previewFrameShell = document.querySelector(".preview-frame-shell");
const editorLayout = document.querySelector("#editor-layout");
const editorContainer = document.querySelector("#gjs");
const selectionStatus = document.querySelector("#selection-status");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const saveButton = document.querySelector("#save");
const textControls = document.querySelector("#text-controls");
const textContent = document.querySelector("#text-content");
const fontSize = document.querySelector("#font-size");
const textColor = document.querySelector("#text-color");
const lineHeight = document.querySelector("#line-height");
const alignmentButtons = document.querySelectorAll("[data-align]");

document.querySelector("#new-project").addEventListener("click", () => showView("new"));
document
  .querySelectorAll('[data-action="home"]')
  .forEach((button) => button.addEventListener("click", showHome));
source.addEventListener("input", updateSendState);
sendButton.addEventListener("click", generatePresentation);
editToggle.addEventListener("click", toggleEditorMode);
undoButton.addEventListener("click", () => state.editor?.undo());
redoButton.addEventListener("click", () => state.editor?.redo());
saveButton.addEventListener("click", saveCurrentProject);
textContent.addEventListener("input", () => state.editor?.updateTextContent(textContent.value));
fontSize.addEventListener("input", () => state.editor?.updateTextStyle("font-size", fontSize.value + "px"));
textColor.addEventListener("input", () => state.editor?.updateTextStyle("color", textColor.value));
lineHeight.addEventListener("input", () => state.editor?.updateTextStyle("line-height", lineHeight.value));
alignmentButtons.forEach((button) =>
  button.addEventListener("click", () => state.editor?.updateTextStyle("text-align", button.dataset.align)),
);

await Promise.all([loadTemplates(), loadProjects()]);
showView("home");

async function loadTemplates() {
  const response = await fetch("/api/templates");
  state.templates = await response.json();
  const list = document.querySelector("#template-list");
  list.replaceChildren(
    ...state.templates.map((template, index) => {
      const label = document.createElement("label");
      label.className = "template-option";
      label.innerHTML =
        '<input type="radio" name="template" value="' +
        escapeHtml(template.id) +
        '" aria-label="' +
        escapeHtml(template.name) +
        " — " +
        escapeHtml(template.description) +
        '">' +
        '<span class="template-swatch" aria-hidden="true"><i></i></span>' +
        "<span><strong>" +
        escapeHtml(template.name) +
        "</strong><small>" +
        escapeHtml(template.description) +
        "</small></span>";
      const radio = label.querySelector("input");
      radio.addEventListener("change", () => {
        state.selectedTemplate = template.id;
        updateSendState();
      });
      if (index === 0) {
        radio.checked = true;
        state.selectedTemplate = template.id;
      }
      return label;
    }),
  );
  updateSendState();
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  state.projects = await response.json();
  renderProjects();
}

function renderProjects() {
  const list = document.querySelector("#project-list");
  const empty = document.querySelector("#empty-projects");
  list.replaceChildren(
    ...state.projects.map((project, index) => {
      const article = document.createElement("article");
      article.className = "project-card";
      article.setAttribute("aria-label", project.name);
      article.tabIndex = 0;
      article.innerHTML =
        '<div class="project-number">' +
        String(index + 1).padStart(2, "0") +
        "</div><div>" +
        '<p class="project-template">' +
        escapeHtml(project.templateName) +
        "</p><h3>" +
        escapeHtml(project.name) +
        '</h3><p class="project-meta">最后修改 ' +
        formatDate(project.updatedAt) +
        '</p></div><span class="project-status">' +
        escapeHtml(project.status) +
        "</span>";
      article.addEventListener("click", () => openProject(project.id));
      article.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProject(project.id);
        }
      });
      return article;
    }),
  );
  empty.hidden = state.projects.length > 0;
}
async function openProject(projectId) {
  const response = await fetch("/api/projects/" + encodeURIComponent(projectId));
  if (!response.ok) {
    showToast("无法打开项目");
    return;
  }
  const project = await response.json();
  openPreview(project);
}


async function generatePresentation() {
  const material = source.value.trim();
  if (!material || !state.selectedTemplate) return;

  sendButton.disabled = true;
  generationPanel.hidden = false;

  state.currentProject = null;
  state.stageHistory = [];
  stageHistory.replaceChildren();
  logElement.textContent = "";

  try {
    const response = await fetch("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: material, templateId: state.selectedTemplate }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json();
      throw new Error(payload.error || "生成请求没有成功启动。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) consumeEvent(line);
      if (done) break;
    }
    if (buffer.trim()) consumeEvent(buffer);
    if (!state.currentProject) throw new Error("生成结束，但没有收到完整演示文稿。");
  } catch (error) {
    appendLog(error.message);
    showToast("生成失败");
  } finally {
    sendButton.disabled = false;
  }
}

function consumeEvent(line) {
  if (!line.trim()) return;
  const event = JSON.parse(line);
  if (event.type === "stage") {
    stageElement.textContent = event.stage;
    state.stageHistory.push(event.stage);
    const item = document.createElement("li");
    item.textContent = event.stage;
    stageHistory.append(item);
  }
  if (event.type === "log") appendLog(event.message);
  if (event.type === "usage") appendLog("Codex 用量：" + JSON.stringify(event.usage));
  if (event.type === "error") throw new Error(event.message);
  if (event.type === "result") openPreview(event.project);
}

function openPreview(project) {
  resetEditor();
  state.currentProject = project;
  document.querySelector("#preview-title").textContent = project.name;
  const frame = document.querySelector('iframe[title="演示文稿预览"]');
  frame.srcdoc = project.html;
  setMode("preview");
  showView("preview");
}

async function showHome() {
  await loadProjects();
  showView("home");
}

function showView(name) {
  Object.entries(views).forEach(([key, view]) => {
    view.hidden = key !== name;
  });
  if (name === "new") source.focus();
}

function updateSendState() {
  sendButton.disabled = !source.value.trim() || !state.selectedTemplate;
}
async function toggleEditorMode() {
  if (state.mode === "edit") {
    refreshPreviewFromEditor();
    setMode("preview");
    return;
  }

  setMode("edit");
  try {
    await ensureEditor();
  } catch (error) {
    console.error(error);
    setMode("preview");
    showToast("无法打开编辑器");
  }
}

function setMode(mode) {
  state.mode = mode;
  const editing = mode === "edit";
  workspaceMode.textContent = editing ? "编辑模式" : "预览模式";
  editToggle.textContent = editing ? "完成编辑" : "编辑";
  previewFrameShell.hidden = editing;
  editorLayout.hidden = !editing;
  saveButton.disabled = !editing;
}


async function ensureEditor() {
  if (state.editor && state.editorProjectId === state.currentProject.id) return;
  resetEditor();
  selectionStatus.textContent = "点击画布中的文字或普通内容图片";
  state.editor = await mountPresentationEditor({
    container: editorContainer,
    project: state.currentProject,
    onSelection({ kind, text }) {
      if (kind === "text") {
        selectionStatus.textContent = "已选中文字";
        textControls.disabled = false;
        syncTextControls(text);
      } else {
        selectionStatus.textContent = "已选中普通内容图片";
        textControls.disabled = true;
      }
    },
    onLocked() {
      selectionStatus.textContent = "已锁定：这个元素不可编辑";
      textControls.disabled = true;
      showToast("这个元素不可编辑");
    },
    onHistoryChange: updateHistoryButtons,
  });
  state.editorProjectId = state.currentProject.id;
}
function syncTextControls(text) {
  textContent.value = text.content;
  fontSize.value = String(text.fontSize);
  textColor.value = text.color;
  lineHeight.value = String(text.lineHeight);
  alignmentButtons.forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.align === text.textAlign)),
  );
}

function updateHistoryButtons({ canUndo = false, canRedo = false } = {}) {
  undoButton.disabled = !canUndo;
  redoButton.disabled = !canRedo;
}

function resetEditor() {
  if (state.editor) state.editor.destroy();
  state.editor = null;
  state.editorProjectId = null;
  textControls.disabled = true;
  updateHistoryButtons();
}

function refreshPreviewFromEditor() {
  if (!state.editor || !state.currentProject) return;
  const html = state.editor.getPreviewHtml();
  state.currentProject = { ...state.currentProject, html };
  document.querySelector('iframe[title="演示文稿预览"]').srcdoc = html;
}

async function saveCurrentProject() {
  if (!state.editor || !state.currentProject) return;
  saveButton.disabled = true;
  try {
    const html = state.editor.getPreviewHtml();
    const response = await fetch("/api/projects/" + encodeURIComponent(state.currentProject.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html,
        projectData: state.editor.getProjectData(),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "项目没有保存成功。");
    state.currentProject = payload;
    document.querySelector('iframe[title="演示文稿预览"]').srcdoc = payload.html;
    showToast("保存成功");
  } catch (error) {
    console.error(error);
    showToast("保存失败");
  } finally {
    saveButton.disabled = state.mode !== "edit";
  }
}

function appendLog(message) {
  logElement.textContent += String(message) + "\n";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
