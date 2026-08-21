import * as z from "zod/v4";
import { createLocalApprovalProvider } from "./lib/approval-provider.mjs";

export const JIRA_TASK_BOARD_TOOL = "jira_list_my_tasks";
export const JIRA_ISSUE_DETAIL_TOOL = "jira_get_issue";
export const JIRA_ATTACHMENT_PREVIEW_TOOL = "jira_preview_issue_attachment";
export const JIRA_LIST_SHEETS_TOOL = "jira_list_sheets";
export const JIRA_SHEET_ISSUES_TOOL = "jira_get_sheet_issues";
export const JIRA_LIST_TRANSITIONS_TOOL = "jira_list_transitions";
export const JIRA_PREPARE_TRANSITION_TOOL = "jira_prepare_transition";
export const JIRA_EXECUTE_TRANSITION_TOOL = "jira_execute_transition";
export const JIRA_GET_WORKSPACES_TOOL = "jira_get_issue_workspaces";
export const JIRA_LIST_AVAILABLE_WORKSPACES_TOOL = "jira_list_available_workspaces";
export const JIRA_BIND_WORKSPACE_TOOL = "jira_bind_issue_workspace";
export const JIRA_UNBIND_WORKSPACE_TOOL = "jira_unbind_issue_workspace";
export const CODEX_LIST_THREADS_TOOL = "codex_list_bindable_threads";
export const CODEX_BIND_ISSUE_TOOL = "codex_bind_issue_to_thread";
export const CODEX_CLEAR_BINDING_TOOL = "codex_clear_issue_binding";
export const CODEX_OPEN_BOUND_THREAD_TOOL = "codex_open_bound_issue_thread";
export const CODEX_CREATE_ISSUE_ANALYSIS_TOOL = "codex_create_and_bind_issue_analysis";
export const AUTOMATION_STATUS_TOOL = "jira_get_bug_monitor_status";
export const AUTOMATION_SET_MONITOR_TOOL = "jira_set_bug_monitor_enabled";
export const UPDATE_STATUS_TOOL = "jira_get_update_status";
export const UPDATE_DOWNLOAD_TOOL = "jira_download_update";
export const UPDATE_CANCEL_DOWNLOAD_TOOL = "jira_cancel_update_download";
export const UPDATE_RESTART_TOOL = "jira_restart_to_complete_update";
export const SVN_INSPECT_CHANGES_TOOL = "svn_inspect_issue_changes";
export const SVN_PREVIEW_DIFF_TOOL = "svn_preview_issue_diff";
export const SVN_OPEN_EXTERNAL_DIFF_TOOL = "svn_open_issue_external_diff";
export const SVN_CREATE_REVIEW_TOOL = "svn_create_issue_review";
export const SVN_GET_REVIEW_TOOL = "svn_get_issue_review";
export const SVN_CANCEL_REVIEW_TOOL = "svn_cancel_issue_review";
export const SVN_CONFIRM_REVIEW_TOOL = "svn_confirm_issue_review";
export const SVN_COMMIT_REVIEW_TOOL = "svn_commit_issue_review";
export const SVN_RECONCILE_COMMIT_TOOL = "svn_reconcile_issue_commit";
export const SVN_CONFIRM_COMMITTED_TOOL = "svn_confirm_issue_committed";
export const SVN_ABANDON_REVIEW_TOOL = "svn_abandon_issue_review";
export const JIRA_TASK_BOARD_RESOURCE_URI = "ui://jira-workbench-assistant/workbench-v3.html";

const DEFAULT_LIMIT_PER_TYPE = 40;
const MAX_LIMIT_PER_TYPE = 100;
const DESKTOP_APP_SERVER_RUNTIME_OWNER = "desktop-appserver";
const projectScopeSchema = z.object({
  id: z.string(),
  cwd: z.string(),
  projectId: z.string(),
  projectLabel: z.string(),
  primary: z.boolean()
});

const bindingSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  runtimeOwner: z.string(),
  updatedAt: z.string(),
  projectScopes: z.array(projectScopeSchema),
  defaultProjectScopeId: z.string()
}).nullable();

const taskSchema = z.object({
  key: z.string(),
  title: z.string(),
  type: z.enum(["requirement", "bug"]),
  typeName: z.string(),
  status: z.enum(["todo", "in_progress", "done", "unknown"]),
  statusName: z.string(),
  priority: z.string(),
  assignee: z.string(),
  collaboratorCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  parentKey: z.string(),
  updated: z.string().nullable(),
  url: z.string(),
  binding: bindingSchema
});

const sheetSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  projectId: z.string(),
  projectKey: z.string(),
  projectName: z.string(),
  scopeType: z.string(),
  queryable: z.boolean(),
  updatedAt: z.string().nullable(),
  url: z.string(),
  directoryUrl: z.string()
});

function bindingFor(bindingState, issueKey) {
  const binding = bindingState?.bindings?.[issueKey];
  if (!binding?.threadId) return null;
  const workspace = binding.workspace && typeof binding.workspace === "object" ? binding.workspace : {};
  const rawScopes = Array.isArray(workspace.projectScopes) && workspace.projectScopes.length
    ? workspace.projectScopes
    : workspace.cwd || workspace.projectId ? [workspace] : [];
  const defaultProjectScopeId = String(workspace.defaultProjectScopeId || rawScopes[0]?.id || "");
  return {
    threadId: String(binding.threadId),
    title: String(binding.title || binding.threadTitle || "已关联会话"),
    runtimeOwner: String(binding.runtimeOwner || DESKTOP_APP_SERVER_RUNTIME_OWNER),
    updatedAt: String(binding.updatedAt || binding.boundAt || ""),
    projectScopes: rawScopes.map((scope, index) => ({
      id: String(scope.id || scope.scopeId || scope.projectId || scope.cwd || `scope:${index + 1}`),
      cwd: String(scope.cwd || ""),
      projectId: String(scope.projectId || ""),
      projectLabel: String(scope.projectLabel || scope.label || scope.cwd || scope.projectId || `项目 ${index + 1}`),
      primary: String(scope.id || scope.scopeId || "") === defaultProjectScopeId || (!defaultProjectScopeId && index === 0)
    })),
    defaultProjectScopeId
  };
}

