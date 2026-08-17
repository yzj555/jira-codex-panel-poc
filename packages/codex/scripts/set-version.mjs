import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVersion } from "../lib/github-update-checker.mjs";

// 脚本位于 packages/codex/scripts/，仓库根为其上三级（dirname 需四次：文件→scripts→codex→packages→根）。
const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const version = normalizeVersion(process.argv[2]);
if (!version) throw new Error("Usage: node packages/codex/scripts/set-version.mjs <semver>");

// 根 package.json / package-lock.json，以及两个 workspace 包的 package.json 同步版本。
for (const relative of [
  "package.json",
  "package-lock.json",
  "packages/core/package.json",
  "packages/codex/package.json"
]) {
  const path = join(root, relative);
  const value = JSON.parse(await readFile(path, "utf8"));
  value.version = version;
  if (value.packages?.[""]) value.packages[""].version = version;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// server.mjs 与 inject/client.js 在 codex 壳，README 在仓库根。
for (const [relative, pattern, replacement] of [
  ["packages/codex/server.mjs", /const VERSION = "[^"]+";/, `const VERSION = "${version}";`],
  ["packages/codex/inject/client.js", /const VERSION = "[^"]+";/, `const VERSION = "${version}";`],
  ["README.md", /> 当前版本：`[^`]+`/, `> 当前版本：\`${version}\``]
]) {
  const path = join(root, relative);
  const source = await readFile(path, "utf8");
  if (!pattern.test(source)) throw new Error(`${relative} 中没有找到版本标记。`);
  await writeFile(path, source.replace(pattern, replacement), "utf8");
}
console.log(version);
