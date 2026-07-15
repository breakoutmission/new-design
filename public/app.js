const state = {
  templates: [],
  projects: [],
  selectedTemplate: null,
  currentProject: null,
  stageHistory: [],
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

document.querySelector("#new-project").addEventListener("click", () => showView("new"));
document
  .querySelectorAll('[data-action="home"]')
  .forEach((button) => button.addEventListener("click", showHome));
source.addEventListener("input", updateSendState);
sendButton.addEventListener("click", generatePresentation);

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
      return article;
    }),
  );
  empty.hidden = state.projects.length > 0;
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
  state.currentProject = project;
  document.querySelector("#preview-title").textContent = project.name;
  const frame = document.querySelector('iframe[title="演示文稿预览"]');
  frame.srcdoc = project.html;
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
    timeStyle: "short",
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
