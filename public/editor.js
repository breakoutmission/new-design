import grapesjs from "/vendor/grapesjs/grapes.mjs";
import { repairImageSrcProps, syncImportedImageMarks, toLetterSpacingPx } from "./editor-controls.js";
import { clamp, copyComponentAdjacent } from "./element-operations.js";

const EDITABLE_TEXT_SELECTOR = "[data-editable-text], h1, h2, h3, h4, h5, h6, p";
const IMAGE_STYLE_KEYS = ["position", "left", "top", "right", "bottom", "width", "height"];
const PRESENTATION_STYLES_KEY = "apsPresentationStyles";

export async function mountPresentationEditor({
  container,
  project,
  onSelection,
  onLocked,
  onHistoryChange = () => {},
  onSlideChange = () => {},
}) {
  const presentationStyles = getPresentationStyles(project);
  const initialData = project.projectData
    ? { projectData: project.projectData }
    : parsePresentationHtml(project.html);
  const editor = grapesjs.init({
    container,
    height: "100%",
    width: "auto",
    storageManager: false,
    panels: { defaults: [] },
    allowScripts: false,
    ...initialData,
  });

  await new Promise((resolve) => editor.on("load", resolve));

  const frame = editor.Canvas.getFrameEl();
  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  appendPresentationStyles(frameDocument, presentationStyles);
  const editorSupportStyle = frameDocument.createElement("style");
  editorSupportStyle.setAttribute("data-aps-editor-support", "true");
  editorSupportStyle.textContent = [
    '[data-aps-selected="true"]{outline:4px solid #c25545!important;outline-offset:3px!important;}',
    "[data-anim]{opacity:1!important;animation:none!important;}",
  ].join("");
  frameDocument.head.append(editorSupportStyle);

  lockComponents(editor.getWrapper());
  if (project.sourceType === "imported") syncImportedImageMarks(editor.getWrapper());
  let selectedComponent = null;
  let selectedKind = null;
  let interaction = null;

  const hostDocument = container.ownerDocument;
  const handleLayer = createHandleLayer(hostDocument);
  const handles = Array.from(handleLayer.querySelectorAll("[data-resize-handle]"));
  const deck = frameDocument.querySelector("#deck, .deck, .stage");
  const slides = Array.from(frameDocument.querySelectorAll(".slide"));
  const counter = frameDocument.querySelector("[data-slide-counter]");
  let currentSlide = 0;

  const historyState = () => ({
    canUndo: editor.UndoManager.hasUndo(),
    canRedo: editor.UndoManager.hasRedo(),
  });

  const notifyHistory = () => onHistoryChange(historyState());

  const selectedTextState = () => {
    if (!selectedComponent || selectedKind !== "text") return null;
    const element = selectedComponent.getEl();
    if (!element) return null;
    const computed = frameWindow.getComputedStyle(element);
    const ownStyle = selectedComponent.getStyle();
    const fontSize = Math.round(Number.parseFloat(computed.fontSize) || 16);
    const computedLineHeight = Number.parseFloat(computed.lineHeight);
    const lineHeight =
      ownStyle["line-height"] ||
      (Number.isFinite(computedLineHeight) ? (computedLineHeight / fontSize).toFixed(2) : "1.2");
    return {
      content: element.textContent || "",
      fontFamily: computed.fontFamily || "",
      fontSize,
      fontWeight: computed.fontWeight || "400",
      color: colorToHex(computed.color),
      lineHeight,
      letterSpacing: toLetterSpacingPx(computed.letterSpacing),
      textAlign: computed.textAlign || "left",
    };
  };

  const updateImageHandles = () => {
    if (selectedKind !== "image" || !selectedComponent) {
      handleLayer.hidden = true;
      return;
    }
    const element = selectedComponent.getEl();
    if (!element) {
      handleLayer.hidden = true;
      return;
    }
    const rect = element.getBoundingClientRect();
    const positions = {
      nw: [rect.left, rect.top],
      ne: [rect.right, rect.top],
      sw: [rect.left, rect.bottom],
      se: [rect.right, rect.bottom],
    };
    handles.forEach((handle) => {
      const [left, top] = positions[handle.dataset.resizeHandle];
      handle.style.left = left + "px";
      handle.style.top = top + "px";
    });
    handleLayer.hidden = false;
  };

  const markSelected = () => {
    clearSelectionOutline(frameDocument);
    selectedComponent?.getEl()?.setAttribute("data-aps-selected", "true");
    updateImageHandles();
  };

  const notifySelection = () => {
    if (selectedKind === "text") {
      const text = selectedTextState();
      if (text) onSelection({ kind: "text", text });
    }
    if (selectedKind === "image") onSelection({ kind: "image" });
  };

  const clearSelectionState = () => {
    selectedComponent = null;
    selectedKind = null;
    clearSelectionOutline(frameDocument);
    updateImageHandles();
    onSelection({ kind: null });
  };

  const selectionIsLive = () => {
    if (!selectedComponent || !selectedKind) return false;
    const element = selectedComponent.getEl?.();
    return Boolean(element) && frameDocument.contains(element);
  };

  const handleSelected = (component) => {
    if (!component) {
      clearSelectionState();
      return;
    }
    const element = component.getEl();
    const editableText = element ? findEditableText(element) : null;
    const editableImage = element ? findEditableImage(element) : null;
    clearSelectionOutline(frameDocument);

    if (editableText) {
      selectedComponent = closestComponentForElement(component, editableText);
      selectedKind = "text";
      markSelected();
      notifySelection();
      return;
    }

    if (editableImage) {
      editableImage.draggable = false;
      selectedComponent = component;
      selectedKind = "image";
      markSelected();
      notifySelection();
      return;
    }

    selectedComponent = null;
    selectedKind = null;
    updateImageHandles();
    onLocked();
  };

  const updateTextContent = (value) => {
    if (!selectedComponent || selectedKind !== "text") return;
    selectedComponent.components(escapeHtml(value));
    markSelected();
    notifySelection();
    notifyHistory();
  };

  const updateTextStyle = (property, value) => {
    if (!selectedComponent || selectedKind !== "text") return;
    selectedComponent.addStyle({ [property]: value });
    markSelected();
    notifySelection();
    notifyHistory();
  };

  const clearTextStyle = (property) => {
    if (!selectedComponent || selectedKind !== "text") return;
    selectedComponent.removeStyle(property);
    markSelected();
    notifySelection();
    notifyHistory();
  };

  const replaceSelectedImage = (src) => {
    if (!selectedComponent || selectedKind !== "image") return false;
    // GrapesJS 图片组件的 HTML 序列化取模型 src 属性（getAttrToHTML → getSrcResult），
    // 必须经 set({ src }) 更新；仅改 attributes 不会进入保存结果。
    selectedComponent.set({ src });
    markSelected();
    notifyHistory();
    return true;
  };

  const refreshSelection = () => {
    if (!selectionIsLive()) {
      clearSelectionState();
    } else {
      markSelected();
      notifySelection();
    }
    notifyHistory();
  };

  const copySelection = () => {
    if (!selectionIsLive()) return;
    const clone = copyComponentAdjacent(selectedComponent);
    if (!clone) return;
    editor.select(clone);
    notifyHistory();
  };

  const deleteSelection = () => {
    if (!selectionIsLive()) return;
    const target = selectedComponent;
    clearSelectionState();
    target.remove();
    notifyHistory();
  };

  const undo = () => {
    editor.UndoManager.undo();
    repairImageSrcProps(editor.getWrapper());
    refreshSelection();
  };

  const redo = () => {
    editor.UndoManager.redo();
    repairImageSrcProps(editor.getWrapper());
    refreshSelection();
  };

  const showSlide = (next) => {
    if (!slides.length) return;
    currentSlide = clamp(next, 0, slides.length - 1);
    if (deck?.id === "deck") {
      deck.style.transform = "translateX(-" + currentSlide * 100 + "vw)";
    } else {
      slides.forEach((slide, index) => {
        slide.classList.toggle("active", index === currentSlide);
        slide.classList.toggle("prev", index < currentSlide);
      });
    }
    if (counter) {
      const currentValue = counter.querySelector("#current");
      const totalValue = counter.querySelector("#total");
      if (currentValue && totalValue) {
        currentValue.textContent = String(currentSlide + 1);
        totalValue.textContent = String(slides.length);
      } else {
        counter.textContent = currentSlide + 1 + " / " + slides.length;
      }
    }
    onSlideChange({
      current: currentSlide + 1,
      total: slides.length,
      canPrevious: currentSlide > 0,
      canNext: currentSlide < slides.length - 1,
    });
    updateImageHandles();
  };

  const previousSlide = () => showSlide(currentSlide - 1);
  const nextSlide = () => showSlide(currentSlide + 1);
  const previousButton = frameDocument.querySelector("[data-prev]");
  const nextButton = frameDocument.querySelector("[data-next]");
  const handlePreviousSlide = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    previousSlide();
  };
  const handleNextSlide = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    nextSlide();
  };
  const handleSlideKeydown = (event) => {
    if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopImmediatePropagation();
      previousSlide();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopImmediatePropagation();
      nextSlide();
    }
  };
  frameWindow.addEventListener("keydown", handleSlideKeydown, true);
  previousButton?.addEventListener("click", handlePreviousSlide, true);
  nextButton?.addEventListener("click", handleNextSlide, true);

  const beginImageInteraction = (event) => {
    const target = event.target;
    const handle = target instanceof Element ? target.closest("[data-resize-handle]") : null;
    if (selectedKind !== "image" || !selectedComponent) return;

    const element = selectedComponent.getEl();
    const slide = element?.closest(".slide");
    if (!element || !slide) return;

    const imageRect = element.getBoundingClientRect();
    const insideImage =
      event.clientX >= imageRect.left &&
      event.clientX <= imageRect.right &&
      event.clientY >= imageRect.top &&
      event.clientY <= imageRect.bottom;
    if (!handle && !insideImage) return;

    const slideRect = slide.getBoundingClientRect();
    interaction = {
      kind: handle ? "resize" : "move",
      handle: handle?.dataset.resizeHandle || null,
      component: selectedComponent,
      captureTarget: target instanceof Element ? target : null,
      element,
      startX: event.clientX,
      startY: event.clientY,
      left: imageRect.left - slideRect.left,
      top: imageRect.top - slideRect.top,
      width: imageRect.width,
      height: imageRect.height,
      slideWidth: slideRect.width,
      slideHeight: slideRect.height,
      aspect: imageRect.width / imageRect.height,
      originalInline: Object.fromEntries(IMAGE_STYLE_KEYS.map((key) => [key, element.style[key]])),
      finalBox: null,
      changed: false,
    };
    interaction.captureTarget?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const moveImageInteraction = (event) => {
    if (!interaction) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    let box;

    if (interaction.kind === "move") {
      box = {
        left: clamp(interaction.left + dx, 0, interaction.slideWidth - interaction.width),
        top: clamp(interaction.top + dy, 0, interaction.slideHeight - interaction.height),
        width: interaction.width,
        height: interaction.height,
      };
    } else {
      const east = interaction.handle.includes("e");
      const south = interaction.handle.includes("s");
      const desiredWidth = interaction.width + dx * (east ? 1 : -1);
      const maxWidthByX = east
        ? interaction.slideWidth - interaction.left
        : interaction.left + interaction.width;
      const maxHeight = south
        ? interaction.slideHeight - interaction.top
        : interaction.top + interaction.height;
      const width = clamp(desiredWidth, 48, Math.min(maxWidthByX, maxHeight * interaction.aspect));
      const height = width / interaction.aspect;
      box = {
        left: east ? interaction.left : interaction.left + interaction.width - width,
        top: south ? interaction.top : interaction.top + interaction.height - height,
        width,
        height,
      };
    }

    interaction.changed =
      Math.abs(box.left - interaction.left) > 1 ||
      Math.abs(box.top - interaction.top) > 1 ||
      Math.abs(box.width - interaction.width) > 1;
    interaction.finalBox = box;
    applyVisualImageStyle(interaction.element, box);
    updateImageHandles();
    event.preventDefault();
  };

  const finishImageInteraction = (event) => {
    if (!interaction) return;
    const completed = interaction;
    interaction = null;
    if (completed.captureTarget?.hasPointerCapture?.(event.pointerId)) {
      completed.captureTarget.releasePointerCapture(event.pointerId);
    }

    restoreInlineImageStyle(completed.element, completed.originalInline);
    if (completed.changed && completed.finalBox) {
      completed.component.addStyle(toComponentImageStyle(completed.finalBox));
      selectedComponent = completed.component;
      selectedKind = "image";
      markSelected();
      notifyHistory();
    } else {
      updateImageHandles();
    }
    event.preventDefault();
  };

  hostDocument.addEventListener("pointerdown", beginImageInteraction, true);
  hostDocument.addEventListener("pointermove", moveImageInteraction, true);
  hostDocument.addEventListener("pointerup", finishImageInteraction, true);
  frameWindow.addEventListener("resize", updateImageHandles);
  editor.on("component:selected", handleSelected);
  editor.UndoManager.clear();
  editor.clearDirtyCount();
  notifyHistory();
  showSlide(0);
  frame.title = "演示文稿编辑画布";

  const getProjectData = () => ({
    ...editor.getProjectData(),
    [PRESENTATION_STYLES_KEY]: presentationStyles,
  });
  const getPreviewHtml = () =>
    serializePresentationHtml(
      project.html,
      editor.getHtml(),
      presentationStyles,
      editor.getCss(),
    );

  return {
    editor,
    previousSlide,
    nextSlide,
    updateTextContent,
    updateTextStyle,
    clearTextStyle,
    replaceSelectedImage,
    copySelection,
    deleteSelection,
    undo,
    redo,
    historyState,
    getProjectData,
    getPreviewHtml,
    destroy() {
      frameWindow.removeEventListener("keydown", handleSlideKeydown, true);
      previousButton?.removeEventListener("click", handlePreviousSlide, true);
      nextButton?.removeEventListener("click", handleNextSlide, true);
      hostDocument.removeEventListener("pointerdown", beginImageInteraction, true);
      hostDocument.removeEventListener("pointermove", moveImageInteraction, true);
      hostDocument.removeEventListener("pointerup", finishImageInteraction, true);
      frameWindow.removeEventListener("resize", updateImageHandles);
      editor.off("component:selected", handleSelected);
      handleLayer.remove();
      editor.destroy();
    },
  };
}

