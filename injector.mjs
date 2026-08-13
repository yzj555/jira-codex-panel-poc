import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
const bridgeProtocolVersion = "2";
const [
  clientSource,
  navigationSource,
  applicationCommandsSource,
  panelHtml,
  panelStyles,
  panelAppSource,
  promptBuilderSource,
  issueViewsSource
] = await Promise.all([
  readFile(join(root, "inject", "client.js"), "utf8"),
  readFile(join(root, "lib", "codex-navigation.mjs"), "utf8"),
  readFile(join(root, "lib", "codex-application-commands.mjs"), "utf8"),
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
const applicationCommandHelpers = applicationCommandsSource.replace(
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
const clientWithApplicationCommands = clientWithNavigation.replace(
  "/*__JIRA_CODEX_APPLICATION_COMMANDS__*/",
  applicationCommandHelpers
);
if (clientWithApplicationCommands === clientWithNavigation) {
  throw new Error("Injector client is missing the Codex Application Commands marker.");
}
const compiledClientSource = clientWithApplicationCommands;
const panelDocument = createEmbeddedPanelDocument({
  html: panelHtml,
  styles: panelStyles,
  appSource: panelAppSource,
  promptBuilderSource,
  issueViewsSource,
  panelUrl
});
const injectionRevision = createHash("sha256")
  .update(compiledClientSource)
  .update(panelDocument)
  .update(bridgeProtocolVersion)
  .digest("hex")
  .slice(0, 16);
const source = [
  `window.__JIRA_CODEX_POC_INJECTION_REVISION__ = ${JSON.stringify(injectionRevision)};`,
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

async function sendBridgeResult(cdp, payload) {
  await cdp.send("Runtime.evaluate", {
    expression: `window.__jiraCodexResolveHostFetch?.(${JSON.stringify(payload)})`,
    returnByValue: false
  });
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
    const accept = request.headers?.accept || request.headers?.Accept;
    if (accept) headers.set("accept", String(accept));
    const desktopClientId = String(request.headers?.["x-jira-codex-desktop-client"] || "").trim();
    if (desktopClientId && /^[A-Za-z0-9._:-]{1,160}$/.test(desktopClientId)) {
      headers.set("x-jira-codex-desktop-client", desktopClientId);
    }
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
    const current = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        // The injector process owns the bridge token. Refresh transport globals on
        // every pass even when the UI revision is already current, otherwise a
        // service restart leaves the live page sending the retired token forever.
        window.__JIRA_CODEX_POC_PANEL_URL__ = ${JSON.stringify(panelUrl)};
        window.__JIRA_CODEX_BRIDGE_BINDING__ = ${JSON.stringify(bridgeBindingName)};
        window.__JIRA_CODEX_BRIDGE_TOKEN__ = ${JSON.stringify(bridgeToken)};
        const host = window.__jiraCodexPoc;
        if (window.__JIRA_CODEX_POC_INJECTION_REVISION__ !== ${JSON.stringify(injectionRevision)}
          || host?.revision !== ${JSON.stringify(injectionRevision)}) return { upToDate: false };
        host.ensure?.();
        return { upToDate: true, state: host.state?.() || null };
      })()`,
      returnByValue: true
    });
    if (current.result?.value?.upToDate) {
      console.log(`[jira-poc] current ${target.id} ${target.url} ${JSON.stringify(current.result.value.state || {})}`);
      return;
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
