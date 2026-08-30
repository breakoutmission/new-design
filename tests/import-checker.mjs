// 导入检查器模块缝测试（Spec #13 指定的两条测试缝之二）：
// 固定 HTML 样本进，档位、报告与处理后 HTML 出；只断言公开模块行为。
// 页面识别规则表见 src/import-checker.mjs 与 docs/import-checker-rules.md，
// 本文件中每条页面识别规则至少一个正例与一个反例固定样本。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IMPORT_MAX_BYTES,
  VERDICT_FULL,
  VERDICT_PARTIAL,
  VERDICT_UNSUPPORTED,
  runImportCheck,
  prepareImportedHtml,
} from "../src/import-checker.mjs";

function check(html, { fileName = "样本.html", fileSize } = {}) {
  const source = typeof html === "string" ? html : "";
  return runImportCheck({
    fileName,
    fileSize: fileSize ?? Buffer.byteLength(source, "utf8"),
    html: source,
  });
}

function doc(body, style = "") {
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="UTF-8">',
    "<title>样本</title>",
    (style ? "<style>" + style + "</style>" : ""),
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

function ruleOf(result, id) {
  return result.report.rules.find((rule) => rule.id === id);
}

function withoutCheckedAt(result) {
  const { report, ...rest } = result;
  const { checkedAt, ...reportRest } = report;
  return { ...rest, report: reportRest };
}

function test(name, run) {
  try {
    run();
  } catch (error) {
    throw new Error("用例「" + name + "」失败：\n" + error.message);
  }
  console.log("PASS: " + name);
}

// ---------------------------------------------------------------------------
// A. 文件级规则：类型、大小、完整性（含畸形文件的明确原因）
// ---------------------------------------------------------------------------

test("A1 非 .html 文件名判为暂不支持并给出类型原因", () => {
  const result = check("<p>文本</p>", { fileName: "说明文档.txt" });
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  assert.equal(result.passed, false);
  assert.equal(result.html, null);
  const rule = ruleOf(result, "file-type");
  assert.equal(rule.status, "fail");
  assert.match(rule.detail, /\.html/);
  assert.equal(result.report.file.type, "");
});

test("A2 超过大小上限判为暂不支持且原因含上限值", () => {
  const result = check(doc('<section class="slide"><h1>超大</h1></section>'), {
    fileSize: IMPORT_MAX_BYTES + 1,
  });
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  const rule = ruleOf(result, "file-size");
  assert.equal(rule.status, "fail");
  assert.match(rule.detail, /10 MB/);
  assert.ok(!result.report.rules.some((item) => item.id === "file-integrity"), "超上限必须短路，不继续评估内容规则");
});

test("A3 缺少闭合 html 标签的畸形文件给出完整性原因", () => {
  const result = check('<!doctype html><html><head><title>残缺</title><body><section class="slide">内容');
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  const rule = ruleOf(result, "file-integrity");
  assert.equal(rule.status, "fail");
  assert.ok(rule.detail.length > 0);
});

test("A4 未闭合的脚本标签判为畸形并给出明确原因", () => {
  const result = check(doc('<section class="slide"><h1>页面</h1></section><script>console.log("未闭合")'));
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  const rule = ruleOf(result, "file-integrity");
  assert.equal(rule.status, "fail");
  assert.match(rule.detail, /脚本/);
});

test("A5 未闭合的注释判为畸形并给出明确原因", () => {
  const result = check(doc('<section class="slide"><h1>页面</h1></section><!-- 少了闭合'));
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  const rule = ruleOf(result, "file-integrity");
  assert.equal(rule.status, "fail");
  assert.match(rule.detail, /注释/);
});

test("A6 HTML5 空注释写法不算未闭合注释", () => {
  const result = check(doc('<section class="slide"><h1>空注释样本标题</h1><p>足够长的正文内容。</p></section><!-->'));
  assert.equal(ruleOf(result, "file-integrity").status, "pass");
});

// ---------------------------------------------------------------------------
// B. 页面识别规则表：优先级执行，每条规则一正一反固定样本
// ---------------------------------------------------------------------------

test("B1 正例：slide 类名词元识别出多页", () => {
  const result = check(
    doc(
      '<section class="slide"><h1>一</h1></section>' +
        '<section class="slide"><h1>二</h1></section>' +
        '<section class="slide"><h1>三</h1></section>',
    ),
  );
  assert.equal(result.report.slideCount, 3);
  const rule = ruleOf(result, "page-structure");
  assert.equal(rule.status, "pass");
  assert.match(rule.detail, /3 页/);
  assert.match(result.html, /<section class="slide"/);
});

test("B1 反例：slideshow 等非词元类名不触发 slide 规则", () => {
  const result = check(doc('<div class="slideshow"><h1>只是一段内容</h1></div>'));
  assert.equal(result.report.slideCount, 0);
  assert.equal(ruleOf(result, "page-structure").status, "fail");
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
});

test("B2 正例：page 类名词元识别出多页并补 slide 语义类", () => {
  const result = check(
    doc('<section class="page"><h1>一</h1></section><section class="page"><h1>二</h1></section>'),
  );
  assert.equal(result.report.slideCount, 2);
  assert.match(result.html, /class="page slide"/);
});

test("B2 反例：homepage 等内嵌 page 字样不算词元", () => {
  const result = check(doc('<div class="homepage-link"><h1>链接页</h1></div>'));
  assert.equal(result.report.slideCount, 0);
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
});

test("B3 正例：data-slide / data-page 属性识别出多页", () => {
  const result = check(
    doc('<section data-slide="1"><h1>一</h1></section><section data-page="2"><h1>二</h1></section>'),
  );
  assert.equal(result.report.slideCount, 2);
  assert.match(result.html, /<section data-slide="1" class="slide">/);
  assert.match(result.html, /<section data-page="2" class="slide">/);
});

test("B3 反例：data-slider 等无关属性不识别为页面", () => {
  const result = check(doc('<div data-slider-id="a"><h1>轮播</h1></div>'));
  assert.equal(result.report.slideCount, 0);
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
});

test("B4 正例：两个以上并列 section 区块识别为页面", () => {
  const result = check(
    doc("<section><h1>一</h1></section><section><h1>二</h1></section><section><h1>三</h1></section>"),
  );
  assert.equal(result.report.slideCount, 3);
  assert.match(result.html, /<section class="slide"><h1>一/);
});

test("B4 反例：并列 article 区块不识别为页面", () => {
  const result = check(doc("<article><h1>一</h1></article><article><h1>二</h1></article>"));
  assert.equal(result.report.slideCount, 0);
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
});

test("B5 正例：唯一全屏 section 区块回退识别为单页", () => {
  const result = check(
    doc('<section style="min-height:100vh"><h1>单页</h1><p>唯一全屏区块。</p></section>', "body{margin:0}"),
  );
  assert.equal(result.report.slideCount, 1);
  assert.match(ruleOf(result, "page-structure").detail, /1 页/);
});

test("B5 反例：单个普通区块且无全屏尺寸不识别为页面", () => {
  const result = check(
    doc("<article><h1>一份没有页面结构的文档</h1><p>只有单个内容块。</p></article>"),
  );
  assert.equal(result.report.slideCount, 0);
  assert.match(ruleOf(result, "page-structure").detail, /无法识别演示页面/);
});

test("B6 规则按优先级执行：page 类名优先于 data-slide 属性", () => {
  const result = check(
    doc(
      '<section class="page"><h1>一</h1></section>' +
        '<section class="page"><h1>二</h1></section>' +
        '<div data-slide="3"><h1>三</h1></div>',
    ),
  );
  assert.equal(result.report.slideCount, 2, "更高优先级规则命中后不再叠加低优先级结果");
});

test("B6 优先级：slide 类名优先于 page 类名，同一元素只计一次", () => {
  const result = check(doc('<section class="slide page"><h1>一</h1></section>'));
  assert.equal(result.report.slideCount, 1);
});

// #21 真实样本修订：页内复合类名（slide-1 / slide_01 这类「slide + 纯数字」是
// 页面标记；slide-content / slide-chrome / slide-counter / chart-slide-layout
// 这类复合名词是页内部件）不得识别为页面。反例来自真实外部样本
// 8-bit-orbit.html（slide-content ×10、slide-counter ×1、chart-slide-layout ×2）
// 与 studio.html（slide-chrome / slide-body / slide-foot 各 ×5）。
test("B7 正例：slide + 纯数字复合类名识别为页面", () => {
  const result = check(
    doc(
      '<section class="slide-1"><h1>一</h1></section>' +
        '<section class="slide_02"><h1>二</h1></section>' +
        '<section class="slide-3 intro"><h1>三</h1></section>',
    ),
  );
  assert.equal(result.report.slideCount, 3);
});

test("B8 反例：slide-content 等页内复合类名不识别为页面", () => {
  const result = check(
    doc(
      '<div class="slide-counter">01 / 02</div>' +
        '<section><div class="slide-content"><h1>页内内容块</h1></div></section>' +
        '<div class="chart-slide-layout"><h1>图表布局</h1></div>',
    ),
  );
  assert.equal(result.report.slideCount, 0, "页内复合类名不是页面标记");
  assert.equal(ruleOf(result, "page-structure").status, "fail");
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
});

test("B9 真实样本形态：真实页与页内复合类名混合时只计真实页", () => {
  const realPages =
    '<section class="slide bg-grid scanlines"><h1>一</h1></section>' +
    '<section class="slide bg-grid-cyan"><h1>二</h1></section>';
  const innerCompounds =
    '<div class="slide-counter">01 / 02</div>' +
    Array.from({ length: 10 }, (_, index) => '<div class="slide-content"><p>内容 ' + index + "</p></div>").join("");
  const result = check(doc(realPages + innerCompounds));
  assert.equal(result.report.slideCount, 2, "只有真实页面计入页数");
  assert.match(result.html, /class="slide bg-grid scanlines"/, "真实页类名保持不变");
  assert.ok(!/class="slide-content slide"/.test(result.html), "页内复合类名不得被补上 slide 语义类");
});

// ---------------------------------------------------------------------------
// C. 三档判定映射与硬性不支持原因
// ---------------------------------------------------------------------------

const fullDeckHtml = doc(
  '<section class="slide"><h1>标题一</h1><p>第一页正文。</p></section>' +
    '<section class="slide"><h1>标题二</h1><p>第二页正文。</p></section>',
);

test("C1 静态多页无锁定内容判为完全可编辑", () => {
  const result = check(fullDeckHtml);
  assert.equal(result.verdict, VERDICT_FULL);
  assert.equal(result.passed, true);
  assert.ok(result.html && result.html.length > 0);
  assert.equal(result.report.lockedElements.length, 0);
});

const partialDeckHtml = doc(
  '<header><img class="logo" src="data:image/png;base64,AAAA" alt="logo"></header>' +
    '<section class="slide"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg><h1>标题</h1></section>' +
    '<section class="slide" style="background:linear-gradient(#fff,#eee)"><p>第二页。</p></section>',
  ".slide{background-image:url(https://example.com/bg.png)}",
);

test("C2 存在 SVG、背景与 Logo 锁定内容判为部分可编辑并列出清单", () => {
  const result = check(partialDeckHtml);
  assert.equal(result.verdict, VERDICT_PARTIAL);
  assert.equal(result.passed, true);
  const locked = result.report.lockedElements;
  const byCategory = Object.fromEntries(locked.map((item) => [item.category, item]));
  assert.equal(byCategory["SVG 装饰图形"].count, 1);
  assert.equal(byCategory["背景图"].count, 1);
  assert.equal(byCategory["背景渐变"].count, 1);
  assert.equal(byCategory["页眉 Logo"].count, 1);
  for (const item of locked) {
    assert.ok(item.reason.length > 0, "每个锁定类别必须有原因");
  }
  const lockRule = ruleOf(result, "locked-content");
  assert.equal(lockRule.status, "warn");
  assert.match(lockRule.title, /锁定元素清单/);
  assert.match(lockRule.detail, /SVG 装饰图形 1 处/);
  assert.match(lockRule.detail, /背景图 1 处/);
  assert.match(lockRule.detail, /背景渐变 1 处/);
  assert.match(lockRule.detail, /页眉 Logo 1 处/);
  assert.match(result.html, /<svg/, "锁定元素必须保持原样显示，不得移除");
});

test("C3 React 框架与脚本生成内容并列给出两个原因后判为暂不支持", () => {
  const result = check(
    doc(
      '<div id="root"></div>',
      "",
    ).replace("</body>", '<script src="https://cdn.example.com/react.production.min.js"></script><script>ReactDOM.createRoot(document.getElementById("root"));</script></body>'),
  );
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  assert.equal(result.passed, false);
  const frameworkRule = ruleOf(result, "framework-detection");
  assert.equal(frameworkRule.status, "fail");
  assert.match(frameworkRule.title, /React/);
  const dynamicRule = ruleOf(result, "dynamic-content");
  assert.equal(dynamicRule.status, "fail");
  assert.match(dynamicRule.title, /脚本动态生成/);
  assert.ok(!ruleOf(result, "page-structure"), "硬性不支持原因短路后不得进入页面识别");
});

test("C4 无框架但静态文字近乎为空且带脚本判为脚本生成内容", () => {
  const result = check(
    doc('<div class="slide"><p>·</p></div>').replace(
      "</body>",
      "<script>document.body.innerHTML = '<p>' + data + '</p>';</script></body>",
    ),
  );
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  assert.equal(ruleOf(result, "dynamic-content").status, "fail");
});

test("C5 Canvas 画布判为暂不支持并说明原因", () => {
  const result = check(doc('<section class="slide"><canvas width="800" height="600"></canvas></section>'));
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  const rule = ruleOf(result, "restricted-embeds");
  assert.equal(rule.status, "fail");
  assert.match(rule.detail, /Canvas/);
});

test("C6 iframe 嵌入判为暂不支持并说明原因", () => {
  const result = check(doc('<section class="slide"><iframe src="https://example.com"></iframe></section>'));
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  assert.match(ruleOf(result, "restricted-embeds").detail, /iframe/);
});

test("C7 无法识别页面判为暂不支持", () => {
  const result = check(doc("<article><h1>文档</h1><p>不是演示文稿。</p></article>"));
  assert.equal(result.verdict, VERDICT_UNSUPPORTED);
  assert.equal(ruleOf(result, "page-structure").status, "fail");
});

test("C8 纯图片演示带翻页脚本不判为脚本生成内容", () => {
  const result = check(
    doc(
      '<section class="slide"><h1>图集演示</h1><img src="data:image/png;base64,AAAA" alt="海报一"></section>' +
        '<section class="slide"><img src="data:image/png;base64,BBBB" alt="海报二"></section>',
    ).replace("</body>", "<script>setInterval(nextPage, 5000);</script></body>"),
  );
  assert.ok(!ruleOf(result, "dynamic-content"), "图片也是内容，不得仅凭文字少判定脚本生成");
  assert.ok(
    !result.report.lockedElements.some((item) => item.category === "脚本动效"),
    "翻页计时脚本由产品页面导航接管，不算脚本动效",
  );
  assert.equal(result.verdict, VERDICT_FULL);
});

test("C9 正文提及框架与动效字样不触发不支持判定", () => {
  const result = check(
    doc(
      '<section class="slide"><h1>React 迁移说明</h1>' +
        "<p>本文讨论 createRoot( 与 animation: fade 的写法，正文足够长，不触发任何启发式判定。</p></section>",
    ),
  );
  assert.ok(!ruleOf(result, "framework-detection"), "正文提及框架特征不得触发框架判定");
  assert.equal(result.verdict, VERDICT_FULL);
  assert.match(result.html, /animation: fade/, "正文文本不得被动画转静态改写");
});

// ---------------------------------------------------------------------------
// D. 可重复性：同一样本重复检查结果一致
// ---------------------------------------------------------------------------

test("D1 同一样本两次检查除时间戳外完全一致", () => {
  for (const sample of [fullDeckHtml, partialDeckHtml, fullDeckHtml.replace('class="slide"', 'class="slide" data-slide="9"')]) {
    const first = check(sample);
    const second = check(sample);
    assert.deepEqual(withoutCheckedAt(first), withoutCheckedAt(second));
  }
});

// ---------------------------------------------------------------------------
// E. 脚本移除与副本安全化
// ---------------------------------------------------------------------------

test("E1 内联与外部脚本全部移除并计数", () => {
  const result = check(
    doc(
      '<section class="slide"><h1>产品发布计划总览</h1><p>这里是需要保持的较长正文内容，避免被判定为脚本生成页面。</p></section>',
    ).replace(
      "</body>",
      '<script>window.__a = 1;</script><script src="https://cdn.example.com/x.js"></script></body>',
    ),
  );
  assert.equal(result.report.scriptCount, 2);
  const rule = ruleOf(result, "script-removal");
  assert.equal(rule.status, "pass");
  assert.equal(rule.title, "已移除 2 段脚本");
  assert.ok(!/<script/i.test(result.html), "处理后副本不得残留任何脚本标签");
});

test("E2 内联事件属性移除", () => {
  const result = check(
    doc('<section class="slide"><p onclick="hack()">这里是一段足够长的可编辑正文文字内容示例，用于验证事件属性移除。</p></section>'),
  );
  assert.ok(!/onclick/i.test(result.html));
  assert.match(result.html, /<p>这里是一段足够长的可编辑正文文字内容示例，用于验证事件属性移除。<\/p>/);
});

test("E3 无脚本时报告未发现脚本", () => {
  const result = check(fullDeckHtml);
  assert.equal(result.report.scriptCount, 0);
  assert.equal(ruleOf(result, "script-removal").title, "未发现脚本");
});

test("E4 处理后副本注入导入专用 CSP 且禁用脚本", () => {
  const result = check(fullDeckHtml);
  assert.match(result.html, /Content-Security-Policy/);
  assert.match(result.html, /script-src 'none'/);
});

test("E5 上传文件自带的 CSP 声明被产品 CSP 覆盖", () => {
  const result = check(
    fullDeckHtml.replace("<head>", '<head><meta http-equiv="Content-Security-Policy" content="script-src \'self\' https://evil.example">'),
  );
  assert.ok(!/evil\.example/.test(result.html));
});

// ---------------------------------------------------------------------------
// F. CSS 动画与过渡转静态
// ---------------------------------------------------------------------------

const animatedDeckHtml = doc(
  '<section class="slide"><h1>标题</h1><p style="transition:opacity .2s">正文</p></section>',
  "@keyframes fade{from{opacity:0}to{opacity:1}}h1{animation:fade 1s ease both}",
);

test("F1 动画与过渡转静态并按处数计入报告", () => {
  const result = check(animatedDeckHtml);
  assert.equal(result.report.animationCount, 3, "1 个 keyframes + 1 条 animation + 1 条 transition");
  const rule = ruleOf(result, "animation-static");
  assert.equal(rule.status, "pass");
  assert.match(rule.title, /3 处/);
  assert.match(rule.detail, /最终画面/);
  assert.ok(!/@keyframes/.test(result.html));
  assert.match(result.html, /animation\s*:\s*none/i);
  assert.match(result.html, /transition\s*:\s*none/i);
  assert.equal(result.verdict, VERDICT_FULL, "纯 CSS 动效转静态不影响档位");
});

test("F2 已经是 none 的动画声明不计处数", () => {
  const result = check(doc('<section class="slide"><h1>标题</h1></section>', "h1{animation:none;transition:none}"));
  assert.equal(result.report.animationCount, 0);
  assert.match(ruleOf(result, "animation-static").title, /未发现/);
});

test("F3 脚本驱动的动效计入锁定清单并判为部分可编辑", () => {
  const result = check(
    doc(
      '<section class="slide"><h1>脚本动画演示标题</h1><p>足够长的正文内容，确保不会误判为脚本生成页面。</p></section>',
    ).replace(
      "</body>",
      "<script>requestAnimationFrame(function loop(t){ move(t); requestAnimationFrame(loop); });</script></body>",
    ),
  );
  const motion = result.report.lockedElements.find((item) => item.category === "脚本动效");
  assert.ok(motion, "脚本驱动动效必须进入锁定清单");
  assert.ok(motion.count >= 1);
  assert.match(motion.reason, /脚本/);
  assert.equal(result.verdict, VERDICT_PARTIAL);
});

// ---------------------------------------------------------------------------
// G. 可编辑内容清单
// ---------------------------------------------------------------------------

test("G1 完全可编辑报告给出可编辑文字与图片计数", () => {
  const result = check(
    doc(
      '<section class="slide"><h1>标题</h1><p>正文一。</p></section>' +
        '<section class="slide"><ul><li>要点</li></ul><img src="data:image/png;base64,AAAA" alt="图表"><img src="data:image/png;base64,BBBB" alt="照片"></section>',
    ),
  );
  assert.equal(result.verdict, VERDICT_FULL);
  const editable = result.report.editableContent;
  const byCategory = Object.fromEntries(editable.map((item) => [item.category, item]));
  assert.equal(byCategory["可编辑文字"].count, 3, "h1 + p + li");
  assert.equal(byCategory["可编辑图片"].count, 2);
  const inventoryRule = ruleOf(result, "content-inventory");
  assert.equal(inventoryRule.status, "pass");
  assert.match(inventoryRule.detail, /3 处/);
  assert.match(inventoryRule.detail, /2 张/);
});

test("G2 页眉导航页脚中的文字不计入可编辑文字", () => {
  const result = check(
    doc(
      '<nav><button>上一页</button><button>下一页</button></nav>' +
        '<section class="slide"><h1>标题</h1></section>',
    ),
  );
  const byCategory = Object.fromEntries(result.report.editableContent.map((item) => [item.category, item]));
  assert.equal(byCategory["可编辑文字"].count, 1);
});

// ---------------------------------------------------------------------------
// H. 契约结构不变量（#14 冻结字段的向后兼容校验）
// ---------------------------------------------------------------------------

test("H1 报告字段结构与冻结契约一致", () => {
  const result = check(fullDeckHtml);
  const report = result.report;
  for (const key of ["verdict", "passed", "checkedAt", "file", "slideCount", "scriptCount", "rules"]) {
    assert.ok(key in report, "报告缺少冻结字段 " + key);
  }
  assert.equal(report.file.name, "样本.html");
  assert.equal(report.file.type, "text/html");
  assert.ok(typeof report.slideCount === "number");
  assert.ok(typeof report.scriptCount === "number");
  for (const rule of report.rules) {
    assert.deepEqual(
      Object.keys(rule).sort(),
      ["detail", "id", "status", "title"],
      "规则对象字段名不得改变",
    );
    assert.ok(["pass", "fail", "warn"].includes(rule.status), "status 只能是 pass/fail/warn");
  }
});

test("H2 冻结五条规则保持既有相对顺序且 script-removal 最后", () => {
  const result = check(fullDeckHtml);
  const ids = result.report.rules.map((rule) => rule.id);
  const frozenOrder = ["file-type", "file-size", "file-integrity", "page-structure", "script-removal"];
  let cursor = -1;
  for (const id of frozenOrder) {
    const index = ids.indexOf(id, cursor + 1);
    assert.ok(index > cursor, "冻结规则 " + id + " 必须按既有顺序出现");
    cursor = index;
  }
  assert.equal(ids[ids.length - 1], "script-removal");
});

test("H3 判定失败时不返回处理后 HTML", () => {
  const result = check(doc("<article><p>无页面。</p></article>"));
  assert.equal(result.html, null);
});

test("H4 prepareImportedHtml 可独立复用且幂等", () => {
  const once = prepareImportedHtml(fullDeckHtml);
  const twice = prepareImportedHtml(once.html);
  assert.equal(twice.html, once.html, "重复安全化结果必须一致");
  assert.ok(once.scriptCount === 0 && once.slideCount === 2);
});

// ---------------------------------------------------------------------------
// I. 能力描述文案（#16 联动：用户可读 note 与编辑器实际能力保持一致）
// ---------------------------------------------------------------------------

test("I1 editableContent 的能力说明与编辑面板当前能力一致", () => {
  const result = check(
    doc(
      '<section class="slide"><h1>盘点样本标题</h1>' +
        '<img alt="配图" src="data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E"></section>',
    ),
  );
  const byCategory = Object.fromEntries(result.report.editableContent.map((item) => [item.category, item]));
  assert.equal(
    byCategory["可编辑文字"].note,
    "可修改内容、字体、字号、颜色、粗细、行距、字间距和对齐方式",
  );
  assert.equal(byCategory["可编辑图片"].note, "可拖动位置、四角等比例缩放和替换图片内容");
});

// ---------------------------------------------------------------------------
// J. 真实样本集回放（#21 收尾）：fixtures/import-samples/ 的固定样本逐一
// 过检查器，锁定真实外部 AI 生成样本与本产品导出样本的判定档位与关键报告
// 数据。样本出处、许可与判定记录见 fixtures/import-samples/README.md；
// 对外兼容性声明以该样本集通过为准（Spec #13）。
// ---------------------------------------------------------------------------

const realSamplesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "import-samples");

