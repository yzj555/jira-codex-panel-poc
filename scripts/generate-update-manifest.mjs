import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const archivePath = resolve(process.argv[2] || "");
const outputDirectory = resolve(process.argv[3] || dirname(archivePath));
if (!process.argv[2]) throw new Error("Usage: node scripts/generate-update-manifest.mjs <archive.zip> [output-directory]");

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const expectedArchiveName = `jira-codex-assistant-${packageJson.version}-win-x64.zip`;
if (basename(archivePath).toLowerCase() !== expectedArchiveName.toLowerCase()) {
  throw new Error(`Release archive must be named ${expectedArchiveName}.`);
}
const archive = await readFile(archivePath);
const manifest = {
  schemaVersion: 1,
  productId: "jira-codex-panel",
  version: packageJson.version,
  channel: "stable",
  restartRequired: true,
  minimumUpdaterVersion: "1.0.0",
  asset: {
    name: basename(archivePath),
    size: archive.length,
    sha256: createHash("sha256").update(archive).digest("hex")
  }
};
await writeFile(join(outputDirectory, "update-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest));
