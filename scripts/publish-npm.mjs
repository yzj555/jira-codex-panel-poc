import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = "https://registry.npmjs.org/";
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const ifMissing = args.has("--if-missing");
const provenance = args.has("--provenance");
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
const npmPrefix = npmCli ? [npmCli] : [];
const releasePackages = [
  {
    name: "@jira-workbench/core",
    directory: "packages/core",
    requiredFiles: [
      "package.json",
      "README.md",
      "bin/serve.mjs",
      "index.mjs",
      "lib/issue-workspace-service.mjs",
      "mcp/jira-task-board-mcp.mjs",
      "mcp/ui/task-board.html",
      "public/prompt-builder.js"
    ]
  },
  {
    name: "@jira-workbench/dsh-client",
    directory: "packages/dsh-client",
    requiredFiles: ["package.json", "README.md", "index.mjs", "lib/client.js"]
  },
  {
    name: "@jira-workbench/dsh",
    directory: "packages/dsh",
    requiredFiles: [
      "package.json",
      "README.md",
      "INSTALL.md",
      "DESIGN.md",
      "plugin.mjs",
      "cordis.patch.yml",
      "lib/dsh-analysis-service.mjs",
      "lib/dsh-conversation-service.mjs"
    ]
  }
];

function localSpec(entry) {
  return `./${entry.directory.replaceAll("\\", "/")}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runNpm(commandArgs, { capture = false } = {}) {
  const result = spawnSync(npmCommand, [...npmPrefix, ...commandArgs], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: process.env,
    shell: !npmCli && process.platform === "win32"
  });
  if (result.error) throw result.error;
  return result;
}

function assertManifest(entry, expectedVersion) {
  const manifestPath = join(root, entry.directory, "package.json");
  const manifest = readJson(manifestPath);
  if (manifest.name !== entry.name) {
    throw new Error(`${relative(root, manifestPath)} name 应为 ${entry.name}，实际为 ${manifest.name}。`);
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`${entry.name} 版本 ${manifest.version} 与根版本 ${expectedVersion} 不一致。`);
  }
  if (manifest.private === true) throw new Error(`${entry.name} 仍标记为 private，禁止发布。`);
  if (manifest.publishConfig?.access !== "public") throw new Error(`${entry.name} 必须显式声明 public access。`);
  if (manifest.publishConfig?.registry !== registry) throw new Error(`${entry.name} registry 必须固定为 ${registry}。`);
  return manifest;
}

function inspectTarball(entry) {
  const result = runNpm([
    "pack",
    localSpec(entry),
    "--dry-run",
    "--json",
    "--ignore-scripts",
    `--registry=${registry}`
  ], { capture: true });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "npm pack 失败。\n");
    process.exit(result.status || 1);
  }
  const report = JSON.parse(result.stdout);
  const files = new Set((report[0]?.files || []).map((file) => file.path.replaceAll("\\", "/")));
  const missing = entry.requiredFiles.filter((file) => !files.has(file));
  if (missing.length) throw new Error(`${entry.name} tarball 缺少关键文件：${missing.join(", ")}`);
  console.log(`✓ ${entry.name}@${report[0].version}: ${files.size} files, ${report[0].size} bytes`);
}

function isPublished(name, version) {
  const result = runNpm([
    "view",
    `${name}@${version}`,
    "version",
    "--json",
    `--registry=${registry}`
  ], { capture: true });
  if (result.status === 0) return true;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (/E404|404 Not Found|could not be found/i.test(output)) return false;
  process.stderr.write(output);
  throw new Error(`无法确认 ${name}@${version} 的 npm 状态。`);
}

const rootManifest = readJson(join(root, "package.json"));
const version = rootManifest.version;
const manifests = new Map(releasePackages.map((entry) => [entry.name, assertManifest(entry, version)]));
const host = manifests.get("@jira-workbench/dsh");
for (const dependency of ["@jira-workbench/core", "@jira-workbench/dsh-client"]) {
  if (host.dependencies?.[dependency] !== version) {
    throw new Error(`@jira-workbench/dsh 必须以精确版本 ${version} 依赖 ${dependency}。`);
  }
}

if (dryRun) {
  for (const entry of releasePackages) inspectTarball(entry);
  console.log(`npm v${version} 三包内容检查通过。`);
  process.exit(0);
}

for (const entry of releasePackages) {
  if (isPublished(entry.name, version)) {
    if (!ifMissing) throw new Error(`${entry.name}@${version} 已存在；npm 版本不可覆盖。`);
    console.log(`↷ ${entry.name}@${version} 已存在，跳过。`);
    continue;
  }
  const publishArgs = [
    "publish",
    localSpec(entry),
    "--access=public",
    `--registry=${registry}`
  ];
  if (provenance) publishArgs.push("--provenance");
  const result = runNpm(publishArgs);
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`npm v${version} 发布完成。`);
