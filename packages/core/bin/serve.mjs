import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCoreService } from "../index.mjs";

const VERSION = "0.31.8";
const host = process.env.JIRA_WORKBENCH_HOST || "127.0.0.1";
const port = Number(process.env.JIRA_WORKBENCH_PORT || 47823);
const uiHtmlFile = fileURLToPath(import.meta.resolve("../mcp/ui/task-board.html"));

const core = createCoreService({ version: VERSION });

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    const config = await core.configStore.getPublic();
    return json(response, 200, {
      ok: true,
      name: "jira-workbench-core",
      version: core.version,
      jiraConfigured: config.configured
    });
  }

  if (url.pathname === "/mcp") {
    await core.handleMcp(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/mcp-app.html") {
    const uiHtml = (await readFile(uiHtmlFile, "utf8")).replaceAll("__JIRA_WORKBENCH_VERSION__", core.version);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return response.end(uiHtml);
  }

  return json(response, 404, { error: "Not Found" });
});

server.listen(port, host, () => {
  console.log(`jira-workbench core listening on http://${host}:${port}`);
});
