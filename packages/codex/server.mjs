import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ConfigurationError,
  buildBoardQueries,
  createConfigStore
} from "@jira-workbench/core/config-store.mjs";
import { JiraApiError, createJiraClient } from "@jira-workbench/core/jira-client.mjs";
import { createJxlClient } from "@jira-workbench/core/jxl-client.mjs";
import {
  findCachedAttachment,
  materializeAttachment,
  openLocalAttachment
} from "@jira-workbench/core/lib/attachment-cache.mjs";
import { createTaskBoardLoader } from "@jira-workbench/core/lib/task-board-loader.mjs";
import { createAutomationManager } from "./lib/automation-manager.mjs";
import { createBugMonitorService } from "./lib/bug-monitor-service.mjs";
import { createDesktopCommandBroker, DesktopCommandError } from "./lib/desktop-command-broker.mjs";
import { createGitHubUpdateChecker } from "./lib/github-update-checker.mjs";
import { createUpdateManager, UpdateManagerError } from "./lib/update-manager.mjs";
import {
  CodexAppServerError,
  createCodexAppServerClient
} from "./lib/codex-app-server-client.mjs";
import { createCodexRuntimeGateway } from "./lib/codex-runtime-gateway.mjs";
import { createNeutralTurnReader } from "./lib/codex-neutral-turn-reader.mjs";
import {
  CodexConversationServiceError,
  createCodexConversationService
} from "./lib/codex-conversation-service.mjs";
import { createCodexSessionReader } from "./lib/codex-session-reader.mjs";
import {
  createIssueBindingStore,
  IssueBindingStoreError,
  normalizeBindingWorkspace
} from "@jira-workbench/core/lib/issue-binding-store.mjs";
import { createIssueWorkspaceStore } from "@jira-workbench/core/lib/issue-workspace-store.mjs";
import { createIssueWorkspaceService } from "@jira-workbench/core/lib/issue-workspace-service.mjs";
import { createJiraWorkbenchService } from "@jira-workbench/core/lib/jira-workbench-service.mjs";
import {
  buildSvnCommitMessage,
  createSvnReviewManager,
  SvnReviewError
} from "@jira-workbench/core/lib/svn-review-manager.mjs";
import { createSvnWorkbenchService } from "@jira-workbench/core/lib/svn-workbench-service.mjs";
import { buildIssueDetailSnapshot, createJiraTaskBoardMcpHttpHandler } from "@jira-workbench/core/mcp/jira-task-board-mcp.mjs";
import { buildIssuePrompt, isBugIssue } from "@jira-workbench/core/public/prompt-builder.js";
import { attachmentCanOpenLocally } from "@jira-workbench/core/public/issue-views.js";

const VERSION = "0.33.6";
const host = process.env.JIRA_WORKBENCH_HOST || "127.0.0.1";
const port = Number(process.env.JIRA_WORKBENCH_PORT || 47823);
const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const corePromptBuilderFile = fileURLToPath(import.meta.resolve("@jira-workbench/core/public/prompt-builder.js"));
const coreIssueViewsFile = fileURLToPath(import.meta.resolve("@jira-workbench/core/public/issue-views.js"));
const coreMcpUiFile = fileURLToPath(import.meta.resolve("@jira-workbench/core/mcp/ui/task-board.html"));
const configStore = createConfigStore();
const updateChecker = createGitHubUpdateChecker({
  currentVersion: VERSION,
  repository: process.env.JIRA_WORKBENCH_UPDATE_REPOSITORY || "yzj555/jira-workbench",
  releaseUrl: process.env.JIRA_WORKBENCH_UPDATE_RELEASE_URL || undefined,
  packageUrl: process.env.JIRA_WORKBENCH_UPDATE_PACKAGE_URL || undefined,
  repositoryUrl: process.env.JIRA_WORKBENCH_UPDATE_REPOSITORY_URL || undefined
});
const codexAppServer = createCodexAppServerClient({
  clientInfo: {
    name: "jira_workbench",
    title: "Jira Workbench",
    version: VERSION
  }
});
const codexRuntime = createCodexRuntimeGateway({ appServer: codexAppServer });
// 中性 turnReader：把 App Server 原始形状（items/fileChange）映射成宿主无关的
// 中性形状（messages/fileChanges），只给 svn-review-manager 用。codexRuntime 本身
// 仍以原始形状服务前端 UI 与 automation。
const neutralTurnReader = createNeutralTurnReader(codexRuntime);
const attachmentCacheRoot = join(dirname(configStore.configFile), "attachments");
const issueBindings = createIssueBindingStore({
  file: process.env.JIRA_WORKBENCH_BINDINGS_FILE
    || join(dirname(configStore.configFile), "issue-bindings.json")
});
const issueWorkspaces = createIssueWorkspaceStore({
  file: process.env.JIRA_WORKBENCH_WORKSPACES_FILE
    || join(dirname(configStore.configFile), "issue-workspaces.json")
});
const workspaceBindings = createIssueWorkspaceService({ store: issueWorkspaces });
const desktopCommands = createDesktopCommandBroker();
const jira = createJiraClient();
const taskBoardLoader = createTaskBoardLoader({
  jira,
  configStore,
  attachmentCacheRoot
});
const jxl = createJxlClient();
const sessionsRoot = process.env.CODEX_SESSIONS_DIR
  || join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
const sessionReader = createCodexSessionReader({ sessionsRoot });
const automation = createAutomationManager({
  stateFile: process.env.JIRA_WORKBENCH_AUTOMATION_FILE || join(dirname(configStore.configFile), "automation.json"),
  configStore,
  turnReader: codexRuntime,
  sessionReader
});
const svnReviews = createSvnReviewManager({
  turnReader: neutralTurnReader,
  sessionReader,
  baselineFile: process.env.JIRA_WORKBENCH_SVN_BASELINES_FILE
    || join(dirname(configStore.configFile), "svn-baselines.json"),
  reviewStateFile: process.env.JIRA_WORKBENCH_SVN_REVIEWS_FILE
    || join(dirname(configStore.configFile), "svn-reviews.json"),
  reviewArtifactsRoot: process.env.JIRA_WORKBENCH_SVN_REVIEW_ARTIFACTS_DIR
    || join(attachmentCacheRoot, "svn-reviews")
});

