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
  activeGeneration: null,
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
const generationMessage = document.querySelector("#generation-message");
const cancelGenerationButton = document.querySelector("#cancel-generation");
const retryGenerationButton = document.querySelector("#retry-generation");
const confirmDialog = document.querySelector("#confirm-dialog");
const confirmTitle = document.querySelector("#confirm-title");
const confirmMessage = document.querySelector("#confirm-message");
const confirmCancel = document.querySelector("#confirm-cancel");
const confirmAccept = document.querySelector("#confirm-accept");
const toast = document.querySelector("#toast");
const workspaceMode = document.querySelector("#workspace-mode");
const editToggle = document.querySelector("#edit-toggle");
const regenerateButton = document.querySelector("#regenerate");
const previewFrameShell = document.querySelector(".preview-frame-shell");
const editorLayout = document.querySelector("#editor-layout");
const editorContainer = document.querySelector("#gjs");
const editorPreviousSlide = document.querySelector("#editor-previous-slide");
const editorNextSlide = document.querySelector("#editor-next-slide");
const editorSlideCounter = document.querySelector("#editor-slide-counter");
const selectionStatus = document.querySelector("#selection-status");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const saveButton = document.querySelector("#save");
const exportHtmlButton = document.querySelector("#export-html");
const exportPdfButton = document.querySelector("#export-pdf");
const exportStatus = document.querySelector("#export-status");
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
cancelGenerationButton.addEventListener("click", cancelGeneration);
retryGenerationButton.addEventListener("click", retryCurrentProject);
regenerateButton.addEventListener("click", regenerateCurrentProject);
editToggle.addEventListener("click", toggleEditorMode);
editorPreviousSlide.addEventListener("click", () => state.editor?.previousSlide());
editorNextSlide.addEventListener("click", () => state.editor?.nextSlide());
undoButton.addEventListener("click", () => state.editor?.undo());
redoButton.addEventListener("click", () => state.editor?.redo());
saveButton.addEventListener("click", saveCurrentProject);
exportHtmlButton.addEventListener("click", () => void exportCurrentProject("html"));
exportPdfButton.addEventListener("click", () => void exportCurrentProject("pdf"));
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
        "</span>" +
        '<button class="project-delete" type="button" aria-label="删除项目 ' +
        escapeHtml(project.name) +
        '">删除</button>';
      article.addEventListener("click", () => openProject(project.id));
      article.querySelector(".project-delete").addEventListener("click", (event) => {
        event.stopPropagation();
        void deleteProject(project.id, project.name);
      });
      article.addEventListener("keydown", (event) => {
        if (event.target !== article) return;
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
  if (project.status === "可编辑") {
    openPreview(project);
  } else {
    showGenerationOutcome(project);
  }
}


async function generatePresentation() {
  const material = source.value.trim();
  if (!material || !state.selectedTemplate) return;
  if (state.activeGeneration) {
    showToast("当前已有演示文稿正在生成，请等待完成或先取消。");
    return;
  }

  const context = { projectId: null };
  state.activeGeneration = context;
  sendButton.disabled = true;
  generationPanel.hidden = false;
  generationMessage.textContent = "";
  cancelGenerationButton.hidden = true;
  cancelGenerationButton.disabled = false;
  retryGenerationButton.hidden = true;

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

    await readGenerationStream(response, context);
    if (!state.currentProject) throw new Error("生成结束，但没有收到项目状态。");
  } catch (error) {
    appendLog(error.message);
    showToast(error.message);
  } finally {
    if (state.activeGeneration === context) state.activeGeneration = null;
    cancelGenerationButton.hidden = true;
    sendButton.disabled = false;
  }
}

async function readGenerationStream(response, context) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consumeEvent(line, context);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer, context);
}

