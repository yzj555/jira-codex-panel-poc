import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, listPageTargets, selectMainCodexTarget } from "../lib/cdp.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cdpPort = Number(process.env.CODEX_CDP_PORT || 47824);
const targets = await listPageTargets(cdpPort);
const target = selectMainCodexTarget(targets);
if (!target) throw new Error("未找到 Codex 页面 target");

const cdp = await new CdpClient(target.webSocketDebuggerUrl).connect();
try {
  await cdp.send("Page.enable");
  await cdp.send("Page.bringToFront");
  const opened = await cdp.send("Runtime.evaluate", {
    expression: "window.__jiraWorkbenchPoc?.open(); window.__jiraWorkbenchPoc?.state() ?? null",
    awaitPromise: true,
    returnByValue: true
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const artifacts = join(root, "artifacts");
  const outputPath = join(artifacts, "windows-codex-jira-panel-poc.png");
  await mkdir(artifacts, { recursive: true });
  await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ outputPath, state: opened.result?.value ?? null }, null, 2));
} finally {
  cdp.close();
}
