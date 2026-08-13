import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AUTOMATION_SET_MONITOR_TOOL,
  AUTOMATION_STATUS_TOOL,
  CODEX_BIND_ISSUE_TOOL,
  CODEX_CLEAR_BINDING_TOOL,
  CODEX_CREATE_ISSUE_ANALYSIS_TOOL,
  CODEX_LIST_THREADS_TOOL,
  CODEX_OPEN_BOUND_THREAD_TOOL,
  JIRA_ATTACHMENT_PREVIEW_TOOL,
  JIRA_EXECUTE_TRANSITION_TOOL,
  JIRA_ISSUE_DETAIL_TOOL,
  JIRA_LIST_SHEETS_TOOL,
  JIRA_LIST_TRANSITIONS_TOOL,
  JIRA_PREPARE_TRANSITION_TOOL,
  JIRA_SHEET_ISSUES_TOOL,
  JIRA_TASK_BOARD_RESOURCE_URI,
  JIRA_TASK_BOARD_TOOL,
  SVN_ABANDON_REVIEW_TOOL,
  SVN_CANCEL_REVIEW_TOOL,
  SVN_COMMIT_REVIEW_TOOL,
  SVN_CONFIRM_COMMITTED_TOOL,
  SVN_CONFIRM_REVIEW_TOOL,
  SVN_CREATE_REVIEW_TOOL,
  SVN_GET_REVIEW_TOOL,
  SVN_INSPECT_CHANGES_TOOL,
  SVN_OPEN_EXTERNAL_DIFF_TOOL,
  SVN_PREVIEW_DIFF_TOOL,
  SVN_RECONCILE_COMMIT_TOOL,
  UPDATE_STATUS_TOOL
} from "../mcp/jira-task-board-mcp.mjs";

