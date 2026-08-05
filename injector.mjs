import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, listPageTargets } from "./lib/cdp.mjs";
import { createEmbeddedPanelDocument } from "./lib/panel-document.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const watch = !args.has("--once");
const cdpPort = Number(process.env.CODEX_CDP_PORT || 47824);
const panelUrl = process.env.JIRA_POC_PANEL_URL || "http://127.0.0.1:47823/";
const bridgeBindingName = "__jiraCodexNodeRequest";
const bridgeToken = randomUUID();
const [clientSource, navigationSource, panelHtml, panelStyles, panelAppSource, promptBuilderSource, issueViewsSource] = await Promise.all([
  readFile(join(root, "inject", "client.js"), "utf8"),
  readFile(join(root, "lib", "codex-navigation.mjs"), "utf8"),
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "prompt-builder.js"), "utf8"),
  readFile(join(root, "public", "issue-views.js"), "utf8")
]);
const navigationHelpers = navigationSource.replace(
  /\bexport\s+(?=(?:const|function|class|async\s+function)\b)/g,
  ""
);
const promptHelpers = promptBuilderSource.replace(
  /\bexport\s+(?=(?:const|function|class|async\s+function)\b)/g,
  ""
);
const clientWithNavigation = clientSource.replace(
  "/*__JIRA_CODEX_NAVIGATION_HELPERS__*/",
  navigationHelpers
);
if (clientWithNavigation === clientSource) {
  throw new Error("Injector client is missing the Codex navigation helper marker.");
}
const compiledClientSource = clientWithNavigation.replace(
  "/*__JIRA_CODEX_PROMPT_HELPERS__*/",
  promptHelpers
);
if (compiledClientSource === clientWithNavigation) {
  throw new Error("Injector client is missing the Jira prompt helper marker.");
}
const panelDocument = createEmbeddedPanelDocument({
  html: panelHtml,
  styles: panelStyles,
  appSource: panelAppSource,
  promptBuilderSource,
  issueViewsSource,
  panelUrl
});
const source = [
  `window.__JIRA_CODEX_POC_PANEL_URL__ = ${JSON.stringify(panelUrl)};`,
  `window.__JIRA_CODEX_POC_PANEL_DOCUMENT__ = ${JSON.stringify(panelDocument)};`,
  `window.__JIRA_CODEX_BRIDGE_BINDING__ = ${JSON.stringify(bridgeBindingName)};`,
  `window.__JIRA_CODEX_BRIDGE_TOKEN__ = ${JSON.stringify(bridgeToken)};`,
  compiledClientSource
].join("\n");
const registeredTargets = new Set();
const targetSessions = new Map();
const panelOrigin = new URL(panelUrl).origin;
const allowedBridgeMethods = new Set(["GET", "POST", "PUT", "DELETE"]);
const maxBridgeRequestBytes = 128 * 1024;
const maxBridgeResponseBytes = 50 * 1024 * 1024;
const attachmentCacheRoot = resolve(process.env.LOCALAPPDATA || "", "jira-codex-panel-poc", "attachments");

async function sendBridgeResult(cdp, payload) {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__jiraCodexResolveHostFetch?.(${JSON.stringify(payload)})`,
    returnByValue: false
  });
}

function bridgeJsonResult(id, status, payload) {
  return {
    id,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: { "content-type": "application/json; charset=utf-8" },
    bodyBase64: Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  };
}

async function validatedAttachmentPaths(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new Error("Attachment path count is invalid.");
  }
  const paths = [];
  for (const value of values) {
    const filePath = resolve(String(value || ""));
    const relativePath = relative(attachmentCacheRoot, filePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Attachment path is outside the Jira attachment cache.");
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Attachment path is not a file.");
    paths.push(filePath);
  }
  return paths;
}

async function attachFilesToInput(cdp, request, id) {
  const inputId = String(request.inputId || "");
  if (!/^jira-codex-attachment-input-[0-9a-f-]{36}$/i.test(inputId)) {
    throw new Error("Attachment input identifier is invalid.");
  }
  const paths = await validatedAttachmentPaths(request.paths);
  await cdp.send("DOM.enable");
  const documentNode = await cdp.send("DOM.getDocument", { depth: 1, pierce: true });
  const inputNode = await cdp.send("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: `#${inputId}`
  });
  if (!inputNode.nodeId) throw new Error("Attachment input was not found in Codex.");
  await cdp.send("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: paths });
  await cdp.send("Runtime.evaluate", {
    expression: `(() => { const input = document.getElementById(${JSON.stringify(inputId)}); if (input && input.files?.length) input.dispatchEvent(new Event("change", { bubbles: true })); })()`
  });
  await sendBridgeResult(cdp, bridgeJsonResult(id, 200, { ok: true, count: paths.length }));
}