function getPresentationStyles(project) {
  const storedStyles = project.projectData?.[PRESENTATION_STYLES_KEY];
  if (Array.isArray(storedStyles)) {
    const normalizedStyles = storedStyles.map(normalizePresentationStyle);
    if (normalizedStyles.every(Boolean)) return normalizedStyles;
  }

  const document = new DOMParser().parseFromString(project.html, "text/html");
  return extractPresentationStyles(document);
}

function normalizePresentationStyle(style) {
  if (typeof style === "string") return { css: style, attributes: {} };
  if (!style || typeof style.css !== "string") return null;
  const attributes = Object.fromEntries(
    Object.entries(style.attributes || {}).filter(([, value]) => typeof value === "string"),
  );
  return { css: style.css, attributes };
}

function parsePresentationHtml(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const style = extractPresentationStyles(document)
    .map(({ css }) => css)
    .join(String.fromCharCode(10));
  document
    .querySelectorAll("script, style, meta[http-equiv], title")
    .forEach((element) => element.remove());
  return {
    components: document.body.innerHTML,
    style,
  };
}

function serializePresentationHtml(shellHtml, bodyHtml, presentationStyles, css) {
  const document = new DOMParser().parseFromString(shellHtml, "text/html");
  const scripts = Array.from(document.querySelectorAll("script")).map(
    (element) => element.outerHTML,
  );
  document.querySelectorAll("script, style").forEach((element) => element.remove());
  document.body.innerHTML = bodyHtml;
  document
    .querySelectorAll("[data-aps-selected]")
    .forEach((element) => element.removeAttribute("data-aps-selected"));

  presentationStyles.forEach((definition) => {
    document.head.append(createPresentationStyle(document, definition));
  });
  const editorStyle = document.createElement("style");
  editorStyle.setAttribute("data-editor-styles", "true");
  editorStyle.textContent = css;
  document.head.append(editorStyle);
  scripts.forEach((script) => document.body.insertAdjacentHTML("beforeend", script));
  return "<!doctype html>" + String.fromCharCode(10) + document.documentElement.outerHTML;
}

