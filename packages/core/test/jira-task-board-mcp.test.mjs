import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  AUTOMATION_SET_MONITOR_TOOL,
  AUTOMATION_STATUS_TOOL,
  CODEX_BIND_ISSUE_TOOL,
  CODEX_CLEAR_BINDING_TOOL,
  CODEX_CREATE_ISSUE_ANALYSIS_TOOL,
  CODEX_LIST_THREADS_TOOL,
  CODEX_OPEN_BOUND_THREAD_TOOL,
  buildIssueDetailSnapshot,
  buildSheetIssuesSnapshot,
  buildSheetsSnapshot,
  buildTaskBoardSnapshot,
  createJiraTaskBoardMcpHttpHandler,
  createJiraTaskBoardMcpServer,
  JIRA_EXECUTE_TRANSITION_TOOL,
  JIRA_ATTACHMENT_PREVIEW_TOOL,
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
  UPDATE_CANCEL_DOWNLOAD_TOOL,
  UPDATE_DOWNLOAD_TOOL,
  UPDATE_RESTART_TOOL,
  UPDATE_STATUS_TOOL
} from "../mcp/jira-task-board-mcp.mjs";

const opened = [];

afterEach(async () => {
  while (opened.length) await opened.pop().close?.();
});

function issue(key, type, status = "todo") {
  return {
    key,
    type,
    typeName: type === "bug" ? "Bug" : "优化",
    title: `${key} 测试任务`,
    summary: `${key} 的完整描述`,
    status,
    statusName: status === "done" ? "已完成" : "待处理",
    priority: "High",
    assignee: "测试用户",
    collaborators: [{ displayName: "协同用户", active: true }],
    attachments: [{ id: "9", filename: "evidence.png", mimeType: "image/png", size: 2048 }],
    labels: ["test"],
    projectName: "测试项目",
    fixVersions: ["DevelopV4"],
    updated: "2026-08-11T10:00:00.000+0800",
    url: `http://jira.example.test/browse/${key}`
  };
}

function jiraResult() {
  const activeIssues = [issue("CT-1", "requirement"), issue("CT-2", "bug")];
  const completedIssues = [issue("CT-3", "requirement", "done")];
  return {
    issues: [...activeIssues, ...completedIssues],
    activeIssues,
    completedIssues,
    total: 3,
    truncated: false,
    fetchedAt: "2026-08-11T02:00:00.000Z",
    site: "http://jira.example.test",
    bindingState: {
      revision: 2,
      bindings: {
        "CT-1": { threadId: "thread-1", title: "分析 CT-1", runtimeOwner: "app-server", updatedAt: "2026-08-11T02:05:00.000Z" }
      }
    }
  };
}

function sheetsResult() {
  return {
    sheets: [{ id: "sheet-a", title: "迭代任务", description: "", projectId: "101", projectKey: "CT", projectName: "测试项目", scopeType: "jql", queryable: true, updatedAt: null, url: "http://jira/sheet-a", directoryUrl: "http://jira/directory" }],
    total: 1,
    fetchedAt: "2026-08-11T02:00:00.000Z",
    site: "http://jira.example.test",
    directoryUrl: "http://jira/directory"
  };
}

function workbench() {
  return {
    listTasks: async () => jiraResult(),
    getIssue: async (key) => ({ issue: jiraResult().issues.find((item) => item.key === key), binding: jiraResult().bindingState.bindings[key] || null, fetchedAt: jiraResult().fetchedAt }),
    getAttachmentPreview: async (key, attachmentId) => ({ issueKey: key, attachmentId, filename: "evidence.png", mimeType: "image/png", size: 4, thumbnail: true, dataUrl: "data:image/png;base64,AQIDBA==" }),
    listSheets: async () => sheetsResult(),
    getSheetIssues: async () => ({ ...jiraResult(), issues: jiraResult().activeIssues, total: 2, sheet: sheetsResult().sheets[0] }),
    listTransitions: async (key) => ({ key, fetchedAt: jiraResult().fetchedAt, transitions: [{ id: "4", name: "开始处理", to: { id: "3", name: "程序处理", group: "in_progress" }, requiresInput: false, requiredFields: [] }] }),
    executeTransition: async (key, transitionId) => ({ key, transitionId, transitionedAt: "2026-08-11T02:10:00.000Z" })
  };
}

