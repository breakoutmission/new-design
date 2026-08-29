// 导入检查器：受限 HTML 导入的纯函数缝。
// HTML 字符串进，判定档位、逐条规则报告和处理后的 HTML 出（ADR-0013、Spec #13）。
// Issue #14 建立最小规则集并冻结三份契约（字段名与类型不得改动）；
// Issue #15 在此基础上向后兼容扩展：页面识别规则表（优先级制）、三档判定映射、
// 锁定元素清单、动效转静态、硬性不支持原因（框架 / 脚本生成内容 / 受限嵌入）
// 与畸形文件的明确原因。规则表正反样本见 tests/import-checker.mjs 与
// docs/import-checker-rules.md。

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

const VERDICT_FULL = "完全可编辑";
const VERDICT_PARTIAL = "部分可编辑";
const VERDICT_UNSUPPORTED = "暂不支持";

// ---------------------------------------------------------------------------
// 通用模式
// ---------------------------------------------------------------------------

const SCRIPT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STRAY_SCRIPT_PATTERN = /<script\b[^>]*>/gi;
const INLINE_EVENT_PATTERN = /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const CLASS_ATTRIBUTE_PATTERN = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const KEYFRAMES_PATTERN = /@(?:-webkit-)?keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi;
// animation/transition 属性声明的值整体置为 none；前缀锚定避免误伤 data-animation 之类的属性名。
// 只在 <style> 块与 style 属性内执行（见 neutralizeAnimations），不得触碰正文文本。
const ANIMATION_DECLARATION_PATTERN = /(^|[\s{;"])((?:animation|transition)(?:-[a-z-]+)?\s*):[^;}"']*/gi;
const STATIC_ANIMATION_VALUE_PATTERN = /^(?:none|initial|inherit|unset|revert)$/i;
// HTML5 允许的空注释写法（<!--> 与 <!--->），先剔除再计数，避免误报未闭合注释。
const EMPTY_COMMENT_PATTERN = /<!--(?:-?)>/g;
const INLINE_STYLE_DOUBLE_PATTERN = /\sstyle\s*=\s*"([^"]*)"/gi;
const INLINE_STYLE_SINGLE_PATTERN = /\sstyle\s*=\s*'([^']*)'/gi;

// 页面识别词元：slide / page 必须是独立的类名词（以空格、连字符、下划线或边界分隔），
// 避免 slideshow、homepage 之类的普通词误判。
const SLIDE_CLASS_TOKEN = /(?:^|[-_\s])slide(?:[-_\s]|$)/i;
const PAGE_CLASS_TOKEN = /(?:^|[-_\s])page(?:[-_\s]|$)/i;
const DATA_PAGE_TAG_PATTERN = /<[a-z][\w-]*\b[^>]*?\sdata-(?:slide|page)\b[^>]*>/gi;
const SECTION_TAG_PATTERN = /<section\b[^>]*>/gi;
const FULLSCREEN_SIZE_PATTERN = /(?:min-)?height\s*:\s*(?:100vh|100%)\b/i;

