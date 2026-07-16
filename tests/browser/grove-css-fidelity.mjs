import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "grove-css-fidelity-"));
const fixtureFile = path.join(dataDir, "grove-real-css.html");
const groveHtml = await readFile(path.join(root, "templates", "grove", "example.html"), "utf8");
const groveHtmlWithCompositeBackgrounds = groveHtml
  .replace(
    /(\.slide\.dark\s*\{\s*)background: var\(--c-bg\);/,
    "$1background: radial-gradient(circle at 82% 18%, rgba(212, 207, 191, 0.025), transparent 28%), var(--c-bg);",
  )
  .replace(
    /(\.slide\.light\s*\{\s*)background: var\(--c-bg-light\);/,
    "$1background: radial-gradient(circle at 15% 85%, rgba(25, 43, 27, 0.025), transparent 32%), var(--c-bg-light);",
  );
assert.notEqual(groveHtmlWithCompositeBackgrounds, groveHtml);
await writeFile(fixtureFile, groveHtmlWithCompositeBackgrounds, "utf8");
const port = 4321;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const server = spawn(
  process.execPath,
  [
    "src/server.mjs",
    "--fixture",
    "--fixture-file",
    path.relative(root, fixtureFile),
    "--no-open",
    "--port",
    String(port),
    "--data-dir",
    dataDir,
  ],
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

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("console", (message) => browserOutput.push("console " + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => browserOutput.push("pageerror: " + error.message));

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(
    ["真实 Grove CSS 保真测试", "验证预览、编辑、保存和重新打开后的背景与间距。"].join("\n"),
  );
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });

  const preview = page.frameLocator('iframe[title="演示文稿预览"]');
  const expectedStyles = await readRepresentativeStyles(preview);
  assert.notEqual(expectedStyles.dark.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.notEqual(expectedStyles.light.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.notEqual(expectedStyles.dark.backgroundImage, "none");
  assert.notEqual(expectedStyles.light.backgroundImage, "none");
  assert.ok(expectedStyles.dark.paddingLeftRatio > 0);
  assert.ok(expectedStyles.dark.paddingTopRatio > 0);

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByText("编辑模式", { exact: true }).waitFor();
  const editor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  assert.deepEqual(
    await readRepresentativeStyles(editor),
    expectedStyles,
    "进入编辑模式后必须保留真实 Grove 的深浅背景与水平/垂直间距",
  );

  assert.equal(
    await readAnimatedHeadingOpacity(editor),
    1,
    "进入编辑模式后，带 Grove 入场动画的文字必须立即可见",
  );

  await editor.getByRole("heading", { level: 1 }).first().click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("真实 Grove CSS 已保留");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存成功", { exact: true }).waitFor();
  const projectFiles = await readdir(path.join(dataDir, "projects"));
  assert.equal(projectFiles.length, 1);
  const savedProject = JSON.parse(
    await readFile(path.join(dataDir, "projects", projectFiles[0]), "utf8"),
  );
  assert.ok(Array.isArray(savedProject.projectData?.apsPresentationStyles));
  assert.match(
    savedProject.projectData.apsPresentationStyles.map(({ css }) => css).join("\n"),
    /radial-gradient/,
    "Grove 原始样式必须保存在结构化项目状态中",
  );
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.getByText("预览模式", { exact: true }).waitFor();
  assert.deepEqual(await readRepresentativeStyles(preview), expectedStyles);
  assert.match(
    await preview.getByRole("heading", { level: 1 }).first().textContent(),
    /真实 Grove CSS 已保留/,
  );

  await page.getByRole("button", { name: "返回首页" }).click();
  await page.getByRole("article", { name: "真实 Grove CSS 保真测试" }).click();
  const reopenedPreview = page.frameLocator('iframe[title="演示文稿预览"]');
  await reopenedPreview.locator(".slide.dark").first().waitFor();
  assert.deepEqual(await readRepresentativeStyles(reopenedPreview), expectedStyles);
  assert.match(
    await reopenedPreview.getByRole("heading", { level: 1 }).first().textContent(),
    /真实 Grove CSS 已保留/,
  );

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const reopenedEditor = page.frameLocator('iframe[title="演示文稿编辑画布"]');
  await reopenedEditor.locator(".slide.dark").first().waitFor();
  assert.deepEqual(
    await readRepresentativeStyles(reopenedEditor),
    expectedStyles,
    "保存并重新打开后，编辑器仍必须保留真实 Grove 背景与间距",
  );
  assert.equal(
    await readAnimatedHeadingOpacity(reopenedEditor),
    1,
    "保存并重新打开后，带 Grove 入场动画的文字仍必须可见",
  );

  console.log("PASS: real Grove CSS remains faithful through edit, save, and reopen");
} catch (error) {
  const enrichedMessage =
    error.message +
    "\n\nServer output:\n" +
    serverOutput.join("") +
    "\nBrowser output:\n" +
    browserOutput.join("\n");
  throw new Error(enrichedMessage);
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

async function readRepresentativeStyles(frame) {
  const read = (locator) =>
    locator.evaluate((element) => {
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const ratio = (value, total) => Number((Number.parseFloat(value) / total).toFixed(4));
      return {
        backgroundColor: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        paddingTopRatio: ratio(computed.paddingTop, rect.height),
        paddingRightRatio: ratio(computed.paddingRight, rect.width),
        paddingBottomRatio: ratio(computed.paddingBottom, rect.height),
        paddingLeftRatio: ratio(computed.paddingLeft, rect.width),
      };
    });
  return {
    dark: await read(frame.locator(".slide.dark").first()),
    light: await read(frame.locator(".slide.light").first()),
  };
}

async function readAnimatedHeadingOpacity(frame) {
  return frame
    .locator(".slide.dark h1[data-anim]")
    .first()
    .evaluate((element) => Number(getComputedStyle(element).opacity));
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
