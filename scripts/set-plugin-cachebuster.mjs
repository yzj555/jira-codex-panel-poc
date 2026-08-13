import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "plugins", "jira-codex-assistant", ".codex-plugin", "plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const base = String(manifest.version || "0.1.0").replace(/\+codex\.[0-9A-Za-z.-]+$/, "");
const fallback = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const cachebuster = String(process.argv[2] || fallback).replace(/[^0-9A-Za-z.-]/g, "-");
manifest.version = `${base}+codex.${cachebuster}`;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(manifest.version);