// 导入副本的安全预览 CSP：与生成项目同基线，但脚本彻底禁用（导入副本不含脚本），
// 图片/字体/媒体额外允许 https 来源，避免真实外部文件在预览中全部裂图。
const IMPORT_CSP = [
  "default-src 'none'",
  "img-src data: blob: https:",
  "font-src data: https:",
  "style-src 'unsafe-inline' https:",
  "script-src 'none'",
  "connect-src 'none'",
  "media-src data: blob: https:",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

// 硬性不支持：前端框架特征。脚本 API 特征只在脚本标签文本里找（避免正文提及
// React 等词误判），框架专属属性 / 全局标记在全文找。
const FRAMEWORK_SIGNATURES = [
  {
    name: "React",
    scriptPattern: /(?:^|[^a-z])react(?:-dom)?[.\w-]*\.js|ReactDOM|createRoot\s*\(/i,
    documentPattern: /__NEXT_DATA__|data-reactroot/i,
  },
  {
    name: "Vue",
    scriptPattern: /(?:^|[^a-z])vue(?:-runtime)?[.\w-]*\.js|createApp\s*\(|new Vue\b/i,
    documentPattern: /data-v-app/i,
  },
  {
    name: "Angular",
    scriptPattern: /(?:^|[^a-z])angular[.\w-]*\.js/i,
    documentPattern: /ng-version\s*=|ng-app\b/i,
  },
];
const EMPTY_APP_ROOT_PATTERN =
  /<(?:div|main|section)\b[^>]*\bid\s*=\s*["']?(?:root|app|__next|q-app)["']?[^>]*>\s*<\/(?:div|main|section)>/i;
// 脚本驱动的动效特征：这些 API 随脚本移除后动效冻结为静止画面。
// setInterval 不算动效特征——翻页计时器随脚本移除后由产品页面导航接管（Spec #13）。
const SCRIPT_MOTION_PATTERN = /requestAnimationFrame\s*\(|\.animate\s*\(/g;

const BLOCK_SCOPE_PATTERN = /<(?:header|nav|footer)\b[^>]*>[\s\S]*?<\/(?:header|nav|footer)\s*>/gi;
const HEADER_BLOCK_PATTERN = /<header\b[^>]*>([\s\S]*?)<\/header\s*>/gi;
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const BACKGROUND_GRADIENT_PATTERN = /background(?:-image)?\s*:[^;}'"]*gradient\s*\(/gi;
const BACKGROUND_IMAGE_PATTERN = /background(?:-image)?\s*:[^;}'"]*url\s*\(/gi;
const IMG_TAG_PATTERN = /<img\b[^>]*>/gi;
const LOGO_TAG_PATTERN = /logo/i;
const EDITABLE_TEXT_PATTERN = /<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

// ---------------------------------------------------------------------------
// 主流程：规则评估顺序（短路）保持 #14 冻结的相对顺序：
// file-type → file-size → file-integrity → [新增硬性不支持组：framework-detection、
// dynamic-content、restricted-embeds，整组并列评估] → page-structure →
// [新增：locked-content → animation-static → content-inventory] → script-removal。
// 任一 fail 判「暂不支持」；无 fail 且存在锁定内容判「部分可编辑」；否则「完全可编辑」。
// ---------------------------------------------------------------------------

export function runImportCheck({ fileName, fileSize, html }) {
  const rules = [];
  const normalizedFileName = String(fileName || "");

  const typeOk = /\.html?$/i.test(normalizedFileName);
  rules.push(
    typeOk
      ? pass("file-type", "文件类型", "HTML 演示文稿文件")
      : fail("file-type", "文件类型", "仅支持 .html 演示文稿文件"),
  );

  const size = Number(fileSize) || 0;
  if (size > IMPORT_MAX_BYTES) {
    rules.push(fail("file-size", "文件大小", "文件超过 " + formatBytes(IMPORT_MAX_BYTES) + " 大小上限"));
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }
  if (!typeOk) {
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }
  rules.push(pass("file-size", "文件大小", formatBytes(size) + "，未超过 " + formatBytes(IMPORT_MAX_BYTES) + " 上限"));

  const content = String(html || "");
  if (!/<!doctype html>/i.test(content) || !/<html[\s>]/i.test(content) || !/<\/html>/i.test(content)) {
    rules.push(fail("file-integrity", "文件完整性", "不是完整的 HTML 文件"));
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }
  const malformedReason = detectMalformedHtml(content);
  if (malformedReason) {
    rules.push(fail("file-integrity", "文件完整性", malformedReason));
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }
  rules.push(pass("file-integrity", "文件完整性", "完整的自包含 HTML 页面"));

  // 硬性不支持组：整组评估后汇总展示（对齐原型屏幕 9 的多原因报告），
  // 任一 fail 即判暂不支持，不再进入页面识别。
  const scriptTagText = (content.match(SCRIPT_PATTERN) || []).join("\n");
  const frameworkNames = detectFrameworks(content, scriptTagText);
  if (frameworkNames.length > 0) {
    rules.push(
      fail(
        "framework-detection",
        "检测到 " + frameworkNames.join("、") + " 框架",
        "页面结构由框架接管，无法安全转为可编辑内容",
      ),
    );
  }
  if (isScriptGeneratedContent(content)) {
    rules.push(
      fail("dynamic-content", "页面内容由脚本动态生成", "检查时得不到稳定页面，无法识别文字与图片"),
    );
  }
  const embedReasons = detectRestrictedEmbeds(content, scriptTagText);
  if (embedReasons.length > 0) {
    rules.push(fail("restricted-embeds", "包含暂不支持的嵌入内容", embedReasons.join("；")));
  }
  if (rules.some((rule) => rule.status === "fail")) {
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }

  const processed = prepareImportedHtml(content);
  if (processed.slideCount < 1) {
    rules.push(fail("page-structure", "页面结构识别", "无法识别演示页面"));
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }
  rules.push(
    pass(
      "page-structure",
      "页面结构识别",
      "通过「" + processed.pageRuleLabel + "」识别出 " + processed.slideCount + " 页幻灯片",
    ),
  );

  const analysis = analyzeImportedHtml(processed.html, scriptTagText);
  if (analysis.lockedElements.length > 0) {
    rules.push(warn("locked-content", "锁定元素清单", lockDetail(analysis.lockedElements)));
  }
  rules.push(
    pass(
      "animation-static",
      processed.animationCount > 0 ? processed.animationCount + " 处 CSS 动画已转为静态" : "未发现 CSS 动画",
      processed.animationCount > 0 ? "进入编辑后动画只保留最终画面" : "预览与编辑按静止画面显示",
    ),
  );
  const [textInventory, imageInventory] = analysis.editableContent;
  rules.push(
    pass(
      "content-inventory",
      "可编辑内容盘点",
      "识别出 " + textInventory.count + " 处可编辑文字、" + imageInventory.count + " 张可编辑图片",
    ),
  );
  rules.push(
    pass(
      "script-removal",
      processed.scriptCount > 0 ? "已移除 " + processed.scriptCount + " 段脚本" : "未发现脚本",
      "预览与编辑不运行原文件脚本",
    ),
  );

  return finish({
    fileName: normalizedFileName,
    size,
    rules,
    html: processed.html,
    slideCount: processed.slideCount,
    scriptCount: processed.scriptCount,
    animationCount: processed.animationCount,
    lockedElements: analysis.lockedElements,
    editableContent: analysis.editableContent,
  });
}

// ---------------------------------------------------------------------------
// 导入副本安全化：移除全部脚本与内联事件属性，按页面识别规则表统一补 slide 语义
// class，CSS 动画与过渡转静态，注入导入专用 CSP。生成项目的安全预览准备
// （preparePreviewHtml）不适用于导入副本：导入文件没有模板约定的页码与可编辑图片
// 标记，也不得被注入产品脚本。
// ---------------------------------------------------------------------------

export function prepareImportedHtml(html) {
  let result = String(html || "");
  const scriptMatches = result.match(SCRIPT_PATTERN) || [];
  const scriptCount =
    scriptMatches.length + (result.replace(SCRIPT_PATTERN, "").match(STRAY_SCRIPT_PATTERN) || []).length;
  result = result
    .replace(SCRIPT_PATTERN, "")
    .replace(STRAY_SCRIPT_PATTERN, "")
    .replace(INLINE_EVENT_PATTERN, "");

  const pages = identifyPages(result);
  if (pages) {
    result = markSlides(result, pages);
  }

  const animated = neutralizeAnimations(result);
  result = animated.html;

  // 产品 CSP 必须生效：先移除上传文件自带的 CSP 声明，再注入导入专用 CSP，
  // 避免上传文件用宽松 CSP 覆盖产品的脚本禁令。
  result = result.replace(
    /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    "",
  );
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + IMPORT_CSP + '">';
  result = /<head[\s>]/i.test(result)
    ? result.replace(/<head([^>]*)>/i, "<head$1>" + meta)
    : result.replace(/<html([^>]*)>/i, "<html$1><head>" + meta + "</head>");

  return {
    html: result,
    scriptCount,
    slideCount: pages ? pages.slideCount : 0,
    pageRuleLabel: pages ? pages.label : "",
    animationCount: animated.count,
  };
}

// ---------------------------------------------------------------------------
// 页面识别规则表（优先级从高到低，先命中先用；同一元素只计一次）。
// 每条规则的正反固定样本见 tests/import-checker.mjs B 组用例。
// mark 描述该规则的补类方式：class 规则按词元改写 class 属性；
// tag 规则按标签模式给开标签补 slide 语义类。
// ---------------------------------------------------------------------------

// 1. slide-class-token：class 含 slide 词元的容器各为一页。
// 2. page-class-token：class 含 page 词元的容器各为一页。
// 3. page-data-attribute：带 data-slide / data-page 属性的容器各为一页。
// 4. sibling-sections：两个以上并列 <section> 区块各为一页。
// 5. single-fullscreen-section：唯一 <section> 且样式声明全屏尺寸时回退为单页。
// 全部失败则识别不出页面，判「暂不支持」。
function identifyPages(html) {
  const slideClassCount = countClassTokenElements(html, SLIDE_CLASS_TOKEN);
  if (slideClassCount > 0) {
    return {
      label: "slide 类名规则",
      slideCount: slideClassCount,
      mark: { type: "class", token: SLIDE_CLASS_TOKEN },
    };
  }
  const pageClassCount = countClassTokenElements(html, PAGE_CLASS_TOKEN);
  if (pageClassCount > 0) {
    return {
      label: "page 类名规则",
      slideCount: pageClassCount,
      mark: { type: "class", token: PAGE_CLASS_TOKEN },
    };
  }
  const dataTagCount = (html.match(DATA_PAGE_TAG_PATTERN) || []).length;
  if (dataTagCount > 0) {
    return {
      label: "data-slide / data-page 属性规则",
      slideCount: dataTagCount,
      mark: { type: "tag", pattern: DATA_PAGE_TAG_PATTERN },
    };
  }
  const sectionTags = html.match(SECTION_TAG_PATTERN) || [];
  if (sectionTags.length >= 2) {
    return {
      label: "并列 section 区块规则",
      slideCount: sectionTags.length,
      mark: { type: "tag", pattern: SECTION_TAG_PATTERN },
    };
  }
  if (sectionTags.length === 1 && FULLSCREEN_SIZE_PATTERN.test(html)) {
    return {
      label: "唯一全屏区块规则",
      slideCount: 1,
      mark: { type: "tag", pattern: SECTION_TAG_PATTERN },
    };
  }
  return null;
}

function countClassTokenElements(html, token) {
  let count = 0;
  for (const match of html.matchAll(CLASS_ATTRIBUTE_PATTERN)) {
    const value = match[1] ?? match[2] ?? "";
    if (token.test(value)) count += 1;
  }
  return count;
}

function markSlides(html, pages) {
  if (pages.mark.type === "class") {
    const token = pages.mark.token;
    return html.replace(CLASS_ATTRIBUTE_PATTERN, (match, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted ?? singleQuoted ?? "";
      if (!token.test(value)) return match;
      const hasSlide = SLIDE_CLASS_TOKEN.test(value);
      return 'class="' + (hasSlide ? value : value + " slide") + '"';
    });
  }
  return html.replace(pages.mark.pattern, (tag) => addSlideClassToTag(tag));
}

function addSlideClassToTag(tag) {
  const doubleQuote = tag.match(/\bclass\s*=\s*"([^"]*)"/);
  if (doubleQuote) {
    if (SLIDE_CLASS_TOKEN.test(doubleQuote[1])) return tag;
    return tag.replace(/\bclass\s*=\s*"[^"]*"/, 'class="' + doubleQuote[1] + ' slide"');
  }
  const singleQuote = tag.match(/\bclass\s*=\s*'([^']*)'/);
  if (singleQuote) {
    if (SLIDE_CLASS_TOKEN.test(singleQuote[1])) return tag;
    return tag.replace(/\bclass\s*=\s*'[^']*'/, "class='" + singleQuote[1] + " slide'");
  }
  return tag.replace(/\s*\/?>$/, (ending) => ' class="slide"' + ending);
}

// ---------------------------------------------------------------------------
// CSS 动画与过渡转静态：删除 <style> 块内的 @keyframes 定义，把 style 块与
// style 属性里的 animation/transition 声明值置为 none；每处实际转换的声明与
// 每个移除的 keyframes 定义各计 1 处。已经是静态值的声明不计处数。
// 处理严格限定在样式上下文内，正文文本中出现的 animation: 字样不受影响。
// 脚本驱动的动效不属于此范围（见锁定类别「脚本动效」）。
// ---------------------------------------------------------------------------

function neutralizeAnimations(html) {
  let count = 0;
  let result = html.replace(STYLE_BLOCK_PATTERN, (block, inner) => {
    const withoutKeyframes = inner.replace(KEYFRAMES_PATTERN, () => {
      count += 1;
      return "";
    });
    return "<style>" + neutralizeDeclarations(withoutKeyframes, () => (count += 1)) + "</style>";
  });
  result = result
    .replace(INLINE_STYLE_DOUBLE_PATTERN, (match, value) =>
      match.replace(value, neutralizeDeclarations(value, () => (count += 1))),
    )
    .replace(INLINE_STYLE_SINGLE_PATTERN, (match, value) =>
      match.replace(value, neutralizeDeclarations(value, () => (count += 1))),
    );
  return { html: result, count };
}

function neutralizeDeclarations(css, onNeutralized) {
  return css.replace(ANIMATION_DECLARATION_PATTERN, (match, prefix, property) => {
    const value = match.slice(match.indexOf(":") + 1).trim();
    if (STATIC_ANIMATION_VALUE_PATTERN.test(value)) return match;
    onNeutralized();
    return prefix + property + ": none";
  });
}

// ---------------------------------------------------------------------------
// 锁定元素清单与可编辑内容盘点（均在安全化后的副本上统计）。
// 锁定类别：SVG 装饰图形、背景渐变、背景图、页眉 Logo、脚本动效；
// 全部保持原样显示，报告列明类别、数量与原因，支撑原型屏幕 8 的展示。
// ---------------------------------------------------------------------------

function analyzeImportedHtml(processedHtml, scriptTagText) {
  const lockedElements = [];
  const addLock = (category, count, reason) => {
    if (count > 0) lockedElements.push({ category, count, reason });
  };

  addLock(
    "SVG 装饰图形",
    (processedHtml.match(/<svg\b/gi) || []).length,
    "第一版不编辑矢量图形，保持原样显示",
  );

  const styleText = collectStyleText(processedHtml);
  addLock(
    "背景渐变",
    (styleText.match(BACKGROUND_GRADIENT_PATTERN) || []).length,
    "背景渐变不提供编辑，保持原样显示",
  );
  addLock(
    "背景图",
    (styleText.match(BACKGROUND_IMAGE_PATTERN) || []).length,
    "背景图不提供选择与修改，保持原样显示",
  );

  addLock("页眉 Logo", countHeaderLogos(processedHtml), "品牌标识不提供替换，保持原样显示");
  addLock(
    "脚本动效",
    (scriptTagText.match(SCRIPT_MOTION_PATTERN) || []).length,
    "依赖原文件脚本的动效随脚本移除冻结为静止画面",
  );

  const contentScope = processedHtml.replace(BLOCK_SCOPE_PATTERN, "");
  const imageCount = Math.max(
    (contentScope.match(IMG_TAG_PATTERN) || []).length - countLogoTagImages(contentScope),
    0,
  );

  const editableContent = [
    { category: "可编辑文字", count: countEditableText(contentScope), note: "可修改内容、字号、颜色、行距和对齐方式" },
    { category: "可编辑图片", count: imageCount, note: "可拖动位置与四角等比例缩放" },
  ];
  return { lockedElements, editableContent };
}

// 锁定元素清单的用户可读详情：逐类别列出数量（支撑原型屏幕 8 的分类展示）。
function lockDetail(lockedElements) {
  const list = lockedElements.map((item) => item.category + " " + item.count + " 处").join("、");
  return list + "保持原样显示，不可编辑";
}

function collectStyleText(html) {
  const blocks = [];
  for (const match of html.matchAll(STYLE_BLOCK_PATTERN)) blocks.push(match[1]);
  for (const match of html.matchAll(INLINE_STYLE_DOUBLE_PATTERN)) blocks.push(match[1]);
  for (const match of html.matchAll(INLINE_STYLE_SINGLE_PATTERN)) blocks.push(match[1]);
  return blocks.join("\n");
}

function countHeaderLogos(html) {
  let count = 0;
  const remainder = html.replace(HEADER_BLOCK_PATTERN, (_, inner) => {
    count += (inner.match(/<img\b/gi) || []).length;
    return "";
  });
  return count + countLogoTagImages(remainder);
}

function countLogoTagImages(html) {
  let count = 0;
  for (const tag of html.match(IMG_TAG_PATTERN) || []) {
    if (LOGO_TAG_PATTERN.test(tag)) count += 1;
  }
  return count;
}

function countEditableText(scope) {
  let count = 0;
  for (const match of scope.matchAll(EDITABLE_TEXT_PATTERN)) {
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (text) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 硬性不支持检测：前端框架、脚本生成内容、受限嵌入。
// ---------------------------------------------------------------------------

function detectFrameworks(html, scriptTagText) {
  const names = [];
  for (const { name, scriptPattern, documentPattern } of FRAMEWORK_SIGNATURES) {
    if (scriptPattern.test(scriptTagText) || documentPattern.test(html)) names.push(name);
  }
  return names;
}

function isScriptGeneratedContent(html) {
  if (!/<script\b/i.test(html)) return false;
  const withoutScripts = html.replace(SCRIPT_PATTERN, "").replace(STYLE_BLOCK_PATTERN, "");
  if (EMPTY_APP_ROOT_PATTERN.test(withoutScripts)) return true;
  // 图片和 SVG 也是内容：有可见视觉元素时，文字少不等于内容由脚本生成
  //（如纯图片翻页演示只带一小段翻页脚本）。
  if (/<img\b|<svg\b/i.test(withoutScripts)) return false;
  const textOnly = withoutScripts
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return textOnly.length < 20;
}

function detectRestrictedEmbeds(html, scriptTagText) {
  const reasons = [];
  if (/<canvas\b/i.test(html)) {
    reasons.push("页面包含 Canvas/WebGL 画布内容");
  } else if (/getContext\s*\(\s*["'](?:experimental-)?webgl/i.test(scriptTagText)) {
    reasons.push("页面使用 WebGL 绘制内容");
  }
  if (/<iframe\b/i.test(html)) {
    reasons.push("页面包含 iframe 嵌入");
  }
  return reasons;
}

// 畸形文件原因：未闭合的脚本标签与未闭合的注释（浏览器会把后续内容当作脚本或
// 注释处理，导入副本无法安全呈现）。HTML5 空注释写法先剔除再计数。
function detectMalformedHtml(content) {
  const withoutScripts = content.replace(SCRIPT_PATTERN, "");
  if (/<script\b/i.test(withoutScripts)) {
    return "存在未闭合的脚本标签，无法安全解析";
  }
  const withoutEmptyComments = withoutScripts.replace(EMPTY_COMMENT_PATTERN, "");
  const commentOpens = (withoutEmptyComments.match(/<!--/g) || []).length;
  const commentCloses = (withoutEmptyComments.match(/-->/g) || []).length;
  if (commentOpens !== commentCloses) {
    return "存在未闭合的注释，部分内容无法正常显示";
  }
  return "";
}

// ---------------------------------------------------------------------------
// 报告组装
// ---------------------------------------------------------------------------

function finish({
  fileName,
  size,
  rules,
  html,
  slideCount = 0,
  scriptCount = 0,
  animationCount = 0,
  lockedElements = [],
  editableContent = [],
}) {
  const failed = rules.some((rule) => rule.status === "fail");
  const verdict = failed
    ? VERDICT_UNSUPPORTED
    : lockedElements.length > 0
      ? VERDICT_PARTIAL
      : VERDICT_FULL;
  const report = {
    verdict,
    passed: !failed,
    checkedAt: new Date().toISOString(),
    file: { name: fileName, size, type: /\.html?$/i.test(fileName) ? "text/html" : "" },
    slideCount,
    scriptCount,
    animationCount,
    lockedElements,
    editableContent,
    rules,
  };
  return { verdict: report.verdict, passed: report.passed, report, html };
}

function pass(id, title, detail) {
  return { id, title, status: "pass", detail };
}

function fail(id, title, detail) {
  return { id, title, status: "fail", detail };
}

function warn(id, title, detail) {
  return { id, title, status: "warn", detail };
}

function formatBytes(size) {
  if (size >= 1024 * 1024) return trimTrailingZero((size / (1024 * 1024)).toFixed(1)) + " MB";
  if (size >= 1024) return trimTrailingZero((size / 1024).toFixed(1)) + " KB";
  return size + " B";
}

function trimTrailingZero(text) {
  return text.replace(/\.0$/, "");
}

export { VERDICT_FULL, VERDICT_PARTIAL, VERDICT_UNSUPPORTED };