function normalizeAppServerSkills(result) {
  const groups = [result?.data, result?.result?.data, result?.skills, result?.result?.skills]
    .find((value) => Array.isArray(value)) || [];
  const unique = new Map();
  for (const group of groups) {
    const skills = Array.isArray(group?.skills) ? group.skills : group?.name ? [group] : [];
    for (const skill of skills) {
      const name = String(skill?.name || "").trim();
      const path = String(skill?.path || "").trim();
      if (!name || !path || unique.has(path.toLowerCase())) continue;
      unique.set(path.toLowerCase(), {
        name,
        path,
        scope: String(skill?.scope || ""),
        enabled: skill?.enabled !== false,
        description: String(skill?.description || skill?.shortDescription || ""),
        shortDescription: String(skill?.shortDescription || skill?.interface?.short_description || "")
      });
    }
  }
  return Array.from(unique.values()).sort((left, right) => (
    left.name.localeCompare(right.name) || left.path.localeCompare(right.path)
  ));
}

function availableSkillsFromResult(result) {
  const groups = [result?.data, result?.result?.data, result?.skills, result?.result?.skills]
    .find((value) => Array.isArray(value)) || [];
  return groups.flatMap((group) => Array.isArray(group?.skills) ? group.skills : group?.name ? [group] : [])
    .flatMap((skill) => {
      const name = String(skill?.name || "").trim();
      const path = String(skill?.path || "").trim();
      return name && path && skill?.enabled !== false ? [{ name, path, scope: String(skill?.scope || "") }] : [];
    });
}

function configuredAnalysisWorkspace(config) {
  if (!config.codexProjectId || !config.codexProjectPath) return null;
  return normalizeBindingWorkspace({
    cwd: config.codexProjectPath,
    workspaceRoots: config.codexProjectRoots?.length
      ? config.codexProjectRoots
      : [config.codexProjectPath],
    projectId: config.codexProjectId,
    projectLabel: config.codexProjectLabel || config.codexProjectId,
    kind: "project",
    source: "configured-codex-project"
  });
}

async function prepareManualIssueAnalysis(issueKey, supplementalDescription = "", requestedWorkspace = null, {
  useConfiguredWorkspace = true
} = {}) {
  const [{ issue }, config] = await Promise.all([
    jiraWorkbench.getIssue(issueKey),
    configStore.load()
  ]);
  const kind = isBugIssue(issue) ? "bug" : "requirement";
  const template = config.promptTemplates?.[kind] || {};
  const workspace = normalizeBindingWorkspace(requestedWorkspace)
    || (useConfiguredWorkspace ? configuredAnalysisWorkspace(config) : null);
  const skillCwds = workspace?.projectScopes?.length
    ? workspace.projectScopes.flatMap((scope) => scope.workspaceRoots?.length ? scope.workspaceRoots : [scope.cwd])
    : workspace?.cwd ? [workspace.cwd] : undefined;
  const availableSkills = availableSkillsFromResult(await codexRuntime.listSkills({
    cwds: skillCwds,
    forceReload: false
  }).catch(() => ({})));
  const configuredSkill = template.skill && typeof template.skill === "object" ? template.skill : null;
  const selectedSkill = configuredSkill
    ? availableSkills.find((skill) => configuredSkill.path && skill.path.toLowerCase() === String(configuredSkill.path).toLowerCase())
      || availableSkills.find((skill) => skill.name === configuredSkill.name)
    : null;
  const fallbackSkill = {
    name: "jira-first-turn-analysis",
    path: join(root, "skills", "jira-first-turn-analysis", "SKILL.md"),
    scope: "app"
  };
  const skills = selectedSkill ? [selectedSkill] : [fallbackSkill];
  const fallbackNotice = configuredSkill && !selectedSkill
    ? `绑定 Skill“${configuredSkill.name || configuredSkill.path}”当前不可用，已降级为分析模板和内置 Jira Skill。`
    : "";
  return {
    issue,
    message: buildIssuePrompt(issue, {
      messageTemplate: template.content || config.messageTemplate || "",
      includeAnalysisInstructions: !selectedSkill,
      supplementalDescription,
      fallbackNotice
    }),
    title: [`分析 ${issue.key}`, issue.title || ""].filter(Boolean).join(" ").slice(0, 180),
    cwd: workspace?.cwd || "",
    workspace,
    skills,
    attachments: await taskBoardLoader.materializeBugMonitorAttachments(issue, config)
  };
}

const bugMonitor = createBugMonitorService({
  stateFile: process.env.JIRA_WORKBENCH_BUG_MONITOR_FILE
    || join(dirname(configStore.configFile), "bug-monitor.json"),
  configStore,
  loadIssues: taskBoardLoader.loadTaskBoardIssues,
  loadIssueContext: async (issue) => (await jiraWorkbench.getIssue(issue.key)).issue,
  issueBindings,
  runtime: codexRuntime,
  automationManager: automation,
  prepareAttachments: taskBoardLoader.materializeBugMonitorAttachments,
  resolveWorkspace: async (config) => {
    return String(config?.codexProjectPath || "").trim();
  },
  fallbackSkill: {
    name: "jira-first-turn-analysis",
    path: join(root, "skills", "jira-first-turn-analysis", "SKILL.md"),
    scope: "app"
  }
});

const updateManager = createUpdateManager({
  currentVersion: VERSION,
  installRoot: dirname(dirname(root)),
  updaterSource: join(root, "installer", "update-bootstrap.ps1"),
  updaterLauncherSource: join(root, "scripts", "update-launcher.mjs"),
  restartSource: join(root, "scripts", "restart-codex-after-update.ps1"),
  userDataRoot: dirname(configStore.configFile),
  onInstallHandoff: () => scheduleUpdateShutdown(),
  blockerProvider: async () => {
    const [monitorStatus, svnOperations] = await Promise.all([
      bugMonitor.getStatus(),
      Promise.resolve(svnReviews.getActiveOperations?.() || [])
    ]);
    const blockers = [...svnOperations];
    if (monitorStatus.busy || monitorStatus.activeJob) {
      blockers.push({
        kind: "bug_analysis",
        issueKey: monitorStatus.activeJob?.issueKey || "",
        message: monitorStatus.activeJob?.issueKey
          ? `${monitorStatus.activeJob.issueKey} 正在自动分析`
          : "自动 Bug 分析正在运行"
      });
    }
    const desktopSnapshot = desktopCommands.snapshot();
    if (desktopSnapshot.pending > 0) {
      blockers.push({
        kind: "desktop_operation",
        count: desktopSnapshot.pending,
        message: `${desktopSnapshot.pending} 个 Codex Desktop 操作尚未完成`
      });
    }
    return blockers;
  }
});

