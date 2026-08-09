import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "output", "real-acceptance");
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, "cancel-"));
const port = 4322;
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const browserOutput = [];

const server = spawn(
  process.execPath,
  ["src/server.mjs", "--no-open", "--port", String(port), "--data-dir", dataDir],
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

  const originalSource = [
    "真实 Codex 取消验证",
    "这份材料只用于启动真实生成并立即取消。",
    "取消后必须保留材料与 Grove 模板，且不能展示残缺 HTML。",
  ].join("\n");

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "源材料", exact: true }).fill(originalSource);
  await page.getByRole("radio", { name: /Grove/ }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByTestId("stage").getByText("正在生成演示文稿", { exact: true }).waitFor();

  const runningTree = await waitForCodexTree(server.pid);
  const codexProcesses = runningTree.filter((process) =>
    String(process.CommandLine || process.Name || "").toLowerCase().includes("codex"),
  );
  assert.ok(codexProcesses.length > 0, "必须观察到真实 Codex 进程");
  const capturedProcesses = runningTree.map((process) => ({
    ProcessId: Number(process.ProcessId),
    ParentProcessId: Number(process.ParentProcessId),
    Name: process.Name,
    CommandLine: process.CommandLine,
    CreationDate: process.CreationDate,
  }));
  const capturedPids = capturedProcesses.map((process) => process.ProcessId);
  console.log("Observed generation tree: " + JSON.stringify(capturedProcesses));

  await page.getByRole("button", { name: "取消生成", exact: true }).click();
  await page.getByRole("heading", { name: "已取消", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText("生成已取消，源材料和演示模板已保留。", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("preview").isHidden(), true, "真实取消后不得展示残缺 HTML");
  assert.equal(await page.getByRole("textbox", { name: "源材料", exact: true }).inputValue(), originalSource);
  assert.equal(await page.getByRole("radio", { name: /Grove/ }).isChecked(), true);

  await waitForProcessesGone(capturedProcesses);
  await assertNoCodexDescendants(server.pid);

  await page.getByRole("button", { name: "返回首页" }).click();
  const canceledCard = page.getByRole("article", { name: "真实 Codex 取消验证" });
  await canceledCard.waitFor();
  assert.match(await canceledCard.textContent(), /已取消/);
  await canceledCard.click();
  await page.getByRole("heading", { name: "已取消", exact: true }).waitFor();
  assert.equal(await page.getByTestId("preview").isHidden(), true);

  await mkdir(path.join(root, "output", "playwright"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "output", "playwright", "real-codex-cancel.png"),
    fullPage: true,
  });

  console.log(
    "PASS: real Codex process tree terminated after browser cancellation; observed PIDs " +
      capturedPids.join(", "),
  );
} catch (error) {
  throw new Error(
    error.message +
      "\n\nServer output:\n" +
      serverOutput.join("") +
      "\nBrowser output:\n" +
      browserOutput.join("\n"),
  );
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.killed) server.kill("SIGTERM");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverExit) {
      throw new Error(
        "Server exited before it became ready (" +
          JSON.stringify(serverExit) +
          ").\n" +
          serverOutput.join(""),
      );
    }
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  throw new Error("Server did not become ready.\n" + serverOutput.join(""));
}

async function getProcessSnapshot() {
  if (process.platform !== "win32") {
    throw new Error("真实 Codex 进程树验收当前只适用于正式目标平台 Windows。");
  }
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

function getDescendants(processes, parentPid) {
  const descendants = [];
  const processByPid = new Map(processes.map((process) => [Number(process.ProcessId), process]));
  const root = processByPid.get(Number(parentPid));
  const pending = [
    {
      pid: Number(parentPid),
      creationTime: getCreationTime(root?.CreationDate),
    },
  ];
  const visited = new Set([Number(parentPid)]);
  while (pending.length) {
    const currentParent = pending.shift();
    for (const process of processes) {
      const processId = Number(process.ProcessId);
      const creationTime = getCreationTime(process.CreationDate);
      if (
        Number(process.ParentProcessId) !== currentParent.pid ||
        visited.has(processId) ||
        creationTime < currentParent.creationTime
      ) {
        continue;
      }
      visited.add(processId);
      pending.push({ pid: processId, creationTime });
      descendants.push(process);
    }
  }
  return descendants;
}

function getCreationTime(value) {
  const dotNetJsonDate = String(value || "").match(/^\/Date\((\d+)/);
  if (dotNetJsonDate) return Number(dotNetJsonDate[1]);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

async function waitForCodexTree(serverPid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await getProcessSnapshot();
    const serverTree = getDescendants(snapshot, serverPid);
    const generatorRoot = serverTree.find((process) =>
      String(process.CommandLine || "").toLowerCase().includes("codex.cmd exec"),
    );
    if (generatorRoot) {
      await delay(250);
      const settledSnapshot = await getProcessSnapshot();
      const settledRoot = settledSnapshot.find(
        (process) =>
          Number(process.ProcessId) === Number(generatorRoot.ProcessId) &&
          process.CreationDate === generatorRoot.CreationDate,
      );
      if (settledRoot) {
        return [
          settledRoot,
          ...getDescendants(settledSnapshot, Number(settledRoot.ProcessId)),
        ];
      }
    }
    await delay(100);
  }
  throw new Error("没有在本地后端下面观察到真实 Codex 子进程树。");
}

async function waitForProcessesGone(capturedProcesses) {
  const pids = capturedProcesses.map((process) => process.ProcessId);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (pids.every((pid) => !isProcessRunning(pid))) return;
    await delay(100);
  }

  const snapshot = await getProcessSnapshot();
  const byPid = new Map(snapshot.map((process) => [Number(process.ProcessId), process]));
  const remaining = capturedProcesses.filter((captured) => {
    const current = byPid.get(captured.ProcessId);
    return current && current.CreationDate === captured.CreationDate;
  });
  if (remaining.length === 0) return;
  throw new Error("取消后仍有原 Codex 进程存活：" + JSON.stringify(remaining));
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function assertNoCodexDescendants(serverPid) {
  const remaining = getDescendants(await getProcessSnapshot(), serverPid).filter((process) =>
    String(process.CommandLine || process.Name || "").toLowerCase().includes("codex"),
  );
  assert.deepEqual(remaining, [], "取消后本地后端下面不得残留 Codex 进程");
}
