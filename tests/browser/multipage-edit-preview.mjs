import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "multipage-edit-preview-"));
const artifactDir = path.join(root, "output", "playwright");
await mkdir(artifactDir, { recursive: true });
const fixtureFile = path.join(root, "fixtures", "grove-multipage-dynamic.html");
const port = 4322;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];
const server = spawn(
  process.execPath,
  ["src/server.mjs", "--fixture", "--fixture-file", fixtureFile, "--no-open", "--port", String(port), "--data-dir", dataDir],
  { cwd: root, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));
server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString("utf8")));
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page.setDefaultTimeout(2_000);
  page.on("console", (message) => browserOutput.push(`console ${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => browserOutput.push(`pageerror: ${error.message}`));

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill("多页编辑回归\n验证后续页面与完成编辑预览。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });

  const preview = page.frameLocator('iframe[title="演示文稿预览"]');
  const previewCounter = preview.locator("[data-slide-counter]");
  await previewCounter.waitFor();
  assert.equal(await previewCounter.textContent(), "1 / 5");
  assert.equal(await preview.getByRole("heading", { level: 1 }).isVisible(), true);
  assert.equal(await preview.getByRole("button", { name: "第 2 页", exact: true }).isVisible(), true);
  assert.equal(await preview.getByRole("button", { name: "第 5 页", exact: true }).isVisible(), true);
  await assertSlidePainted(preview.locator(".slide").first(), "编辑前第 1 页");
  await preview.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await previewCounter.textContent(), "2 / 5");
  await assertSlidePainted(preview.locator(".slide").nth(1), "编辑前第 2 页");
  await preview.getByRole("button", { name: "第 1 页", exact: true }).click();
  assert.equal(await previewCounter.textContent(), "1 / 5");

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await editor.locator(".slide").first().waitFor();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await page.locator("#editor-slide-counter").textContent()) === "1 / 5") break;
    await delay(20);
  }
  const editNavigation = page.getByRole("navigation", { name: "编辑页导航" });
  const failures = [];
  let movedImageState = null;
  const editCounter = editNavigation.getByText("1 / 5", { exact: true });
  const editNext = editNavigation.getByRole("button", { name: "下一页", exact: true });
  if ((await editNavigation.count()) === 0 || (await editCounter.count()) === 0 || (await editNext.count()) === 0) {
    failures.push("SYMPTOM-1: 编辑模式没有可用的后续页面导航与页码");
  } else {
    assert.equal(await editCounter.isVisible(), true);
    await editor.locator(".slide").first().click({ position: { x: 12, y: 12 } });
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#editor-slide-counter").textContent(), "2 / 5");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator("#editor-slide-counter").textContent(), "1 / 5");
    await editNext.click();
    assert.equal(await editNavigation.getByText("2 / 5", { exact: true }).isVisible(), true);

    const secondSlide = editor.locator(".slide").nth(1);
    const secondHeading = secondSlide.getByRole("heading", { level: 2 });
    assert.equal(await secondHeading.isVisible(), true, "后续页面的兼容文字必须可见");
    await secondHeading.click();
    const textContent = page.getByRole("textbox", { name: "文字内容", exact: true });
    await textContent.fill("第二页编辑后仍然存在");
    await textContent.press("ArrowRight");
    assert.equal(await page.locator("#editor-slide-counter").textContent(), "2 / 5", "输入框内方向键不得切换页面");
    assert.equal(await secondHeading.textContent(), "第二页编辑后仍然存在");

    const editableImage = secondSlide.getByRole("img", { name: "多页回归普通内容图片" });
    await editableImage.click();
    await page.getByText("已选中普通内容图片", { exact: true }).waitFor();
    const imageBefore = await editableImage.boundingBox();
    assert.ok(imageBefore);
    await editableImage.hover();
    await page.mouse.down();
    await secondSlide.hover({ position: { x: 460, y: 260 } });
    await page.mouse.up();
    const imageAfter = await editableImage.boundingBox();
    assert.ok(imageAfter);
    assert.ok(Math.abs(imageAfter.x - imageBefore.x) > 10 || Math.abs(imageAfter.y - imageBefore.y) > 10);
    movedImageState = await editableImage.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        left: Number.parseFloat(computed.left),
        top: Number.parseFloat(computed.top),
        width: Number.parseFloat(computed.width),
        height: Number.parseFloat(computed.height),
      };
    });

    for (let pageNumber = 3; pageNumber <= 5; pageNumber += 1) {
      await editNavigation.getByRole("button", { name: "下一页", exact: true }).click();
      assert.equal(await page.locator("#editor-slide-counter").textContent(), `${pageNumber} / 5`);
    }
    assert.equal(await editor.locator(".slide").nth(4).getByRole("heading", { level: 2 }).isVisible(), true);
    for (let pageNumber = 4; pageNumber >= 2; pageNumber -= 1) {
      await editNavigation.getByRole("button", { name: "上一页", exact: true }).click();
      assert.equal(await page.locator("#editor-slide-counter").textContent(), `${pageNumber} / 5`);
    }
  }

  await editNavigation.getByRole("button", { name: "上一页", exact: true }).click();
  assert.equal(await editNavigation.getByText("1 / 5", { exact: true }).isVisible(), true);
  const firstHeading = editor.locator(".slide").first().getByRole("heading", { level: 1 });
  await firstHeading.click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("第一页编辑后仍然存在");

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  await page.evaluate(() => {
    const frame = document.querySelector('iframe[title="演示文稿预览"]');
    const shell = document.querySelector(".preview-frame-shell");
    window.__apsPreviewTransitionEvents = [];
    frame.addEventListener("load", () => window.__apsPreviewTransitionEvents.push("load"), { once: true });
    const observer = new MutationObserver(() => {
      if (!shell.hidden) {
        window.__apsPreviewTransitionEvents.push("shown");
        observer.disconnect();
      }
    });
    observer.observe(shell, { attributes: true, attributeFilter: ["hidden"] });
  });
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  await page.waitForFunction(() => window.__apsPreviewTransitionEvents?.includes("load"));
  const transitionEvents = await page.evaluate(() => window.__apsPreviewTransitionEvents);
  if (transitionEvents.indexOf("shown") < transitionEvents.indexOf("load")) {
    failures.push(`SYMPTOM-2: 预览在 iframe 加载完成前就被显示，events=${JSON.stringify(transitionEvents)}`);
  }
  await previewCounter.waitFor();
  const completedCounter = await previewCounter.textContent();
  const completedNavigationCount = await preview.getByRole("button", { name: "第 2 页", exact: true }).count();
  const completedHeadingVisible = await preview.getByRole("heading", { level: 1 }).isVisible().catch(() => false);
  if (completedCounter !== "1 / 5" || completedNavigationCount === 0 || !completedHeadingVisible) {
    failures.push(
      `SYMPTOM-2: 完成编辑后预览前景、页码或导航消失，counter=${JSON.stringify(completedCounter)}, navigation=${completedNavigationCount}, headingVisible=${completedHeadingVisible}`,
    );
  }
  assert.deepEqual(failures, []);
  await assertSlidePainted(preview.locator(".slide").first(), "第 1 页");

  await preview.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await previewCounter.textContent(), "2 / 5", "完成编辑后导航必须可用");
  assert.equal(
    await preview.locator(".slide").nth(1).getByRole("heading", { level: 2 }).textContent(),
    "第二页编辑后仍然存在",
  );
  assert.equal(await preview.getByRole("img", { name: "多页回归普通内容图片" }).isVisible(), true);
  await assertSlidePainted(preview.locator(".slide").nth(1), "第 2 页");
  for (let pageNumber = 3; pageNumber <= 5; pageNumber += 1) {
    await preview.getByRole("button", { name: `第 ${pageNumber} 页`, exact: true }).click();
    assert.equal(await previewCounter.textContent(), `${pageNumber} / 5`);
    await assertSlidePainted(preview.locator(".slide").nth(pageNumber - 1), `第 ${pageNumber} 页`);
  }
  await preview.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await previewCounter.textContent(), "2 / 5");
  await assertSlidePainted(preview.locator(".slide").nth(1), "完成编辑截图第 2 页");

  assert.ok(movedImageState, "移动后的图片必须有可持久化的计算样式");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifactDir, "issue-9-multipage-complete-green.png") });

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: /多页编辑回归/ }).click();
  await previewCounter.waitFor();
  assert.equal(await previewCounter.textContent(), "1 / 5", "重新打开后必须恢复五页页码");
  assert.equal(await preview.getByRole("heading", { level: 1 }).textContent(), "第一页编辑后仍然存在");
  await preview.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await previewCounter.textContent(), "2 / 5");
  assert.equal(
    await preview.locator(".slide").nth(1).getByRole("heading", { level: 2 }).textContent(),
    "第二页编辑后仍然存在",
  );
  const reopenedImage = preview.getByRole("img", { name: "多页回归普通内容图片" });
  assert.equal(await reopenedImage.isVisible(), true);
  const reopenedImageState = await reopenedImage.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      left: Number.parseFloat(computed.left),
      top: Number.parseFloat(computed.top),
      width: Number.parseFloat(computed.width),
      height: Number.parseFloat(computed.height),
    };
  });
  assert.ok(movedImageState);
  for (const property of ["left", "top", "width", "height"]) {
    assert.ok(Math.abs(reopenedImageState[property] - movedImageState[property]) < 2);
  }
  await assertSlidePainted(preview.locator(".slide").nth(1), "重开截图第 2 页");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifactDir, "issue-9-multipage-reopen-green.png") });

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.locator(".slide").first().waitFor();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await page.locator("#editor-slide-counter").textContent()) === "1 / 5") break;
    await delay(20);
  }

  const htmlDownloadPromise = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlPath = path.join(artifactDir, "issue-9-multipage-export.html");
  await htmlDownload.saveAs(htmlPath);
  const exportedHtml = await readFile(htmlPath, "utf8");
  assert.match(exportedHtml, /第二页编辑后仍然存在/, "HTML 必须包含后续页编辑后的中文文字");

  const standalone = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await standalone.context().setOffline(true);
  await standalone.goto(pathToFileURL(htmlPath).href);
  const standaloneCounter = standalone.locator("[data-slide-counter]");
  assert.equal(await standaloneCounter.textContent(), "1 / 5");
  assert.equal(await standalone.getByRole("heading", { level: 1 }).textContent(), "第一页编辑后仍然存在");
  await standalone.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await standaloneCounter.textContent(), "2 / 5", "自包含 HTML 必须可以独立翻页");
  assert.equal(
    await standalone.locator(".slide").nth(1).getByRole("heading", { level: 2 }).textContent(),
    "第二页编辑后仍然存在",
  );
  await standalone.close();

  await page.getByRole("button", { name: "导出 PDF", exact: true }).waitFor({ state: "visible" });
  const pdfDownloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = path.join(artifactDir, "issue-9-multipage-export.pdf");
  await pdfDownload.saveAs(pdfPath);
  const pdfLoadingTask = getDocument({ data: new Uint8Array(await readFile(pdfPath)) });
  const pdf = await pdfLoadingTask.promise;
  const pdfPageCount = pdf.numPages;
  assert.equal(pdfPageCount, 5, "五张幻灯片必须导出为五页 PDF");
  const firstPdfPage = await pdf.getPage(1);
  const firstPdfText = (await firstPdfPage.getTextContent()).items.map((item) => item.str).join("").replaceAll(/\s/g, "");
  assert.match(firstPdfText, /第一页编辑后仍然存在/);
  const secondPdfPage = await pdf.getPage(2);
  const secondPdfText = (await secondPdfPage.getTextContent()).items.map((item) => item.str).join("").replaceAll(/\s/g, "");
  assert.match(secondPdfText, /第二页编辑后仍然存在/);
  const operators = await firstPdfPage.getOperatorList();
  const fillColors = operators.fnArray.flatMap((operator, index) => {
    if (operator !== OPS.setFillRGBColor) return [];
    const args = operators.argsArray[index];
    const values = args?.length === 1 && args[0]?.length ? args[0] : args;
    return [typeof values === "string" ? values : Array.from(values || [])];
  });
  assert.ok(
    fillColors.some((color) => {
      if (typeof color === "string") return color.toLowerCase() === "#192b1b";
      const [red, green, blue] = color;
      return Math.abs(red - 25) <= 2 && Math.abs(green - 43) <= 2 && Math.abs(blue - 27) <= 2;
    }),
    `PDF 必须保留深绿背景，实际填充色：${JSON.stringify(fillColors)}`,
  );
  await pdfLoadingTask.destroy();

  console.log("EVIDENCE: five-page preview kept text/image/navigation/counter; standalone HTML reached 2 / 5; PDF pages=5, background=#192b1b");
  console.log("PASS: later-page editing and complete-edit preview survive dynamic Grove navigation");
} catch (error) {
  throw new Error(`${error.message}\n\nServer output:\n${serverOutput.join("")}\nBrowser output:\n${browserOutput.join("\n")}`);
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

async function assertSlidePainted(slide, label) {
  await slide.evaluate(async (element) => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const animations = element.parentElement?.getAnimations() || [];
    await Promise.all(animations.map((animation) => animation.finished));
  });
  const metrics = await slide.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const foreground = element.querySelector("h1, h2, h3, h4, h5, h6, p, img");
    const foregroundRect = foreground?.getBoundingClientRect();
    const foregroundStyle = foreground ? getComputedStyle(foreground) : null;
    const slideStyle = getComputedStyle(element);
    const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const foregroundVisibleWidth = foregroundRect
      ? Math.max(0, Math.min(foregroundRect.right, innerWidth) - Math.max(foregroundRect.left, 0))
      : 0;
    const foregroundVisibleHeight = foregroundRect
      ? Math.max(0, Math.min(foregroundRect.bottom, innerHeight) - Math.max(foregroundRect.top, 0))
      : 0;
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      visibleWidth,
      visibleHeight,
      backgroundColor: slideStyle.backgroundColor,
      foregroundOpacity: Number.parseFloat(foregroundStyle?.opacity || "0"),
      foregroundVisibleWidth,
      foregroundVisibleHeight,
    };
  });
  assert.ok(metrics.visibleWidth >= metrics.viewportWidth * 0.9, `${label} 必须位于预览视口内：${JSON.stringify(metrics)}`);
  assert.ok(metrics.visibleHeight >= metrics.viewportHeight * 0.9, `${label} 高度必须覆盖预览视口：${JSON.stringify(metrics)}`);
  assert.notEqual(metrics.backgroundColor, "rgba(0, 0, 0, 0)", `${label} 必须保留背景`);
  assert.ok(metrics.foregroundOpacity > 0, `${label} 前景透明度必须大于 0：${JSON.stringify(metrics)}`);
  assert.ok(metrics.foregroundVisibleWidth > 0 && metrics.foregroundVisibleHeight > 0, `${label} 前景必须在视口内：${JSON.stringify(metrics)}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Server did not become ready.\n${serverOutput.join("")}`);
}
