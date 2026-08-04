import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ConfigurationError,
  createConfigStore,
  DASHBOARD_ACTIVE_JQL,
  DASHBOARD_COMPLETED_JQL,
  DEFAULT_JQL
} from "./config-store.mjs";
import { JiraApiError, createJiraClient } from "./jira-client.mjs";
import { createJxlClient } from "./jxl-client.mjs";
import { materializeAttachment } from "./lib/attachment-cache.mjs";
import { createAutomationManager } from "./lib/automation-manager.mjs";
import { createCodexSessionReader } from "./lib/codex-session-reader.mjs";

const VERSION = "0.16.1";
const host = process.env.JIRA_POC_HOST || "127.0.0.1";
const port = Number(process.env.JIRA_POC_PORT || 47823);
const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const configStore = createConfigStore();
const attachmentCacheRoot = join(dirname(configStore.configFile), "attachments");
const jira = createJiraClient();
const jxl = createJxlClient();
const sessionsRoot = process.env.CODEX_SESSIONS_DIR
  || join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
const automation = createAutomationManager({
  stateFile: process.env.JIRA_CODEX_AUTOMATION_FILE || join(dirname(configStore.configFile), "automation.json"),
  configStore,
  sessionReader: createCodexSessionReader({ sessionsRoot })
});

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/prompt-builder.js", ["prompt-builder.js", "text/javascript; charset=utf-8"]],
  ["/issue-views.js", ["issue-views.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) {
      throw new ConfigurationError("配置请求内容过大。", { code: "REQUEST_TOO_LARGE", statusCode: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ConfigurationError("请求不是有效的 JSON。", { code: "INVALID_JSON" });
  }
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    const config = await configStore.getPublic();
    return json(response, 200, {
      ok: true,
      name: "jira-codex-panel-poc",
      version: VERSION,
      jiraConfigured: config.configured
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return json(response, 200, { config: await configStore.getPublic() });
  }

  if (request.method === "PUT" && url.pathname === "/api/config") {
    const candidate = await configStore.prepare(await readJson(request));
    await jira.fetchIssues(candidate, { maxResults: 1 });
    const config = await configStore.save(candidate);
    return json(response, 200, { config, connection: { ok: true } });
  }

  if (request.method === "DELETE" && url.pathname === "/api/config") {
    await configStore.clear();
    return json(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/automation/status") {
    const config = await configStore.getPublic();
    return json(response, 200, {
      monitorEnabled: config.bugMonitorEnabled,
      monitorGeneration: config.monitorGeneration,
      wecomConfigured: config.wecomConfigured,
      ...(await automation.getStatus())
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/monitor") {
    const input = await readJson(request);
    const config = await configStore.setBugMonitorEnabled(input.enabled);
    return json(response, 200, {
      config,
      automation: {
        monitorEnabled: config.bugMonitorEnabled,
        monitorGeneration: config.monitorGeneration,
        wecomConfigured: config.wecomConfigured,
        ...(await automation.getStatus())
      }
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/jobs") {
    const input = await readJson(request);
    return json(response, 200, {
      job: await automation.register(input),
      automation: await automation.getStatus()
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/jobs/fail") {
    const input = await readJson(request);
    return json(response, 200, {
      job: await automation.fail(input),
      automation: await automation.getStatus()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/issues") {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const result = config.jql === DEFAULT_JQL
      ? await jira.fetchTaskBoardIssues(config, {
        activeJql: DASHBOARD_ACTIVE_JQL,
        completedJql: DASHBOARD_COMPLETED_JQL
      })
      : await jira.fetchIssues(config);
    return json(response, 200, result);
  }

  if (request.method === "GET" && url.pathname === "/api/jxl/sheets") {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    return json(response, 200, await jxl.listSheets(config));
  }

  const jxlSheetIssuesMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/jxl\/sheets\/(\d+)\/([A-Za-z0-9_-]+)\/issues$/)
    : null;
  if (jxlSheetIssuesMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const sheet = await jxl.getSheet(config, {
      projectId: jxlSheetIssuesMatch[1],
      sheetId: jxlSheetIssuesMatch[2]
    });
    if (!sheet) {
      throw new JiraApiError("JXL Sheet 不存在或当前用户无权查看。", {
        code: "JXL_SHEET_NOT_FOUND",
        upstreamStatus: 404
      });
    }
    if (sheet._scope?.type !== "jql" || !sheet._scope.value) {
      throw new JiraApiError("当前 JXL Sheet 不是 JQL 范围，暂时只能在 Jira 中打开。", {
        code: "JXL_SCOPE_UNSUPPORTED",
        upstreamStatus: 400
      });
    }
    const { _scope, ...sheetInfo } = sheet;
    const result = await jira.fetchIssues({ ...config, jql: _scope.value });
    return json(response, 200, { ...result, sheet: sheetInfo });
  }

  const attachmentMaterializeMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/attachments\/(\d+)\/materialize$/)
    : null;
  if (attachmentMaterializeMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const attachmentId = attachmentMaterializeMatch[1];
    const attachment = await jira.fetchAttachment(config, attachmentId);
    const materialized = await materializeAttachment({
      cacheRoot: attachmentCacheRoot,
      attachmentId,
      attachment
    });
    return json(response, 200, { attachment: materialized });
  }

  const attachmentMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/attachments\/(\d+)$/)
    : null;
  if (attachmentMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const attachment = await jira.fetchAttachment(config, attachmentMatch[1], {
      thumbnail: url.searchParams.get("thumbnail") === "1"
    });
    const disposition = attachment.thumbnail
      ? "inline"
      : `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`;
    const headers = {
      "content-type": attachment.contentType,
      "content-disposition": disposition,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    };
    if (attachment.contentLength) headers["content-length"] = attachment.contentLength;
    response.writeHead(200, headers);
    if (!attachment.body) return response.end();
    Readable.fromWeb(attachment.body).pipe(response);
    return;
  }

  return false;
}

async function serveStatic(request, response, url) {
  const staticFile = request.method === "GET" ? staticFiles.get(url.pathname) : null;
  if (!staticFile) return json(response, 404, { error: "Not found", code: "NOT_FOUND" });

  const [fileName, contentType] = staticFile;
  const filePath = join(publicDir, fileName);
  const fileStat = await stat(filePath);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": fileStat.size,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
  createReadStream(filePath).pipe(response);
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(request, response, url);
    if (handled !== false) return;
  }
  await serveStatic(request, response, url);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const known = error instanceof ConfigurationError || error instanceof JiraApiError;
    const statusCode = known ? error.statusCode : 500;
    console.error(`[jira-poc] ${request.method} ${request.url}: ${error.code || error.name}: ${error.message}`);
    if (response.headersSent) return response.destroy(error);
    json(response, statusCode, {
      error: known ? error.message : "本地 Jira 服务发生内部错误。",
      code: error.code || "INTERNAL_ERROR",
      upstreamStatus: error.upstreamStatus || undefined,
      details: error.details || undefined
    });
  });
});

server.listen(port, host, () => {
  automation.start();
  console.log(`[jira-poc] panel server: http://${host}:${port}`);
  console.log(`[jira-poc] credential store: ${configStore.configFile}`);
});

function shutdown() {
  automation.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