function normalizeTask(issue, bindingState) {
  const type = issue?.type === "bug" ? "bug" : "requirement";
  const status = ["todo", "in_progress", "done"].includes(issue?.status)
    ? issue.status
    : "unknown";
  const key = String(issue?.key || "");
  return {
    key,
    title: String(issue?.title || "未命名 Jira 任务"),
    type,
    typeName: String(issue?.typeName || (type === "bug" ? "Bug" : "需求")),
    status,
    statusName: String(issue?.statusName || "未知状态"),
    priority: String(issue?.priority || "未设置"),
    assignee: String(issue?.assignee || "未分配"),
    collaboratorCount: Array.isArray(issue?.collaborators) ? issue.collaborators.length : 0,
    attachmentCount: Array.isArray(issue?.attachments) ? issue.attachments.length : 0,
    parentKey: String(issue?.parent?.key || ""),
    updated: issue?.updated ? String(issue.updated) : null,
    url: String(issue?.url || ""),
    binding: bindingFor(bindingState, key)
  };
}

function activeIssuesFrom(result) {
  if (Array.isArray(result?.activeIssues)) return result.activeIssues;
  return Array.isArray(result?.issues)
    ? result.issues.filter((issue) => issue?.status !== "done")
    : [];
}

function completedIssuesFrom(result) {
  if (Array.isArray(result?.completedIssues)) return result.completedIssues;
  return Array.isArray(result?.issues)
    ? result.issues.filter((issue) => issue?.status === "done")
    : [];
}

function groupedTasks(issues, bindingState, limitPerType) {
  const normalized = issues.map((issue) => normalizeTask(issue, bindingState)).filter((issue) => issue.key);
  const allRequirements = normalized.filter((issue) => issue.type === "requirement");
  const allBugs = normalized.filter((issue) => issue.type === "bug");
  return {
    requirements: allRequirements.slice(0, limitPerType),
    bugs: allBugs.slice(0, limitPerType),
    available: allRequirements.length + allBugs.length,
    truncated: allRequirements.length > limitPerType || allBugs.length > limitPerType
  };
}

export function buildTaskBoardSnapshot(result, {
  includeCompleted = false,
  limitPerType = DEFAULT_LIMIT_PER_TYPE
} = {}) {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT_PER_TYPE, Number(limitPerType) || DEFAULT_LIMIT_PER_TYPE));
  const bindingState = result?.bindingState || { revision: 0, bindings: {} };
  const active = groupedTasks(activeIssuesFrom(result), bindingState, safeLimit);
  const completed = groupedTasks(completedIssuesFrom(result), bindingState, safeLimit);
  const visible = includeCompleted
    ? groupedTasks([...activeIssuesFrom(result), ...completedIssuesFrom(result)], bindingState, safeLimit)
    : active;
  return {
    view: "board",
    scope: includeCompleted ? "all" : "active",
    fetchedAt: String(result?.fetchedAt || new Date().toISOString()),
    site: String(result?.site || ""),
    truncated: Boolean(result?.truncated || active.truncated || completed.truncated || visible.truncated),
    bindingsRevision: Number(bindingState.revision || 0),
    counts: {
      total: visible.requirements.length + visible.bugs.length,
      requirements: visible.requirements.length,
      bugs: visible.bugs.length,
      available: visible.available,
      active: active.available,
      completed: completed.available
    },
    requirements: visible.requirements,
    bugs: visible.bugs,
    active: {
      requirements: active.requirements,
      bugs: active.bugs
    },
    completed: {
      requirements: completed.requirements,
      bugs: completed.bugs
    }
  };
}

function normalizeIssueDetail(issue, binding = null) {
  const task = normalizeTask(issue, {
    bindings: binding ? { [issue?.key]: binding } : {}
  });
  return {
    ...task,
    summary: String(issue?.summary || "Jira 中未填写描述。"),
    hasDescription: issue?.hasDescription !== false,
    collaborators: (issue?.collaborators || []).map((person) => ({
      displayName: String(person?.displayName || person?.name || "未知用户"),
      active: person?.active !== false
    })),
    attachments: (issue?.attachments || []).map((attachment) => ({
      id: String(attachment?.id || ""),
      filename: String(attachment?.filename || "未命名附件"),
      mimeType: String(attachment?.mimeType || "application/octet-stream"),
      size: Number(attachment?.size || 0),
      author: String(attachment?.author || "未知用户"),
      created: attachment?.created ? String(attachment.created) : null,
      sourceIssueKey: String(attachment?.sourceIssueKey || issue?.key || ""),
      previewable: /^image\//i.test(String(attachment?.mimeType || ""))
    })),
    labels: (issue?.labels || []).map(String),
    projectName: String(issue?.projectName || ""),
    fixVersions: (issue?.fixVersions || []).map(String),
    created: issue?.created ? String(issue.created) : null
  };
}

export function buildIssueDetailSnapshot(result) {
  const issue = result?.issue || {};
  const parent = issue.parentIssue || issue.parent || null;
  const parentIssue = parent?.key ? normalizeIssueDetail(parent) : null;
  return {
    view: "issue",
    fetchedAt: String(result?.fetchedAt || new Date().toISOString()),
    bindingsRevision: Number(result?.bindingsRevision || 0),
    issue: {
      ...normalizeIssueDetail(issue, result?.binding || null),
      parentIssue,
      parentContext: {
        status: String(issue?.parentContext?.status || (parentIssue ? "available" : "none")),
        key: String(issue?.parentContext?.key || parentIssue?.key || ""),
        message: String(issue?.parentContext?.message || "")
      }
    }
  };
}