function conversations() {
  let revision = 2;
  return {
    listThreads: async () => ({
      fetchedAt: jiraResult().fetchedAt,
      runtimeOwner: "standalone-appserver",
      bindingsRevision: revision,
      total: 1,
      threads: [{ id: "thread-2", title: "分析 CT-2", preview: "", cwd: "F:\\repo", updatedAt: null, status: "notLoaded", archived: false, boundIssueKeys: [] }]
    }),
    bindIssue: async ({ issueKey, threadId, expectedRevision }) => ({
      issueKey,
      binding: { threadId, threadTitle: "分析 CT-2", runtimeOwner: "standalone-appserver" },
      revision: ++revision,
      replacedIssueKeys: [],
      expectedRevision
    }),
    clearBinding: async ({ issueKey }) => ({ issueKey, binding: null, revision: ++revision })
  };
}

function automation() {
  let enabled = false;
  return {
    getStatus: async () => ({ monitorOwner: "local-service", schedulerRunning: true, monitorEnabled: enabled, queueLength: 0 }),
    setEnabled: async (value) => ({ monitorOwner: "local-service", schedulerRunning: true, monitorEnabled: (enabled = value), queueLength: 0 })
  };
}

function updates() {
  const update = {
    enabled: true,
    checked: true,
    currentVersion: "0.31.1",
    latestVersion: "0.32.0",
    updateAvailable: true,
    source: "release",
    sourceLabel: "GitHub Release",
    installable: true,
    url: "https://github.com/yzj555/jira-workbench/releases/tag/v0.32.0",
    checkedAt: "2026-08-13T00:00:00.000Z",
    error: ""
  };
  return {
    getStatus: async () => ({ update, installation: { state: "idle", canDownload: true } }),
    startDownload: async () => ({ update, installation: { state: "downloading", progress: 0 } }),
    cancelDownload: async () => ({ update, installation: { state: "cancelled", progress: 0 } }),
    restart: async () => ({ update, installation: { state: "restart_required", phase: "restarting", targetVersion: "0.32.0", restartRequired: true } })
  };
}

function desktop() {
  return {
    openIssueConversation: async (issueKey) => ({ opened: true, threadId: `thread-for-${issueKey}` }),
    createIssueAnalysis: async (issueKey) => ({ issueKey, threadId: `new-thread-for-${issueKey}`, turnId: "turn-1", issueSnapshot: buildIssueDetailSnapshot({ issue: issue(issueKey, "requirement"), binding: { threadId: `new-thread-for-${issueKey}` } }) })
  };
}

function svn() {
  const id = "00000000-0000-4000-8000-000000000001";
  const baseReview = {
    id,
    status: "manual_review",
    verdict: "pass",
    codexReviewEnabled: false,
    selectedPaths: ["src/a.go"],
    message: "http://jira/browse/CT-1\n-- test",
    workingCopy: { root: "F:\\repo", scopeRoot: "F:\\repo", scopeName: "repo" },
    mechanical: { verdict: "pass", blockers: [], warnings: [], notes: [] },
    crossTaskConflicts: []
  };
  return {
    context: async () => ({ context: { workingCopy: baseReview.workingCopy, changes: [{ path: "src/a.go", item: "modified", kind: "file", recommended: true }] }, message: baseReview.message, history: [], review: null }),
    previewDiff: async ({ path }) => ({ path, available: true, diff: "+new" }),
    openExternalDiff: async ({ path }) => ({ ok: true, path }),
    createReview: async () => ({ review: baseReview, dispatch: null }),
    getReview: async () => baseReview,
    cancelReview: async () => ({ ...baseReview, status: "cancelled" }),
    confirmReview: async () => ({ confirmationToken: "confirmation-token-1234567890", expiresAt: "2026-08-11T03:00:00.000Z" }),
    commitReview: async () => ({ ...baseReview, status: "committed", commit: { revision: "123" } }),
    reconcileCommit: async () => ({ ...baseReview, status: "committed", commit: { revision: "123" } }),
    confirmCommitted: async () => ({ ...baseReview, status: "committed", commit: { revision: "123" } }),
    abandonReview: async () => ({ ...baseReview, status: "abandoned" })
  };
}