function appendPresentationStyles(frameDocument, presentationStyles) {
  const fragment = frameDocument.createDocumentFragment();
  presentationStyles.forEach((definition) => {
    const style = createPresentationStyle(frameDocument, definition);
    style.setAttribute("data-aps-source-styles", "true");
    fragment.append(style);
  });
  frameDocument.head.prepend(fragment);
}

function createPresentationStyle(document, { css, attributes }) {
  const style = document.createElement("style");
  Object.entries(attributes).forEach(([name, value]) => style.setAttribute(name, value));
  style.textContent = css;
  return style;
}

function extractPresentationStyles(document) {
  return Array.from(
    document.querySelectorAll("style:not([data-editor-styles])"),
    (element) => ({
      css: element.textContent || "",
      attributes: Object.fromEntries(
        Array.from(element.attributes, ({ name, value }) => [name, value]),
      ),
    }),
  );
}

function findEditableText(target) {
  if (target.closest("nav, [data-slide-counter]")) return null;
  const editable = target.closest(EDITABLE_TEXT_SELECTOR);
  if (!editable || !editable.closest(".slide")) return null;
  return editable;
}

function closestComponentForElement(component, element) {
  let candidate = component;
  while (candidate && candidate.getEl() !== element) {
    candidate = candidate.parent();
  }
  return candidate || component;
}

