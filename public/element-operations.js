// 可编辑元素复制与删除：只操作 GrapesJS 项目数据（ADR-0009/0010），
// 不新增任何自定义数据模型或项目记录字段。
const COPY_OFFSET_PX = 24;

export function copyComponentAdjacent(component) {
  const parent = component.parent();
  if (!parent) return null;
  const clone = component.clone();
  const offsetStyle = buildAdjacentOffsetStyle(component);
  if (offsetStyle) clone.addStyle(offsetStyle);
  const index = component.index();
  parent.append(clone, { at: index + 1 });
  return clone;
}

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

// 绝对定位元素（如移动过的图片）的副本若不做偏移，会与原件完全重叠；
// 流式布局元素插入相邻位置后自然排在原件附近，无需偏移。
// 坐标沿用图片拖拽的既有约定：以幻灯片为参照（imageRect - slideRect）。
function buildAdjacentOffsetStyle(component) {
  const element = component.getEl();
  const slide = element?.closest?.(".slide");
  if (!element || !slide) return null;
  const frameWindow = element.ownerDocument.defaultView;
  const position = frameWindow ? frameWindow.getComputedStyle(element).position : "";
  if (position !== "absolute" && position !== "fixed") return null;

  const elementRect = element.getBoundingClientRect();
  const slideRect = slide.getBoundingClientRect();
  if (elementRect.width <= 0 || elementRect.height <= 0) return null;
  const left = clamp(
    elementRect.left - slideRect.left + COPY_OFFSET_PX,
    0,
    slideRect.width - elementRect.width,
  );
  const top = clamp(
    elementRect.top - slideRect.top + COPY_OFFSET_PX,
    0,
    slideRect.height - elementRect.height,
  );
  return {
    position: "absolute",
    left: left + "px",
    top: top + "px",
    right: "auto",
    bottom: "auto",
  };
}