test("工作台快照同时保留待办、历史和服务端绑定状态", () => {
  const snapshot = buildTaskBoardSnapshot(jiraResult());
  assert.equal(snapshot.scope, "active");
  assert.deepEqual(snapshot.active.requirements.map((task) => task.key), ["CT-1"]);
  assert.deepEqual(snapshot.active.bugs.map((task) => task.key), ["CT-2"]);
  assert.deepEqual(snapshot.completed.requirements.map((task) => task.key), ["CT-3"]);
  assert.equal(snapshot.requirements[0].binding.threadId, "thread-1");
  assert.equal(snapshot.requirements[0].attachmentCount, 1);
  assert.equal(snapshot.bindingsRevision, 2);

  const all = buildTaskBoardSnapshot(jiraResult(), { includeCompleted: true });
  assert.deepEqual(all.requirements.map((task) => task.key), ["CT-1", "CT-3"]);
});

test("详情与 Sheets 快照只暴露面板需要的只读字段", () => {
  const child = {
    ...jiraResult().issues[0],
    parent: { key: "CT-ROOT", title: "父级需求", url: "http://jira.example.test/browse/CT-ROOT" },
    parentIssue: {
      ...issue("CT-ROOT", "requirement"),
      title: "父级需求",
      summary: "父级完整背景",
      attachments: [{ id: "10", filename: "parent.png", mimeType: "image/png", size: 1024, sourceIssueKey: "CT-ROOT" }]
    },
    parentContext: { status: "available", key: "CT-ROOT", message: "" }
  };
  const detail = buildIssueDetailSnapshot({ issue: child, binding: jiraResult().bindingState.bindings["CT-1"] });
  assert.equal(detail.view, "issue");
  assert.equal(detail.issue.summary, "CT-1 的完整描述");
  assert.equal(detail.issue.attachments[0].previewable, true);
  assert.equal(detail.issue.attachments[0].downloadUrl, undefined);
  assert.equal(detail.issue.parentIssue.key, "CT-ROOT");
  assert.equal(detail.issue.parentIssue.summary, "父级完整背景");
  assert.equal(detail.issue.parentIssue.attachments[0].sourceIssueKey, "CT-ROOT");
  assert.equal(detail.issue.parentContext.status, "available");

  const sheets = buildSheetsSnapshot(sheetsResult());
  assert.equal(sheets.view, "sheets");
  assert.equal(sheets.sheets[0].title, "迭代任务");
  const sheetIssues = buildSheetIssuesSnapshot({ ...jiraResult(), issues: jiraResult().activeIssues, total: 2, sheet: sheetsResult().sheets[0] });
  assert.equal(sheetIssues.view, "sheet");
  assert.deepEqual(sheetIssues.issues.map((item) => item.key), ["CT-1", "CT-2"]);
});