const jiraWorkbench = createJiraWorkbenchService({
  loadIssues: taskBoardLoader.loadTaskBoardIssues,
  loadConfig: () => configStore.load(),
  resolveConfig: taskBoardLoader.resolveCollaboratorFieldConfig,
  jira,
  jxl,
  issueBindings
});

const codexConversations = createCodexConversationService({
  runtime: codexRuntime,
  issueBindings
});

const svnWorkbench = createSvnWorkbenchService({
  loadConfig: () => configStore.load(),
  resolveConfig: taskBoardLoader.resolveCollaboratorFieldConfig,
  jira,
  issueBindings,
  issueWorkspaces,
  reviews: svnReviews,
  runtime: codexRuntime,
  buildCommitMessage: buildSvnCommitMessage
});

async function syncConversationWorkspaces(bindings) {
  const candidates = Object.fromEntries(Object.entries(bindings || {}).flatMap(([issueKey, binding]) => (
    binding?.workspace
      ? [[issueKey, { workspace: binding.workspace, source: "conversation-binding-sync", updatedAt: binding.updatedAt }]]
      : []
  )));
  if (!Object.keys(candidates).length) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await issueWorkspaces.snapshot();
    try {
      await issueWorkspaces.applyMutations({ upserts: candidates, expectedRevision: state.revision });
      return;
    } catch (error) {
      if (error?.code !== "ISSUE_WORKSPACES_REVISION_CONFLICT" || attempt === 2) throw error;
    }
  }
}

void issueBindings.snapshot()
  .then((state) => issueWorkspaces.importConversationBindings(state))
  .catch((error) => console.warn(`[jira-workbench] 项目绑定迁移跳过：${error?.message || error}`));

async function openIssueConversation(issueKey, { targetClientId = "" } = {}) {
  const key = String(issueKey || "").trim().toUpperCase();
  const state = await issueBindings.snapshot();
  const binding = state.bindings?.[key];
  if (!binding?.threadId) {
    throw new CodexConversationServiceError(`${key} 当前没有已关联的 Codex 会话。`, {
      code: "ISSUE_NOT_BOUND",
      statusCode: 409
    });
  }
  const result = await desktopCommands.request("open-thread", {
    issueKey: key,
    threadId: binding.threadId
  }, { timeoutMs: 15_000, targetClientId });
  return { opened: true, threadId: result?.threadId || binding.threadId };
}

function scheduleIssueBaselines({ issueKey, threadId, boundAt } = {}) {
  const record = typeof svnWorkbench.recordBaselines === "function"
    ? svnWorkbench.recordBaselines.bind(svnWorkbench)
    : svnWorkbench.recordBaseline.bind(svnWorkbench);
  void record({ issueKey, threadId, boundAt }).catch((error) => {
    console.warn(`[jira-poc] SVN baselines for ${issueKey} skipped: ${error.message || error}`);
  });
}

async function bindIssueConversation(input) {
  const result = await codexConversations.bindIssue(input);
  await syncConversationWorkspaces({ [result.issueKey]: result.binding });
  scheduleIssueBaselines({
    issueKey: result.issueKey,
    threadId: result.binding?.threadId,
    boundAt: result.binding?.boundAt || result.binding?.updatedAt
  });
  return result;
}