async function handleBridgeRequest(cdp, event) {
  if (event.name !== bridgeBindingName) return;
  let request;
  try {
    request = JSON.parse(event.payload || "{}");
  } catch {
    return;
  }
  const id = String(request.id || "");
  if (!id || request.token !== bridgeToken) return;

  try {
    if (request.action === "attach-files") {
      await attachFilesToInput(cdp, request, id);
      return;
    }
    const url = new URL(String(request.url || ""), panelUrl);
    if (url.origin !== panelOrigin) throw new Error("Bridge URL origin is not allowed.");
    const method = String(request.method || "GET").toUpperCase();
    if (!allowedBridgeMethods.has(method)) throw new Error(`Bridge method ${method} is not allowed.`);
    const body = request.body == null ? null : String(request.body);
    if (body && Buffer.byteLength(body, "utf8") > maxBridgeRequestBytes) {
      throw new Error("Bridge request body is too large.");
    }
    const headers = new Headers();
    const contentType = request.headers?.["content-type"] || request.headers?.["Content-Type"];
    if (contentType) headers.set("content-type", String(contentType));
    const response = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : body,
      redirect: "error",
      signal: AbortSignal.timeout(90_000)
    });
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxBridgeResponseBytes) throw new Error("Bridge response is too large.");
    const responseBytes = Buffer.from(await response.arrayBuffer());
    if (responseBytes.byteLength > maxBridgeResponseBytes) throw new Error("Bridge response is too large.");
    const responseHeaders = {};
    for (const name of ["content-type", "content-disposition", "content-length", "cache-control"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    await sendBridgeResult(cdp, {
      id,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: responseBytes.toString("base64")
    });
  } catch (error) {
    await sendBridgeResult(cdp, { id, error: error.message || String(error) });
  }
}

function closeTargetSession(targetId) {
  const session = targetSessions.get(targetId);
  session?.unsubscribeBinding?.();
  session?.cdp.close();
  targetSessions.delete(targetId);
  registeredTargets.delete(targetId);
}

async function getTargetSession(target) {
  const existing = targetSessions.get(target.id);
  if (existing?.webSocketDebuggerUrl === target.webSocketDebuggerUrl) return existing.cdp;
  if (existing) closeTargetSession(target.id);
  const cdp = await new CdpClient(target.webSocketDebuggerUrl).connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Runtime.addBinding", { name: bridgeBindingName });
  const unsubscribeBinding = cdp.on("Runtime.bindingCalled", (event) => {
    void handleBridgeRequest(cdp, event).catch((error) => {
      console.error(`[jira-poc] bridge error ${target.id}: ${error.message}`);
    });
  });
  targetSessions.set(target.id, {
    cdp,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    unsubscribeBinding
  });
  return cdp;
}

async function injectTarget(target) {
  const cdp = await getTargetSession(target);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.setBypassCSP", { enabled: true });
    if (!registeredTargets.has(target.id)) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
      registeredTargets.add(target.id);
    }
    const result = await cdp.send("Runtime.evaluate", {
      expression: source,
      awaitPromise: true,
      returnByValue: true
    });
    const value = result.result?.value;
    console.log(`[jira-poc] injected ${target.id} ${target.url}${value ? ` ${JSON.stringify(value)}` : ""}`);
  } catch (error) {
    closeTargetSession(target.id);
    throw error;
  }
}

async function runPass() {
  const allTargets = await listPageTargets(cdpPort);
  const exactMainTargets = allTargets.filter((target) => target.url === "app://-/index.html");
  const targets = exactMainTargets.length
    ? exactMainTargets
    : allTargets.filter((target) => target.url?.startsWith("app://-/index.html")
      && !target.url.includes("avatar-overlay"));
  const liveIds = new Set(targets.map((target) => target.id));
  for (const targetId of targetSessions.keys()) {
    if (!liveIds.has(targetId)) closeTargetSession(targetId);
  }
  for (const target of targets) {
    try {
      await injectTarget(target);
    } catch (error) {
      console.error(`[jira-poc] failed ${target.id}: ${error.message}`);
    }
  }
}

await runPass();
if (!watch) process.exit(0);

console.log(`[jira-poc] watching Codex CDP on 127.0.0.1:${cdpPort}`);
setInterval(() => {
  void runPass().catch((error) => console.error(`[jira-poc] watch error: ${error.message}`));
}, 2000);