test("MCP 将只读工具和需确认的写工具关联到同一标准 UI Resource", async () => {
  const server = createJiraTaskBoardMcpServer({ workbench: workbench(), conversations: conversations(), svn: svn(), automation: automation(), updates: updates(), desktop: desktop(), version: "0.31.1" });
  const client = new Client({ name: "jira-workbench-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  opened.push(server, client);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [AUTOMATION_SET_MONITOR_TOOL, AUTOMATION_STATUS_TOOL, CODEX_BIND_ISSUE_TOOL, CODEX_CLEAR_BINDING_TOOL, CODEX_CREATE_ISSUE_ANALYSIS_TOOL, CODEX_LIST_THREADS_TOOL, CODEX_OPEN_BOUND_THREAD_TOOL, JIRA_ATTACHMENT_PREVIEW_TOOL, JIRA_EXECUTE_TRANSITION_TOOL, JIRA_ISSUE_DETAIL_TOOL, JIRA_LIST_SHEETS_TOOL, JIRA_LIST_TRANSITIONS_TOOL, JIRA_PREPARE_TRANSITION_TOOL, JIRA_SHEET_ISSUES_TOOL, JIRA_TASK_BOARD_TOOL, SVN_ABANDON_REVIEW_TOOL, SVN_CANCEL_REVIEW_TOOL, SVN_COMMIT_REVIEW_TOOL, SVN_CONFIRM_COMMITTED_TOOL, SVN_CONFIRM_REVIEW_TOOL, SVN_CREATE_REVIEW_TOOL, SVN_GET_REVIEW_TOOL, SVN_INSPECT_CHANGES_TOOL, SVN_OPEN_EXTERNAL_DIFF_TOOL, SVN_PREVIEW_DIFF_TOOL, SVN_RECONCILE_COMMIT_TOOL, UPDATE_CANCEL_DOWNLOAD_TOOL, UPDATE_DOWNLOAD_TOOL, UPDATE_RESTART_TOOL, UPDATE_STATUS_TOOL].sort());
  for (const tool of listed.tools) {
    assert.equal(tool._meta.ui.resourceUri, JIRA_TASK_BOARD_RESOURCE_URI);
  }
  const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
  for (const name of [AUTOMATION_STATUS_TOOL, CODEX_LIST_THREADS_TOOL, JIRA_ATTACHMENT_PREVIEW_TOOL, JIRA_ISSUE_DETAIL_TOOL, JIRA_LIST_SHEETS_TOOL, JIRA_LIST_TRANSITIONS_TOOL, JIRA_SHEET_ISSUES_TOOL, JIRA_TASK_BOARD_TOOL, SVN_GET_REVIEW_TOOL, SVN_INSPECT_CHANGES_TOOL, SVN_OPEN_EXTERNAL_DIFF_TOOL, SVN_PREVIEW_DIFF_TOOL]) {
    assert.equal(byName[name].annotations.readOnlyHint, true);
    assert.equal(byName[name].annotations.destructiveHint, false);
  }
  assert.equal(byName[UPDATE_STATUS_TOOL].annotations.readOnlyHint, true);
  assert.equal(byName[UPDATE_STATUS_TOOL].annotations.openWorldHint, true);
  assert.equal(byName[UPDATE_DOWNLOAD_TOOL].annotations.openWorldHint, true);
  assert.equal(byName[UPDATE_RESTART_TOOL].annotations.destructiveHint, true);
  assert.equal(byName[UPDATE_RESTART_TOOL].annotations.openWorldHint, false);
  assert.equal(byName[JIRA_PREPARE_TRANSITION_TOOL].annotations.openWorldHint, false);
  assert.equal(byName[CODEX_BIND_ISSUE_TOOL].annotations.destructiveHint, false);
  assert.equal(byName[CODEX_CLEAR_BINDING_TOOL].annotations.destructiveHint, true);
  assert.equal(byName[CODEX_CLEAR_BINDING_TOOL].annotations.openWorldHint, false);
  assert.equal(byName[JIRA_EXECUTE_TRANSITION_TOOL].annotations.readOnlyHint, false);
  assert.equal(byName[JIRA_EXECUTE_TRANSITION_TOOL].annotations.destructiveHint, true);
  assert.equal(byName[JIRA_EXECUTE_TRANSITION_TOOL].annotations.openWorldHint, true);
  assert.equal(byName[AUTOMATION_SET_MONITOR_TOOL].annotations.openWorldHint, true);
  assert.equal(byName[SVN_COMMIT_REVIEW_TOOL].annotations.destructiveHint, true);
  assert.equal(byName[SVN_COMMIT_REVIEW_TOOL].annotations.openWorldHint, true);

  const board = await client.callTool({ name: JIRA_TASK_BOARD_TOOL, arguments: { includeCompleted: true, limitPerType: 100 } });
  assert.equal(board.structuredContent.counts.active, 2);
  assert.match(board.content[0].text, /不要在回复中重复/);
  const detail = await client.callTool({ name: JIRA_ISSUE_DETAIL_TOOL, arguments: { issueKey: "CT-1" } });
  assert.equal(detail.structuredContent.issue.key, "CT-1");
  const attachment = await client.callTool({ name: JIRA_ATTACHMENT_PREVIEW_TOOL, arguments: { issueKey: "CT-1", attachmentId: "9" } });
  assert.equal(attachment.structuredContent.preview.dataUrl, "data:image/png;base64,AQIDBA==");
  const monitor = await client.callTool({ name: AUTOMATION_STATUS_TOOL, arguments: {} });
  assert.equal(monitor.structuredContent.automation.monitorEnabled, false);
  const enabledMonitor = await client.callTool({ name: AUTOMATION_SET_MONITOR_TOOL, arguments: { enabled: true } });
  assert.equal(enabledMonitor.structuredContent.automation.monitorEnabled, true);
  const update = await client.callTool({ name: UPDATE_STATUS_TOOL, arguments: {} });
  assert.equal(update.structuredContent.update.latestVersion, "0.32.0");
  assert.equal((await client.callTool({ name: UPDATE_DOWNLOAD_TOOL, arguments: {} })).structuredContent.installation.state, "downloading");
  assert.equal((await client.callTool({ name: UPDATE_CANCEL_DOWNLOAD_TOOL, arguments: {} })).structuredContent.installation.state, "cancelled");
  assert.equal((await client.callTool({ name: UPDATE_RESTART_TOOL, arguments: {} })).structuredContent.installation.phase, "restarting");
  const openedThread = await client.callTool({ name: CODEX_OPEN_BOUND_THREAD_TOOL, arguments: { issueKey: "CT-1" } });
  assert.equal(openedThread.structuredContent.threadId, "thread-for-CT-1");
  const createdThread = await client.callTool({ name: CODEX_CREATE_ISSUE_ANALYSIS_TOOL, arguments: { issueKey: "CT-1", supplementalDescription: "弱网复现" } });
  assert.equal(createdThread.structuredContent.threadId, "new-thread-for-CT-1");
  const sheets = await client.callTool({ name: JIRA_LIST_SHEETS_TOOL, arguments: {} });
  assert.equal(sheets.structuredContent.total, 1);
  const sheet = await client.callTool({ name: JIRA_SHEET_ISSUES_TOOL, arguments: { projectId: "101", sheetId: "sheet-a" } });
  assert.equal(sheet.structuredContent.issues.length, 2);
  assert.equal(sheet.structuredContent.issues[0].projectName, "测试项目");
  assert.deepEqual(sheet.structuredContent.issues[0].fixVersions, ["DevelopV4"]);
  assert.equal(sheet.structuredContent.issues[0].collaborators[0].displayName, "协同用户");
  const transitions = await client.callTool({ name: JIRA_LIST_TRANSITIONS_TOOL, arguments: { issueKey: "CT-1" } });
  assert.equal(transitions.structuredContent.transitions[0].to.name, "程序处理");
  const prepared = await client.callTool({ name: JIRA_PREPARE_TRANSITION_TOOL, arguments: { issueKey: "CT-1", transitionId: "4", expectedTargetStatus: "程序处理" } });
  assert.match(prepared.structuredContent.confirmationId, /^[0-9a-f-]{36}$/);
  const executed = await client.callTool({ name: JIRA_EXECUTE_TRANSITION_TOOL, arguments: { confirmationId: prepared.structuredContent.confirmationId } });
  assert.equal(executed.structuredContent.targetStatus, "程序处理");
  const replay = await client.callTool({ name: JIRA_EXECUTE_TRANSITION_TOOL, arguments: { confirmationId: prepared.structuredContent.confirmationId } });
  assert.equal(replay.isError, true);
  const threads = await client.callTool({ name: CODEX_LIST_THREADS_TOOL, arguments: {} });
  assert.equal(threads.structuredContent.threads[0].id, "thread-2");
  const bound = await client.callTool({ name: CODEX_BIND_ISSUE_TOOL, arguments: { issueKey: "CT-2", threadId: "thread-2", expectedRevision: 2 } });
  assert.equal(bound.structuredContent.action, "bound");
  const cleared = await client.callTool({ name: CODEX_CLEAR_BINDING_TOOL, arguments: { issueKey: "CT-2", expectedRevision: 3 } });
  assert.equal(cleared.structuredContent.action, "cleared");
  const svnContext = await client.callTool({ name: SVN_INSPECT_CHANGES_TOOL, arguments: { issueKey: "CT-1" } });
  assert.equal(svnContext.structuredContent.context.changes[0].path, "src/a.go");
  const externalDiff = await client.callTool({ name: SVN_OPEN_EXTERNAL_DIFF_TOOL, arguments: { issueKey: "CT-1", path: "src/a.go" } });
  assert.deepEqual(externalDiff.structuredContent.result, { ok: true, path: "src/a.go" });
  const svnReview = await client.callTool({ name: SVN_CREATE_REVIEW_TOOL, arguments: { issueKey: "CT-1", selectedPaths: ["src/a.go"], codexReviewEnabled: false } });
  assert.equal(svnReview.structuredContent.review.status, "manual_review");
  const svnConfirmed = await client.callTool({ name: SVN_CONFIRM_REVIEW_TOOL, arguments: { issueKey: "CT-1", reviewId: svnReview.structuredContent.review.id, reviewed: true } });
  const svnCommitted = await client.callTool({ name: SVN_COMMIT_REVIEW_TOOL, arguments: { issueKey: "CT-1", reviewId: svnReview.structuredContent.review.id, confirmationToken: svnConfirmed.structuredContent.confirmationToken } });
  assert.equal(svnCommitted.structuredContent.review.commit.revision, "123");

  const resource = await client.readResource({ uri: JIRA_TASK_BOARD_RESOURCE_URI });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(resource.contents[0]._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.match(resource.contents[0].text, /待我处理/);
  assert.match(resource.contents[0].text, /Jira Sheets/);
  assert.match(resource.contents[0].text, /处理历史/);
  assert.match(resource.contents[0].text, /ui\/initialize/);
  assert.match(resource.contents[0].text, /tools\/call/);
  assert.match(resource.contents[0].text, /function toolResultError\(result\)/);
  assert.match(resource.contents[0].text, /throw toolResultError\(result\)/);
  assert.match(resource.contents[0].text, /expectedThreadId: task\.binding\?\.threadId \|\| ""/);
  assert.match(resource.contents[0].text, /setWidgetState/);
  assert.match(resource.contents[0].text, /SVN 审核与提交/);
  assert.match(resource.contents[0].text, /v0\.31\.1/);
  assert.doesNotMatch(resource.contents[0].text, /__JIRA_WORKBENCH_VERSION__/);
});

test("本机 /mcp 可通过 Streamable HTTP 调用完整工作台", async () => {
  const handler = createJiraTaskBoardMcpHttpHandler({ workbench: workbench(), conversations: conversations(), svn: svn(), automation: automation(), updates: updates(), desktop: desktop() });
  const httpServer = createServer((request, response) => handler(request, response).catch((error) => response.writeHead(500).end(error.message)));
  opened.push({ close: () => new Promise((resolve) => httpServer.close(resolve)) });
  await new Promise((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(0, "127.0.0.1", resolve); });
  const address = httpServer.address();
  const client = new Client({ name: "jira-workbench-http-test", version: "1.0.0" });
  opened.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 30);
  const result = await client.callTool({ name: JIRA_TASK_BOARD_TOOL, arguments: {} });
  assert.equal(result.structuredContent.counts.active, 2);
});

test("Core MCP 拒绝错误 Content-Type 与跨站浏览器来源", async () => {
  const handler = createJiraTaskBoardMcpHttpHandler({ workbench: workbench() });
  const httpServer = createServer((request, response) => handler(request, response).catch((error) => response.writeHead(500).end(error.message)));
  opened.push({ close: () => new Promise((resolve) => httpServer.close(resolve)) });
  await new Promise((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(0, "127.0.0.1", resolve); });
  const address = httpServer.address();
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;

  const wrongType = await fetch(endpoint, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(wrongType.status, 415);

  const crossSite = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  assert.equal(crossSite.status, 403);
});
