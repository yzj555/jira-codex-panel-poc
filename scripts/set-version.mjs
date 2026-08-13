import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVersion } from "../lib/github-update-checker.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = normalizeVersion(process.argv[2]);
if (!version) throw new Error("Usage: node scripts/set-version.mjs <semver>");

for (const name of ["package.json", "package-lock.json"]) {
  const path = join(root, name);
  const value = JSON.parse(await readFile(path, "utf8"));
  value.version = version;
  if (value.packages?.[""]) value.packages[""].version = version;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

for (const [relative, pattern, replacement] of [
  ["server.mjs", /const VERSION = "[^"]+";/, `const VERSION = "${version}";`],
  ["inject/client.js", /const VERSION = "[^"]+";/, `const VERSION = "${version}";`],
  ["README.md", /> 当前版本：`[^`]+`/, `> 当前版本：\`${version}\``]
]) {
  const path = join(root, relative);
  const source = await readFile(path, "utf8");
  if (!pattern.test(source)) throw new Error(`${relative} 中没有找到版本标记。`);
  await writeFile(path, source.replace(pattern, replacement), "utf8");
}
console.log(version);
