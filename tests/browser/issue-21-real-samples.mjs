// Issue #21 公开浏览器行为测试：真实样本端到端验收与收尾。
// 固定样本集（fixtures/import-samples/，出处与判定记录见其 README.md）逐份走完
// 上传 → 导入检查报告 → 编辑（排版三项、图片替换、复制/删除、文本框拖拽与原位留白）
// → 保存 → 重新打开 → 导出 HTML/PDF 的完整流程；暂不支持样本得到正确档位与
// 可读原因且不创建项目记录。样本覆盖三档判定与全部锁定类别。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
await mkdir(path.join(root, "output", "playwright"), { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "issue-21-"));
const samplesDir = path.join(root, "fixtures", "import-samples");
const port = 4341;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const server = spawn(
  process.execPath,
  ["src/server.mjs", "--fixture", "--no-open", "--port", String(port), "--data-dir", dataDir],
  {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));
server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));

let serverExit = null;
server.once("exit", (code, signal) => {
  serverExit = { code, signal };
});

const replacementPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let page;
try {
  await waitForServer();
  const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  const projectCountBadge = page.locator("#project-count");
  await projectCountBadge.waitFor();

  // ===========================================================================
  // 样本一：AI 演示工作流.html（本产品导出，部分可编辑：SVG 装饰 + 页眉 Logo）。
  // 全量能力清点：排版三项、拖拽与原位留白（含撤销/重做）、复制、删除、图片替换。
  // ===========================================================================
  await uploadSample("AI 演示工作流.html");
  await assertVerdictPill("部分可编辑");
  await page.getByText("检查完成 · 未修改原文件", { exact: true }).waitFor();
  await page.locator("#import-report-view").getByText("可编辑内容", { exact: true }).waitFor();
  assert.equal(await page.locator("#import-editable-count").textContent(), "2 类");
  await page.locator("#import-report-view").getByText("可编辑文字 5 处", { exact: true }).waitFor();
  await page.locator("#import-report-view").getByText("可编辑图片 1 张", { exact: true }).waitFor();
  await page.locator("#import-report-view").getByText("将被锁定的内容", { exact: true }).waitFor();
  assert.equal(await page.locator("#import-locked-count").textContent(), "2 类");
  await page.locator("#import-report-view").getByText("SVG 装饰图形 1 处", { exact: true }).waitFor();
  await page.locator("#import-report-view").getByText("页眉 Logo 1 处", { exact: true }).waitFor();
  // 部分可编辑档的项目状态行是锁定交互提示；项目创建经末尾的项目记录契约断言核对。
  await page
    .locator("#import-report-view")
    .getByText("锁定内容在编辑画布中点击时会提示「已锁定：这个元素不可编辑」", { exact: true })
    .waitFor();
  const productFileMeta = await page.locator("#import-report-file-meta").textContent();
  assert.match(productFileMeta, /3 页/, "文件摘要必须包含识别出的页数");
  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-21-report-product-export.png"), fullPage: true });

  // 查看原文件：打开的是原始上传字节（本产品导出的原文件）。
  const productPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "查看原文件", exact: true }).click();
  const productPopup = await productPopupPromise;
  await productPopup.waitForLoadState();
  assert.match(productPopup.url(), /^blob:/);
  assert.ok((await productPopup.content()).includes("AI 演示工作流"), "查看原文件必须展示原始上传内容");
  await productPopup.close();

  await page.getByRole("button", { name: "仍要进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 10_000 });
  const productPreviewFrame = previewFrame();
  await productPreviewFrame.getByRole("heading", { name: "AI 演示工作流", level: 1 }).waitFor({ timeout: 10_000 });
  assert.ok(
    (await productPreviewFrame.locator("svg.template-symbol").count()) === 1,
    "锁定 SVG 装饰必须在预览中原样保留",
  );

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const productEditor = editorFrame();
  const productHeading = productEditor.getByRole("heading", { name: "AI 演示工作流", level: 1 }).first();

  // 排版三项：字体、粗细、字间距即时生效。
  await productHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByLabel("字体", { exact: true }).selectOption({ label: "Inter（无衬线）" });
  assert.match(await productHeading.evaluate((element) => getComputedStyle(element).fontFamily), /Inter/i);
  await page.getByLabel("粗细", { exact: true }).selectOption({ label: "粗体 700" });
  assert.equal(await productHeading.evaluate((element) => getComputedStyle(element).fontWeight), "700");
  await page.getByLabel("字间距", { exact: true }).fill("2");
  assert.equal(await productHeading.evaluate((element) => getComputedStyle(element).letterSpacing), "2px");

  // 文本框整框拖拽：流式转自由定位 + 原位留白，一次撤销复原、一次重做再现。
  const productSlide = productEditor.locator(".slide").first();
  const productDrag = await dragToSlideCenter(page, productHeading, productSlide, 0.62, 0.55);
  assert.equal(await productHeading.evaluate((element) => getComputedStyle(element).position), "absolute");
  assert.equal(await productEditor.locator("[data-aps-placeholder]").count(), 1, "拖拽后原位置必须留下占位留白");
  assert.ok(
    Math.abs((await productEditor.locator("[data-aps-placeholder]").first().boundingBox()).x - productDrag.before.x) < 4,
    "占位留白必须停在原位置",
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await productHeading.evaluate((element) => getComputedStyle(element).position), "static", "撤销必须复原流式定位");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  const productHeadingAfterRedo = await productHeading.boundingBox();
  assert.ok(Math.abs(productHeadingAfterRedo.x - productDrag.after.x) < 3 && Math.abs(productHeadingAfterRedo.y - productDrag.after.y) < 3, "重做必须再现拖拽落点");

  // 复制与删除：副本内容一致、删除后回到一份。
  await productHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await productEditor.getByRole("heading", { name: "AI 演示工作流", level: 1 }).first().waitFor();
  assert.equal(await productEditor.getByRole("heading", { name: "AI 演示工作流", level: 1 }).count(), 2, "复制后必须出现副本");
  const productCopyCount = await productEditor.getByRole("heading", { name: "AI 演示工作流", level: 1 }).count();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  assert.equal(await productEditor.getByRole("heading", { name: "AI 演示工作流", level: 1 }).count(), productCopyCount - 1, "删除必须移除副本");

  // 图片替换：画布立即更新为内嵌数据。
  const productImage = productEditor.getByRole("img", { name: "森林和演示页面的抽象示意" });
  await productImage.click();
  await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
  const productImageSrcBefore = await productImage.evaluate((element) => element.getAttribute("src"));
  await page.locator("#image-file-input").setInputFiles({ name: "真实样本替换图.png", mimeType: "image/png", buffer: replacementPng });
  const productImageSrcAfter = await productImage.evaluate((element) => element.getAttribute("src"));
  assert.match(productImageSrcAfter, /^data:image\/png;base64,/, "替换图片必须读入为内嵌数据");
  assert.notEqual(productImageSrcAfter, productImageSrcBefore);

  await saveAndFinishEditing();
  await productPreviewFrame.getByRole("img", { name: "森林和演示页面的抽象示意" }).waitFor({ timeout: 10_000 });
  assert.equal(
    (await productPreviewFrame.locator("[data-aps-placeholder]").count()) === 1,
    true,
    "预览必须保留原位留白",
  );

  await reopenEditor("AI 演示工作流");
  const productReopened = editorFrame();
  const productReopenedHeading = productReopened.getByRole("heading", { name: "AI 演示工作流", level: 1 }).first();
  await productReopenedHeading.waitFor({ timeout: 20_000 });
  await productReopenedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.match(await page.getByLabel("字体", { exact: true }).inputValue(), /Inter/i, "重开后字体必须与保存一致");
  assert.equal(await page.getByLabel("粗细", { exact: true }).inputValue(), "700", "重开后粗细必须与保存一致");
  assert.equal(await page.getByLabel("字间距", { exact: true }).inputValue(), "2", "重开后字间距必须与保存一致");
  assert.equal(
    await productReopened.getByRole("img", { name: "森林和演示页面的抽象示意" }).evaluate((element) =>
      element.getAttribute("src"),
    ),
    productImageSrcAfter,
    "重开后替换图片必须保持",
  );
  assert.equal(await productReopened.locator("[data-aps-placeholder]").count(), 1, "重开后占位留白必须保持");

  const productExport = await exportHtml("AI 演示工作流", "issue-21-export-product.html");
  assert.doesNotMatch(productExport, /<script\b/i, "导出 HTML 不得包含脚本");
  assert.doesNotMatch(productExport, /file:\/\//i);
  assert.match(productExport, /data-product-static-paging/);
  assert.deepEqual(
    badgeTextsInExportedFile(productExport),
    ["1 / 3", "2 / 3", "3 / 3"],
    "导出 HTML 页码徽章必须逐页写定且数量等于页数",
  );
  assert.ok(productExport.includes(productImageSrcAfter.slice(0, 60)), "导出必须保留替换后的图片");
  assert.ok(productExport.includes("svg"), "导出必须保留锁定 SVG 装饰");
  const productPdf = await exportPdf("AI 演示工作流", "issue-21-export-product.pdf");
  await assertPdf(productPdf, { pages: 3, textPattern: /AI演示工作流/ });
  console.log("EVIDENCE: product-export sample (partial) full flow passed: report/edit/save/reopen/export HTML+PDF");

  // ===========================================================================
  // 样本二：studio.html（外部工具，完全可编辑，12 页）。
  // ===========================================================================
  await page.getByRole("button", { name: "返回首页" }).click();
  await uploadSample("studio.html");
  await assertVerdictPill("完全可编辑");
  await page.getByText("检查完成 · 未修改原文件", { exact: true }).waitFor();
  await page.getByText("通过「slide 类名规则」识别出 12 页幻灯片", { exact: true }).waitFor();
  await page.getByText("识别出 36 处可编辑文字、0 张可编辑图片", { exact: true }).waitFor();
  await page.getByText("已创建演示项目「studio」", { exact: true }).waitFor();
  await page.locator("#import-rules .import-rule").first().waitFor();
  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-21-report-full-studio.png"), fullPage: true });

  await page.getByRole("button", { name: "进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const studioEditor = editorFrame();
  const studioHeading = studioEditor.locator(".slide").first().locator("h1").first();
  await studioHeading.waitFor({ timeout: 30_000 });
  await studioHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByLabel("字体", { exact: true }).selectOption({ label: "Noto Sans SC（中文无衬线）" });
  assert.match(await studioHeading.evaluate((element) => getComputedStyle(element).fontFamily), /Noto Sans SC/i);
  await page.getByLabel("字间距", { exact: true }).fill("1.5");
  assert.equal(await studioHeading.evaluate((element) => getComputedStyle(element).letterSpacing), "1.5px");

  const studioSlide = studioEditor.locator(".slide").first();
  await dragToSlideCenter(page, studioHeading, studioSlide, 0.6, 0.5);
  assert.equal(await studioHeading.evaluate((element) => getComputedStyle(element).position), "absolute");
  assert.ok((await studioEditor.locator("[data-aps-placeholder]").count()) >= 1, "真实外部样本拖拽后必须出现原位留白");

  // 复制后先保存：副本必须跨保存重开保持，随后删除并再次保存。
  await studioHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  assert.equal(await studioEditor.locator(".slide").first().locator("h1").count(), 2, "复制后第一页必须有两个标题");

  await saveAndFinishEditing();
  await reopenEditor("studio");
  const studioReopened = editorFrame();
  const studioReopenedHeading = studioReopened.locator(".slide").first().locator("h1").first();
  await studioReopenedHeading.waitFor({ timeout: 30_000 });
  assert.equal(
    await studioReopened.locator(".slide").first().locator("h1").count(),
    2,
    "重开后文字副本必须保持",
  );
  await studioReopenedHeading.click({ force: true });
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.match(await page.getByLabel("字体", { exact: true }).inputValue(), /Noto Sans SC/i);
  assert.equal(await page.getByLabel("字间距", { exact: true }).inputValue(), "1.5");
  assert.equal(await studioReopenedHeading.evaluate((element) => getComputedStyle(element).position), "absolute", "重开后真实样本的拖拽定位必须保持");
  const studioReopenedPlaceholder = await studioReopened.locator("[data-aps-placeholder]").count();
  assert.ok(studioReopenedPlaceholder >= 1, "重开后原位留白必须保持");

  // 删除当前选中的标题（原件与副本内容一致，删任一份）：
  // 元素消失，且再次保存后导出不含副本。
  await page.getByRole("button", { name: "删除", exact: true }).click();
  assert.equal(await studioReopened.locator(".slide").first().locator("h1").count(), 1, "删除必须移除一份标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();

  const studioExport = await exportHtml("studio", "issue-21-export-studio.html");
  assert.doesNotMatch(studioExport, /<script\b/i);
  assert.doesNotMatch(studioExport, /<link\b[^>]*\bhref=["']https?:\/\//i, "导出必须剥离外部样式表");
  assert.deepEqual(badgeTextsInExportedFile(studioExport).length, 12, "studio 导出徽章数必须等于真实页数");
  const studioPdf = await exportPdf("studio", "issue-21-export-studio.pdf");
  await assertPdf(studioPdf, { pages: 12 });
  console.log("EVIDENCE: studio sample (full) full flow passed: 12 pages, badges == PDF pages == 12, copy/delete persisted across save+reopen");

  // ===========================================================================
  // 样本三：cobalt-grid.html（外部工具，部分可编辑：SVG ×5 + 背景渐变 ×1，
  // 叠放 + active 翻页结构）。跨页编辑后保存重开。
  // ===========================================================================
  await page.getByRole("button", { name: "返回首页" }).click();
  await uploadSample("cobalt-grid.html");
  await assertVerdictPill("部分可编辑");
  await page.locator("#import-report-view").getByText("将被锁定的内容", { exact: true }).waitFor();
  assert.equal(await page.locator("#import-locked-count").textContent(), "2 类");
  await page.locator("#import-report-view").getByText("SVG 装饰图形 5 处", { exact: true }).waitFor();
  await page.locator("#import-report-view").getByText("背景渐变 1 处", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-21-report-partial-cobalt.png"), fullPage: true });

  await page.getByRole("button", { name: "仍要进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const cobaltEditor = editorFrame();
  const cobaltHeading = cobaltEditor.locator(".slide").first().locator("h1").first();
  await cobaltHeading.waitFor({ timeout: 30_000 });
  await cobaltHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("Cobalt 封面改题");
  assert.equal(await cobaltHeading.textContent(), "Cobalt 封面改题");

  // 真实「叠放 + active」样本的画布翻页：下一页后第二页变为可见可编辑。
  await page.getByRole("button", { name: "下一页" }).click();
  const cobaltSecondText = cobaltEditor.locator(".slide").nth(1).locator("p").first();
  await cobaltSecondText.click({ timeout: 10_000 });
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("第二页改题");
  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-21-editor-cobalt-page2.png"), fullPage: true });

  await saveAndFinishEditing();
  await reopenEditor("cobalt-grid");
  const cobaltReopened = editorFrame();
  const cobaltReopenedFirst = cobaltReopened.locator(".slide").first().locator("h1").first();
  await cobaltReopenedFirst.waitFor({ timeout: 30_000 });
  assert.equal(await cobaltReopenedFirst.textContent(), "Cobalt 封面改题", "重开后第一页编辑必须保持");
  await page.getByRole("button", { name: "下一页" }).click();
  const cobaltReopenedSecond = cobaltReopened.locator(".slide").nth(1).locator("p").first();
  await cobaltReopenedSecond.click({ timeout: 10_000 });
  assert.ok(
    (await cobaltReopenedSecond.textContent()).includes("第二页改题"),
    "重开后第二页编辑必须保持",
  );

  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  const cobaltPreview = previewFrame();
  assert.ok((await cobaltPreview.locator("svg").count()) >= 5, "预览必须原样保留全部 SVG 装饰");
  const cobaltGradientKept = await cobaltPreview.locator(".stage").first().evaluate((stage) =>
    getComputedStyle(stage, "::before").backgroundImage.includes("gradient"),
  );
  assert.equal(cobaltGradientKept, true, "预览必须原样保留背景渐变（.stage::before 网格）");

  await exportHtml("cobalt-grid", "issue-21-export-cobalt.html");
  const cobaltExport = await readFile(path.join(root, "output", "playwright", "issue-21-export-cobalt.html"), "utf8");
  assert.doesNotMatch(cobaltExport, /<script\b/i);
  assert.deepEqual(badgeTextsInExportedFile(cobaltExport), ["1 / 8", "2 / 8", "3 / 8", "4 / 8", "5 / 8", "6 / 8", "7 / 8", "8 / 8"]);
  const cobaltExportSvgs = (cobaltExport.match(/<svg\b/gi) || []).length;
  assert.ok(cobaltExportSvgs >= 5, "导出必须保留全部 SVG 装饰");
  const cobaltPdf = await exportPdf("cobalt-grid", "issue-21-export-cobalt.pdf");
  await assertPdf(cobaltPdf, { pages: 8 });
  console.log("EVIDENCE: cobalt-grid sample (partial, stacked/active deck) full flow passed with cross-page edits");

  // ===========================================================================
  // 样本四：8-bit-orbit.html（外部工具，部分可编辑：脚本动效 + 背景渐变 + 背景图，
  // 真实样本驱动的页面识别修订覆盖样本）。
  // ===========================================================================
  await page.getByRole("button", { name: "返回首页" }).click();
  await uploadSample("8-bit-orbit.html");
  await assertVerdictPill("部分可编辑");
  await page.locator("#import-report-view").getByText("将被锁定的内容", { exact: true }).waitFor();
  assert.equal(await page.locator("#import-locked-count").textContent(), "3 类");
  await page.locator("#import-report-view").getByText("背景渐变 8 处", { exact: true }).waitFor();
  await page.locator("#import-report-view").getByText("背景图 1 处", { exact: true }).waitFor();
  await page.locator("#import-report-view").getByText("脚本动效 2 处", { exact: true }).waitFor();
  const orbitFileMeta = await page.locator("#import-report-file-meta").textContent();
  assert.match(orbitFileMeta, /10 页/, "文件摘要页数必须与真实页数一致（页内复合类名不计页）");

  await page.getByRole("button", { name: "仍要进入编辑", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const orbitEditor = editorFrame();
  const orbitHeading = orbitEditor.locator(".slide").first().locator("h1").first();
  await orbitHeading.waitFor({ timeout: 30_000 });
  await orbitHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  await page.getByLabel("粗细", { exact: true }).selectOption({ label: "粗体 700" });
  assert.equal(await orbitHeading.evaluate((element) => getComputedStyle(element).fontWeight), "700");
  await saveAndFinishEditing();
  await reopenEditor("8-bit-orbit");
  const orbitReopened = editorFrame();
  const orbitReopenedHeading = orbitReopened.locator(".slide").first().locator("h1").first();
  await orbitReopenedHeading.waitFor({ timeout: 30_000 });
  await orbitReopenedHeading.click();
  await page.getByText("已选中文字", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("粗细", { exact: true }).inputValue(), "700", "重开后粗细必须与保存一致");

  const orbitExport = await exportHtml("8-bit-orbit", "issue-21-export-8bit.html");
  assert.doesNotMatch(orbitExport, /<script\b/i, "脚本动效随脚本移除，导出不得包含脚本");
  assert.deepEqual(badgeTextsInExportedFile(orbitExport).length, 10, "页内复合类名不得获得页码徽章");
  const orbitPdf = await exportPdf("8-bit-orbit", "issue-21-export-8bit.pdf");
  await assertPdf(orbitPdf, { pages: 10 });
  console.log("EVIDENCE: 8-bit-orbit sample (partial, script motion + compounds) badges == PDF pages == 10");

  // ===========================================================================
  // 样本五：retro-windows.html（外部工具，暂不支持：Canvas ×3）。
  // ===========================================================================
  await page.getByRole("button", { name: "返回首页" }).click();
  await projectCountBadge.waitFor();
  const projectCountBeforeUnsupported = await projectCountBadge.textContent();
  await uploadSample("retro-windows.html");
  await assertVerdictPill("暂不支持");
  await page.getByText("检查完成 · 未创建项目", { exact: true }).waitFor();
  await page.getByText("页面包含 Canvas/WebGL 画布内容", { exact: true }).waitFor();
  await page.getByText("原文件未做任何修改，也没有创建演示项目。", { exact: true }).waitFor();
  assert.equal(await page.locator("#import-rules .import-rule").count(), 1, "暂不支持态只展示原因清单");
  assert.equal(
    await page.locator(".import-report-actions").getByRole("button", { name: "进入编辑", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.locator(".import-report-actions").getByRole("button", { name: "仍要进入编辑", exact: true }).count(),
    0,
  );
  assert.equal(await projectCountBadge.textContent(), projectCountBeforeUnsupported, "暂不支持样本不得创建项目记录");
  await page.screenshot({ path: path.join(root, "output", "playwright", "issue-21-report-unsupported-retro.png"), fullPage: true });
  await page.getByRole("button", { name: "重新上传", exact: true }).click();
  assert.equal(await page.locator("#import-dialog").evaluate((element) => element.open), true);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.locator("#import-report-view .back-button").click();
  await page.locator("#project-count").waitFor();

  // ===========================================================================
  // 项目记录契约与原始文件完整性：全部导入项目共用同一记录结构，原始上传
  // 文件副本与仓库中的固定样本逐字节一致。
  // ===========================================================================
  const projects = await fetch(baseUrl + "/api/projects").then((response) => response.json());
  const expectations = [
    { file: "AI 演示工作流.html", name: "AI 演示工作流", verdict: "部分可编辑" },
    { file: "studio.html", name: "studio", verdict: "完全可编辑" },
    { file: "cobalt-grid.html", name: "cobalt-grid", verdict: "部分可编辑" },
    { file: "8-bit-orbit.html", name: "8-bit-orbit", verdict: "部分可编辑" },
  ];
  for (const expectation of expectations) {
    const record = projects.find((project) => project.originalFileName === expectation.file);
    assert.ok(record, "项目列表必须包含 " + expectation.file + " 的导入项目");
    assert.equal(record.sourceType, "imported");
    assert.equal(record.verdict, expectation.verdict);
    assert.equal(record.name, expectation.name);
    const detail = await fetch(baseUrl + "/api/projects/" + record.id).then((response) => response.json());
    assert.equal(detail.templateId, null);
    assert.equal(detail.templateName, "导入");
    assert.equal(detail.source, "");
    const originalCopy = await readFile(path.join(dataDir, record.originalFile));
    const committedSample = await readFile(path.join(samplesDir, expectation.file));
    assert.ok(originalCopy.equals(committedSample), expectation.file + " 的原始文件副本必须逐字节一致");
  }
  assert.equal(projects.filter((project) => project.sourceType === "imported").length, 4, "只有四份通过档样本创建项目");
  console.log("EVIDENCE: 4 imported project records carry contract fields; original file copies byte-identical");
  console.log("PASS: Issue #21 real-sample end-to-end acceptance works through the public UI");
  await browser.close();
} catch (error) {
  try {
    if (page) {
      await page
        .screenshot({ path: path.join(root, "output", "playwright", "issue-21-failure.png"), fullPage: true })
        .catch(() => {});
    }
  } catch {}
  throw new Error(
    error.message +
      "\n\nServer output:\n" +
      serverOutput.join("") +
      "\nBrowser output:\n" +
      browserOutput.join("\n"),
  );
} finally {
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

// ---------------------------------------------------------------------------
// 助手：上传、报告断言、保存重开、导出、拖拽与 PDF 校验。
// ---------------------------------------------------------------------------

function editorFrame() {
  return page.frameLocator('iframe[title="演示文稿编辑画布"]');
}

function previewFrame() {
  return page.frameLocator('iframe[title="演示文稿预览"]');
}

async function uploadSample(fileName) {
  await page.getByRole("button", { name: /导入演示/ }).click();
  await page.locator("#import-dialog").waitFor();
  await page.locator("#import-file-input").setInputFiles(path.join(samplesDir, fileName));
  await page.getByText(fileName, { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始检查", exact: true }).click();
  await page.getByTestId("import-report").waitFor({ timeout: 15_000 });
}

async function assertVerdictPill(verdict) {
  const pill = page.getByTestId("import-verdict");
  assert.equal(await pill.textContent(), verdict);
}

async function saveAndFinishEditing() {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
}

async function reopenEditor(projectName) {
  await page.getByRole("button", { name: "返回首页" }).click();
  const card = page.getByRole("article", { name: projectName });
  await card.waitFor();
  await card.click();
  await page.getByTestId("preview").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
}

async function exportHtml(projectName, outputFile) {
  const exportResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/exports/html") && response.request().method() === "POST",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  assert.equal((await exportResponsePromise).status(), 200, "HTML 导出接口应成功返回");
  const download = await downloadPromise;
  await page.getByText("HTML 导出成功", { exact: true }).waitFor();
  assert.equal(download.suggestedFilename(), projectName + ".html", "导出文件名应为项目名");
  const exportedPath = path.join(root, "output", "playwright", outputFile);
  await download.saveAs(exportedPath);
  return readFile(exportedPath, "utf8");
}

async function exportPdf(projectName, outputFile) {
  const pdfResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/exports/pdf") && response.request().method() === "POST",
  );
  const pdfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  assert.equal((await pdfResponsePromise).status(), 200, "PDF 导出接口应成功返回");
  const pdfDownload = await pdfDownloadPromise;
  await page.getByText("PDF 导出成功", { exact: true }).waitFor();
  assert.equal(pdfDownload.suggestedFilename(), projectName + ".pdf", "导出文件名应为项目名");
  const pdfPath = path.join(root, "output", "playwright", outputFile);
  await pdfDownload.saveAs(pdfPath);
  return pdfPath;
}

// 提取导出文件中的页码徽章文本（只计真实 DOM 徽章 span，不含样式选择器）。
function badgeTextsInExportedFile(exportedHtml) {
  const badges = [];
  for (const match of exportedHtml.matchAll(/<span data-product-page-badge>([^<]*)<\/span>/gi)) {
    badges.push(match[1].trim());
  }
  return badges;
}

// 把元素拖拽到幻灯片内按比例指定的位置；返回拖拽前后包围盒供后续断言。
async function dragToSlideCenter(page, element, slide, ratioX, ratioY) {
  const before = await element.boundingBox();
  const slideBox = await slide.boundingBox();
  assert.ok(before && slideBox, "拖拽前必须能取得元素与幻灯片包围盒");
  const targetInSlide = {
    x: Math.round(slideBox.width * ratioX),
    y: Math.round(slideBox.height * ratioY),
  };
  await element.hover();
  await page.mouse.down();
  await slide.hover({ position: targetInSlide, force: true });
  await page.mouse.up();
  const after = await element.boundingBox();
  assert.ok(after, "拖拽后必须能取得元素包围盒");
  assert.ok(
    Math.abs(after.x + after.width / 2 - (slideBox.x + targetInSlide.x)) < 10 &&
      Math.abs(after.y + after.height / 2 - (slideBox.y + targetInSlide.y)) < 10,
    `拖拽后文本框必须到达新位置（实际 ${JSON.stringify(after)}）`,
  );
  return { before, after };
}

// 校验导出 PDF 的页数、页面尺寸与可选的首页文本。
async function assertPdf(pdfPath, { pages, textPattern }) {
  const pdfBytes = await readFile(pdfPath);
  const pdfLoadingTask = getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await pdfLoadingTask.promise;
  assert.equal(pdf.numPages, pages, `PDF 页数应为 ${pages}`);
  const [, , pageWidth, pageHeight] = (await pdf.getPage(1)).view;
  assert.ok(Math.abs(pageWidth - 960) < 0.5, `PDF 页宽应为 960pt，实际 ${pageWidth}`);
  assert.ok(Math.abs(pageHeight - 540) < 0.5, `PDF 页高应为 540pt，实际 ${pageHeight}`);
  if (textPattern) {
    const firstPageText = (await (await pdf.getPage(1)).getTextContent()).items
      .map((item) => item.str)
      .join("")
      .replaceAll(/\s/g, "");
    assert.match(firstPageText, textPattern, "PDF 首页文本必须包含编辑后的内容");
  }
  await pdfLoadingTask.destroy();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverExit) {
      throw new Error(
        `Server exited before it became ready (${JSON.stringify(serverExit)}).\n${serverOutput.join("")}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Server did not become ready.\n${serverOutput.join("")}`);
}
