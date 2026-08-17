import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPanelCodexRuntimeAdapter } from "../lib/codex-application-commands.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const commandArgument = process.argv.find((value) => value.startsWith("--command="));
const command = commandArgument ? commandArgument.slice("--command=".length).trim() : "";
const port = Number(process.argv.find((value) => value.startsWith("--port="))?.slice("--port=".length) || 47991);
const temporaryRoot = await mkdtemp(join(tmpdir(), "jira-codex-app-server-probe-"));
const environment = {
  ...process.env,
  JIRA_WORKBENCH_PORT: String(port),
  JIRA_WORKBENCH_CONFIG_FILE: join(temporaryRoot, "config.json"),
  JIRA_WORKBENCH_AUTOMATION_FILE: join(temporaryRoot, "automation.json"),
  JIRA_WORKBENCH_SVN_BASELINES_FILE: join(temporaryRoot, "svn-baselines.json"),
  JIRA_WORKBENCH_SVN_REVIEWS_FILE: join(temporaryRoot, "svn-reviews.json"),
  JIRA_WORKBENCH_SVN_REVIEW_ARTIFACTS_DIR: join(temporaryRoot, "review-artifacts"),
  ...(command ? { JIRA_WORKBENCH_APP_SERVER_COMMAND: command } : {})
};
const child = spawn(process.execPath, [join(root, "server.mjs")], {
  cwd: root,
  env: environment,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000);
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`面板服务提前退出：${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const payload = await response.json();
      if (response.ok && payload.ok) return payload;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`面板服务没有在限定时间内就绪：${stderr}`);
}

try {
  const health = await waitForHealth();
  const runtimeAdapter = createPanelCodexRuntimeAdapter({
    request: async (path, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: options.method || "GET",
        headers: options.body === undefined ? undefined : { "content-type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error || `HTTP ${response.status}`);
        error.code = payload.code;
        throw error;
      }
      return payload;
    }
  });
  const probeResponse = await fetch(`http://127.0.0.1:${port}/api/codex/app-server/probe`, { method: "POST" });
  const probe = await probeResponse.json();
  const skillsResponse = await fetch(`http://127.0.0.1:${port}/api/codex/app-server/skills`);
  const skills = await skillsResponse.json();
  const threadsResponse = await fetch(`http://127.0.0.1:${port}/api/codex/app-server/threads?limit=1`);
  const threads = await threadsResponse.json();
  const sampleThreadId = String(threads?.result?.data?.[0]?.id || "").trim();
  let threadStateReadable = true;
  if (sampleThreadId) {
    const threadState = await runtimeAdapter.readThread(sampleThreadId);
    threadStateReadable = threadState.threadId === sampleThreadId
      && threadState.runtimeOwner === "standalone-appserver";
  }
  const result = {
    health: Boolean(health.ok),
    appServer: Boolean(probe?.appServer?.ok),
    command: probe?.appServer?.runtime?.command || "",
    commandSource: probe?.appServer?.runtime?.commandSource || "",
    skillCount: Array.isArray(skills?.skills) ? skills.skills.length : 0,
    threadListReadable: Array.isArray(threads?.result?.data),
    threadStateReadable,
    error: probe?.appServer?.error || (skillsResponse.ok ? null : skills)
  };
  console.log(JSON.stringify(result, null, 2));
  if (!probeResponse.ok || !skillsResponse.ok || !threadsResponse.ok
    || !result.appServer || !result.threadListReadable || !result.threadStateReadable) process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill();
  await new Promise((resolvePromise) => {
    if (child.exitCode !== null) return resolvePromise();
    child.once("exit", resolvePromise);
    setTimeout(resolvePromise, 2_000);
  });
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  if (resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}\\`)
    && resolvedTemporaryRoot.includes("jira-codex-app-server-probe-")) {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}
