import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLocalApprovalProvider } from "../lib/approval-provider.mjs";
import {
  buildToolDefinitions,
  JIRA_TASK_BOARD_TOOL,
  JIRA_ISSUE_DETAIL_TOOL,
  JIRA_ATTACHMENT_PREVIEW_TOOL,
  JIRA_LIST_SHEETS_TOOL,
  JIRA_SHEET_ISSUES_TOOL,
  JIRA_LIST_TRANSITIONS_TOOL,
  JIRA_PREPARE_TRANSITION_TOOL,
  JIRA_EXECUTE_TRANSITION_TOOL,
  CODEX_LIST_THREADS_TOOL,
  CODEX_BIND_ISSUE_TOOL,
  CODEX_CLEAR_BINDING_TOOL,
  CODEX_OPEN_BOUND_THREAD_TOOL,
  CODEX_CREATE_ISSUE_ANALYSIS_TOOL,
  AUTOMATION_STATUS_TOOL,
  AUTOMATION_SET_MONITOR_TOOL,
  UPDATE_STATUS_TOOL,
  UPDATE_DOWNLOAD_TOOL,
  UPDATE_CANCEL_DOWNLOAD_TOOL,
  UPDATE_RESTART_TOOL,
  SVN_INSPECT_CHANGES_TOOL,
  SVN_PREVIEW_DIFF_TOOL,
  SVN_OPEN_EXTERNAL_DIFF_TOOL,
  SVN_CREATE_REVIEW_TOOL,
  SVN_GET_REVIEW_TOOL,
  SVN_CANCEL_REVIEW_TOOL,
  SVN_CONFIRM_REVIEW_TOOL,
  SVN_COMMIT_REVIEW_TOOL,
  SVN_RECONCILE_COMMIT_TOOL,
  SVN_CONFIRM_COMMITTED_TOOL,
  SVN_ABANDON_REVIEW_TOOL,
  JIRA_TASK_BOARD_RESOURCE_URI,
  buildTaskBoardSnapshot,
  buildIssueDetailSnapshot,
  buildSheetsSnapshot,
  buildSheetIssuesSnapshot
} from "../tools.mjs";

// 工具名常量、snapshot 构建器与工具面定义的真身在 tools.mjs（host-agnostic）。
// 本文件只保留 MCP 协议层：re-export 保持既有 import 路径不变，遍历工具面注册。
export {
  JIRA_TASK_BOARD_TOOL,
  JIRA_ISSUE_DETAIL_TOOL,
  JIRA_ATTACHMENT_PREVIEW_TOOL,
  JIRA_LIST_SHEETS_TOOL,
  JIRA_SHEET_ISSUES_TOOL,
  JIRA_LIST_TRANSITIONS_TOOL,
  JIRA_PREPARE_TRANSITION_TOOL,
  JIRA_EXECUTE_TRANSITION_TOOL,
  CODEX_LIST_THREADS_TOOL,
  CODEX_BIND_ISSUE_TOOL,
  CODEX_CLEAR_BINDING_TOOL,
  CODEX_OPEN_BOUND_THREAD_TOOL,
  CODEX_CREATE_ISSUE_ANALYSIS_TOOL,
  AUTOMATION_STATUS_TOOL,
  AUTOMATION_SET_MONITOR_TOOL,
  UPDATE_STATUS_TOOL,
  UPDATE_DOWNLOAD_TOOL,
  UPDATE_CANCEL_DOWNLOAD_TOOL,
  UPDATE_RESTART_TOOL,
  SVN_INSPECT_CHANGES_TOOL,
  SVN_PREVIEW_DIFF_TOOL,
  SVN_OPEN_EXTERNAL_DIFF_TOOL,
  SVN_CREATE_REVIEW_TOOL,
  SVN_GET_REVIEW_TOOL,
  SVN_CANCEL_REVIEW_TOOL,
  SVN_CONFIRM_REVIEW_TOOL,
  SVN_COMMIT_REVIEW_TOOL,
  SVN_RECONCILE_COMMIT_TOOL,
  SVN_CONFIRM_COMMITTED_TOOL,
  SVN_ABANDON_REVIEW_TOOL,
  JIRA_TASK_BOARD_RESOURCE_URI,
  buildTaskBoardSnapshot,
  buildIssueDetailSnapshot,
  buildSheetsSnapshot,
  buildSheetIssuesSnapshot
};

