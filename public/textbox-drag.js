// 可编辑文字整框拖拽与原位留白：只操作 GrapesJS 项目数据（ADR-0009/0010），
// 不新增自定义数据模型或项目记录字段。
// 坐标沿用图片拖拽的既有约定：以幻灯片为参照（elementRect - slideRect）。
import { clamp } from "./element-operations.js";

const TEXT_BOX_STYLE_KEYS = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "margin",
  "transform",
];

export const PLACEHOLDER_ATTRIBUTE = "data-aps-placeholder";

export function beginTextBoxDrag(component, element, event) {
  const slide = element?.closest(".slide");
  if (!element || !slide) return null;
  const box = element.getBoundingClientRect();
  const insideBox =
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom;
  if (!insideBox) return null;

  const slideRect = slide.getBoundingClientRect();
  const frameWindow = element.ownerDocument.defaultView;
  const computed = frameWindow.getComputedStyle(element);
  const position = computed.position;
  return {
    component,
    element,
    flow: position !== "absolute" && position !== "fixed",
    startX: event.clientX,
    startY: event.clientY,
    left: box.left - slideRect.left,
    top: box.top - slideRect.top,
    width: box.width,
    height: box.height,
    slideWidth: slideRect.width,
    slideHeight: slideRect.height,
    margins: {
      top: computed.marginTop,
      right: computed.marginRight,
      bottom: computed.marginBottom,
      left: computed.marginLeft,
    },
    originalInline: Object.fromEntries(TEXT_BOX_STYLE_KEYS.map((key) => [key, element.style[key]])),
    finalBox: null,
    changed: false,
  };
}

export function moveTextBoxDrag(interaction, event) {
  const dx = event.clientX - interaction.startX;
  const dy = event.clientY - interaction.startY;
  const box = {
    left: clamp(interaction.left + dx, 0, interaction.slideWidth - interaction.width),
    top: clamp(interaction.top + dy, 0, interaction.slideHeight - interaction.height),
    width: interaction.width,
    height: interaction.height,
  };
  interaction.changed =
    Math.abs(box.left - interaction.left) > 1 || Math.abs(box.top - interaction.top) > 1;
  interaction.finalBox = box;

  // 流式元素拖拽中用 transform 视觉位移：布局不受扰动，周围内容全程不动；
  // 已定位元素与图片拖拽一致，直接更新 left/top 预览。
  if (interaction.flow) {
    interaction.element.style.transform =
      "translate(" + (box.left - interaction.left) + "px," + (box.top - interaction.top) + "px)";
  } else {
    Object.assign(interaction.element.style, toComponentTextBoxStyle(box));
  }
  return box;
}

export function restoreInlineTextBoxStyle(element, original) {
  TEXT_BOX_STYLE_KEYS.forEach((key) => {
    element.style[key] = original[key];
  });
}

// 提交拖拽：流式元素先在同父原索引处插入占位盒、再转为自由定位——
// 两次模型改动发生在同一同步调用栈内，撤销管理器将其并为一步，一次撤销即可整体复原。
// 占位盒保留原尺寸与原 margin，物理占据原流式空间，周围内容不回填。
// 流式路径同时清除样式表 transform：坐标取自含 transform 的视觉 rect，
// 不中和 transform 会让落点整体偏移一个 transform 量。
export function commitTextBoxDrag(interaction, box) {
  if (interaction.flow) {
    insertInPlacePlaceholder(interaction);
    interaction.component.addStyle({
      ...toComponentTextBoxStyle(box),
      transform: "none",
    });
    return;
  }
  interaction.component.addStyle(toComponentTextBoxStyle(box));
}

function insertInPlacePlaceholder(interaction) {
  const component = interaction.component;
  const parent = component.parent();
  // 可编辑文字必有 .slide 祖先（findEditableText 保证），parent 实际不可达；
  // 若极端情况触发，宁可得到一次无留白的移动，也不中断拖拽。
  if (!parent) return;
  const { top, right, bottom, left } = interaction.margins;
  // 尺寸必须经 addStyle 进入样式模型：本编辑器序列化丢弃 attributes.style
  // （avoidInline 导出模式），占位盒样式只有像其他编辑一样走样式模型，
  // 才能以 #id 规则进入预览与导出的 HTML，留白不塌陷。
  const placeholder = parent.components().add(
    { tagName: "div", attributes: { [PLACEHOLDER_ATTRIBUTE]: "true" } },
    { at: component.index() },
  );
  placeholder.addStyle({
    width: interaction.width + "px",
    height: interaction.height + "px",
    margin: top + " " + right + " " + bottom + " " + left,
  });
}

function toComponentTextBoxStyle(box) {
  return {
    position: "absolute",
    left: box.left + "px",
    top: box.top + "px",
    right: "auto",
    bottom: "auto",
    width: box.width + "px",
    height: box.height + "px",
    margin: "0",
  };
}
