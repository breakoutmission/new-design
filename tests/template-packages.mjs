import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesRoot = path.join(root, "templates");
const expected = [
  "biennale-yellow",
  "blue-professional",
  "cobalt-grid",
  "grove",
  "studio",
];
const actual = (await readdir(templatesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(actual, expected, "模板根目录必须恰好包含五个已通过资格验收的首发包");

for (const directory of expected) {
  const packageDir = path.join(templatesRoot, directory);
  const files = (await readdir(packageDir)).sort();
  assert.deepEqual(
    files,
    ["LICENSE", "NOTICE.md", "SKILL.md", "example.html", "template.json"],
    directory + " 必须同时包含提示、示例、元数据、许可证和来源说明",
  );
  const [skill, example, license, notice, metadata] = await Promise.all([
    readFile(path.join(packageDir, "SKILL.md"), "utf8"),
    readFile(path.join(packageDir, "example.html"), "utf8"),
    readFile(path.join(packageDir, "LICENSE"), "utf8"),
    readFile(path.join(packageDir, "NOTICE.md"), "utf8"),
    readFile(path.join(packageDir, "template.json"), "utf8").then(JSON.parse),
  ]);
  assert.ok(skill.trim().length > 100, directory + " 提示文件不得为空壳");
  assert.match(example, /<!doctype html>/i, directory + " 示例必须是完整 HTML");
  assert.ok(
    Array.from(example.matchAll(/class=["']([^"']*)["']/gi)).some((match) =>
      match[1].split(/\s+/).includes("slide"),
    ),
    directory + " 示例必须包含幻灯片结构",
  );
  assert.match(license, /MIT License/, directory + " 必须保留 MIT 许可证");
  assert.match(notice, /Open Design/i, directory + " 必须说明 Open Design 来源");
  assert.equal(typeof metadata.name, "string", directory + " 元数据必须包含模板名称");
}

console.log("PASS: exactly five launch template packages include prompt, example, metadata, license, and notice");