function consumeEvent(line, context) {
  if (!line.trim()) return;
  const event = JSON.parse(line);
  if (["error", "canceled", "result"].includes(event.type) && state.activeGeneration === context) {
    state.activeGeneration = null;
  }
  if (event.type === "project") {
    context.projectId = event.project.id;
    state.currentProject = event.project;
    generationMessage.textContent = "生成运行时可以返回首页处理其他可编辑项目。";
    cancelGenerationButton.hidden = false;
  }
  if (event.type === "stage") {
    stageElement.textContent = event.stage;
    state.stageHistory.push(event.stage);
    const item = document.createElement("li");
    item.textContent = event.stage;
    stageHistory.append(item);
  }
  if (event.type === "log") appendLog(event.message);
  if (event.type === "usage") appendLog("Codex 用量：" + JSON.stringify(event.usage));
  if (event.type === "error") {
    appendLog(event.message);
    if (isViewingGenerationProject(event.project.id)) {
      showGenerationOutcome(event.project);
    } else {
      void loadProjects();
    }
    showToast("生成失败");
  }
  if (event.type === "canceled") {
    if (isViewingGenerationProject(event.project.id)) {
      showGenerationOutcome(event.project);
    } else {
      void loadProjects();
      showToast(event.project.name + " 已取消");
    }
  }
  if (event.type === "result") {
    if (isViewingGenerationProject(event.project.id)) {
      openPreview(event.project);
    } else {
      void loadProjects();
      showToast(event.project.name + " 生成完成");
    }
  }
}

function isViewingGenerationProject(projectId) {
  return !views.new.hidden && state.currentProject?.id === projectId;
}