async function createIssueAnalysis(issueKey, supplementalDescription = "", {
  targetClientId = "",
  expectedRevision,
  workspace,
  workspaceSelection = "preserve"
} = {}) {
  const key = String(issueKey || "").trim().toUpperCase();
  const initialBindingState = await issueBindings.snapshot();
  const baselineRevision = expectedRevision == null
    ? initialBindingState.revision
    : Number(expectedRevision);
  if (!Number.isInteger(baselineRevision) || baselineRevision < 0) {
    throw new CodexConversationServiceError("expectedRevision 必须是非负整数。", {
      code: "INVALID_EXPECTED_REVISION",
      statusCode: 400
    });
  }
  if (baselineRevision !== initialBindingState.revision) {
    throw new CodexConversationServiceError("会话绑定关系刚刚发生变化，请刷新后重新确认。", {
      code: "ISSUE_BINDINGS_REVISION_CONFLICT",
      statusCode: 409,
      details: {
        stage: "before_create",
        issueKey: key,
        expectedRevision: baselineRevision,
        currentRevision: initialBindingState.revision
      }
    });
  }
  const selectionMode = String(workspaceSelection || "preserve").trim().toLowerCase();
  if (!new Set(["preserve", "explicit", "none"]).has(selectionMode)) {
    throw new CodexConversationServiceError("workspaceSelection 必须是 preserve、explicit 或 none。", {
      code: "INVALID_WORKSPACE_SELECTION",
      statusCode: 400
    });
  }
  const explicitWorkspace = normalizeBindingWorkspace(workspace);
  if (selectionMode === "explicit" && !explicitWorkspace) {
    throw new CodexConversationServiceError("请选择至少一个有效的项目目录。", {
      code: "INVALID_PROJECT_WORKSPACE",
      statusCode: 400
    });
  }
  const requestedWorkspace = selectionMode === "none"
    ? null
    : explicitWorkspace || normalizeBindingWorkspace(initialBindingState.bindings?.[key]?.workspace);
  const prepared = await prepareManualIssueAnalysis(key, supplementalDescription, requestedWorkspace, {
    useConfiguredWorkspace: selectionMode !== "none"
  });
  const started = await desktopCommands.request("create-analysis", {
    issueKey: key,
    message: prepared.message,
    title: prepared.title,
    cwd: prepared.cwd,
    workspaceRoots: prepared.workspace?.workspaceRoots || (prepared.cwd ? [prepared.cwd] : []),
    projectId: prepared.workspace?.projectId || "",
    skills: prepared.skills,
    attachments: prepared.attachments
  }, { timeoutMs: 55_000, targetClientId });
  const threadId = String(started?.threadId || "").trim();
  if (!threadId || threadId.startsWith("client-new-thread:")) {
    throw new DesktopCommandError("Codex Desktop 未返回正式会话 ID，未保存 Jira 关联。", {
      code: "DESKTOP_THREAD_ID_UNRESOLVED",
      statusCode: 503
    });
  }
  const boundAt = new Date().toISOString();
  const binding = {
    threadId,
    threadTitle: prepared.title,
    issueTitle: prepared.issue.title || "",
    runtimeOwner: "desktop-appserver",
    hostReference: "current-codex-window",
    analysisTurnId: String(started?.turnId || ""),
    firstMessageStatus: "sent",
    firstMessageUpdatedAt: boundAt,
    boundAt,
    updatedAt: boundAt,
    ...(prepared.workspace ? { workspace: { ...prepared.workspace, source: "desktop-analysis", observedAt: boundAt } } : prepared.cwd ? {
      workspace: { cwd: prepared.cwd, workspaceRoots: [prepared.cwd], source: "desktop-analysis", observedAt: boundAt }
    } : {})
  };
  let next;
  try {
    next = await issueBindings.applyMutations({
      upserts: { [key]: binding },
      expectedRevision: baselineRevision
    });
  } catch (error) {
    if (error?.code !== "ISSUE_BINDINGS_REVISION_CONFLICT") throw error;
    const currentBindingState = await issueBindings.snapshot();
    throw new CodexConversationServiceError(
      "Codex 会话已经创建，但绑定关系同时发生了变化，因此未自动覆盖现有绑定。请从已有会话中选择新会话并人工确认绑定。",
      {
        code: "ISSUE_ANALYSIS_CREATED_UNBOUND",
        statusCode: 409,
        details: {
          stage: "created_unbound",
          issueKey: key,
          threadId,
          turnId: String(started?.turnId || ""),
          expectedRevision: baselineRevision,
          currentRevision: currentBindingState.revision
        }
      }
    );
  }
  await syncConversationWorkspaces({ [key]: next.bindings?.[key] || binding });
  scheduleIssueBaselines({ threadId, issueKey: key, boundAt });
  return {
    issueKey: key,
    threadId,
    turnId: String(started?.turnId || ""),
    binding: next.bindings?.[key] || binding,
    bindingsRevision: next.revision,
    issueSnapshot: buildIssueDetailSnapshot({
      issue: prepared.issue,
      binding: next.bindings?.[key] || binding,
      bindingsRevision: next.revision
    })
  };
}

const mcpOptions = {
  workbench: jiraWorkbench,
  conversations: {
    ...codexConversations,
    bindIssue: bindIssueConversation
  },
  svn: svnWorkbench,
  workspaces: workspaceBindings,
  automation: {
    getStatus: () => bugMonitor.getStatus(),
    setEnabled: async (enabled) => {
      await configStore.setBugMonitorEnabled(enabled);
      bugMonitor.wake();
      return bugMonitor.getStatus();
    }
  },
  updates: {
    getStatus: ({ force = false } = {}) => getFullUpdateStatus({ force }),
    startDownload: async () => {
      const update = await getUpdateStatus({ force: true });
      return { update, installation: await updateManager.startDownload(update, { autoInstall: true }) };
    },
    cancelDownload: async () => {
      const update = await getUpdateStatus();
      return { update, installation: await updateManager.cancelDownload(update) };
    },
    restart: async () => {
      return { update: await getUpdateStatus(), installation: await updateManager.restart() };
    }
  },
  version: VERSION,
  serverName: "jira-workbench-assistant"
};
const handleMcp = createJiraTaskBoardMcpHttpHandler((request) => {
  const requestedClientId = String(request.headers["x-jira-workbench-desktop-client"] || "").trim();
  const liveClients = desktopCommands.activeClients();
  const targetClientId = requestedClientId || (liveClients.length === 1 ? liveClients[0] : "");
  const requireDesktopTarget = () => {
    if (targetClientId) return targetClientId;
    throw new DesktopCommandError(
      liveClients.length > 1
        ? "当前有多个 Codex 窗口，官方 Plugin 无法确定应在哪个窗口执行。请从目标窗口的 Jira 任务面板操作。"
        : "当前没有可用的 Codex Desktop 窗口。请先通过统一入口启动 Codex。",
      {
        code: liveClients.length > 1 ? "DESKTOP_TARGET_AMBIGUOUS" : "DESKTOP_TARGET_UNAVAILABLE",
        statusCode: 409
      }
    );
  };
  return {
    ...mcpOptions,
    desktop: {
      openIssueConversation: (issueKey) => openIssueConversation(issueKey, { targetClientId: requireDesktopTarget() }),
      createIssueAnalysis: (issueKey, supplementalDescription, options = {}) => createIssueAnalysis(
        issueKey,
        supplementalDescription,
        {
          targetClientId: requireDesktopTarget(),
          ...(options.expectedRevision == null ? {} : { expectedRevision: options.expectedRevision })
        }
      )
    }
  };
});

async function jiraConfigForPreview(request) {
  if (request.method !== "POST") return configStore.load();
  const input = await readJson(request);
  const current = await configStore.load();
  // Preview endpoints deliberately use the token currently in the form but
  // never persist it. This lets first-time setup discover projects/filters
  // before the user commits the configuration.
  return configStore.prepare({
    deployment: "data_center",
    baseUrl: input.baseUrl ?? current.baseUrl,
    token: input.token ?? ""
  });
}

