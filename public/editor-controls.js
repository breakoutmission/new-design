// 编辑面板扩展逻辑（Issue #16）：字体/粗细/字间距排版选项、本地图片替换
// 与导入项目普通内容图片的编辑标记。排版选项与原型屏幕 10/11 一致；
// 锁定语义（背景图、SVG、Logo、模板装饰不可替换）沿用既有交互。

export const FONT_OPTIONS = [
  { value: "", label: "默认（跟随模板）" },
  { value: "'Playfair Display', serif", label: "Playfair Display（衬线）" },
  { value: "'Noto Serif SC', serif", label: "Noto Serif SC（中文衬线）" },
  { value: "'Inter', sans-serif", label: "Inter（无衬线）" },
  { value: "'Noto Sans SC', sans-serif", label: "Noto Sans SC（中文无衬线）" },
];

export const FONT_WEIGHT_OPTIONS = [
  { value: "", label: "默认（跟随模板）" },
  { value: "400", label: "常规 400" },
  { value: "500", label: "中等 500" },
  { value: "700", label: "粗体 700" },
];

// 与导入检查报告「可编辑图片」口径一致：页眉/导航/页脚之外、
// 属性不含 logo 字样的普通 <img>（CONTEXT.md「可编辑图片」）。
const LOCKED_SCOPE_TAGS = new Set(["header", "nav", "footer"]);
const LOGO_ATTRIBUTE_PATTERN = /logo/i;

// 把 computed font-family 匹配到选项值；模板自带字体不在选项内时返回 ""（默认）。
export function matchFontFamilyOption(computedFamily) {
  const family = String(computedFamily || "").toLowerCase();
  if (!family) return "";
  for (const option of FONT_OPTIONS) {
    if (!option.value) continue;
    const primary = option.value.split(",")[0].replaceAll("'", "").replaceAll('"', "").trim().toLowerCase();
    if (primary && family.includes(primary)) return option.value;
  }
  return "";
}

export function matchFontWeightOption(computedWeight) {
  const weight = String(Number.parseFloat(computedWeight) || "");
  return FONT_WEIGHT_OPTIONS.some((option) => option.value === weight) ? weight : "";
}

// computed letter-spacing 为 "normal" 或带单位长度值；面板以 px 展示。
export function toLetterSpacingPx(computedValue) {
  const parsed = Number.parseFloat(computedValue);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
}

export function readLocalImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

// 导入项目打开编辑时统一图片编辑标记：可编辑图片补 data-editable-image，
// 锁定图片（页眉/导航/页脚、Logo）清掉该标记，使编辑体验与导入检查报告一致。
// 对 GrapesJS 组件树操作（而非 DOM），改动才能进入项目数据并跨保存保持。
// 在挂载流程调用、且在撤销管理器清空之前，不污染会话内撤销历史。
export function syncImportedImageMarks(wrapper) {
  walkComponents(wrapper, (component) => {
    if (String(component.get("tagName") || "").toLowerCase() !== "img") return;
    const attributes = component.getAttributes();
    const attributeText = [
      stringifyAttribute(attributes.src),
      stringifyAttribute(attributes.class),
      stringifyAttribute(attributes.id),
      stringifyAttribute(attributes.alt),
    ].join(" ");
    const eligible =
      !hasLockedScopeParent(component) && !LOGO_ATTRIBUTE_PATTERN.test(attributeText);
    const marked = Boolean(attributes["data-editable-image"]);
    if (eligible === marked) return;
    component.addAttributes({ "data-editable-image": eligible ? "true" : "" });
  });
}

// GrapesJS 0.23 图片组件的撤销快照会丢弃 src 模型属性（ComponentImage.toJSON
// 在 src 与 attributes.src 相等时删除前者），撤销/重做后 prop 与 attributes 脱节：
// 画布按 attributes 显示新图，序列化（getAttrToHTML）却按 prop 输出旧图。
// 撤销/重做后以快照恢复的 attributes 为权威，静默同步回 prop（不产生新历史）。
export function repairImageSrcProps(wrapper) {
  walkComponents(wrapper, (component) => {
    if (String(component.get("tagName") || "").toLowerCase() !== "img") return;
    const attributeSrc = stringifyAttribute(component.getAttributes().src);
    const propertySrc = stringifyAttribute(component.get("src"));
    if (!attributeSrc || !propertySrc || attributeSrc === propertySrc) return;
    component.set("src", attributeSrc, { silent: true });
  });
}

function walkComponents(component, visit) {
  visit(component);
  component.components().forEach((child) => walkComponents(child, visit));
}

function hasLockedScopeParent(component) {
  let parent = component.parent();
  while (parent) {
    if (LOCKED_SCOPE_TAGS.has(String(parent.get("tagName") || "").toLowerCase())) return true;
    parent = parent.parent();
  }
  return false;
}

function stringifyAttribute(value) {
  if (value === undefined || value === null) return "";
  return Array.isArray(value) ? value.join(" ") : String(value);
}
