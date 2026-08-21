import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVersion } from "../lib/github-update-checker.mjs";

// 脚本位于 packages/codex/scripts/，仓库根为其上三级（dirname 需四次：文件→scripts→codex→packages→根）。
const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const version = normalizeVersion(process.argv[2]);
if (!version) throw new Error("Usage: node packages/codex/scripts/set-version.mjs <semver>");

// 根 package.json / package-lock.json，以及各 workspace 包的 package.json 同步版本。
for (const relative of [
  "package.json",
  "package-lock.json",
  "packages/core/package.json",
  "packages/codex/package.json",
  "packages/dsh/package.json",
  "packages/dsh-client/package.json"
]) {
  const path = join(root, relative);
  const value = JSON.parse(await readFile(path, "utf8"));
  value.version = version;
  if (value.packages?.[""]) value.packages[""].version = version;
  if (relative === "packages/dsh/package.json") {
    value.dependencies["@jira-workbench/core"] = version;
    value.dependencies["@jira-workbench/dsh-client"] = version;
  }
  if (relative === "package-lock.json") {
    for (const entry of Object.values(value.packages || {})) {
      if (["@jira-workbench/core", "@jira-workbench/dsh-client", "@jira-workbench/dsh"].includes(entry?.name)) {
        entry.version = version;
      }
      if (entry?.dependencies?.["@jira-workbench/core"]) entry.dependencies["@jira-workbench/core"] = version;
      if (entry?.dependencies?.["@jira-workbench/dsh-client"]) entry.dependencies["@jira-workbench/dsh-client"] = version;
    }
  }
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// server.mjs 与 inject/client.js 在 codex 壳，core 独立服务的版本标记在 core 包，README 在仓库根。
for (const [relative, pattern, replacement] of [
  ["packages/codex/server.mjs", /const VERSION = "[^"]+";/, `const VERSION = "${version}";`],
  ["packages/codex/inject/client.js", /const VERSION = "[^"]+";/, `const VERSION = "${version}";`],
  ["packages/core/bin/serve.mjs", /const VERSION = "[^"]+";/, `const VERSION = "${version}";`],
  ["packages/core/index.mjs", /  version = "[^"]+"/, `  version = "${version}"`],
  ["packages/dsh/plugin.mjs", /    version: config\.version \|\| "[^"]+"/, `    version: config.version || "${version}"`],
  ["packages/dsh/README.md", /> 当前 Jira Workbench 版本：`[^`]+`/, `> 当前 Jira Workbench 版本：\`${version}\``],
  ["README.md", /> 当前版本：`[^`]+`/, `> 当前版本：\`${version}\``]
]) {
  const path = join(root, relative);
  const source = await readFile(path, "utf8");
  if (!pattern.test(source)) throw new Error(`${relative} 中没有找到版本标记。`);
  await writeFile(path, source.replace(pattern, replacement), "utf8");
}

// Plugin cachebuster 随版本同步到仓库：本地安装（install.ps1 用仓库清单）时
// Codex 能识别到新版本并重新加载 Plugin，而不是沿用上次安装的缓存。
// 只替换 version 字段，保持清单其余内容（含中文 \u 转义）原样不变。
const pluginManifestPath = join(
  root,
  "packages/codex/plugins/jira-workbench-assistant/.codex-plugin/plugin.json"
);
const pluginSource = await readFile(pluginManifestPath, "utf8");
const cachebusterPattern = /("version"\s*:\s*")([^"]*)(\+(?:codex\.[0-9A-Za-z.-]+)?)(")/;
if (!cachebusterPattern.test(pluginSource)) {
  throw new Error(`${pluginManifestPath} 中没有找到可同步的 Plugin version 字段。`);
}
await writeFile(
  pluginManifestPath,
  pluginSource.replace(cachebusterPattern, (_, prefix, base, _suffix, suffix) => (
    `${prefix}${base}+codex.v${version}${suffix}`
  )),
  "utf8"
);

console.log(version);