async function cancelGeneration() {
  const projectId = state.activeGeneration?.projectId || state.currentProject?.id;
  if (!projectId) return;

  cancelGenerationButton.disabled = true;
  try {
    const response = await fetch("/api/generations/" + encodeURIComponent(projectId) + "/cancel", {
      method: "POST",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "没有成功取消生成。");
    showGenerationOutcome(payload);
  } catch (error) {
    appendLog(error.message);
    showToast(error.message);
  } finally {
    cancelGenerationButton.disabled = false;
  }
}

async function regenerateCurrentProject() {
  const project = state.currentProject;
  if (!project) return;
  if (state.activeGeneration) {
    showToast("当前已有演示文稿正在生成，请等待完成或先取消。");
    return;
  }

  const confirmed = await askForConfirmation({
    title: "重新生成并覆盖当前内容？",
    message: "将复用原源材料和 " + project.templateName + " 模板，覆盖当前 HTML 和已有编辑。",
    confirmLabel: "确认重新生成",
  });
  if (!confirmed) return;

  await retryCurrentProject();
}

async function retryCurrentProject() {
  const project = state.currentProject;
  if (!project) return;
  if (state.activeGeneration) {
    showToast("当前已有演示文稿正在生成，请等待完成或先取消。");
    return;
  }

  const context = { projectId: project.id };
  state.activeGeneration = context;
  sendButton.disabled = true;

  try {
    const response = await fetch("/api/projects/" + encodeURIComponent(project.id) + "/generations", {
      method: "POST",
    });
    if (!response.ok || !response.body) {
      const payload = await response.json();
      throw new Error(payload.error || "重试没有成功启动。");
    }

    restoreProjectInputs(project);
    generationPanel.hidden = false;
    retryGenerationButton.hidden = true;
    cancelGenerationButton.hidden = true;
    cancelGenerationButton.disabled = false;
    generationMessage.textContent = "";
    stageElement.textContent = "正在准备材料";
    state.stageHistory = [];
    stageHistory.replaceChildren();
    logElement.textContent = "";
    showView("new");
    resetEditor();
    await readGenerationStream(response, context);
  } catch (error) {
    appendLog(error.message);
    showToast(error.message);
  } finally {
    if (state.activeGeneration === context) state.activeGeneration = null;
    cancelGenerationButton.hidden = true;
    sendButton.disabled = false;
  }
}

function restoreProjectInputs(project) {
  source.value = project.source || "";
  state.selectedTemplate = project.templateId;
  document.querySelectorAll('input[name="template"]').forEach((radio) => {
    radio.checked = radio.value === project.templateId;
  });
}

function showGenerationOutcome(project) {
  state.currentProject = project;
  restoreProjectInputs(project);

  generationPanel.hidden = false;
  stageElement.textContent = project.status;
  cancelGenerationButton.hidden = project.status !== "生成中";
  retryGenerationButton.hidden = !["已取消", "生成失败"].includes(project.status);
  generationMessage.textContent =
    project.status === "已取消"
      ? "生成已取消，源材料和演示模板已保留。"
      : project.status === "生成失败"
        ? project.error || "生成没有完成，源材料和演示模板已保留。"
        : "生成正在运行，可以返回首页处理其他可编辑项目。";
  updateSendState();
  showView("new");
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
    await refreshPreviewFromEditor();
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
    onSlideChange: updateEditorNavigation,
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

function updateEditorNavigation({
  current = 1,
  total = 1,
  canPrevious = false,
  canNext = false,
} = {}) {
  editorSlideCounter.textContent = current + " / " + total;
  editorPreviousSlide.disabled = !canPrevious;
  editorNextSlide.disabled = !canNext;
}

function resetEditor() {
  if (state.editor) state.editor.destroy();
  state.editor = null;
  state.editorProjectId = null;
  textControls.disabled = true;
  updateHistoryButtons();
  updateEditorNavigation();
}

async function refreshPreviewFromEditor() {
  if (!state.editor || !state.currentProject) return;
  const html = state.editor.getPreviewHtml();
  state.currentProject = { ...state.currentProject, html };
  const frame = document.querySelector('iframe[title="演示文稿预览"]');
  await new Promise((resolve) => {
    frame.addEventListener("load", resolve, { once: true });
    frame.srcdoc = html;
  });
}

async function saveCurrentProject() {
  saveButton.disabled = true;
  try {
    await persistCurrentProject();
    showToast("保存成功");
  } catch (error) {
    console.error(error);
    showToast("保存失败");
  } finally {
    saveButton.disabled = state.mode !== "edit";
  }
}

async function persistCurrentProject() {
  if (!state.editor || !state.currentProject) throw new Error("请先打开演示项目再保存。");
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
  return payload;
}

async function exportCurrentProject(format) {
  if (!state.currentProject) return;
  const label = format === "pdf" ? "PDF" : "HTML";
  exportHtmlButton.disabled = true;
  exportPdfButton.disabled = true;
  exportStatus.textContent = "正在保存当前编辑……";
  try {
    await ensureEditor();
    const project = await persistCurrentProject();
    exportStatus.textContent = "保存成功，正在导出 " + label;
    const response = await fetch(
      "/api/projects/" + encodeURIComponent(project.id) + "/exports/" + encodeURIComponent(format),
      { method: "POST" },
    );
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || label + " 没有导出成功。");
    }
    const blob = await response.blob();
    downloadBlob(blob, project.name + "." + format);
    exportStatus.textContent = label + " 导出成功";
  } catch (error) {
    console.error(error);
    exportStatus.textContent = error.message || label + " 没有导出成功，请重试。";
    showToast(exportStatus.textContent);
  } finally {
    exportHtmlButton.disabled = false;
    exportPdfButton.disabled = false;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function deleteProject(projectId, projectName) {
  const confirmed = await askForConfirmation({
    title: "永久删除演示项目？",
    message: "“" + projectName + "”将从本机永久删除，且无法恢复。",
    confirmLabel: "永久删除",
  });
  if (!confirmed) return;

  try {
    const response = await fetch("/api/projects/" + encodeURIComponent(projectId), {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "项目没有删除成功。");
    }
    await loadProjects();
    showToast("项目已永久删除");
  } catch (error) {
    showToast(error.message);
  }
}

function askForConfirmation({ title, message, confirmLabel }) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmAccept.textContent = confirmLabel;
  confirmDialog.showModal();

  return new Promise((resolve) => {
    const finish = (accepted) => {
      confirmCancel.removeEventListener("click", onCancelClick);
      confirmAccept.removeEventListener("click", onAcceptClick);
      confirmDialog.removeEventListener("cancel", onDialogCancel);
      if (confirmDialog.open) confirmDialog.close();
      resolve(accepted);
    };
    const onCancelClick = () => finish(false);
    const onAcceptClick = () => finish(true);
    const onDialogCancel = (event) => {
      event.preventDefault();
      finish(false);
    };

    confirmCancel.addEventListener("click", onCancelClick);
    confirmAccept.addEventListener("click", onAcceptClick);
    confirmDialog.addEventListener("cancel", onDialogCancel);
  });
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