const staticFiles = new Map([
  ["/", [join(publicDir, "index.html"), "text/html; charset=utf-8"]],
  ["/index.html", [join(publicDir, "index.html"), "text/html; charset=utf-8"]],
  ["/app.js", [join(publicDir, "app.js"), "text/javascript; charset=utf-8"]],
  ["/prompt-builder.js", [corePromptBuilderFile, "text/javascript; charset=utf-8"]],
  ["/issue-views.js", [coreIssueViewsFile, "text/javascript; charset=utf-8"]],
  ["/styles.css", [join(publicDir, "styles.css"), "text/css; charset=utf-8"]],
  ["/mcp-app.html", [coreMcpUiFile, "text/html; charset=utf-8"]]
]);

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request, { maxBytes = 64 * 1024 } = {}) {
  const contentType = String(request.headers["content-type"] || "").trim();
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new ConfigurationError("JSON 请求必须使用 application/json 内容类型。", {
      code: "UNSUPPORTED_MEDIA_TYPE",
      statusCode: 415
    });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      throw new ConfigurationError("请求内容过大。", { code: "REQUEST_TOO_LARGE", statusCode: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ConfigurationError("请求不是有效的 JSON。", { code: "INVALID_JSON" });
  }
}

function effectivePort(url) {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "[::1]"
    || normalized === "::1";
}

function assertAllowedWriteOrigin(request, requestUrl) {
  const method = String(request.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return;

  const origin = String(request.headers.origin || "").trim();
  // The desktop injection bridge, MCP clients and CLI calls do not send an
  // Origin header. They remain valid local callers; this check only rejects
  // browser write requests that explicitly identify a foreign origin.
  if (!origin) return;

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new ConfigurationError("不允许来自非本地页面的写请求。", {
      code: "WRITE_ORIGIN_FORBIDDEN",
      statusCode: 403
    });
  }

  if (!isLoopbackHostname(originUrl.hostname) || effectivePort(originUrl) !== effectivePort(requestUrl)) {
    throw new ConfigurationError("不允许来自非本地页面的写请求。", {
      code: "WRITE_ORIGIN_FORBIDDEN",
      statusCode: 403
    });
  }
}

async function getUpdateStatus({ force = false } = {}) {
  const config = await configStore.getPublic();
  return updateChecker.check({
    enabled: config.syncSettings?.updateCheckEnabled !== false,
    force: Boolean(force)
  });
}

async function getFullUpdateStatus({ force = false } = {}) {
  const update = await getUpdateStatus({ force });
  return {
    update,
    installation: await updateManager.status(update)
  };
}

let updateShutdownScheduled = false;
function scheduleUpdateShutdown() {
  updateShutdownScheduled = true;
  const timer = setTimeout(() => void shutdown(), 800);
  timer.unref?.();
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    const config = await configStore.getPublic();
    return json(response, 200, {
      ok: true,
      name: "jira-workbench",
      version: VERSION,
      jiraConfigured: config.configured
    });
  }

  if (request.method === "GET" && url.pathname === "/api/update-status") {
    return json(response, 200, await getFullUpdateStatus({ force: url.searchParams.get("force") === "true" }));
  }

  if (request.method === "POST" && url.pathname === "/api/update/download") {
    await readJson(request);
    const update = await getUpdateStatus({ force: true });
    return json(response, 202, {
      update,
      installation: await updateManager.startDownload(update, { autoInstall: true })
    });
  }

  if (request.method === "DELETE" && url.pathname === "/api/update/download") {
    const update = await getUpdateStatus();
    return json(response, 200, { update, installation: await updateManager.cancelDownload(update) });
  }

  if (request.method === "POST" && url.pathname === "/api/update/restart") {
    await readJson(request);
    return json(response, 202, {
      update: await getUpdateStatus(),
      installation: await updateManager.restart()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/desktop/commands/next") {
    return json(response, 200, {
      command: desktopCommands.take(url.searchParams.get("clientId") || "")
    });
  }

  const desktopCommandResultMatch = url.pathname.match(/^\/api\/desktop\/commands\/([0-9a-f-]+)\/result$/i);
  if (request.method === "PUT" && desktopCommandResultMatch) {
    return json(response, 200, desktopCommands.complete(desktopCommandResultMatch[1], await readJson(request)));
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return json(response, 200, { config: await configStore.getPublic() });
  }

  if (request.method === "GET" && url.pathname === "/api/bindings") {
    return json(response, 200, await codexConversations.getBindings());
  }

  if (request.method === "GET" && url.pathname === "/api/workspaces") {
    return json(response, 200, await workspaceBindings.get(url.searchParams.get("issueKey") || ""));
  }

  if (request.method === "PUT" && url.pathname === "/api/workspaces") {
    return json(response, 200, await workspaceBindings.bind(await readJson(request)));
  }

  if (request.method === "DELETE" && url.pathname === "/api/workspaces") {
    return json(response, 200, await workspaceBindings.unbind(await readJson(request)));
  }

  if (request.method === "PUT" && url.pathname === "/api/bindings/import") {
    const input = await readJson(request, { maxBytes: 1024 * 1024 });
    return json(response, 200, await issueBindings.importBindings(input.bindings));
  }

  if (request.method === "PUT" && url.pathname === "/api/bindings/mutations") {
    const input = await readJson(request, { maxBytes: 1024 * 1024 });
    const result = await issueBindings.compareAndSwap(input);
    await syncConversationWorkspaces(input.upserts);
    return json(response, 200, result);
  }

  if (request.method === "GET" && url.pathname === "/api/codex/conversations") {
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    return json(response, 200, await codexConversations.listThreads({
      limit: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50,
      searchTerm: url.searchParams.get("searchTerm") || "",
      cwd: url.searchParams.get("cwd") || ""
    }));
  }

  if (request.method === "PUT" && url.pathname === "/api/codex/bindings") {
    return json(response, 200, await bindIssueConversation(await readJson(request)));
  }

  const clearCodexBindingMatch = url.pathname.match(/^\/api\/codex\/bindings\/([A-Za-z][A-Za-z0-9_]*-\d+)$/);
  if (request.method === "DELETE" && clearCodexBindingMatch) {
    const input = await readJson(request);
    return json(response, 200, await codexConversations.clearBinding({
      issueKey: clearCodexBindingMatch[1],
      expectedRevision: input.expectedRevision
    }));
  }

  const openIssueConversationMatch = url.pathname.match(
    /^\/api\/codex\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)\/open$/
  );
  if (request.method === "POST" && openIssueConversationMatch) {
    const targetClientId = String(request.headers["x-jira-workbench-desktop-client"] || "").trim();
    if (!targetClientId) {
      throw new ConfigurationError("缺少当前 Codex 窗口标识。", {
        code: "DESKTOP_CLIENT_ID_REQUIRED",
        statusCode: 400
      });
    }
    return json(response, 200, await openIssueConversation(openIssueConversationMatch[1], { targetClientId }));
  }

  const createIssueAnalysisMatch = url.pathname.match(
    /^\/api\/codex\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)\/analysis$/
  );
  if (request.method === "POST" && createIssueAnalysisMatch) {
    const input = await readJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ConfigurationError("请求内容必须是 JSON 对象。", {
        code: "INVALID_REQUEST_BODY",
        statusCode: 400
      });
    }
    if (input.supplementalDescription != null && typeof input.supplementalDescription !== "string") {
      throw new ConfigurationError("supplementalDescription 必须是字符串。", {
        code: "INVALID_SUPPLEMENTAL_DESCRIPTION",
        statusCode: 400
      });
    }
    if (input.workspace != null && (!input.workspace || typeof input.workspace !== "object" || Array.isArray(input.workspace))) {
      throw new ConfigurationError("workspace 必须是项目范围对象。", {
        code: "INVALID_PROJECT_WORKSPACE",
        statusCode: 400
      });
    }
    if (input.workspaceSelection != null
      && !["preserve", "explicit", "none"].includes(String(input.workspaceSelection).trim().toLowerCase())) {
      throw new ConfigurationError("workspaceSelection 必须是 preserve、explicit 或 none。", {
        code: "INVALID_WORKSPACE_SELECTION",
        statusCode: 400
      });
    }
    const targetClientId = String(request.headers["x-jira-workbench-desktop-client"] || "").trim();
    if (!targetClientId) {
      throw new ConfigurationError("缺少当前 Codex 窗口标识。", {
        code: "DESKTOP_CLIENT_ID_REQUIRED",
        statusCode: 400
      });
    }
    return json(response, 200, await createIssueAnalysis(
      createIssueAnalysisMatch[1],
      input.supplementalDescription || "",
      {
        targetClientId,
        expectedRevision: input.expectedRevision,
        workspace: input.workspace || null,
        workspaceSelection: input.workspaceSelection || "preserve"
      }
    ));
  }

  if (request.method === "GET" && url.pathname === "/api/codex/runtime") {
    return json(response, 200, {
      analysisSkill: {
        name: "jira-first-turn-analysis",
        path: join(root, "skills", "jira-first-turn-analysis", "SKILL.md"),
        scope: "app"
      },
      runtime: codexRuntime.snapshot(),
      appServer: codexAppServer.snapshot()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/codex/runtime/capabilities") {
    return json(response, 200, codexRuntime.getCapabilities());
  }

  if (request.method === "GET" && url.pathname === "/api/codex/app-server/status") {
    return json(response, 200, { appServer: codexAppServer.snapshot() });
  }

  if (request.method === "POST" && url.pathname === "/api/codex/app-server/probe") {
    const result = await codexRuntime.probe();
    return json(response, 200, {
      runtimeOwner: result.runtimeOwner,
      appServer: result
    });
  }

  if (request.method === "GET" && url.pathname === "/api/codex/app-server/skills") {
    const cwds = url.searchParams.getAll("cwd")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    const result = await codexRuntime.listSkills({
      cwds: cwds.length ? cwds : undefined,
      forceReload: url.searchParams.get("forceReload") === "true"
    });
    return json(response, 200, {
      skills: normalizeAppServerSkills(result),
      appServer: codexAppServer.snapshot()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/codex/app-server/threads") {
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    const result = await codexRuntime.listThreads({
      cursor: url.searchParams.get("cursor") || undefined,
      limit: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50,
      archived: url.searchParams.get("archived") === "true",
      searchTerm: url.searchParams.get("searchTerm") || undefined,
      cwd: url.searchParams.get("cwd") || undefined
    });
    return json(response, 200, {
      result: { ...result, runtimeOwner: codexRuntime.id },
      appServer: codexAppServer.snapshot()
    });
  }

  if (request.method === "POST" && url.pathname === "/api/codex/app-server/analysis") {
    const input = await readJson(request);
    const analysisOptions = {
      message: input.message,
      title: input.title,
      cwd: input.cwd,
      model: input.model,
      effort: input.effort,
      skills: input.skills,
      attachments: input.attachments,
      referenceFiles: input.referenceFiles === true,
      requireAllAttachments: input.referenceFiles !== true,
      outputSchema: input.outputSchema
    };
    const result = await codexRuntime.startReadOnlyAnalysis(analysisOptions);
    return json(response, 200, { result, appServer: codexAppServer.snapshot() });
  }

  if (request.method === "POST" && url.pathname === "/api/codex/app-server/turns") {
    const input = await readJson(request);
    const result = await codexRuntime.startReadOnlyTurn(input.threadId, {
      message: input.message,
      cwd: input.cwd,
      model: input.model,
      effort: input.effort,
      skills: input.skills,
      attachments: input.attachments,
      referenceFiles: input.referenceFiles === true,
      requireAllAttachments: input.referenceFiles !== true,
      outputSchema: input.outputSchema
    });
    return json(response, 200, { result, appServer: codexAppServer.snapshot() });
  }

  if (request.method === "POST" && url.pathname === "/api/codex/app-server/thread-state") {
    const input = await readJson(request);
    const result = await codexRuntime.readThread(input.threadId, { includeTurns: true });
    return json(response, 200, { result, appServer: codexAppServer.snapshot() });
  }

  if (request.method === "POST" && url.pathname === "/api/codex/app-server/thread-name") {
    const input = await readJson(request);
    const result = await codexRuntime.renameThread(input.threadId, input.name);
    return json(response, 200, { result, appServer: codexAppServer.snapshot() });
  }

  if (request.method === "POST" && url.pathname === "/api/codex/app-server/interrupt") {
    const input = await readJson(request);
    const result = await codexRuntime.interruptTurn(input.threadId, input.turnId);
    return json(response, 200, { result, appServer: codexAppServer.snapshot() });
  }

  if (request.method === "PUT" && url.pathname === "/api/config") {
    const candidate = await taskBoardLoader.resolveCollaboratorFieldConfig(
      await configStore.prepare(await readJson(request))
    );
    await taskBoardLoader.validateConfiguredFilters(candidate);
    if (candidate.boardSources?.legacy && candidate.jql) {
      await jira.fetchIssues(candidate, { maxResults: 1 });
    } else {
      const queries = buildBoardQueries(candidate.boardSources);
      await jira.fetchIssues({ ...candidate, jql: queries.activeJql }, { maxResults: 1 });
    }
    const config = await configStore.save(candidate);
    bugMonitor.wake();
    return json(response, 200, { config, connection: { ok: true } });
  }

  if (request.method === "DELETE" && url.pathname === "/api/config") {
    await configStore.clear();
    return json(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/automation/status") {
    return json(response, 200, await bugMonitor.getStatus());
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/monitor") {
    const input = await readJson(request);
    const config = await configStore.setBugMonitorEnabled(input.enabled);
    bugMonitor.wake();
    return json(response, 200, {
      config,
      automation: await bugMonitor.getStatus()
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/monitor/import") {
    const input = await readJson(request);
    const automation = await bugMonitor.importLegacyState(input);
    bugMonitor.wake();
    return json(response, 200, { automation });
  }

  if (request.method === "POST" && url.pathname === "/api/automation/scan") {
    await bugMonitor.poll();
    return json(response, 200, { automation: await bugMonitor.getStatus() });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/jobs") {
    const input = await readJson(request);
    return json(response, 200, {
      job: await automation.register(input),
      automation: await bugMonitor.getStatus()
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/jobs/fail") {
    const input = await readJson(request);
    return json(response, 200, {
      job: await automation.fail(input),
      automation: await bugMonitor.getStatus()
    });
  }

  if (["GET", "POST"].includes(request.method) && url.pathname === "/api/filters") {
    const config = await jiraConfigForPreview(request);
    if (!config.baseUrl || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    return json(response, 200, await jira.fetchFilters(config, {
      projectKey: url.searchParams.get("projectKey") || "",
      projectId: url.searchParams.get("projectId") || "",
      projectName: url.searchParams.get("projectName") || ""
    }));
  }

  if (["GET", "POST"].includes(request.method) && url.pathname === "/api/projects") {
    const config = await jiraConfigForPreview(request);
    if (!config.baseUrl || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    return json(response, 200, await jira.fetchProjects(config));
  }

  if (request.method === "GET" && url.pathname === "/api/issues") {
    return json(response, 200, await jiraWorkbench.listTasks());
  }

  if (request.method === "GET" && url.pathname === "/api/svn/context") {
    return json(response, 200, await svnWorkbench.context({
      issueKey: url.searchParams.get("issueKey"),
      threadId: url.searchParams.get("threadId"),
      projectScopeId: url.searchParams.get("projectScopeId"),
      includeReview: url.searchParams.get("includeReview") !== "0"
    }));
  }

  if (request.method === "GET" && url.pathname === "/api/svn/reviews/latest") {
    return json(response, 200, {
      review: await svnWorkbench.latestReview({
        threadId: url.searchParams.get("threadId"),
        issueKey: url.searchParams.get("issueKey"),
        projectScopeId: url.searchParams.get("projectScopeId")
      })
    });
  }

  if (request.method === "GET" && url.pathname === "/api/svn/diff") {
    return json(response, 200, {
      preview: await svnWorkbench.previewDiff({
        issueKey: url.searchParams.get("issueKey"),
        threadId: url.searchParams.get("threadId"),
        projectScopeId: url.searchParams.get("projectScopeId"),
        path: url.searchParams.get("path")
      })
    });
  }

  if (request.method === "POST" && url.pathname === "/api/svn/diff/open") {
    const input = await readJson(request);
    return json(response, 200, {
      result: await svnWorkbench.openExternalDiff({
        issueKey: input.issueKey,
        threadId: input.threadId,
        projectScopeId: input.projectScopeId,
        path: input.path
      })
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/svn/baselines") {
    const input = await readJson(request);
    return json(response, 200, {
      baseline: await svnWorkbench.recordBaseline({
        threadId: input.threadId,
        issueKey: input.issueKey,
        projectScopeId: input.projectScopeId,
        boundAt: input.boundAt
      })
    });
  }

  if (request.method === "POST" && url.pathname === "/api/svn/reviews") {
    const input = await readJson(request);
    return json(response, 201, await svnWorkbench.createReview({
      threadId: input.threadId,
      issueKey: input.issueKey,
      projectScopeId: input.projectScopeId,
      selectedPaths: input.selectedPaths,
      summary: input.summary,
      codexReviewEnabled: input.codexReviewEnabled === true
    }));
  }

  const svnReviewMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})$/i)
    : null;
  if (svnReviewMatch) {
    return json(response, 200, {
      review: await svnWorkbench.getReview(svnReviewMatch[1], url.searchParams.get("issueKey"))
    });
  }

  const svnCancelMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/cancel$/i)
    : null;
  if (svnCancelMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnWorkbench.cancelReview(svnCancelMatch[1], input.message, input.issueKey)
    });
  }

  const svnDispatchMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/dispatch$/i)
    : null;
  if (svnDispatchMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnWorkbench.dispatchReview(svnDispatchMatch[1], {
        auditThreadId: input.auditThreadId,
        auditTurnId: input.auditTurnId
      }, input.issueKey)
    });
  }

  const svnDispatchFailedMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/dispatch-failed$/i)
    : null;
  if (svnDispatchFailedMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnWorkbench.failDispatch(svnDispatchFailedMatch[1], input.message, input.issueKey)
    });
  }

  const svnRetryMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/retry$/i)
    : null;
  if (svnRetryMatch) {
    const input = await readJson(request);
    return json(response, 200, await svnWorkbench.retryReview(svnRetryMatch[1], input.issueKey));
  }

  const svnConfirmMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/confirm$/i)
    : null;
  if (svnConfirmMatch) {
    const input = await readJson(request);
    return json(response, 200, await svnWorkbench.confirmReview(svnConfirmMatch[1], {
      issueKey: input.issueKey,
      reviewed: input.reviewed,
      riskAcknowledged: input.riskAcknowledged,
      overlapAcknowledged: input.overlapAcknowledged
    }));
  }

  const svnCommitMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/commit$/i)
    : null;
  if (svnCommitMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnWorkbench.commitReview(svnCommitMatch[1], {
        issueKey: input.issueKey,
        confirmationToken: input.confirmationToken
      })
    });
  }

  const svnReconcileMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/reconcile$/i)
    : null;
  if (svnReconcileMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnWorkbench.reconcileCommit(svnReconcileMatch[1], input.issueKey)
    });
  }

  const svnConfirmCommittedMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/confirm-committed$/i)
    : null;
  if (svnConfirmCommittedMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnWorkbench.confirmCommitted(svnConfirmCommittedMatch[1], {
        acknowledged: input.acknowledged,
        revision: input.revision
      }, input.issueKey)
    });
  }

  const svnAbandonMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/abandon$/i)
    : null;
  if (svnAbandonMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnWorkbench.abandonReview(svnAbandonMatch[1], {
        acknowledged: input.acknowledged,
        message: input.message
      }, input.issueKey)
    });
  }

  const issueMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)$/)
    : null;
  if (issueMatch) {
    return json(response, 200, await jiraWorkbench.getIssue(issueMatch[1]));
  }

  const issueTransitionsMatch = ["GET", "POST"].includes(request.method)
    ? url.pathname.match(/^\/api\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)\/transitions$/)
    : null;
  if (issueTransitionsMatch) {
    const issueKey = issueTransitionsMatch[1];
    if (request.method === "GET") {
      return json(response, 200, await jiraWorkbench.listTransitions(issueKey));
    }
    const input = await readJson(request);
    const available = await jiraWorkbench.listTransitions(issueKey);
    const selected = (available.transitions || []).find((transition) => String(transition.id) === String(input.transitionId || ""));
    if (!selected || selected.requiresInput) {
      throw new ConfigurationError("该 Jira 状态流转已不可用，或需要在 Jira 中补充字段。请刷新后重试。", {
        code: "JIRA_TRANSITION_STALE_OR_REQUIRES_INPUT",
        statusCode: 409
      });
    }
    if (input.expectedTargetStatus && String(selected.to?.name || "") !== String(input.expectedTargetStatus)) {
      throw new ConfigurationError("Jira 状态流转目标已经变化，请刷新后重新确认。", {
        code: "JIRA_TRANSITION_TARGET_CHANGED",
        statusCode: 409
      });
    }
    return json(response, 200, await jiraWorkbench.executeTransition(issueKey, input.transitionId));
  }

  if (request.method === "GET" && url.pathname === "/api/jxl/sheets") {
    return json(response, 200, await jiraWorkbench.listSheets());
  }

  const jxlSheetIssuesMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/jxl\/sheets\/(\d+)\/([A-Za-z0-9_-]+)\/issues$/)
    : null;
  if (jxlSheetIssuesMatch) {
    return json(response, 200, await jiraWorkbench.getSheetIssues({
      projectId: jxlSheetIssuesMatch[1],
      sheetId: jxlSheetIssuesMatch[2]
    }));
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

  const attachmentOpenMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/attachments\/(\d+)\/open$/)
    : null;
  if (attachmentOpenMatch) {
    await readJson(request);
    const attachmentId = attachmentOpenMatch[1];
    const cached = await findCachedAttachment({ cacheRoot: attachmentCacheRoot, attachmentId });
    if (!cached) {
      throw new ConfigurationError("附件尚未下载，或本地缓存已经失效。请先重新下载。", {
        code: "ATTACHMENT_NOT_MATERIALIZED",
        statusCode: 409
      });
    }
    if (!attachmentCanOpenLocally(cached)) {
      throw new ConfigurationError("出于安全考虑，该附件只允许下载，不会自动调用本地程序打开。", {
        code: "ATTACHMENT_LOCAL_OPEN_NOT_ALLOWED",
        statusCode: 422
      });
    }
    try {
      await openLocalAttachment(cached.path);
    } catch (error) {
      throw new ConfigurationError(`无法使用系统默认程序打开附件：${error.message}`, {
        code: "ATTACHMENT_LOCAL_OPEN_FAILED",
        statusCode: 422
      });
    }
    return json(response, 200, {
      opened: true,
      attachment: {
        id: attachmentId,
        filename: cached.filename,
        size: cached.size
      }
    });
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

  const [filePath, contentType] = staticFile;
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
  if (updateShutdownScheduled && !["GET", "HEAD"].includes(request.method || "GET")
    && (url.pathname === "/mcp" || url.pathname.startsWith("/api/"))) {
    return json(response, 503, {
      error: "本地服务已进入更新交接阶段，请等待新版本启动。",
      code: "UPDATE_SHUTDOWN_IN_PROGRESS"
    });
  }
  if (url.pathname === "/mcp" || url.pathname.startsWith("/api/")) {
    assertAllowedWriteOrigin(request, url);
  }
  if (url.pathname === "/mcp") {
    await handleMcp(request, response);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(request, response, url);
    if (handled !== false) return;
  }
  await serveStatic(request, response, url);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const known = error instanceof ConfigurationError
      || error instanceof JiraApiError
      || error instanceof SvnReviewError
      || error instanceof IssueBindingStoreError
      || error instanceof CodexConversationServiceError
      || error instanceof DesktopCommandError
      || error instanceof UpdateManagerError
      || error instanceof CodexAppServerError;
    const statusCode = known ? error.statusCode || (error instanceof CodexAppServerError ? 503 : 500) : 500;
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

await svnReviews.initialize();

server.listen(port, host, () => {
  automation.start();
  bugMonitor.start();
  svnReviews.start();
  console.log(`[jira-poc] panel server: http://${host}:${port}`);
  console.log(`[jira-poc] credential store: ${configStore.configFile}`);
});

let shutdownStarted = false;
async function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  desktopCommands.close();
  await bugMonitor.stop();
  automation.stop();
  await codexRuntime.close();
  await svnReviews.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
