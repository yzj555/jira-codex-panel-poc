import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createConfigStore } from "./config-store.mjs";
import { createJiraClient } from "./jira-client.mjs";
import { createJxlClient } from "./jxl-client.mjs";
import { createIssueBindingStore } from "./lib/issue-binding-store.mjs";
import { createJiraWorkbenchService } from "./lib/jira-workbench-service.mjs";
import { buildSvnCommitMessage, createSvnReviewManager } from "./lib/svn-review-manager.mjs";
import { createSvnWorkbenchService } from "./lib/svn-workbench-service.mjs";
import { createNullReviewAuditProvider } from "./lib/null-review-audit-provider.mjs";
import { createTaskBoardLoader } from "./lib/task-board-loader.mjs";
import { createJiraTaskBoardMcpHttpHandler } from "./mcp/jira-task-board-mcp.mjs";

// 适配层通过包的公开入口 import 这些子模块；re-export 保持入口作为唯一稳定 API 面。
export * from "./config-store.mjs";
export * from "./jira-client.mjs";
export * from "./jxl-client.mjs";
export { createIssueBindingStore, IssueBindingStoreError, normalizeBindingWorkspace } from "./lib/issue-binding-store.mjs";
export { createLocalApprovalProvider, ActionConfirmationError } from "./lib/approval-provider.mjs";
export { createJiraWorkbenchService } from "./lib/jira-workbench-service.mjs";
export { buildSvnCommitMessage, createSvnReviewManager, SvnReviewError } from "./lib/svn-review-manager.mjs";
export { createSvnWorkbenchService } from "./lib/svn-workbench-service.mjs";
export { createNullReviewAuditProvider } from "./lib/null-review-audit-provider.mjs";
export { createTaskBoardLoader } from "./lib/task-board-loader.mjs";
export { findCachedAttachment, materializeAttachment, openLocalAttachment } from "./lib/attachment-cache.mjs";
export { buildIssueDetailSnapshot, createJiraTaskBoardMcpServer, createJiraTaskBoardMcpHttpHandler } from "./mcp/jira-task-board-mcp.mjs";
export {
  buildToolDefinitions,
  buildTaskBoardSnapshot,
  buildSheetsSnapshot,
  buildSheetIssuesSnapshot
} from "./tools.mjs";
export { buildIssuePrompt, isBugIssue } from "./public/prompt-builder.js";
export { attachmentCanOpenLocally } from "./public/issue-views.js";

function userDataRoot() {
  return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "jira-workbench");
}

/**
 * 组装一个宿主无关的 core 服务：只读 Jira 工作台 + SVN 人工审核，不含
 * Codex 会话、桌面操作、自动 Bug 分析或 GitHub 更新。审查审计使用空 provider
 * 降级，SVN 提交仍走机械检查、一次性确认与提交对账。
 */
export function createCoreService({
  configFile = process.env.JIRA_WORKBENCH_CONFIG_FILE || join(userDataRoot(), "config.json"),
  bindingsFile = process.env.JIRA_WORKBENCH_BINDINGS_FILE || join(userDataRoot(), "issue-bindings.json"),
  baselineFile = process.env.JIRA_WORKBENCH_SVN_BASELINES_FILE || join(userDataRoot(), "svn-baselines.json"),
  reviewStateFile = process.env.JIRA_WORKBENCH_SVN_REVIEWS_FILE || join(userDataRoot(), "svn-reviews.json"),
  reviewArtifactsRoot = process.env.JIRA_WORKBENCH_SVN_REVIEW_ARTIFACTS_DIR
    || join(userDataRoot(), "attachments", "svn-reviews"),
  secretStore,
  approvalProvider,
  version = "0.32.3"
} = {}) {
  const configStore = createConfigStore({ configFile, ...(secretStore ? { secretStore } : {}) });
  const jira = createJiraClient();
  const jxl = createJxlClient();
  const issueBindings = createIssueBindingStore({ file: bindingsFile });
  const attachmentCacheRoot = join(dirname(configStore.configFile), "attachments");
  const taskBoardLoader = createTaskBoardLoader({ jira, configStore, attachmentCacheRoot });

  const jiraWorkbench = createJiraWorkbenchService({
    loadIssues: taskBoardLoader.loadTaskBoardIssues,
    loadConfig: () => configStore.load(),
    resolveConfig: taskBoardLoader.resolveCollaboratorFieldConfig,
    jira,
    jxl,
    issueBindings
  });

  const nullAudit = createNullReviewAuditProvider();
  const svnReviews = createSvnReviewManager({
    turnReader: nullAudit.turnReader,
    sessionReader: nullAudit.sessionReader,
    baselineFile,
    reviewStateFile,
    reviewArtifactsRoot
  });

  const svnWorkbench = createSvnWorkbenchService({
    loadConfig: () => configStore.load(),
    resolveConfig: taskBoardLoader.resolveCollaboratorFieldConfig,
    jira,
    issueBindings,
    reviews: svnReviews,
    buildCommitMessage: buildSvnCommitMessage
  });

  const handleMcp = createJiraTaskBoardMcpHttpHandler({
    workbench: jiraWorkbench,
    svn: svnWorkbench,
    version,
    ...(approvalProvider ? { approvalProvider } : {})
  });

  return {
    configStore,
    jira,
    jxl,
    issueBindings,
    taskBoardLoader,
    jiraWorkbench,
    svnReviews,
    svnWorkbench,
    handleMcp,
    version
  };
}