const endpoint = new URL(process.env.JIRA_CODEX_MCP_URL || "http://127.0.0.1:47823/mcp");
const client = new Client({ name: "jira-codex-plugin-probe", version: "2.0.0" });
const expectedTools = [
  AUTOMATION_SET_MONITOR_TOOL,
  AUTOMATION_STATUS_TOOL,
  CODEX_BIND_ISSUE_TOOL,
  CODEX_CLEAR_BINDING_TOOL,
  CODEX_CREATE_ISSUE_ANALYSIS_TOOL,
  CODEX_LIST_THREADS_TOOL,
  CODEX_OPEN_BOUND_THREAD_TOOL,
  JIRA_ATTACHMENT_PREVIEW_TOOL,
  JIRA_EXECUTE_TRANSITION_TOOL,
  JIRA_ISSUE_DETAIL_TOOL,
  JIRA_LIST_SHEETS_TOOL,
  JIRA_LIST_TRANSITIONS_TOOL,
  JIRA_PREPARE_TRANSITION_TOOL,
  JIRA_SHEET_ISSUES_TOOL,
  JIRA_TASK_BOARD_TOOL,
  SVN_ABANDON_REVIEW_TOOL,
  SVN_CANCEL_REVIEW_TOOL,
  SVN_COMMIT_REVIEW_TOOL,
  SVN_CONFIRM_COMMITTED_TOOL,
  SVN_CONFIRM_REVIEW_TOOL,
  SVN_CREATE_REVIEW_TOOL,
  SVN_GET_REVIEW_TOOL,
  SVN_INSPECT_CHANGES_TOOL,
  SVN_OPEN_EXTERNAL_DIFF_TOOL,
  SVN_PREVIEW_DIFF_TOOL,
  SVN_RECONCILE_COMMIT_TOOL,
  UPDATE_STATUS_TOOL
].sort();

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const listed = await client.listTools();
  const actualTools = listed.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    const missingTools = expectedTools.filter((toolName) => !actualTools.includes(toolName));
    const unexpectedTools = actualTools.filter((toolName) => !expectedTools.includes(toolName));
    throw new Error([
      "MCP 工具列表与探针预期不一致。",
      `缺失：${missingTools.join(", ") || "无"}`,
      `多出：${unexpectedTools.join(", ") || "无"}`
    ].join(" "));
  }
  const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
  for (const toolName of [AUTOMATION_STATUS_TOOL, CODEX_LIST_THREADS_TOOL, JIRA_ATTACHMENT_PREVIEW_TOOL, JIRA_TASK_BOARD_TOOL, JIRA_ISSUE_DETAIL_TOOL, JIRA_LIST_SHEETS_TOOL, JIRA_SHEET_ISSUES_TOOL, JIRA_LIST_TRANSITIONS_TOOL, SVN_GET_REVIEW_TOOL, SVN_INSPECT_CHANGES_TOOL, SVN_OPEN_EXTERNAL_DIFF_TOOL, SVN_PREVIEW_DIFF_TOOL]) {
    if (byName[toolName].annotations?.readOnlyHint !== true) throw new Error(`${toolName} 缺少 readOnlyHint=true。`);
  }
  if (byName[UPDATE_STATUS_TOOL].annotations?.readOnlyHint !== true
    || byName[UPDATE_STATUS_TOOL].annotations?.openWorldHint !== true) {
    throw new Error(`${UPDATE_STATUS_TOOL} 必须标记为读取 GitHub 的只读开放世界工具。`);
  }
  for (const toolName of [AUTOMATION_SET_MONITOR_TOOL, CODEX_CREATE_ISSUE_ANALYSIS_TOOL]) {
    if (byName[toolName].annotations?.openWorldHint !== true) {
      throw new Error(`${toolName} 必须标记外部写操作。`);
    }
  }
  if (byName[JIRA_EXECUTE_TRANSITION_TOOL].annotations?.openWorldHint !== true) {
    throw new Error(`${JIRA_EXECUTE_TRANSITION_TOOL} 必须标记外部写操作。`);
  }
  if (byName[SVN_COMMIT_REVIEW_TOOL].annotations?.openWorldHint !== true
    || byName[SVN_COMMIT_REVIEW_TOOL].annotations?.destructiveHint !== true) {
    throw new Error(`${SVN_COMMIT_REVIEW_TOOL} 必须标记高风险外部写操作。`);
  }

  const result = await client.callTool({
    name: JIRA_TASK_BOARD_TOOL,
    arguments: { includeCompleted: true, limitPerType: 2 }
  });
  if (result.isError || !result.structuredContent?.counts) {
    throw new Error(result.content?.[0]?.text || "任务工具没有返回结构化统计。");
  }
  const sampleIssueKey = result.structuredContent.active?.requirements?.[0]?.key
    || result.structuredContent.active?.bugs?.[0]?.key
    || "";
  let sample = null;
  if (sampleIssueKey) {
    const detail = await client.callTool({ name: JIRA_ISSUE_DETAIL_TOOL, arguments: { issueKey: sampleIssueKey } });
    const transitions = await client.callTool({ name: JIRA_LIST_TRANSITIONS_TOOL, arguments: { issueKey: sampleIssueKey } });
    if (detail.isError || detail.structuredContent?.issue?.key !== sampleIssueKey) {
      throw new Error(`${sampleIssueKey} 详情只读链路不可用。`);
    }
    if (transitions.isError || !Array.isArray(transitions.structuredContent?.transitions)) {
      throw new Error(`${sampleIssueKey} 状态流转只读链路不可用。`);
    }
    sample = {
      issueKey: sampleIssueKey,
      status: detail.structuredContent.issue.statusName,
      transitionCount: transitions.structuredContent.transitions.length
    };
  }
  const threadResult = await client.callTool({ name: CODEX_LIST_THREADS_TOOL, arguments: { limit: 3 } });
  if (threadResult.isError || !Array.isArray(threadResult.structuredContent?.threads)) {
    throw new Error("官方 App Server 会话列表无法通过 MCP 工作台读取。");
  }
  const automationResult = await client.callTool({ name: AUTOMATION_STATUS_TOOL, arguments: {} });
  if (automationResult.isError || automationResult.structuredContent?.view !== "automationStatus") {
    throw new Error("本地服务持有的 Bug 自动监控状态无法通过 MCP 工作台读取。");
  }
  const boundTask = [
    ...(result.structuredContent.active?.requirements || []),
    ...(result.structuredContent.active?.bugs || []),
    ...(result.structuredContent.completed?.requirements || []),
    ...(result.structuredContent.completed?.bugs || [])
  ].find((task) => task.binding?.threadId);
  let svnProbe = { attempted: false, reason: "本次截断结果中没有已关联会话的 Jira 任务" };
  if (boundTask?.key) {
    try {
      const inspected = await client.callTool({ name: SVN_INSPECT_CHANGES_TOOL, arguments: { issueKey: boundTask.key } });
      svnProbe = inspected.isError
        ? { attempted: true, ok: false, issueKey: boundTask.key, error: inspected.content?.[0]?.text || "SVN 检查失败" }
        : { attempted: true, ok: true, issueKey: boundTask.key, changeCount: inspected.structuredContent?.context?.changes?.length || 0 };
    } catch (error) {
      svnProbe = { attempted: true, ok: false, issueKey: boundTask.key, error: error.message || String(error) };
    }
  }
  const resource = await client.readResource({ uri: JIRA_TASK_BOARD_RESOURCE_URI });
  const html = resource.contents?.[0];
  if (html?.mimeType !== "text/html;profile=mcp-app" || !html.text?.includes("ui/initialize") || !html.text?.includes("Jira Sheets")) {
    throw new Error("MCP Apps 工作台 UI Resource 不完整。");
  }

  console.log(JSON.stringify({
    ok: true,
    endpoint: endpoint.href,
    tools: actualTools,
    counts: result.structuredContent.counts,
    sample,
    bindableThreadCount: threadResult.structuredContent.threads.length,
    bugMonitor: {
      owner: automationResult.structuredContent.automation?.monitorOwner || "unknown",
      enabled: automationResult.structuredContent.automation?.monitorEnabled === true,
      schedulerRunning: automationResult.structuredContent.automation?.schedulerRunning === true
    },
    svnProbe,
    uiResource: JIRA_TASK_BOARD_RESOURCE_URI,
    uiMimeType: html.mimeType
  }, null, 2));
} finally {
  await client.close();
}