export function buildSheetsSnapshot(result) {
  return {
    view: "sheets",
    fetchedAt: String(result?.fetchedAt || new Date().toISOString()),
    site: String(result?.site || ""),
    directoryUrl: String(result?.directoryUrl || ""),
    total: Number(result?.total || 0),
    sheets: (result?.sheets || []).map((sheet) => ({
      id: String(sheet?.id || ""),
      title: String(sheet?.title || "未命名 Sheet"),
      description: String(sheet?.description || ""),
      projectId: String(sheet?.projectId || ""),
      projectKey: String(sheet?.projectKey || ""),
      projectName: String(sheet?.projectName || sheet?.projectKey || ""),
      scopeType: String(sheet?.scopeType || ""),
      queryable: Boolean(sheet?.queryable),
      updatedAt: sheet?.updatedAt ? String(sheet.updatedAt) : null,
      url: String(sheet?.url || ""),
      directoryUrl: String(sheet?.directoryUrl || result?.directoryUrl || "")
    })).filter((sheet) => sheet.id && sheet.projectId)
  };
}

export function buildSheetIssuesSnapshot(result, { limit = MAX_LIMIT_PER_TYPE } = {}) {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT_PER_TYPE, Number(limit) || MAX_LIMIT_PER_TYPE));
  return {
    view: "sheet",
    fetchedAt: String(result?.fetchedAt || new Date().toISOString()),
    site: String(result?.site || ""),
    sheet: buildSheetsSnapshot({ sheets: [result?.sheet] }).sheets[0],
    truncated: Boolean(result?.truncated || (result?.issues || []).length > safeLimit),
    total: Number(result?.total || (result?.issues || []).length),
    issues: (result?.issues || [])
      .slice(0, safeLimit)
      .map((issue) => ({
        ...normalizeTask(issue, result?.bindingState),
        projectName: String(issue?.projectName || ""),
        fixVersions: (issue?.fixVersions || []).map(String),
        collaborators: (issue?.collaborators || []).map((person) => ({
          displayName: String(person?.displayName || person?.name || "未知用户")
        }))
      }))
      .filter((issue) => issue.key)
  };
}

function summarizeTasks(snapshot) {
  return `Jira 任务已加载到交互面板（待办 ${snapshot.counts.active} 项，历史 ${snapshot.counts.completed} 项）。除非用户明确要求文本摘要，否则不要在回复中重复生成任务列表或 Markdown 表格。`;
}

function uiMeta(invoking, invoked) {
  return {
    ui: { resourceUri: JIRA_TASK_BOARD_RESOURCE_URI },
    "openai/outputTemplate": JIRA_TASK_BOARD_RESOURCE_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked
  };
}

function readOnlyAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
}

function externalReadOnlyAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
}

