import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const file = readArg("--file");
const delayMs = Number(readArg("--delay") || 0);
const shouldFail = args.includes("--fail");

await new Promise((resolve) => setTimeout(resolve, delayMs));

if (shouldFail) {
  console.error("Codex 生成失败：测试生成器未能完成演示文稿。");
  process.exitCode = 1;
} else {
  process.stdout.write(await readFile(file, "utf8"));
}

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
