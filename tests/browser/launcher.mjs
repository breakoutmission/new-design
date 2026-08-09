import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "launcher-"));
const port = 4336;
const baseUrl = `http://127.0.0.1:${port}`;
const launcherOutput = [];

const launcher = spawn(
  "cmd.exe",
  [
    "/d",
    "/s",
    "/c",
    `call start-ai-presentation-studio.cmd --test --no-open --port ${port} --data-dir ${dataDir}`,
  ],
  {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
launcher.stdout.on("data", (chunk) => launcherOutput.push(chunk.toString("utf8")));
launcher.stderr.on("data", (chunk) => launcherOutput.push(chunk.toString("utf8")));

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page
    .getByRole("textbox", { name: "源材料", exact: true })
    .fill("Windows 启动入口回归\n验证启动脚本传入独立数据目录。");
  await page.getByRole("radio", { name: /^Grove —/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("preview").waitFor({ timeout: 15_000 });
  const projectFiles = (await readdir(path.join(dataDir, "projects"))).filter((name) =>
    name.endsWith(".json"),
  );
  assert.equal(projectFiles.length, 1, "Windows 启动入口必须把项目写入指定的独立 data directory");
  console.log("PASS: Windows launcher starts the public app with an isolated data directory");
} catch (error) {
  throw new Error(`${error.message}\n\nLauncher output:\n${launcherOutput.join("")}`);
} finally {
  if (browser) await browser.close();
  stopLauncherTree();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // The launcher is still starting.
    }
    await delay(100);
  }
  throw new Error("Windows 启动入口没有使用请求的端口启动应用");
}

function stopLauncherTree() {
  if (launcher.exitCode !== null || launcher.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(launcher.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    launcher.kill("SIGKILL");
  }
}
