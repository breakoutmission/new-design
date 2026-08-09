import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "test-data");
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "windows-default-launcher-"));
const port = 4339;
const baseUrl = `http://127.0.0.1:${port}`;
const before = await getProcessSnapshot();
const beforePids = new Set(before.map((item) => Number(item.ProcessId)));

spawn("cmd.exe", ["/d", "/s", "/c", "call start-ai-presentation-studio.cmd"], {
  cwd: root,
  env: {
    ...process.env,
    APS_PORT: String(port),
    APS_DATA_DIR: dataDir,
  },
  windowsHide: true,
  detached: true,
  stdio: "ignore",
}).unref();

let browser;
let commandWindowPid = null;
try {
  await waitForServer();
  const processTree = await waitForServerProcess(beforePids);
  const commandWindow = processTree.find(
    (item) =>
      String(item.Name).toLowerCase() === "cmd.exe" &&
      String(item.CommandLine).toLowerCase().includes("pnpm start"),
  );
  assert.ok(commandWindow, "默认双击入口必须创建承载后端的命令窗口");
  commandWindowPid = Number(commandWindow.ProcessId);
  assert.equal(await waitForMinimizedWindow(commandWindowPid), true, "后端命令窗口必须最小化运行");
  assert.equal(await waitForBrowserWindow(), true, "默认双击入口必须自动打开浏览器首页");

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "AI Presentation Studio" }).waitFor();
  await page.screenshot({
    path: path.join(root, "output", "playwright", "issue-7-windows-default-launcher.png"),
    fullPage: true,
  });

  await closeWindow(commandWindowPid);
  assert.equal(await waitForServerStopped(), true, "关闭运行窗口后本地后端必须停止");
  console.log("PASS: default Windows launcher auto-opens the homepage, stays minimized, and stops when closed");
} finally {
  try {
    if (browser) await browser.close();
  } finally {
    if (commandWindowPid && (await isServerRunning())) {
      spawnSync("taskkill.exe", ["/PID", String(commandWindowPid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else if (!commandWindowPid) {
      await cleanupNewLauncherProcesses(beforePids);
    }
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isServerRunning()) return;
    await delay(100);
  }
  throw new Error("默认 Windows 启动入口没有使用隔离端口启动应用");
}

async function isServerRunning() {
  try {
    return (await fetch(`${baseUrl}/api/health`)).ok;
  } catch {
    return false;
  }
}

async function waitForServerStopped() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!(await isServerRunning())) return true;
    await delay(100);
  }
  return false;
}

async function waitForServerProcess(existingPids) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await getProcessSnapshot();
    const byPid = new Map(snapshot.map((item) => [Number(item.ProcessId), item]));
    const server = snapshot.find(
      (item) =>
        !existingPids.has(Number(item.ProcessId)) &&
        String(item.CommandLine).includes("src/server.mjs") &&
        String(item.CommandLine).includes(String(port)),
    );
    if (server) {
      const tree = [server];
      let parentPid = Number(server.ParentProcessId);
      while (parentPid && !existingPids.has(parentPid)) {
        const parent = byPid.get(parentPid);
        if (!parent) break;
        tree.push(parent);
        parentPid = Number(parent.ParentProcessId);
      }
      return tree;
    }
    await delay(100);
  }
  throw new Error("没有找到默认 Windows 启动入口创建的后端进程树");
}

async function getProcessSnapshot() {
  const command = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate |",
    "ConvertTo-Json -Compress",
  ].join("\n");
  const { stdout } = await execFileAsync(
    process.env.POWERSHELL_EXE || "powershell.exe",
    ["-NoProfile", "-Command", command],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  const parsed = JSON.parse(stdout.trim() || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitForMinimizedWindow(pid) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await readWindowState(pid);
    if (state.hasHandle && state.minimized) return true;
    await delay(100);
  }
  return false;
}

async function readWindowState(pid) {
  const command = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ApsWin { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); }'
$process = Get-Process -Id ${pid} -ErrorAction Stop
$handle = $process.MainWindowHandle
[pscustomobject]@{ hasHandle = ($handle -ne 0); minimized = if ($handle -ne 0) { [ApsWin]::IsIconic($handle) } else { $false } } | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync(
    process.env.POWERSHELL_EXE || "powershell.exe",
    ["-NoProfile", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
  return JSON.parse(stdout.trim());
}

async function waitForBrowserWindow() {
  const command = `
$window = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('chrome','msedge') -and $_.MainWindowTitle -like '*AI Presentation Studio*' } | Select-Object -First 1 Id,ProcessName,MainWindowTitle
if ($window) { $window | ConvertTo-Json -Compress } else { 'null' }
`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { stdout } = await execFileAsync(
      process.env.POWERSHELL_EXE || "powershell.exe",
      ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true },
    );
    if (JSON.parse(stdout.trim() || "null")) return true;
    await delay(100);
  }
  return false;
}

async function closeWindow(pid) {
  const command = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ApsClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam); }'
$process = Get-Process -Id ${pid} -ErrorAction Stop
if ($process.MainWindowHandle -eq 0) { throw '命令窗口句柄不可用' }
if (-not [ApsClose]::PostMessage($process.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw '无法关闭命令窗口' }
`;
  await execFileAsync(
    process.env.POWERSHELL_EXE || "powershell.exe",
    ["-NoProfile", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
}

async function cleanupNewLauncherProcesses(existingPids) {
  const snapshot = await getProcessSnapshot();
  const candidates = snapshot.filter(
    (item) =>
      !existingPids.has(Number(item.ProcessId)) &&
      String(item.Name).toLowerCase() === "cmd.exe" &&
      String(item.CommandLine).toLowerCase().includes("pnpm start"),
  );
  for (const candidate of candidates) {
    spawnSync("taskkill.exe", ["/PID", String(candidate.ProcessId), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
}
