import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiraWorkbenchService } from "../lib/jira-workbench-service.mjs";

function fixture({ parentFailure = false } = {}) {
  const calls = [];
  const config = { configured: true, token: "secret", baseUrl: "http://jira.example.test" };
  const issue = {
    key: "CT-1",
    title: "任务",
    parent: { key: "CT-ROOT", title: "父级需求", url: "http://jira.example.test/browse/CT-ROOT" },
    attachments: [{ id: "9", filename: "evidence.png", mimeType: "image/png", size: 4 }]
  };
  const parentIssue = {
    key: "CT-ROOT",
    title: "父级需求",
    summary: "完整父级背景",
    attachments: [{ id: "10", filename: "parent.png", mimeType: "image/png", size: 4, sourceIssueKey: "CT-ROOT" }]
  };
  const bindingState = { revision: 3, bindings: { "CT-1": { threadId: "thread-1" } } };
  const service = createJiraWorkbenchService({
    loadIssues: async () => ({ issues: [issue], activeIssues: [issue], completedIssues: [], fetchedAt: "now" }),
    loadConfig: async () => config,
    resolveConfig: async (value) => ({ ...value, collaboratorFieldId: "customfield_1" }),
    jira: {
      fetchIssue: async (value, key) => {
        calls.push(["issue", value, key]);
        if (key === "CT-ROOT") {
          if (parentFailure) throw Object.assign(new Error("无权读取父单"), { code: "JIRA_ISSUE_HTTP_ERROR" });
          return parentIssue;
        }
        return issue;
      },
      fetchAttachment: async (value, attachmentId, options) => {
        calls.push(["attachment", value, attachmentId, options]);
        return {
          filename: "evidence.png",
          contentType: "image/png",
          contentLength: 4,
          thumbnail: options?.thumbnail === true,
          body: new Response(Uint8Array.from([1, 2, 3, 4])).body
        };
      },
      fetchIssues: async (value) => { calls.push(["issues", value]); return { issues: [issue], total: 1, fetchedAt: "now" }; },
      fetchTransitions: async (value, key) => { calls.push(["transitions", value, key]); return { issueKey: key, transitions: [{ id: "4" }] }; },
      executeTransition: async (value, key, transitionId) => { calls.push(["transition", value, key, transitionId]); return { issueKey: key, transitionId }; }
    },
    jxl: {
      listSheets: async (value) => { calls.push(["sheets", value]); return { sheets: [], total: 0 }; },
      getSheet: async (value, identity) => { calls.push(["sheet", value, identity]); return { id: identity.sheetId, projectId: identity.projectId, title: "Sheet", _scope: { type: "jql", value: "project = CT" } }; }
    },
    issueBindings: {
      snapshot: async () => bindingState,
      applyMutations: async (mutations) => { calls.push(["bindings", mutations]); return { ...bindingState, revision: 4 }; }
    }
  });
  return { service, calls, bindingState };
}

test("共享工作台把服务端绑定状态加入任务和详情，但不改变 Jira 原始任务字段", async () => {
  const { service, bindingState } = fixture();
  const tasks = await service.listTasks();
  assert.equal(tasks.bindingState, bindingState);
  assert.equal(tasks.issues[0].binding, undefined);
  const detail = await service.getIssue("ct-1");
  assert.equal(detail.issue.key, "CT-1");
  assert.equal(detail.issue.parentIssue.key, "CT-ROOT");
  assert.equal(detail.issue.parentIssue.summary, "完整父级背景");
  assert.equal(detail.issue.parentContext.status, "available");
  assert.equal(detail.binding.threadId, "thread-1");
  assert.equal(detail.bindingsRevision, 3);
});

test("官方工作台只按需读取属于当前任务的图片附件", async () => {
  const { service, calls } = fixture();
  const preview = await service.getAttachmentPreview("ct-1", "9");
  assert.equal(preview.issueKey, "CT-1");
  assert.equal(preview.filename, "evidence.png");
  assert.equal(preview.thumbnail, false);
  assert.equal(preview.dataUrl, "data:image/png;base64,AQIDBA==");
  assert.deepEqual(calls.find((call) => call[0] === "attachment").slice(2), ["9", { thumbnail: false }]);
  const parentPreview = await service.getAttachmentPreview("CT-1", "10");
  assert.equal(parentPreview.sourceIssueKey, "CT-ROOT");
  await assert.rejects(
    () => service.getAttachmentPreview("CT-1", "11"),
    (error) => error.code === "JIRA_ATTACHMENT_NOT_IN_ISSUE"
  );
});

test("父单无权限时保留当前执行单，并以非阻塞状态暴露上下文缺口", async () => {
  const { service } = fixture({ parentFailure: true });
  const detail = await service.getIssue("CT-1");
  assert.equal(detail.issue.key, "CT-1");
  assert.equal(detail.issue.parentIssue, null);
  assert.equal(detail.issue.parentContext.status, "unavailable");
  assert.equal(detail.issue.parentContext.key, "CT-ROOT");
  assert.match(detail.issue.parentContext.message, /无权读取父单/);
});

test("共享工作台对旧 HTTP 与官方 MCP 复用同一份 JXL 权限和 JQL 查询结果", async () => {
  const { service, calls, bindingState } = fixture();
  const result = await service.getSheetIssues({ projectId: "101", sheetId: "sheet-a" });
  assert.equal(result.sheet._scope, undefined);
  assert.equal(result.bindingState, bindingState);
  assert.equal(result.issues[0].key, "CT-1");
  assert.equal(calls.find((call) => call[0] === "issues")[1].jql, "project = CT");
  assert.equal(calls.find((call) => call[0] === "issues")[1].collaboratorFieldId, "customfield_1");
});

test("共享工作台拒绝未配置 Jira 和非法 Sheet 标识", async () => {
  const empty = createJiraWorkbenchService({
    loadIssues: async () => ({}),
    loadConfig: async () => ({ configured: false, token: "" }),
    jira: {},
    jxl: {},
    issueBindings: { snapshot: async () => ({ bindings: {} }) }
  });
  await assert.rejects(() => empty.listSheets(), (error) => error.code === "JIRA_NOT_CONFIGURED" && error.statusCode === 428);
  await assert.rejects(() => empty.getSheetIssues({ projectId: "../", sheetId: "bad/path" }), (error) => error.code === "INVALID_JXL_SHEET_ID");
});

test("旧 HTTP 与后续官方变更工具可复用同一状态流转和绑定命令", async () => {
  const { service, calls } = fixture();
  const transitions = await service.listTransitions("ct-1");
  assert.equal(transitions.transitions[0].id, "4");
  const result = await service.executeTransition("CT-1", "4");
  assert.deepEqual(result, { issueKey: "CT-1", transitionId: "4" });
  const bindings = await service.updateBindings({ deletes: ["CT-1"] });
  assert.equal(bindings.revision, 4);
  assert.ok(calls.some((call) => call[0] === "transition"));
  assert.ok(calls.some((call) => call[0] === "bindings"));
});