const uiHtmlPromise = readFile(new URL("./ui/task-board.html", import.meta.url), "utf8");

export function createJiraTaskBoardMcpServer({
  workbench,
  conversations,
  svn,
  automation,
  updates,
  desktop,
  loadIssues,
  approvalProvider = createLocalApprovalProvider(),
  version = "0.1.0",
  serverName = "jira-workbench"
} = {}) {
  const service = workbench || (typeof loadIssues === "function" ? { listTasks: loadIssues } : null);
  if (!service?.listTasks) throw new TypeError("workbench.listTasks 必须是函数。");

  const server = new McpServer(
    { name: serverName, version },
    { instructions: "通过工具查看当前用户的 Jira 待办、历史、JXL Sheets、任务详情、Codex 会话绑定与 SVN 审核状态。只读工具不会修改外部状态；Jira 状态流转、本地绑定写入和 SVN 提交必须经过用户在交互面板中的明确确认，并由服务端复检。SVN 提交只能使用已审核的显式路径与一次性确认。UI 已展示完整结构化结果，除非用户明确要求，否则不要重复输出长列表。" }
  );

  server.registerResource(
    "jira-workbench",
    JIRA_TASK_BOARD_RESOURCE_URI,
    {
      title: "Jira 任务工作台",
      description: "查看待办、历史、JXL Sheets、任务详情、会话关联状态与 SVN 审核提交。",
      mimeType: "text/html;profile=mcp-app"
    },
    async () => ({
      contents: [{
        uri: JIRA_TASK_BOARD_RESOURCE_URI,
        mimeType: "text/html;profile=mcp-app",
        text: (await uiHtmlPromise).replaceAll("__JIRA_WORKBENCH_VERSION__", version),
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [] }
          }
        }
      }]
    })
  );

  for (const definition of buildToolDefinitions({
    service,
    conversations,
    svn,
    automation,
    updates,
    desktop,
    approvalProvider
  })) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
        _meta: definition._meta
      },
      definition.handler
    );
  }

  return server;
}

function jsonRpcError(response, statusCode, message) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function loopbackRequest(request) {
  const address = String(request.socket?.remoteAddress || "").toLowerCase();
  const remoteIsLoopback = address === "::1" || address === "127.0.0.1" || address.startsWith("::ffff:127.");
  if (!remoteIsLoopback) return false;
  try {
    const hostname = new URL(`http://${request.headers.host || ""}`).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  } catch {
    return false;
  }
}

async function readRequestBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("MCP 请求内容过大。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createJiraTaskBoardMcpHttpHandler(options = {}) {
  const resolveOptions = typeof options === "function" ? options : () => options;
  const approvalProvider = (typeof options === "function" ? null : options.approvalProvider || options.confirmations)
    || createLocalApprovalProvider();
  return async function handleJiraTaskBoardMcp(request, response) {
    if (!loopbackRequest(request)) return jsonRpcError(response, 403, "Jira MCP 仅允许本机访问。");
    if (request.method !== "POST") return jsonRpcError(response, 405, "此无状态 MCP 端点仅接受 POST。");

    const requestOptions = resolveOptions(request) || {};
    const server = createJiraTaskBoardMcpServer({ ...requestOptions, approvalProvider });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    const close = () => {
      void transport.close();
      void server.close();
    };
    response.once("close", close);

    try {
      const body = await readRequestBody(request);
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) jsonRpcError(response, 500, error instanceof Error ? error.message : "MCP 请求失败。");
    }
  };
}