function findEditableImage(target) {
  const editable = target.closest("img[data-editable-image]");
  if (!editable || !editable.closest(".slide")) return null;
  return editable;
}

function clearSelectionOutline(document) {
  document
    .querySelectorAll('[data-aps-selected="true"]')
    .forEach((element) => element.removeAttribute("data-aps-selected"));
}

function lockComponents(component) {
  component.set({
    copyable: false,
    draggable: false,
    droppable: false,
    removable: false,
    toolbar: [],
  });
  component.components().forEach(lockComponents);
}


function createHandleLayer(document) {
  const layer = document.createElement("div");
  layer.setAttribute("data-image-handles", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "99999",
    pointerEvents: "none",
  });
  for (const corner of ["nw", "ne", "sw", "se"]) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.dataset.resizeHandle = corner;
    handle.setAttribute("aria-label", "图片" + corner.toUpperCase() + "角缩放");
    Object.assign(handle.style, {
      position: "fixed",
      width: "14px",
      height: "14px",
      minHeight: "0",
      padding: "0",
      border: "2px solid #fff",
      borderRadius: "2px",
      background: "#c25545",
      boxShadow: "0 0 0 1px #20382a",
      transform: "translate(-50%, -50%)",
      cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
      pointerEvents: "auto",
    });
    layer.append(handle);
  }
  layer.hidden = true;
  document.body.append(layer);
  return layer;
}

function applyVisualImageStyle(element, box) {
  Object.assign(element.style, toComponentImageStyle(box));
}

function restoreInlineImageStyle(element, original) {
  IMAGE_STYLE_KEYS.forEach((key) => {
    element.style[key] = original[key];
  });
}

function toComponentImageStyle(box) {
  return {
    position: "absolute",
    left: box.left + "px",
    top: box.top + "px",
    right: "auto",
    bottom: "auto",
    width: box.width + "px",
    height: box.height + "px",
  };
}

function colorToHex(value) {
  if (value.startsWith("#")) return value.slice(0, 7);
  const start = value.indexOf("(");
  const end = value.lastIndexOf(")");
  const channels = value
    .slice(start + 1, end)
    .split(",")
    .slice(0, 3)
    .map((channel) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(channel)))));
  if (channels.some((channel) => !Number.isFinite(channel))) return "#000000";
  return "#" + channels.map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