function checkRealSample(fileName) {
  const source = readFileSync(path.join(realSamplesDir, fileName), "utf8");
  return runImportCheck({
    fileName,
    fileSize: Buffer.byteLength(source, "utf8"),
    html: source,
  });
}

function lockCategoriesOf(result) {
  return result.report.lockedElements.map((item) => [item.category, item.count]);
}

const realSampleExpectations = [
  {
    fileName: "AI 演示工作流.html",
    verdict: VERDICT_PARTIAL,
    slideCount: 3,
    scriptCount: 1,
    animationCount: 6,
    locked: [
      ["SVG 装饰图形", 1],
      ["页眉 Logo", 1],
    ],
    editableText: 5,
    editableImages: 1,
  },
  {
    fileName: "studio.html",
    verdict: VERDICT_FULL,
    slideCount: 12,
    animationCount: 22,
    locked: [],
    editableText: 36,
    editableImages: 0,
  },
  {
    fileName: "cobalt-grid.html",
    verdict: VERDICT_PARTIAL,
    slideCount: 8,
    locked: [
      ["SVG 装饰图形", 5],
      ["背景渐变", 1],
    ],
    editableText: 18,
    editableImages: 0,
  },
  {
    fileName: "8-bit-orbit.html",
    verdict: VERDICT_PARTIAL,
    slideCount: 10,
    locked: [
      ["背景渐变", 8],
      ["背景图", 1],
      ["脚本动效", 2],
    ],
    editableText: 46,
    editableImages: 0,
  },
  {
    fileName: "retro-windows.html",
    verdict: VERDICT_UNSUPPORTED,
    failRule: "restricted-embeds",
    failDetailPattern: /Canvas/,
  },
];

