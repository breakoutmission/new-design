// 导入检查器：受限 HTML 导入的纯函数缝。
// HTML 字符串进，判定档位、逐条规则报告和处理后的 HTML 出（ADR-0013、Spec #13）。
// 本文件由 Issue #14 建立最小规则集；Issue #15 补全规则与三档判定流水线。

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

const VERDICT_FULL = "完全可编辑";
const VERDICT_PARTIAL = "部分可编辑";
const VERDICT_UNSUPPORTED = "暂不支持";

// 页面识别启发式（第一版最小集）：class 名含 slide/page 语义词的容器视为演示页面。
const PAGE_CLASS_TOKEN = /(?:^|[-_\s])(?:slide|page)(?:[-_\s]|$)/i;
const SCRIPT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STRAY_SCRIPT_PATTERN = /<script\b[^>]*>/gi;
const INLINE_EVENT_PATTERN = /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const CLASS_ATTRIBUTE_PATTERN = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

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
  const complete = /<!doctype html>/i.test(content) && /<html[\s>]/i.test(content) && /<\/html>/i.test(content);
  if (!complete) {
    rules.push(fail("file-integrity", "文件完整性", "不是完整的 HTML 文件"));
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }
  rules.push(pass("file-integrity", "文件完整性", "完整的自包含 HTML 页面"));

  const processed = prepareImportedHtml(content);
  if (processed.slideCount < 1) {
    rules.push(fail("page-structure", "页面结构识别", "无法识别演示页面"));
    return finish({ fileName: normalizedFileName, size, rules, html: null });
  }
  rules.push(pass("page-structure", "页面结构识别", "识别出 " + processed.slideCount + " 页幻灯片"));
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
  });
}

// 导入副本安全化：移除全部脚本与内联事件属性，页面容器统一补 slide 语义 class，
// 注入导入专用 CSP。生成项目的安全预览准备（preparePreviewHtml）不适用于导入副本：
// 导入文件没有模板约定的页码与可编辑图片标记，也不得被注入产品脚本。
export function prepareImportedHtml(html) {
  let result = String(html || "");
  const scriptMatches = result.match(SCRIPT_PATTERN) || [];
  const scriptCount = scriptMatches.length + (result.replace(SCRIPT_PATTERN, "").match(STRAY_SCRIPT_PATTERN) || []).length;
  result = result
    .replace(SCRIPT_PATTERN, "")
    .replace(STRAY_SCRIPT_PATTERN, "")
    .replace(INLINE_EVENT_PATTERN, "");

  let slideCount = 0;
  result = result.replace(CLASS_ATTRIBUTE_PATTERN, (match, doubleQuoted, singleQuoted) => {
    const value = doubleQuoted ?? singleQuoted ?? "";
    if (!PAGE_CLASS_TOKEN.test(value)) return match;
    slideCount += 1;
    const hasSlide = /(?:^|[-_\s])slide(?:[-_\s]|$)/i.test(value);
    return 'class="' + (hasSlide ? value : value + " slide") + '"';
  });

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

  return { html: result, scriptCount, slideCount };
}

function finish({ fileName, size, rules, html, slideCount = 0, scriptCount = 0 }) {
  const failed = rules.some((rule) => rule.status === "fail");
  const report = {
    verdict: failed ? VERDICT_UNSUPPORTED : VERDICT_FULL,
    passed: !failed,
    checkedAt: new Date().toISOString(),
    file: { name: fileName, size, type: /\.html?$/i.test(fileName) ? "text/html" : "" },
    slideCount,
    scriptCount,
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

function formatBytes(size) {
  if (size >= 1024 * 1024) return trimTrailingZero((size / (1024 * 1024)).toFixed(1)) + " MB";
  if (size >= 1024) return trimTrailingZero((size / 1024).toFixed(1)) + " KB";
  return size + " B";
}

function trimTrailingZero(text) {
  return text.replace(/\.0$/, "");
}

export { VERDICT_FULL, VERDICT_PARTIAL, VERDICT_UNSUPPORTED };