function localMutationAnnotations() {
  return { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
}

function localDestructiveAnnotations() {
  return { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
}

function externalMutationAnnotations() {
  return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
}

export function buildToolDefinitions({
  service,
  conversations,
  svn,
  workspaces,
  automation,
  updates,
  desktop,
  approvalProvider = createLocalApprovalProvider()
} = {}) {
  const definitions = [];
  const desktopHostName = String(desktop?.hostName || "Codex Desktop").trim() || "Codex Desktop";
  function define(name, options, handler) {
    definitions.push({ name, ...options, handler });
  }
  if (!service?.listTasks) throw new TypeError("service.listTasks 必须是函数。");

  define(
    JIRA_TASK_BOARD_TOOL,
    {
      title: "查看我的 Jira 任务工作台",
      description: "读取当前用户的 Jira 待办和已完成历史，按需求与 Bug 分类，并返回会话关联状态。只读。",
      inputSchema: {
        includeCompleted: z.boolean().optional().default(false),
        limitPerType: z.number().int().min(1).max(MAX_LIMIT_PER_TYPE).optional().default(DEFAULT_LIMIT_PER_TYPE)
      },
      annotations: readOnlyAnnotations(),
      _meta: uiMeta("正在读取 Jira 任务…", "Jira 任务已读取")
    },
    async ({ includeCompleted, limitPerType }) => {
      const snapshot = buildTaskBoardSnapshot(await service.listTasks(), { includeCompleted, limitPerType });
      return { structuredContent: snapshot, content: [{ type: "text", text: summarizeTasks(snapshot) }] };
    }
  );

  if (typeof automation?.getStatus === "function") {
    define(
      AUTOMATION_STATUS_TOOL,
      {
        title: "查看 Jira Bug 自动监控状态",
        description: "读取本地服务持有的 Bug 自动监控开关、队列、最近任务和错误状态。只读。",
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取自动监控状态…", "自动监控状态已读取")
      },
      async () => {
        const automationStatus = await automation.getStatus();
        return {
          structuredContent: { view: "automationStatus", automation: automationStatus },
          content: [{ type: "text", text: `Bug 自动监控${automationStatus.monitorEnabled ? "已开启" : "已关闭"}。` }]
        };
      }
    );
  }

  if (typeof updates?.getStatus === "function") {
    define(
      UPDATE_STATUS_TOOL,
      {
        title: "检查 Jira 工作台更新",
        description: "从 GitHub Release（无 Release 时回退到远端 main）读取版本，并与当前安装版本比较。只读。",
        inputSchema: { force: z.boolean().optional().default(false) },
        annotations: externalReadOnlyAnnotations(),
        _meta: uiMeta("正在检查 GitHub 更新…", "版本检查完成")
      },
      async ({ force }) => {
        const status = await updates.getStatus({ force });
        const update = status?.update || status;
        const installation = status?.installation || null;
        const text = update.updateAvailable
          ? `发现 Jira 工作台 v${update.latestVersion}，当前版本为 v${update.currentVersion}。`
          : update.checked
            ? `Jira 工作台当前版本为 v${update.currentVersion}，已是最新版本。`
            : `Jira 工作台当前版本为 v${update.currentVersion}。`;
        return {
          structuredContent: { view: "updateStatus", update, installation },
          content: [{ type: "text", text }]
        };
      }
    );
  }

  if (typeof updates?.startDownload === "function") {
    define(
      UPDATE_DOWNLOAD_TOOL,
      {
        title: "下载并安装 Jira 工作台更新",
        description: "从正式 GitHub Release 下载 Windows 更新包，校验大小与 SHA-256 后自动备份并安装。安装完成后不会立即关闭 Codex，而是等待用户确认重启。",
        inputSchema: {},
        annotations: externalMutationAnnotations(),
        _meta: uiMeta("正在启动更新下载…", "更新下载已启动")
      },
      async () => {
        const result = await updates.startDownload();
        return {
          structuredContent: { view: "updateStatus", ...result },
          content: [{ type: "text", text: "更新下载已经开始；校验通过后会自动安装，安装完成后需要用户确认重启 Codex。" }]
        };
      }
    );
  }

  if (typeof updates?.cancelDownload === "function") {
    define(
      UPDATE_CANCEL_DOWNLOAD_TOOL,
      {
        title: "取消 Jira 工作台更新下载",
        description: "取消当前正在进行的更新包下载。不会改变现有安装。",
        inputSchema: {},
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在取消更新下载…", "更新下载已取消")
      },
      async () => {
        const result = await updates.cancelDownload();
        return {
          structuredContent: { view: "updateStatus", ...result },
          content: [{ type: "text", text: "更新下载已取消，当前安装没有变化。" }]
        };
      }
    );
  }

  if (typeof updates?.restart === "function") {
    define(
      UPDATE_RESTART_TOOL,
      {
        title: "重启 Codex 完成更新",
        description: "仅在新版本已经安装并验证后使用。正常关闭所有 Codex 窗口，再通过统一启动入口重新打开；重启成功后自动确认并清理更新状态。",
        inputSchema: {},
        annotations: localDestructiveAnnotations(),
        _meta: uiMeta("正在准备重启 Codex…", "Codex 重启已开始")
      },
      async () => {
        const result = await updates.restart();
        return {
          structuredContent: { view: "updateStatus", ...result },
          content: [{ type: "text", text: "Codex 正在正常关闭并重新打开；重启后更新状态会自动完成并清理。" }]
        };
      }
    );
  }

  if (typeof automation?.setEnabled === "function") {
    define(
      AUTOMATION_SET_MONITOR_TOOL,
      {
        title: "设置 Jira Bug 自动监控",
        description: "修改本地 Bug 自动监控开关。开启后，本地服务会在后台发现 Bug、创建只读分析会话，并在已配置时推送企业微信。",
        inputSchema: { enabled: z.boolean() },
        annotations: externalMutationAnnotations(),
        _meta: uiMeta("正在更新自动监控…", "自动监控设置已更新")
      },
      async ({ enabled }) => {
        const automationStatus = await automation.setEnabled(enabled);
        return {
          structuredContent: { view: "automationStatus", automation: automationStatus },
          content: [{ type: "text", text: `Bug 自动监控已${enabled ? "开启" : "关闭"}。` }]
        };
      }
    );
  }

  if (typeof service.getIssue === "function") {
    define(
      JIRA_ISSUE_DETAIL_TOOL,
      {
        title: "查看 Jira 任务详情",
        description: "读取一个 Jira Issue 的描述、协同处理人、附件元数据、标签和会话关联状态。只读。",
        inputSchema: { issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/) },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取任务详情…", "任务详情已读取")
      },
      async ({ issueKey }) => {
        const snapshot = buildIssueDetailSnapshot(await service.getIssue(issueKey));
        return {
          structuredContent: snapshot,
          content: [{ type: "text", text: `${snapshot.issue.key} 详情已加载到交互面板。` }]
        };
      }
    );
  }

  if (typeof service.getAttachmentPreview === "function") {
    define(
      JIRA_ATTACHMENT_PREVIEW_TOOL,
      {
        title: "预览 Jira 图片附件",
        description: "读取属于指定 Jira Issue 的图片附件缩略内容，供官方工作台按需预览。只读；不返回 Jira Token 或跨站地址。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          attachmentId: z.string().regex(/^\d+$/)
        },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取附件预览…", "附件预览已读取")
      },
      async ({ issueKey, attachmentId }) => {
        const preview = await service.getAttachmentPreview(issueKey, attachmentId);
        return {
          structuredContent: { view: "attachmentPreview", preview },
          content: [{ type: "text", text: `${preview.filename} 的图片预览已加载到交互面板。` }]
        };
      }
    );
  }

  if (typeof service.listSheets === "function") {
    define(
      JIRA_LIST_SHEETS_TOOL,
      {
        title: "查看 Jira JXL Sheets",
        description: "列出当前 Jira 用户有权查看的 JXL Sheets。只读。",
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取 JXL Sheets…", "JXL Sheets 已读取")
      },
      async () => {
        const snapshot = buildSheetsSnapshot(await service.listSheets());
        return {
          structuredContent: snapshot,
          content: [{ type: "text", text: `JXL Sheets 已加载到交互面板（${snapshot.total} 个）。` }]
        };
      }
    );
  }

  if (typeof service.getSheetIssues === "function") {
    define(
      JIRA_SHEET_ISSUES_TOOL,
      {
        title: "查看 JXL Sheet 内容",
        description: "读取一个可查询 JXL Sheet 的 Jira 任务内容。只读。",
        inputSchema: {
          projectId: z.string().regex(/^\d+$/),
          sheetId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
          limit: z.number().int().min(1).max(MAX_LIMIT_PER_TYPE).optional().default(MAX_LIMIT_PER_TYPE)
        },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取 Sheet 内容…", "Sheet 内容已读取")
      },
      async ({ projectId, sheetId, limit }) => {
        const snapshot = buildSheetIssuesSnapshot(
          await service.getSheetIssues({ projectId, sheetId }),
          { limit }
        );
        return {
          structuredContent: snapshot,
          content: [{ type: "text", text: `${snapshot.sheet?.title || "Sheet"} 已加载到交互面板。` }]
        };
      }
    );
  }

  if (typeof service.listTransitions === "function") {
    define(
      JIRA_LIST_TRANSITIONS_TOOL,
      {
        title: "查看 Jira 状态流转",
        description: "读取指定 Jira Issue 当前可执行的状态流转。只读；在任何流转操作前先调用。",
        inputSchema: { issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/) },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取可用状态…", "可用状态已读取")
      },
      async ({ issueKey }) => {
        const result = await service.listTransitions(issueKey);
        const snapshot = {
          view: "transitions",
          issueKey: String(result?.key || issueKey).toUpperCase(),
          fetchedAt: String(result?.fetchedAt || new Date().toISOString()),
          transitions: (result?.transitions || []).map((transition) => ({
            id: String(transition?.id || ""),
            name: String(transition?.name || transition?.to?.name || "未命名流转"),
            to: {
              id: String(transition?.to?.id || ""),
              name: String(transition?.to?.name || "未知状态"),
              group: String(transition?.to?.group || "unknown")
            },
            requiresInput: Boolean(transition?.requiresInput),
            requiredFields: (transition?.requiredFields || []).map((field) => ({
              id: String(field?.id || ""),
              name: String(field?.name || field?.id || "未知字段")
            }))
          })).filter((transition) => transition.id)
        };
        return {
          structuredContent: snapshot,
          content: [{ type: "text", text: `${snapshot.issueKey} 当前有 ${snapshot.transitions.length} 个可用状态流转。` }]
        };
      }
    );
  }

  if (typeof service.listTransitions === "function" && typeof service.executeTransition === "function") {
    define(
      JIRA_PREPARE_TRANSITION_TOOL,
      {
        title: "准备 Jira 状态流转",
        description: "仅在用户已经在交互面板中明确选择目标状态并确认后调用。重新校验流转并签发短时一次性确认；不会修改 Jira。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          transitionId: z.string().regex(/^\d+$/),
          expectedTargetStatus: z.string().min(1).max(200)
        },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在复核状态流转…", "状态流转等待最终提交")
      },
      async ({ issueKey, transitionId, expectedTargetStatus }) => {
        const latest = await service.listTransitions(issueKey);
        const transition = (latest?.transitions || []).find((candidate) => String(candidate?.id) === transitionId);
        if (!transition || String(transition?.to?.name || "") !== expectedTargetStatus) {
          const error = new Error("目标状态已发生变化，请刷新后重新确认。");
          error.code = "JIRA_TRANSITION_STALE";
          error.statusCode = 409;
          throw error;
        }
        if (transition.requiresInput) {
          const error = new Error(`该状态流转需要填写额外字段（${transition.requiredFields.map((field) => field.name).join("、")}），请在 Jira 中完成。`);
          error.code = "JIRA_TRANSITION_REQUIRES_INPUT";
          error.statusCode = 400;
          throw error;
        }
        const grant = await approvalProvider.issue("jira-transition", {
          issueKey: String(latest.key || issueKey).toUpperCase(),
          transitionId,
          expectedTargetStatus
        });
        return {
          structuredContent: {
            view: "transitionConfirmation",
            ...grant,
            issueKey: String(latest.key || issueKey).toUpperCase(),
            transitionId,
            targetStatus: expectedTargetStatus
          },
          content: [{ type: "text", text: `已复核 ${latest.key || issueKey} → ${expectedTargetStatus}，等待执行。` }]
        };
      }
    );

    define(
      JIRA_EXECUTE_TRANSITION_TOOL,
      {
        title: "执行 Jira 状态流转",
        description: "使用交互面板刚刚签发的一次性确认执行 Jira 状态流转。会修改 Jira；不得在没有用户最终确认时调用。",
        inputSchema: { confirmationId: z.string().uuid() },
        annotations: externalMutationAnnotations(),
        _meta: uiMeta("正在提交 Jira 状态流转…", "Jira 状态流转已提交")
      },
      async ({ confirmationId }) => {
        const grant = await approvalProvider.consume(confirmationId, "jira-transition");
        const result = await service.executeTransition(grant.issueKey, grant.transitionId);
        const issueResult = typeof service.getIssue === "function"
          ? await service.getIssue(grant.issueKey)
          : null;
        return {
          structuredContent: {
            view: "transitionResult",
            issueKey: grant.issueKey,
            transitionId: grant.transitionId,
            targetStatus: grant.expectedTargetStatus,
            transitionedAt: String(result?.transitionedAt || new Date().toISOString()),
            issueSnapshot: issueResult ? buildIssueDetailSnapshot(issueResult) : null
          },
          content: [{ type: "text", text: `${grant.issueKey} 已流转到 ${grant.expectedTargetStatus}。` }]
        };
      }
    );
  }

  if (typeof workspaces?.listAvailable === "function") {
    define(
      JIRA_LIST_AVAILABLE_WORKSPACES_TOOL,
      {
        title: "查看宿主项目列表",
        description: "读取当前宿主已经添加的项目或工作区，供用户选择 Jira 的项目目录绑定。只读，不扫描会话，也不接受任意路径输入。",
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取宿主项目列表…", "宿主项目列表已读取")
      },
      async () => {
        const result = await workspaces.listAvailable();
        return {
          structuredContent: { view: "availableWorkspaces", ...result },
          content: [{ type: "text", text: `当前宿主提供 ${result.workspaces.length} 个可选项目。` }]
        };
      }
    );
  }

  if (typeof workspaces?.get === "function") {
    define(
      JIRA_GET_WORKSPACES_TOOL,
      {
        title: "查看 Jira 绑定的项目目录",
        description: "读取指定 Jira 当前绑定的一个或多个本机项目目录。该绑定独立于 Codex/DSH 会话，供 SVN 操作选择范围。只读。",
        inputSchema: { issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/) },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取项目目录…", "项目目录已读取")
      },
      async ({ issueKey }) => {
        const result = await workspaces.get(issueKey);
        return {
          structuredContent: { view: "workspaceBindings", ...result },
          content: [{ type: "text", text: `${String(issueKey).toUpperCase()} 当前绑定 ${(result.binding?.workspace?.projectScopes || []).length} 个项目目录。` }]
        };
      }
    );
  }

  if (typeof workspaces?.bind === "function") {
    define(
      JIRA_BIND_WORKSPACE_TOOL,
      {
        title: "绑定 Jira 项目目录",
        description: "把用户明确选择的本机绝对目录绑定到 Jira。可追加多个目录并指定默认目录；不会创建或切换会话。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          cwd: z.string().min(1).max(4_000),
          projectId: z.string().max(500).optional().default(""),
          projectLabel: z.string().max(500).optional().default(""),
          makeDefault: z.boolean().optional().default(true),
          replaceExisting: z.boolean().optional().default(false),
          expectedRevision: z.number().int().min(0)
        },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在绑定项目目录…", "项目目录已绑定")
      },
      async (input) => {
        const result = await workspaces.bind(input);
        return {
          structuredContent: { view: "workspaceBindings", ...result },
          content: [{ type: "text", text: `${result.issueKey} 已绑定项目目录。` }]
        };
      }
    );
  }

  if (typeof workspaces?.unbind === "function") {
    define(
      JIRA_UNBIND_WORKSPACE_TOOL,
      {
        title: "解除 Jira 项目目录绑定",
        description: "解除指定项目目录；projectScopeId 为空时解除该 Jira 的全部项目目录。不会删除目录或修改工作副本。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          projectScopeId: z.string().max(1_000).optional().default(""),
          expectedRevision: z.number().int().min(0)
        },
        annotations: localDestructiveAnnotations(),
        _meta: uiMeta("正在解除项目绑定…", "项目绑定已解除")
      },
      async (input) => {
        const result = await workspaces.unbind(input);
        return {
          structuredContent: { view: "workspaceBindings", ...result },
          content: [{ type: "text", text: `${result.issueKey} 的项目目录绑定已更新。` }]
        };
      }
    );
  }

  if (typeof conversations?.listThreads === "function") {
    define(
      CODEX_LIST_THREADS_TOOL,
      {
        title: "查看可关联的宿主会话",
        description: "通过当前宿主的官方会话目录列出用户可读取的会话，供人工选择 Jira 关联目标。只读。",
        inputSchema: {
          searchTerm: z.string().max(200).optional().default(""),
          cwd: z.string().max(2_000).optional().default(""),
          limit: z.number().int().min(1).max(200).optional().default(50)
        },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取宿主会话…", "宿主会话已读取")
      },
      async ({ searchTerm, cwd, limit }) => {
        const result = await conversations.listThreads({ searchTerm, cwd, limit });
        return {
          structuredContent: { view: "threads", ...result },
          content: [{ type: "text", text: `已读取 ${result.total} 个可关联的宿主会话。` }]
        };
      }
    );
  }

  if (typeof desktop?.openIssueConversation === "function") {
    define(
      CODEX_OPEN_BOUND_THREAD_TOOL,
      {
        title: "在 Codex Desktop 打开已关联会话",
        description: "请求当前 Codex Desktop 窗口打开 Jira 已关联的会话。只改变桌面视图，不发送消息。",
        inputSchema: { issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/) },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在请求 Codex Desktop 打开会话…", "Codex Desktop 已处理打开请求")
      },
      async ({ issueKey }) => {
        const result = await desktop.openIssueConversation(issueKey);
        return {
          structuredContent: { view: "desktopNavigation", issueKey: String(issueKey).toUpperCase(), ...result },
          content: [{ type: "text", text: `${String(issueKey).toUpperCase()} 的关联会话已请求在 Codex Desktop 打开。` }]
        };
      }
    );
  }

  if (typeof desktop?.createIssueAnalysis === "function") {
    define(
      CODEX_CREATE_ISSUE_ANALYSIS_TOOL,
      {
        title: `新建并关联 Jira 分析会话（${desktopHostName}）`,
        description: `在 ${desktopHostName} 创建新会话、发送只读首轮分析消息并关联 Jira。首轮仅理解和分析，不修改项目文件。`,
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          supplementalDescription: z.string().max(4_000).optional().default(""),
          expectedRevision: z.number().int().nonnegative().optional(),
          expectedThreadId: z.string().max(1_000).optional(),
          projectScopeId: z.string().max(1_000).optional().default("")
        },
        annotations: externalMutationAnnotations(),
        _meta: uiMeta(`正在新建 ${desktopHostName} 分析会话…`, `${desktopHostName} 分析会话已创建并关联`)
      },
      async ({ issueKey, supplementalDescription, expectedRevision, expectedThreadId, projectScopeId }) => {
        const result = await desktop.createIssueAnalysis(issueKey, supplementalDescription, {
          expectedRevision,
          expectedThreadId,
          projectScopeId
        });
        return {
          structuredContent: { view: "desktopAnalysis", ...result },
          content: [{ type: "text", text: `${String(issueKey).toUpperCase()} 的只读分析会话已创建并关联。` }]
        };
      }
    );
  }

  if (typeof conversations?.bindIssue === "function") {
    define(
      CODEX_BIND_ISSUE_TOOL,
      {
        title: "关联 Jira 与宿主会话",
        description: "仅在用户已在交互面板中选择目标会话并明确确认后，保存 Jira 与当前宿主会话的本地关联。不会发送消息或修改会话内容。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          threadId: z.string().min(1).max(1_000),
          expectedRevision: z.number().int().nonnegative(),
          replaceExistingThreadBinding: z.boolean().optional().default(false)
        },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在保存会话关联…", "会话关联已保存")
      },
      async (input) => {
        const result = await conversations.bindIssue(input);
        const issueResult = typeof service.getIssue === "function"
          ? await service.getIssue(result.issueKey)
          : null;
        return {
          structuredContent: {
            view: "bindingResult",
            action: "bound",
            ...result,
            issueSnapshot: issueResult ? buildIssueDetailSnapshot(issueResult) : null
          },
          content: [{ type: "text", text: `${result.issueKey} 已关联现有宿主会话；未发送任何消息。` }]
        };
      }
    );
  }

  if (typeof conversations?.clearBinding === "function") {
    define(
      CODEX_CLEAR_BINDING_TOOL,
      {
        title: "解除 Jira 会话关联",
        description: "仅在用户明确确认后清除 Jira 与当前宿主会话的本地关联；不会删除或修改该会话。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          expectedRevision: z.number().int().nonnegative()
        },
        annotations: localDestructiveAnnotations(),
        _meta: uiMeta("正在解除会话关联…", "会话关联已解除")
      },
      async (input) => {
        const result = await conversations.clearBinding(input);
        const issueResult = typeof service.getIssue === "function"
          ? await service.getIssue(result.issueKey)
          : null;
        return {
          structuredContent: {
            view: "bindingResult",
            action: "cleared",
            ...result,
            issueSnapshot: issueResult ? buildIssueDetailSnapshot(issueResult) : null
          },
          content: [{ type: "text", text: `${result.issueKey} 的本地会话关联已解除；宿主会话未被删除。` }]
        };
      }
    );
  }

  if (typeof svn?.context === "function") {
    define(
      SVN_INSPECT_CHANGES_TOOL,
      {
        title: "检查 Jira 关联的 SVN 改动",
        description: "根据 Jira 的服务端会话关联定位项目，只读执行 SVN info/status，返回当前项目范围、变更文件、自动推荐、历史提交和现有审核草稿。不会修改工作副本。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          projectScopeId: z.string().max(1_000).optional().default("")
        },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在检查 SVN 工作副本…", "SVN 改动已读取")
      },
      async ({ issueKey, projectScopeId }) => {
        const result = await svn.context({ issueKey, projectScopeId });
        return {
          structuredContent: { view: "svnContext", issueKey: issueKey.toUpperCase(), ...result },
          content: [{ type: "text", text: `${issueKey.toUpperCase()} 的 SVN 改动已加载到审核面板。` }]
        };
      }
    );
  }

  if (typeof svn?.previewDiff === "function") {
    define(
      SVN_PREVIEW_DIFF_TOOL,
      {
        title: "预览 SVN 文件差异",
        description: "只读执行指定 Jira 关联项目内单个变更文件的 svn diff。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          projectScopeId: z.string().max(1_000).optional().default(""),
          path: z.string().min(1).max(4_000)
        },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在读取 SVN 差异…", "SVN 差异已读取")
      },
      async ({ issueKey, projectScopeId, path }) => {
        const preview = await svn.previewDiff({ issueKey, projectScopeId, path });
        return {
          structuredContent: { view: "svnDiff", issueKey: issueKey.toUpperCase(), preview },
          content: [{ type: "text", text: `${path} 的 SVN 差异已加载到审核面板。` }]
        };
      }
    );
  }

  if (typeof svn?.openExternalDiff === "function") {
    define(
      SVN_OPEN_EXTERNAL_DIFF_TOOL,
      {
        title: "使用 TortoiseSVN 比较文件差异",
        description: "在当前 Jira 绑定项目范围内校验单个已纳管变更文件，然后只读启动 TortoiseSVN 原生差异比较；不会修改工作副本。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          projectScopeId: z.string().max(1_000).optional().default(""),
          path: z.string().min(1).max(4_000)
        },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在打开 TortoiseSVN 差异比较…", "TortoiseSVN 差异比较已打开")
      },
      async ({ issueKey, projectScopeId, path }) => {
        const result = await svn.openExternalDiff({ issueKey, projectScopeId, path });
        return {
          structuredContent: { view: "svnExternalDiff", issueKey: issueKey.toUpperCase(), result },
          content: [{ type: "text", text: `${path} 已通过当前项目的安全路径校验，并交给 TortoiseSVN 进行只读比较。` }]
        };
      }
    );
  }

  if (typeof svn?.createReview === "function") {
    define(
      SVN_CREATE_REVIEW_TOOL,
      {
        title: "创建 SVN 审核快照",
        description: "仅在用户已人工选择显式文件后创建不可变 SVN 审核快照。Codex 审查默认关闭；开启时通过官方 App Server 在绑定会话启动只读审查，失败可降级为人工审核。不会提交 SVN。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          projectScopeId: z.string().max(1_000).optional().default(""),
          selectedPaths: z.array(z.string().min(1).max(4_000)).min(1).max(200),
          summary: z.string().max(2_000).optional().default(""),
          codexReviewEnabled: z.boolean().optional().default(false)
        },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在创建 SVN 审核快照…", "SVN 审核快照已创建")
      },
      async ({ issueKey, projectScopeId, selectedPaths, summary, codexReviewEnabled }) => {
        const result = await svn.createReview({
          issueKey,
          projectScopeId,
          selectedPaths,
          summary,
          codexReviewEnabled,
          dispatchCodexReview: codexReviewEnabled
        });
        return {
          structuredContent: { view: "svnReview", issueKey: issueKey.toUpperCase(), ...result },
          content: [{ type: "text", text: codexReviewEnabled
            ? `${issueKey.toUpperCase()} 的审核快照已创建；Codex 审查状态：${result.review?.status || "未知"}。`
            : `${issueKey.toUpperCase()} 已进入人工审核；尚未提交 SVN。` }]
        };
      }
    );
  }

  if (typeof svn?.getReview === "function") {
    define(
      SVN_GET_REVIEW_TOOL,
      {
        title: "读取 SVN 审核状态",
        description: "读取并刷新一个 SVN 审核草稿的当前状态。只读；不会提交。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          reviewId: z.string().uuid()
        },
        annotations: readOnlyAnnotations(),
        _meta: uiMeta("正在刷新 SVN 审核…", "SVN 审核状态已刷新")
      },
      async ({ issueKey, reviewId }) => {
        const review = await svn.getReview(reviewId, issueKey);
        return {
          structuredContent: { view: "svnReview", issueKey: issueKey.toUpperCase(), review },
          content: [{ type: "text", text: `SVN 审核状态：${review.status}。` }]
        };
      }
    );
  }

  if (typeof svn?.cancelReview === "function") {
    define(
      SVN_CANCEL_REVIEW_TOOL,
      {
        title: "取消 Codex SVN 审查",
        description: "仅在用户明确确认后取消耗时的 Codex 审查，并将当前审核快照降级为人工审核；不会提交或还原文件。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          reviewId: z.string().uuid(),
          message: z.string().max(1_000).optional().default("用户已取消 Codex 审查，改为人工审核。")
        },
        annotations: localDestructiveAnnotations(),
        _meta: uiMeta("正在取消 Codex 审查…", "已降级为人工审核")
      },
      async ({ issueKey, reviewId, message }) => {
        const review = await svn.cancelReview(reviewId, message, issueKey);
        return {
          structuredContent: { view: "svnReview", issueKey: issueKey.toUpperCase(), review },
          content: [{ type: "text", text: "Codex 审查已取消；审核快照仍保留，可继续人工审核。" }]
        };
      }
    );
  }

  if (typeof svn?.confirmReview === "function") {
    define(
      SVN_CONFIRM_REVIEW_TOOL,
      {
        title: "确认已完成人工 SVN 审核",
        description: "仅在用户已人工查看全部选定文件、需求符合性和风险后调用。服务端复检快照并签发短时一次性提交确认；本工具本身不提交。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          reviewId: z.string().uuid(),
          reviewed: z.literal(true),
          riskAcknowledged: z.boolean().optional().default(false),
          overlapAcknowledged: z.boolean().optional().default(false)
        },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在复检 SVN 审核快照…", "等待最终人工提交确认")
      },
      async ({ issueKey, reviewId, reviewed, riskAcknowledged, overlapAcknowledged }) => {
        const confirmation = await svn.confirmReview(reviewId, {
          issueKey,
          reviewed,
          riskAcknowledged,
          overlapAcknowledged
        });
        const review = await svn.getReview(reviewId, issueKey);
        return {
          structuredContent: { view: "svnCommitConfirmation", issueKey: issueKey.toUpperCase(), review, ...confirmation },
          content: [{ type: "text", text: "审核快照复检通过，仍需用户最终确认后才能提交 SVN。" }]
        };
      }
    );
  }

  if (typeof svn?.commitReview === "function") {
    define(
      SVN_COMMIT_REVIEW_TOOL,
      {
        title: "提交已审核的 SVN 改动",
        description: "高风险写操作。仅使用刚签发的一次性确认，复检 Jira、文件指纹、SVN 状态和远端更新后，以显式路径执行 svn commit 并通过 svn log 核对 revision。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          reviewId: z.string().uuid(),
          confirmationToken: z.string().min(20).max(200)
        },
        annotations: externalMutationAnnotations(),
        _meta: uiMeta("正在复检并提交 SVN…", "SVN 提交命令已结束")
      },
      async ({ issueKey, reviewId, confirmationToken }) => {
        const review = await svn.commitReview(reviewId, { issueKey, confirmationToken });
        return {
          structuredContent: { view: "svnCommitResult", issueKey: issueKey.toUpperCase(), review },
          content: [{ type: "text", text: review.status === "committed"
            ? `SVN 已提交并核对 revision r${review.commit?.revision || "?"}。`
            : `SVN 提交状态：${review.status}。` }]
        };
      }
    );
  }

  if (typeof svn?.reconcileCommit === "function") {
    define(
      SVN_RECONCILE_COMMIT_TOOL,
      {
        title: "重新核对 SVN 提交结果",
        description: "针对提交结果未知的草稿只读查询 svn log 并更新本地审核状态；不会再次执行提交。",
        inputSchema: { issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/), reviewId: z.string().uuid() },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在核对 SVN 日志…", "SVN 日志已核对")
      },
      async ({ issueKey, reviewId }) => {
        const review = await svn.reconcileCommit(reviewId, issueKey);
        return { structuredContent: { view: "svnCommitResult", issueKey: issueKey.toUpperCase(), review }, content: [{ type: "text", text: `提交核对状态：${review.status}。` }] };
      }
    );
  }

  if (typeof svn?.confirmCommitted === "function") {
    define(
      SVN_CONFIRM_COMMITTED_TOOL,
      {
        title: "人工登记 SVN 已提交",
        description: "仅在 SVN 命令已执行但自动日志核对不唯一、且用户已亲自查看 SVN 日志后，登记人工确认的 revision；不会再次提交。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          reviewId: z.string().uuid(),
          acknowledged: z.literal(true),
          revision: z.string().regex(/^r?\d+$/i)
        },
        annotations: localMutationAnnotations(),
        _meta: uiMeta("正在登记人工核对结果…", "人工核对结果已登记")
      },
      async ({ issueKey, reviewId, acknowledged, revision }) => {
        const review = await svn.confirmCommitted(reviewId, { acknowledged, revision }, issueKey);
        return { structuredContent: { view: "svnCommitResult", issueKey: issueKey.toUpperCase(), review }, content: [{ type: "text", text: `已登记 SVN revision r${review.commit?.revision || revision.replace(/^r/i, "")}。` }] };
      }
    );
  }

  if (typeof svn?.abandonReview === "function") {
    define(
      SVN_ABANDON_REVIEW_TOOL,
      {
        title: "放弃 SVN 审核草稿",
        description: "仅在用户明确确认后放弃未提交的本地审核草稿，以便重新扫描最新文件状态；不会还原文件或删除已提交历史。",
        inputSchema: {
          issueKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/),
          reviewId: z.string().uuid(),
          acknowledged: z.literal(true),
          message: z.string().max(1_000).optional().default("用户已确认放弃旧审核草稿并重新扫描。")
        },
        annotations: localDestructiveAnnotations(),
        _meta: uiMeta("正在放弃旧审核草稿…", "旧审核草稿已放弃")
      },
      async ({ issueKey, reviewId, acknowledged, message }) => {
        const review = await svn.abandonReview(reviewId, { acknowledged, message }, issueKey);
        return { structuredContent: { view: "svnReview", issueKey: issueKey.toUpperCase(), review }, content: [{ type: "text", text: "旧审核草稿已放弃，可以重新扫描最新 SVN 状态。" }] };
      }
    );
  }

  return definitions;
}