for (const expectation of realSampleExpectations) {
  test("J 真实样本回放：" + expectation.fileName + " 判定为「" + expectation.verdict + "」", async () => {
    const result = checkRealSample(expectation.fileName);
    assert.equal(result.verdict, expectation.verdict);
    assert.equal(result.passed, expectation.verdict !== VERDICT_UNSUPPORTED);
    if (expectation.verdict === VERDICT_UNSUPPORTED) {
      assert.equal(result.html, null, "暂不支持样本不得返回处理后 HTML");
      const failRule = result.report.rules.find((rule) => rule.id === expectation.failRule);
      assert.equal(failRule.status, "fail");
      assert.match(failRule.detail, expectation.failDetailPattern);
      return;
    }
    assert.ok(result.html && result.html.length > 0, "通过档位必须返回处理后 HTML");
    if (expectation.slideCount !== undefined) assert.equal(result.report.slideCount, expectation.slideCount);
    if (expectation.scriptCount !== undefined) assert.equal(result.report.scriptCount, expectation.scriptCount);
    if (expectation.animationCount !== undefined) assert.equal(result.report.animationCount, expectation.animationCount);
    assert.deepEqual(lockCategoriesOf(result), expectation.locked, "锁定类别与数量必须与样本判定记录一致");
    const editable = Object.fromEntries(result.report.editableContent.map((item) => [item.category, item.count]));
    assert.equal(editable["可编辑文字"], expectation.editableText);
    assert.equal(editable["可编辑图片"], expectation.editableImages);
    assert.ok(!/<script\b/i.test(result.html), "处理后副本不得残留脚本");
  });
}

