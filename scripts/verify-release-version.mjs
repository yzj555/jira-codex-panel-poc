import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVersion } from "../lib/github-update-checker.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tagVersion = normalizeVersion(process.argv[2] || process.env.GITHUB_REF_NAME || "");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = normalizeVersion(packageJson.version);
if (!tagVersion) throw new Error("必须提供 vX.Y.Z Release tag。");
if (tagVersion !== version) throw new Error(`Release tag v${tagVersion} 与 package.json v${version} 不一致。`);

const checks = [
  ["server.mjs", `const VERSION = "${version}";`],
  ["inject/client.js", `const VERSION = "${version}";`],
  ["README.md", `> 当前版本：\`${version}\``]
];
for (const [relative, marker] of checks) {
  const content = await readFile(join(root, relative), "utf8");
  if (!content.includes(marker)) throw new Error(`${relative} 没有同步到 v${version}。`);
}
console.log(`Release v${version} 版本一致性检查通过。`);
