import {
  DEFAULT_BUG_MESSAGE_TEMPLATE,
  DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE,
  isBugIssue
} from "/prompt-builder.js";
import {
  attachmentCanOpenLocally,
  attachmentPreviewKind,
  filterAndSortSheetIssues,
  filterIssuesForView,
  splitIssuesByType,
  summarizeIssueViews
} from "/issue-views.js";

const HOST_THEME_TOKEN_KEYS = [
  "bg", "surface", "surface-under", "elevated", "control", "muted", "hover",
  "text", "text-secondary", "text-muted", "border", "border-strong", "accent",
  "accent-soft", "on-accent", "button", "on-button", "success", "success-soft",
  "error", "error-soft", "warning", "warning-soft"
];
const SETTINGS_ONLY_VIEW = window.location.hash === "#settings";

function safeHostThemeToken(value) {
  const normalized = String(value || "").trim();
  return normalized && normalized.length <= 160 && !/[;{}<>]/.test(normalized) ? normalized : "";
}

function applyHostTheme({ theme, tokens } = {}) {
  const root = document.documentElement;
  const resolvedTheme = theme === "dark" || theme === "light"
    ? theme
    : root.dataset.theme === "dark" || root.dataset.theme === "light"
      ? root.dataset.theme
      : window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
  if (tokens && typeof tokens === "object") {
    HOST_THEME_TOKEN_KEYS.forEach((key) => {
      const value = safeHostThemeToken(tokens[key]);
      if (value) root.style.setProperty(`--codex-theme-${key}`, value);
      else root.style.removeProperty(`--codex-theme-${key}`);
    });
  }
}

applyHostTheme();
if (window.parent === window) {
  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", (event) => {
    applyHostTheme({ theme: event.matches ? "dark" : "light" });
  });
}

const board = document.querySelector("#board");
const topActions = document.querySelector(".top-actions");
const drawer = document.querySelector("#drawer");
const backdrop = document.querySelector("#backdrop");
const toast = document.querySelector("#toast");
const search = document.querySelector("#search");
const pageTabs = Array.from(document.querySelectorAll(".page-tab"));
const health = document.querySelector("#health");
const healthLabel = document.querySelector("#health-label");
const notice = document.querySelector("#notice");
const noticeText = document.querySelector("#notice-text");
const noticeAction = document.querySelector("#notice-action");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsBackdrop = document.querySelector("#settings-backdrop");
const settingsForm = document.querySelector("#settings-form");
const settingsStatus = document.querySelector("#settings-status");
const settingsSectionTabs = Array.from(document.querySelectorAll(".settings-section-tab"));
const versionBadge = document.querySelector("#version-badge");
const updateCheckDetail = document.querySelector("#update-check-detail");
const updateCheckLink = document.querySelector("#update-check-link");
const checkUpdatesNow = document.querySelector("#check-updates-now");
const updateInstallDetail = document.querySelector("#update-install-detail");
const updateOperation = document.querySelector("#update-operation");
const updateOperationTitle = document.querySelector("#update-operation-title");
const updateOperationPercent = document.querySelector("#update-operation-percent");
const updateOperationSteps = Array.from(document.querySelectorAll("[data-update-step]"));
const updateOperationHint = document.querySelector("#update-operation-hint");
const downloadUpdate = document.querySelector("#download-update");
const cancelUpdateDownload = document.querySelector("#cancel-update-download");
const restartUpdate = document.querySelector("#restart-update");
const templateEditorDialog = document.querySelector("#template-editor-dialog");
const templateEditorBackdrop = document.querySelector("#template-editor-backdrop");
const templateEditorForm = document.querySelector("#template-editor-form");
const templateEditorContent = document.querySelector("#template-editor-content");
const templateEditorSkill = document.querySelector("#template-editor-skill");
const templateEditorStatus = document.querySelector("#template-editor-status");
const bugMonitorControl = document.querySelector("#bug-monitor-control");
const bugMonitorToggle = document.querySelector("#bug-monitor-toggle");
const bugMonitorState = document.querySelector("#bug-monitor-state");
const rebindDialog = document.querySelector("#rebind-dialog");
const rebindBackdrop = document.querySelector("#rebind-backdrop");
const rebindForm = document.querySelector("#rebind-form");
const rebindStatus = document.querySelector("#rebind-status");
const associationWait = document.querySelector("#association-wait");
const associationWaitTitle = document.querySelector("#association-wait-title");
const associationWaitDescription = document.querySelector("#association-wait-description");
const clearBindingDialog = document.querySelector("#clear-binding-dialog");
const clearBindingBackdrop = document.querySelector("#clear-binding-backdrop");
const clearBindingStatus = document.querySelector("#clear-binding-status");
const confirmClearBinding = document.querySelector("#confirm-clear-binding");
const attachmentPreviewDialog = document.querySelector("#attachment-preview-dialog");
const attachmentPreviewBackdrop = document.querySelector("#attachment-preview-backdrop");
const attachmentPreviewBody = document.querySelector("#attachment-preview-body");
const attachmentPreviewHint = document.querySelector("#attachment-preview-hint");
const attachmentPreviewDownload = document.querySelector("#download-preview-attachment");
const attachmentPreviewPrevious = document.querySelector("#previous-preview-image");
const attachmentPreviewNext = document.querySelector("#next-preview-image");
const transitionSelect = document.querySelector("#transition-select");
const transitionAction = document.querySelector("#transition-action");
const transitionHint = document.querySelector("#transition-hint");
const FIXED_DEPLOYMENT = "data_center";
const DEFAULT_SYNC_SETTINGS = Object.freeze({
  tasksEnabled: true,
  taskIntervalSeconds: 60,
  syncOnPanelReturn: true,
  sheetsIntervalSeconds: 300,
  updateCheckEnabled: true
});
const DEFAULT_TEMPLATE_SKILLS = Object.freeze({
  requirement: null,
  bug: null
});
const MAX_TEXT_PREVIEW_CHARACTERS = 500_000;
const LAST_JXL_SHEET_STORAGE_KEY = "jira-workbench:last-jxl-sheet:v1";
const ASSOCIATION_DRAFT_STORAGE_KEY = "jira-workbench:association-drafts:v1";
const ASSOCIATION_WAIT_TIMEOUT_MS = 65_000;
const SHEET_COLUMNS = [
  { key: "issue", label: "Issue", filter: "text", placeholder: "筛选 Key" },
  { key: "type", label: "类型", filter: "type" },
  { key: "title", label: "标题", filter: "text", placeholder: "筛选标题" },
  { key: "status", label: "状态", filter: "status" },
  { key: "priority", label: "优先级", filter: "text", placeholder: "筛选优先级" },
  { key: "assignee", label: "负责人", filter: "text", placeholder: "筛选负责人" },
  { key: "collaborators", label: "协同处理人", filter: "text", placeholder: "筛选协同人" },
  { key: "attachments", label: "附件", filter: "attachments" },
  { key: "updated", label: "更新时间", filter: "text", placeholder: "日期/时间" }
];

function emptySheetFilters() {
  return Object.fromEntries(SHEET_COLUMNS.map((column) => [column.key, ""]));
}

const statusDefinitions = [
  { id: "todo", label: "待处理" },
  { id: "in_progress", label: "处理中" },
  { id: "done", label: "已完成" }
];

const state = {
  issues: [],
  bindings: {},
  bindingsRevision: 0,
  threads: [],
  currentThreadId: "",
  projects: [],
  boardFilters: [],
  boardFilterSelections: { requirement: [], bug: [] },
  boardFiltersLoading: false,
  boardFiltersError: "",
  boardProjects: [],
  boardProjectsLoading: false,
  boardProjectsError: "",
  skills: [],
  skillsError: "",
  config: null,
  updateStatus: null,
  updateInstallation: null,
  updateActionPending: false,
  automation: null,
  automationUpdating: false,
  activeView: "inbox",
  // Empty means all Jira statuses. Non-empty values are the original Jira
  // status names selected independently in each homepage lane.
  inboxStatusFilters: { requirement: [], bug: [] },
  activeSheet: "",
  jxlSheets: [],
  jxlLoaded: false,
  jxlLoading: false,
  jxlError: "",
  jxlDirectoryUrl: "",
  sheetIssues: [],
  sheetLoadedKey: "",
  sheetLoading: false,
  sheetError: "",
  sheetFetchedAt: null,
  sheetTotal: 0,
  sheetTruncated: false,
  sheetFilters: emptySheetFilters(),
  sheetSort: { column: "", direction: "" },
  selectedIssue: null,
  issueTransitions: [],
  transitionLoading: false,
  transitioning: false,
  transitionError: "",
  loading: false,
  backgroundSyncing: false,
  fetchedAt: null,
  total: 0,
  truncated: false
};

let toastTimer = null;
let sheetRequestId = 0;
let issueDetailRequestId = 0;
let attachmentPreviewRequestId = 0;
let attachmentPreviewObjectUrl = "";
let attachmentPreviewAttachment = null;
let attachmentPreviewBlob = null;
let attachmentPreviewReturnFocus = null;
let attachmentPreviewGallery = [];
let attachmentPreviewGalleryIndex = -1;
const attachmentPreviewBlobCache = new Map();
const attachmentLocalStates = new Map();
let transitionRequestId = 0;
let editingTemplateKind = "";
let templateDrafts = defaultTemplateDrafts();
let associationPendingIssueKey = "";
let associationWaitTimer = 0;
let associationWaitActionLabel = "正在处理…";
let associationWaitTitleText = "正在处理 Codex 会话…";
let associationWaitDescriptionText = "操作确认成功后将自动跳转。";
let clearingBindingIssueKey = "";
let activeSettingsSection = "jira";
let taskSyncTimer = 0;
let sheetsSyncTimer = 0;
let updateStatusTimer = 0;
let lastPanelActivationAt = 0;
let initialLoadComplete = false;
let searchRenderTimer = 0;
let rebindProjectScopeCandidates = [];

class ApiError extends Error {
  constructor(message, payload = {}) {
    super(message);
    this.code = payload.code;
    this.upstreamStatus = payload.upstreamStatus;
    this.details = payload.details;
  }
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function captureBoardScrollState() {
  const sheet = board.querySelector(".sheet-table-wrap");
  return {
    boardTop: board.scrollTop,
    lanes: Array.from(board.querySelectorAll(".task-lane[data-kind]"), (lane) => ({
      kind: lane.dataset.kind,
      top: lane.querySelector(".card-list")?.scrollTop || 0
    })),
    sheet: sheet ? { top: sheet.scrollTop, left: sheet.scrollLeft } : null
  };
}

function captureBoardFocusState() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !board.contains(active)) return null;
  if (active.dataset.filterKind !== undefined) {
    return { type: "filter", kind: active.dataset.filterKind, status: active.dataset.filterStatus || "" };
  }
  const issueNode = active.closest?.("[data-issue-key]");
  return issueNode?.dataset.issueKey ? { type: "issue", issueKey: issueNode.dataset.issueKey } : null;
}

function restoreBoardState(snapshot = {}, focusState = null) {
  window.requestAnimationFrame(() => {
    board.scrollTop = snapshot.boardTop || 0;
    (snapshot.lanes || []).forEach(({ kind, top }) => {
      const list = board.querySelector(`.task-lane[data-kind="${CSS.escape(kind)}"] .card-list`);
      if (list) list.scrollTop = top;
    });
    const sheet = board.querySelector(".sheet-table-wrap");
    if (sheet && snapshot.sheet) {
      sheet.scrollTop = snapshot.sheet.top || 0;
      sheet.scrollLeft = snapshot.sheet.left || 0;
    }
    const focusTarget = focusState?.type === "filter"
      ? board.querySelector(`[data-filter-kind="${CSS.escape(focusState.kind)}"][data-filter-status="${CSS.escape(focusState.status)}"]`)
      : focusState?.type === "issue"
        ? board.querySelector(`[data-issue-key="${CSS.escape(focusState.issueKey)}"]`)
        : null;
    focusTarget?.focus?.({ preventScroll: true });
  });
}

function renderPreservingBoardState() {
  const scrollState = captureBoardScrollState();
  const focusState = captureBoardFocusState();
  render();
  board.classList.add("suppress-entry-motion");
  restoreBoardState(scrollState, focusState);
}

function icon(name, className = "") {
  const paths = {
    conversation: '<path d="M6.5 17.5 3.5 20v-5.1A7.5 7.5 0 1 1 7 18.8"/><path d="M8 9.5h8M8 13h5"/>',
    attachment: '<path d="m8.5 12.5 5.9-5.9a3 3 0 0 1 4.2 4.2l-7.3 7.3a5 5 0 0 1-7.1-7.1l7-7"/>'
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `ui-icon${className ? ` ${className}` : ""}`);
  svg.innerHTML = paths[name] || "";
  return svg;
}

async function api(path, options = {}) {
  const request = { cache: "no-store", ...options };
  if (request.body && typeof request.body !== "string") {
    request.headers = { "content-type": "application/json", ...(request.headers || {}) };
    request.body = JSON.stringify(request.body);
  }
  const response = await fetch(path, request);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.error || `HTTP ${response.status}`, payload);
  return payload;
}

function safeGitHubUpdateUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname.toLowerCase() === "github.com" ? url.href : "";
  } catch {
    return "";
  }
}

const UPDATE_PHASE_VIEW = {
  downloading: { title: "正在准备更新", hint: "下载安装包，并校验文件大小与 SHA-256。", activeStep: 0, completedThrough: -1 },
  verified: { title: "更新包校验完成", hint: "即将自动进入安全安装，无需再次确认。", activeStep: 0, completedThrough: 0 },
  launching: { title: "正在开始安全安装", hint: "独立更新器接管后，本地服务会短暂重新启动。", activeStep: 1, completedThrough: 0 },
  waiting_for_service: { title: "正在移交安装", hint: "面板可能短暂断开，更新会在后台继续。", activeStep: 1, completedThrough: 0 },
  extracting: { title: "正在展开更新包", hint: "安装器正在复核更新内容。", activeStep: 1, completedThrough: 0 },
  backing_up: { title: "正在备份当前版本", hint: "若验证失败，将自动恢复到更新前状态。", activeStep: 1, completedThrough: 0 },
  installing: { title: "正在安装新版本", hint: "正在更新组件与 Plugin，请勿重复操作。", activeStep: 1, completedThrough: 0 },
  verifying: { title: "正在确认安装结果", hint: "检查本地服务、必要组件与 Plugin 注册。", activeStep: 1, completedThrough: 0 },
  restart_launching: { title: "正在准备重启 Codex", hint: "请保持当前窗口打开；窗口关闭后，重启助手会继续完成后台退出与重新启动。", activeStep: 2, completedThrough: 1 },
  restarting: { title: "正在重启 Codex", hint: "重新打开后会自动确认更新并清理临时状态。", activeStep: 2, completedThrough: 1 },
  restart_required: { title: "需要重启以完成更新", hint: "新版本已经安装并验证；保存工作后重启即可完整生效。", activeStep: 2, completedThrough: 1 },
  completed: { title: "更新已完整生效", hint: "临时更新状态将自动清理。", activeStep: -1, completedThrough: 2 },
  rolling_back: { title: "正在恢复原版本", hint: "新版本验证未通过，正在自动恢复安全备份。", activeStep: 1, completedThrough: 0 },
  failed: { title: "更新未完成", hint: "请查看错误信息；现有安装未修改或已自动回滚。", activeStep: -1, completedThrough: -1 }
};

function localizedUpdateError(value) {
  const message = String(value || "").trim();
  if (!message) return "";
  if (/Codex did not close normally/i.test(message)) {
    return "Codex 窗口已收到关闭请求，但后台进程未在规定时间内退出。请保存工作后重试。";
  }
  if (/Codex processes remained active/i.test(message)) {
    return "Codex 的残留进程仍未退出。请从任务管理器关闭 Codex 后重试。";
  }
  return message;
}

function localizedUpdateMessage(value) {
  const message = String(value || "").trim();
  if (!message) return "";
  const restartRequired = message.match(/^v(.+?) is installed and requires a Codex restart\.?$/i);
  if (restartRequired) return `v${restartRequired[1]} 已安装，需要重启 Codex 才能完整生效。`;
  return message;
}

function renderUpdateOperation(installation) {
  const installState = String(installation?.state || "idle");
  const fallbackPhase = installState === "ready" ? "verified"
    : installState === "rolled_back" || installState === "failed" ? "failed"
      : installState;
  const reportedPhase = String(installation?.phase || "");
  const phase = UPDATE_PHASE_VIEW[reportedPhase] ? reportedPhase : String(fallbackPhase || "idle");
  const view = UPDATE_PHASE_VIEW[phase];
  const visible = Boolean(view) && !["idle", "available", "cancelled"].includes(installState);
  updateOperation.hidden = !visible;
  if (!visible) return;

  const failed = installState === "failed" || installState === "rolled_back";
  const completed = installState === "completed";
  const fallbackProgress = completed ? 100
    : installState === "restart_required" ? 97
      : installState === "ready" ? 25
        : failed ? 100 : 0;
  const reportedProgress = Number(installation?.operationProgress || 0);
  const progress = Math.max(0, Math.min(100, reportedProgress > 0 ? reportedProgress : fallbackProgress));
  const waitingForRestart = installState === "restart_required" && phase === "restart_required";
  updateOperation.classList.toggle("is-failed", failed);
  updateOperation.classList.toggle("is-completed", completed);
  updateOperation.classList.toggle("needs-restart", waitingForRestart);
  updateOperationTitle.textContent = view.title;
  updateOperationPercent.textContent = failed ? "未完成"
    : completed ? "已完成"
      : waitingForRestart ? "待重启" : `${Math.round(progress)}%`;
  updateOperationHint.textContent = view.hint;
  updateOperationSteps.forEach((step, index) => {
    step.classList.toggle("is-complete", index <= Number(view.completedThrough ?? -1));
    step.classList.toggle("is-active", index === Number(view.activeStep ?? -1));
  });
}

function renderUpdateStatus() {
  const update = state.updateStatus;
  const installation = state.updateInstallation;
  const installState = String(installation?.state || "idle");
  const updateInProgress = ["downloading", "ready", "installing"].includes(installState);
  const restartRequired = installState === "restart_required";
  const currentVersion = String(update?.currentVersion || "—");
  const updateUrl = safeGitHubUpdateUrl(update?.url);
  versionBadge.textContent = update?.updateAvailable
    ? `v${currentVersion} · 可更新 v${update.latestVersion}`
    : `v${currentVersion}`;
  versionBadge.classList.toggle("update-available", Boolean(update?.updateAvailable));
  versionBadge.title = update?.updateAvailable
    ? `发现 v${update.latestVersion}，点击查看 GitHub`
    : update?.checked ? "当前已是最新版本" : "当前安装版本";
  versionBadge.setAttribute("aria-disabled", String(!update?.updateAvailable || !updateUrl));
  if (update?.updateAvailable && updateUrl) versionBadge.href = updateUrl;
  else versionBadge.removeAttribute("href");

  updateCheckLink.hidden = !update?.updateAvailable || !updateUrl;
  if (!updateCheckLink.hidden) updateCheckLink.href = updateUrl;
  else updateCheckLink.removeAttribute("href");
  updateCheckDetail.closest(".update-check-row")?.classList.toggle("update-available", Boolean(update?.updateAvailable));
  updateCheckDetail.closest(".update-check-row")?.classList.toggle("update-error", Boolean(installation?.error));

  if (updateInProgress) {
    const fromVersion = String(installation?.previousVersion || currentVersion);
    const targetVersion = String(installation?.targetVersion || update?.latestVersion || "");
    updateCheckDetail.textContent = targetVersion
      ? `正在从 v${fromVersion} 更新到 v${targetVersion}`
      : `正在处理 v${fromVersion} 的更新`;
  } else if (restartRequired) {
    updateCheckDetail.textContent = `v${installation.targetVersion || currentVersion} 已完成安全安装；重启 Codex 后完整生效。`;
  } else if (!update) {
    updateCheckDetail.textContent = "正在读取当前版本…";
  } else if (update.updateAvailable) {
    updateCheckDetail.textContent = update.installable
      ? `当前 v${currentVersion}，可安装 v${update.latestVersion}。`
      : `当前 v${currentVersion}，GitHub 已有 v${update.latestVersion}，但尚未发布一键安装包。`;
  } else if (update.checked) {
    updateCheckDetail.textContent = `当前 v${currentVersion}，已是最新版本（${update.sourceLabel || "GitHub"}）。`;
  } else if (!update.enabled && !update.error) {
    updateCheckDetail.textContent = `当前 v${currentVersion}；自动检查更新已关闭。`;
  } else if (update.error) {
    updateCheckDetail.textContent = `当前 v${currentVersion}；暂时无法检查 GitHub：${update.error}`;
  } else {
    updateCheckDetail.textContent = `当前版本 v${currentVersion}。`;
  }

  const downloading = installState === "downloading";
  const installing = installState === "installing";
  const installationMessage = localizedUpdateMessage(installation?.message);
  const installationError = localizedUpdateError(installation?.error);
  updateInstallDetail.hidden = !installationMessage && !installationError;
  updateInstallDetail.textContent = installationError || installationMessage;
  updateInstallDetail.classList.toggle("error", Boolean(installationError));
  renderUpdateOperation(installation);
  if (!updateOperation.hidden && !installation?.error) updateInstallDetail.hidden = true;

  downloadUpdate.hidden = !installation?.canDownload;
  cancelUpdateDownload.hidden = !installation?.canCancelDownload;
  restartUpdate.hidden = !installation?.canRestart;
  for (const button of [downloadUpdate, cancelUpdateDownload, restartUpdate]) {
    button.disabled = state.updateActionPending;
  }
  checkUpdatesNow.disabled = state.updateActionPending || downloading || installing;
  checkUpdatesNow.hidden = installing || restartRequired;

  if (downloading) {
    cancelUpdateDownload.textContent = `取消下载 ${Number(installation.progress || 0)}%`;
  } else {
    cancelUpdateDownload.textContent = "取消下载";
  }
}

function scheduleUpdateStatusPoll() {
  if (updateStatusTimer) window.clearTimeout(updateStatusTimer);
  updateStatusTimer = 0;
  const installState = state.updateInstallation?.state;
  const phase = state.updateInstallation?.phase;
  if (!["downloading", "ready", "installing"].includes(installState)
    && !(installState === "restart_required" && ["restart_launching", "restarting"].includes(phase))) return;
  updateStatusTimer = window.setTimeout(() => {
    updateStatusTimer = 0;
    void loadUpdateStatus({ quiet: true });
  }, installState === "downloading" || installState === "ready" ? 1_000 : 2_000);
}

async function loadUpdateStatus({ force = false, quiet = false } = {}) {
  if (checkUpdatesNow) {
    checkUpdatesNow.disabled = true;
    checkUpdatesNow.textContent = "检查中…";
  }
  try {
    const payload = await api(`/api/update-status${force ? "?force=true" : ""}`);
    state.updateStatus = payload.update || null;
    state.updateInstallation = payload.installation || null;
    renderUpdateStatus();
    if (!quiet && force) {
      if (state.updateStatus?.updateAvailable) showToast(`发现新版本 v${state.updateStatus.latestVersion}`);
      else if (state.updateStatus?.checked) showToast("当前已是最新版本");
      else showToast("暂时无法从 GitHub 检查更新", 5000);
    }
  } catch (error) {
    if (!quiet) showToast(`版本检查失败：${error.message}`, 5000);
  } finally {
    if (checkUpdatesNow) {
      checkUpdatesNow.disabled = false;
      checkUpdatesNow.textContent = "立即检查";
    }
    renderUpdateStatus();
    scheduleUpdateStatusPoll();
  }
}

async function runUpdateAction(path, { method = "POST", body = {}, successMessage = "" } = {}) {
  if (state.updateActionPending) return null;
  state.updateActionPending = true;
  renderUpdateStatus();
  try {
    const payload = await api(path, { method, ...(method === "DELETE" ? {} : { body }) });
    state.updateStatus = payload.update || state.updateStatus;
    state.updateInstallation = payload.installation || state.updateInstallation;
    renderUpdateStatus();
    if (successMessage) showToast(successMessage, 5000);
    return payload;
  } catch (error) {
    const blockers = Array.isArray(error.details?.blockers)
      ? error.details.blockers.map((blocker) => blocker.message || blocker.kind).filter(Boolean).join("；")
      : "";
    const reason = String(error.details?.reason || "").trim();
    const detail = blockers || reason;
    showToast(`${error.message}${detail ? `：${detail}` : ""}`, 8000);
    return null;
  } finally {
    state.updateActionPending = false;
    renderUpdateStatus();
    scheduleUpdateStatusPoll();
  }
}

async function restartToCompleteUpdate() {
  const version = String(state.updateInstallation?.targetVersion || state.updateStatus?.latestVersion || "");
  if (!version || !state.updateInstallation?.canRestart) return;
  const confirmed = window.confirm(
    `v${version} 已经安装并通过完整性验证。\n\n重启助手会先正常关闭所有 Codex 窗口；若窗口关闭后仍残留后台进程，会只结束 Codex 的残留进程。尚未完成的任务会中断，请先保存当前工作。\n\n现在重启 Codex，让更新完整生效吗？`
  );
  if (!confirmed) return;
  await runUpdateAction("/api/update/restart", {
    body: {},
    successMessage: "正在正常关闭并重新打开 Codex…"
  });
}

function postHostMessage(type, payload = {}) {
  if (window.parent === window) return;
  window.parent.postMessage({ source: "jira-workbench", type, ...payload }, "*");
}

function normalizeThreadList(payload) {
  const currentThreadId = comparableThreadId(state.currentThreadId).toLowerCase();
  return (Array.isArray(payload?.threads) ? payload.threads : [])
    .map((thread) => {
      const threadId = String(thread?.id || thread?.threadId || "").trim();
      if (!threadId) return null;
      return {
        ...thread,
        threadId,
        threadTitle: String(thread?.title || thread?.threadTitle || thread?.name || threadId),
        active: Boolean(currentThreadId && comparableThreadId(threadId).toLowerCase() === currentThreadId),
        pinned: Boolean(thread?.pinned)
      };
    })
    .filter(Boolean);
}

function normalizeWorkspaceList(payload) {
  return (Array.isArray(payload?.workspaces) ? payload.workspaces : [])
    .map((workspace) => {
      const projectId = String(workspace?.projectId || workspace?.id || workspace?.cwd || "").trim();
      if (!projectId) return null;
      return {
        ...workspace,
        projectId,
        projectLabel: String(
          workspace?.label
          || workspace?.projectLabel
          || workspace?.cwd
          || workspace?.projectId
          || workspace?.id
        ).trim() || projectId
      };
    })
    .filter(Boolean);
}

function uniqueProjectRoots(values = []) {
  return [...new Map(values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => [value.toLowerCase(), value])).values()];
}

function normalizeProjectScopeForUi(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const cwd = String(value.cwd || value.projectPath || value.path || "").trim();
  const workspaceRoots = uniqueProjectRoots([
    ...(Array.isArray(value.workspaceRoots) ? value.workspaceRoots : []),
    ...(Array.isArray(value.rootPaths) ? value.rootPaths : []),
    cwd
  ]);
  const rawId = String(value.scopeId || value.id || "").trim();
  const inferredProjectId = /^project:/i.test(rawId)
    ? rawId.slice(rawId.indexOf(":") + 1)
    : /^(?:path|scope):/i.test(rawId) ? "" : rawId;
  const projectId = String(value.projectId || inferredProjectId).trim();
  if (!cwd && !workspaceRoots.length && !projectId) return null;
  const id = String(rawId || (projectId
    ? `project:${projectId}`
    : cwd ? `path:${cwd.toLowerCase()}` : `scope:${index + 1}`)).trim();
  return {
    id,
    cwd: cwd || workspaceRoots[0] || "",
    workspaceRoots,
    projectId,
    projectLabel: String(value.projectLabel || value.label || value.displayLabel || projectId || cwd || `项目 ${index + 1}`).trim(),
    kind: String(value.kind || value.workspaceKind || (projectId ? "project" : "workspace")).trim(),
    source: String(value.source || "desktop-project-selection").trim(),
    observedAt: String(value.observedAt || value.updatedAt || new Date().toISOString()).trim()
  };
}

function bindingProjectScopes(binding) {
  const workspace = binding?.workspace;
  if (!workspace || typeof workspace !== "object") return [];
  const explicit = (Array.isArray(workspace.projectScopes) ? workspace.projectScopes : [])
    .map(normalizeProjectScopeForUi)
    .filter(Boolean);
  if (explicit.length) return explicit;
  const legacy = normalizeProjectScopeForUi(workspace);
  return legacy ? [legacy] : [];
}

function projectScopeKey(scope) {
  return scope?.cwd
    ? `cwd:${String(scope.cwd).toLowerCase()}`
    : `id:${String(scope?.id || scope?.projectId || "").toLowerCase()}`;
}

function availableProjectScopes(binding = null) {
  const configured = state.config?.codexProjectPath || state.config?.codexProjectId
    ? normalizeProjectScopeForUi({
      id: state.config.codexProjectId ? `project:${state.config.codexProjectId}` : "",
      cwd: state.config.codexProjectPath,
      workspaceRoots: state.config.codexProjectRoots || [],
      projectId: state.config.codexProjectId,
      projectLabel: state.config.codexProjectLabel,
      source: "configured-codex-project"
    })
    : null;
  const candidates = [
    ...bindingProjectScopes(binding),
    ...state.projects.map(normalizeProjectScopeForUi),
    configured
  ].filter(Boolean);
  return [...new Map(candidates.map((scope) => [projectScopeKey(scope), scope])).values()];
}

function currentRebindProjectSelection() {
  const checked = Array.from(document.querySelectorAll("input[data-rebind-project-scope]:checked"))
    .map((input) => input.value);
  const primary = document.querySelector('input[name="rebindPrimaryScope"]:checked')?.value || "";
  return { checked: new Set(checked), primary };
}

function updateRebindProjectSelection() {
  const container = document.querySelector("#rebind-project-options");
  const checkboxes = Array.from(container.querySelectorAll("input[data-rebind-project-scope]"));
  const selected = new Set(checkboxes.filter((input) => input.checked).map((input) => input.value));
  const primaryInputs = Array.from(container.querySelectorAll('input[name="rebindPrimaryScope"]'));
  for (const input of primaryInputs) {
    input.disabled = !selected.has(input.value);
    if (input.checked && input.disabled) input.checked = false;
    input.closest(".rebind-project-option")?.classList.toggle("selected", selected.has(input.value));
  }
  let primary = primaryInputs.find((input) => input.checked && !input.disabled);
  if (!primary && selected.size) {
    primary = primaryInputs.find((input) => selected.has(input.value));
    if (primary) primary.checked = true;
  }
  document.querySelector("#rebind-project-count").textContent = `${selected.size} 个`;
  const selectedScopes = rebindProjectScopeCandidates.filter((scope) => selected.has(scope.id));
  const defaultScope = selectedScopes.find((scope) => scope.id === primary?.value) || selectedScopes[0];
  document.querySelector("#rebind-new-project").textContent = selectedScopes.length
    ? `将关联 ${selectedScopes.length} 个项目目录；主目录：${defaultScope?.projectLabel || defaultScope?.cwd || "未设置"}`
    : "未选择项目目录：新建时创建普通会话；绑定已有会话时使用该会话自身目录。";
}

function renderRebindProjectScopes(binding = null, { preserveSelection = false } = {}) {
  const existingSelection = preserveSelection ? currentRebindProjectSelection() : null;
  const bindingScopes = bindingProjectScopes(binding);
  const selectedIds = existingSelection?.checked?.size
    ? existingSelection.checked
    : new Set(bindingScopes.map((scope) => scope.id));
  rebindProjectScopeCandidates = availableProjectScopes(binding);
  if (!selectedIds.size && state.config?.codexProjectId) {
    const configured = rebindProjectScopeCandidates.find((scope) => (
      scope.projectId === state.config.codexProjectId
      || scope.id === state.config.codexProjectId
      || scope.id === `project:${state.config.codexProjectId}`
    ));
    if (configured) selectedIds.add(configured.id);
  }
  const requestedPrimary = existingSelection?.primary
    || binding?.workspace?.defaultProjectScopeId
    || bindingScopes[0]?.id
    || "";
  const container = document.querySelector("#rebind-project-options");
  container.replaceChildren(...rebindProjectScopeCandidates.map((scope, index) => {
    const row = element("div", "rebind-project-option");
    const selectLabel = element("label", "rebind-project-select");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = scope.id;
    checkbox.dataset.rebindProjectScope = "true";
    checkbox.checked = selectedIds.has(scope.id);
    const copy = element("span", "rebind-project-copy");
    copy.append(element("strong", "", scope.projectLabel), element("small", "", scope.cwd || scope.workspaceRoots[0] || scope.projectId));
    selectLabel.append(checkbox, copy);
    const primaryLabel = element("label", "rebind-project-primary");
    const primary = document.createElement("input");
    primary.type = "radio";
    primary.name = "rebindPrimaryScope";
    primary.value = scope.id;
    primary.checked = scope.id === requestedPrimary || (!requestedPrimary && index === 0 && checkbox.checked);
    primaryLabel.append(primary, document.createTextNode("主目录"));
    row.append(selectLabel, primaryLabel);
    return row;
  }));
  document.querySelector("#rebind-project-empty").hidden = rebindProjectScopeCandidates.length > 0;
  updateRebindProjectSelection();
}

function selectedRebindWorkspace() {
  const selection = currentRebindProjectSelection();
  const projectScopes = rebindProjectScopeCandidates.filter((scope) => selection.checked.has(scope.id));
  if (!projectScopes.length) return null;
  const primary = projectScopes.find((scope) => scope.id === selection.primary) || projectScopes[0];
  return {
    cwd: primary.cwd,
    workspaceRoots: uniqueProjectRoots(projectScopes.flatMap((scope) => scope.workspaceRoots?.length ? scope.workspaceRoots : [scope.cwd])),
    projectId: primary.projectId,
    projectLabel: primary.projectLabel,
    kind: primary.kind,
    source: "user-project-selection",
    observedAt: new Date().toISOString(),
    projectScopes,
    defaultProjectScopeId: primary.id
  };
}

function applyBindingState(payload) {
  const bindingState = payload?.bindingState && typeof payload.bindingState === "object"
    ? payload.bindingState
    : payload;
  if (!bindingState || typeof bindingState !== "object") return;
  const revision = Number(bindingState.revision ?? bindingState.bindingsRevision);
  if (Number.isInteger(revision) && revision >= 0 && revision < state.bindingsRevision) return;
  if (bindingState.bindings && typeof bindingState.bindings === "object") {
    state.bindings = bindingState.bindings;
  }
  if (Number.isInteger(revision) && revision >= 0) state.bindingsRevision = revision;
}

function applyCurrentDesktopContext(message = {}) {
  state.currentThreadId = String(message.currentThreadId || message.threadId || "").trim();
  state.threads = normalizeThreadList({ threads: state.threads });
  if (Array.isArray(message.projects)) {
    state.projects = normalizeWorkspaceList({ workspaces: message.projects });
    if (!settingsDialog.hidden) {
      populateCodexProjectOptions(state.config?.codexProjectId || "", state.config?.codexProjectLabel || "");
    }
    void loadCodexSkillsForConfiguredProject();
  }
  if (!rebindDialog.hidden) {
    const options = document.querySelector("#rebind-thread-options");
    options.replaceChildren(...state.threads.map((thread) => {
      const option = document.createElement("option");
      option.value = thread.threadId;
      const prefix = thread.active ? "当前 · " : thread.pinned ? "置顶 · " : "";
      option.label = `${prefix}${thread.threadTitle || thread.threadId}`;
      return option;
    }));
    const currentThread = state.threads.find((thread) => thread.active);
    const currentButton = document.querySelector("#bind-current-thread");
    currentButton.disabled = !currentThread;
    currentButton.textContent = currentThread
      ? `使用当前会话：${currentThread.threadTitle || currentThread.threadId}`
      : "当前没有可绑定的会话";
    renderRebindProjectScopes(state.selectedIssue ? state.bindings[state.selectedIssue.key] : null, {
      preserveSelection: true
    });
    updateRebindThreadPreview();
  }
}

async function loadCodexSkillsForConfiguredProject(projectId = state.config?.codexProjectId || "") {
  const configuredProjectId = String(projectId || "").trim();
  const configuredWorkspace = state.projects.find((project) => [
    project.projectId,
    project.id,
    project.projectId ? `project:${project.projectId}` : ""
  ]
    .map((value) => String(value || "").trim())
    .includes(configuredProjectId));
  const skillQuery = configuredWorkspace?.cwd
    ? `?cwd=${encodeURIComponent(configuredWorkspace.cwd)}`
    : "";
  try {
    const payload = await api(`/api/codex/app-server/skills${skillQuery}`);
    state.skills = Array.isArray(payload?.skills) ? payload.skills : [];
    state.skillsError = "";
  } catch (error) {
    state.skillsError = error?.message || "无法读取 Codex Skill 列表";
  }
  if (!settingsDialog.hidden) renderTemplateCards();
}

async function loadCodexPanelContext({ quiet = false } = {}) {
  let bindingsAvailable = false;
  let conversationsAvailable = false;
  const presentProgress = () => {
    if (!settingsDialog.hidden) {
      populateCodexProjectOptions(state.config?.codexProjectId || "", state.config?.codexProjectLabel || "");
      renderTemplateCards();
    }
    renderPreservingBoardState();
    if (state.selectedIssue) updatePrimaryAction(state.selectedIssue);
  };

  const bindingTask = api("/api/bindings").then((payload) => {
    applyBindingState(payload);
    bindingsAvailable = true;
    presentProgress();
  });
  const conversationTask = api("/api/codex/conversations?limit=200").then((payload) => {
    state.threads = normalizeThreadList(payload);
    conversationsAvailable = true;
    presentProgress();
  }).catch((error) => {
    if (!quiet) showToast(`无法读取 Codex 会话：${error?.message || "App Server 暂不可用"}`, 5000);
  });
  const skillTask = loadCodexSkillsForConfiguredProject().then(presentProgress);

  await Promise.allSettled([bindingTask, conversationTask, skillTask]);
  return {
    bindingsAvailable,
    conversationsAvailable
  };
}

function setHealth(kind, message) {
  health.classList.remove("ok", "error", "syncing");
  if (kind) health.classList.add(kind);
  healthLabel.textContent = message;
}

function showNotice(message, { kind = "info", settings = false } = {}) {
  notice.className = `notice ${kind}`;
  noticeText.textContent = message;
  noticeAction.hidden = !settings;
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
}

function showToast(message, duration = 2800) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration);
}

function updateAutomationControl() {
  bugMonitorControl.hidden = state.activeView !== "inbox";
  const enabled = Boolean(state.config?.bugMonitorEnabled);
  bugMonitorToggle.checked = enabled;
  bugMonitorToggle.disabled = state.automationUpdating || !state.config?.configured;
  bugMonitorControl.classList.toggle("disabled", state.automationUpdating);
  if (state.automationUpdating) bugMonitorState.textContent = "正在保存";
  else if (!enabled) bugMonitorState.textContent = "已关闭";
  else if (state.automation?.activeJob?.issueKey) {
    bugMonitorState.textContent = `分析中 ${state.automation.activeJob.issueKey}`;
  } else bugMonitorState.textContent = "监控中";
  const pushHint = state.config?.wecomConfigured ? "完成后推送企业微信" : "未配置机器人，仅在 Codex 中分析";
  bugMonitorControl.title = enabled
    ? `监控当前及之后出现的 Bug；${pushHint}`
    : "开启后，监控当前及之后出现的 Bug，并自动创建 Codex 分析对话";
}

async function loadAutomationStatus({ quiet = true } = {}) {
  if (!state.config?.configured) {
    state.automation = null;
    updateAutomationControl();
    return;
  }
  try {
    state.automation = await api("/api/automation/status");
  } catch (error) {
    if (!quiet) showToast(`无法读取自动监控状态：${error.message}`, 5000);
  }
  updateAutomationControl();
}

function statusLabel(status) {
  return statusDefinitions.find((item) => item.id === status)?.label || status;
}

function issueStatusName(issue) {
  const statusName = String(issue?.statusName || "").trim();
  return statusName || String(issue?.status || "未知状态").trim() || "未知状态";
}

function typeLabel(issue) {
  return issue.typeName || (issue.type === "bug" ? "Bug" : "需求");
}

function defaultTemplateContent(kind) {
  return kind === "bug" ? DEFAULT_BUG_MESSAGE_TEMPLATE : DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE;
}

function normalizedSkillReference(skill) {
  if (!skill || typeof skill !== "object" || !String(skill.name || "").trim()) return null;
  return {
    name: String(skill.name).trim(),
    path: String(skill.path || "").trim(),
    scope: String(skill.scope || "").trim()
  };
}

function defaultTemplateDrafts() {
  return Object.fromEntries(["requirement", "bug"].map((kind) => [kind, {
    customized: false,
    content: defaultTemplateContent(kind),
    skill: normalizedSkillReference(DEFAULT_TEMPLATE_SKILLS[kind])
  }]));
}

function templateDraftsFromConfig(config) {
  const defaults = defaultTemplateDrafts();
  const configured = config?.promptTemplates;
  if (!configured || typeof configured !== "object") {
    const legacy = String(config?.messageTemplate || "").trim();
    if (legacy && legacy !== DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE.trim()) {
      defaults.requirement = { ...defaults.requirement, customized: true, content: legacy };
      defaults.bug = { ...defaults.bug, customized: true, content: legacy };
    }
    return defaults;
  }
  for (const kind of ["requirement", "bug"]) {
    const entry = configured[kind];
    if (!entry || typeof entry !== "object") continue;
    defaults[kind] = {
      customized: Boolean(entry.customized),
      content: String(entry.content || defaultTemplateContent(kind)).trim() || defaultTemplateContent(kind),
      skill: normalizedSkillReference(entry.skill)
    };
  }
  return defaults;
}

function templateEntryForIssue(issue) {
  const kind = isBugIssue(issue) ? "bug" : "requirement";
  return state.config?.promptTemplates?.[kind] || templateDraftsFromConfig(state.config)[kind];
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function visibleIssues() {
  if (state.activeView === "sheets") {
    return filterIssuesForView(state.sheetIssues, "sheets", search.value);
  }
  return filterIssuesForView(state.issues, state.activeView, search.value);
}

function jxlSheetKey(sheet) {
  return sheet ? `${sheet.projectId}:${sheet.id}` : "";
}

function normalizedJiraSite(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const url = new URL(source);
    url.hash = "";
    url.search = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return source.replace(/\/$/, "");
  }
}

function rememberedJxlSheetKey() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_JXL_SHEET_STORAGE_KEY) || "null");
    if (!saved || normalizedJiraSite(saved.site) !== normalizedJiraSite(state.config?.baseUrl)) return "";
    return typeof saved.sheetKey === "string" ? saved.sheetKey : "";
  } catch {
    return "";
  }
}

function rememberJxlSheetKey(sheetKey) {
  const site = normalizedJiraSite(state.config?.baseUrl);
  if (!site || !sheetKey) return;
  try {
    localStorage.setItem(LAST_JXL_SHEET_STORAGE_KEY, JSON.stringify({ site, sheetKey }));
  } catch {
    // The panel remains usable when the host disables local storage.
  }
}

function resetSheetTableState() {
  state.sheetFilters = emptySheetFilters();
  state.sheetSort = { column: "", direction: "" };
}

function hasSheetFilters() {
  return Object.values(state.sheetFilters).some((value) => String(value || "").trim());
}

function hasSheetTableState() {
  return hasSheetFilters() || Boolean(state.sheetSort.column);
}

function activeJxlSheet() {
  return state.jxlSheets.find((sheet) => jxlSheetKey(sheet) === state.activeSheet) || null;
}

function priorityClass(priority) {
  const value = String(priority || "").toLowerCase();
  if (value.includes("highest") || value.includes("最高")) return "highest";
  if (value.includes("high") || value.includes("高")) return "high";
  if (value.includes("low") || value.includes("低")) return "low";
  return "medium";
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function initials(value) {
  const text = String(value || "?").trim();
  const compact = text.replace(/\s+/g, "");
  if (/\p{Script=Han}/u.test(compact)) return Array.from(compact).slice(-1).join("") || "?";
  const words = text.split(/\s+/).filter(Boolean);
  const letters = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0]).join("")
    : Array.from(compact).slice(0, 2).join("");
  return letters.toUpperCase() || "?";
}

function createPersonChip(person) {
  const chip = element("span", "person-chip");
  const displayName = String(person?.displayName || person?.name || person?.key || "未知用户").trim();
  chip.append(element("i", "person-avatar", initials(displayName)));
  chip.append(element("span", "", displayName));
  if (person.active === false) chip.append(element("em", "", "停用"));
  return chip;
}

function normalizeCollaborators(collaborators = []) {
  const seen = new Set();
  return collaborators.filter((person) => {
    const identity = String(person?.accountId || person?.key || person?.name || person?.displayName || "")
      .trim()
      .toLocaleLowerCase();
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function renderRichText(target, value) {
  const raw = String(value || "");
  const normalized = raw
    .replace(/\{color(?::[^}]*)?\}/gi, "")
    .replace(/\{color\}/gi, "");
  target.replaceChildren();
  const urlPattern = /https?:\/\/[^\s<>，。；、）】"']+/g;
  let offset = 0;
  for (const match of normalized.matchAll(urlPattern)) {
    if (match.index > offset) target.append(document.createTextNode(normalized.slice(offset, match.index)));
    const link = document.createElement("a");
    link.href = match[0];
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = match[0];
    target.append(link);
    offset = match.index + match[0].length;
  }
  if (offset < normalized.length) target.append(document.createTextNode(normalized.slice(offset)));
}

function attachmentIdentity(attachment) {
  return String(attachment?.id || attachment?.downloadUrl || attachment?.filename || "");
}

async function fetchAttachmentBlob(attachment, { cachePreview = false } = {}) {
  const identity = attachmentIdentity(attachment);
  if (cachePreview && identity && attachmentPreviewBlobCache.has(identity)) {
    return attachmentPreviewBlobCache.get(identity);
  }
  const response = await fetch(attachment.downloadUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (cachePreview && identity) attachmentPreviewBlobCache.set(identity, blob);
  return blob;
}

function releaseAttachmentPreviewUrl() {
  if (!attachmentPreviewObjectUrl) return;
  URL.revokeObjectURL(attachmentPreviewObjectUrl);
  attachmentPreviewObjectUrl = "";
}

function triggerAttachmentDownload(attachment, blob) {
  const objectUrl = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = objectUrl;
  download.download = attachment.filename;
  document.body.append(download);
  download.click();
  download.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

async function downloadAttachment(attachment, blob = null) {
  const content = blob || await fetchAttachmentBlob(attachment);
  triggerAttachmentDownload(attachment, content);
}

function closeAttachmentPreview() {
  attachmentPreviewRequestId += 1;
  releaseAttachmentPreviewUrl();
  attachmentPreviewAttachment = null;
  attachmentPreviewBlob = null;
  attachmentPreviewGallery = [];
  attachmentPreviewGalleryIndex = -1;
  attachmentPreviewBlobCache.clear();
  attachmentPreviewBody.replaceChildren();
  attachmentPreviewDialog.hidden = true;
  attachmentPreviewBackdrop.hidden = true;
  attachmentPreviewDownload.disabled = true;
  attachmentPreviewPrevious.hidden = true;
  attachmentPreviewNext.hidden = true;
  const returnFocus = attachmentPreviewReturnFocus;
  attachmentPreviewReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

function syncAttachmentPreviewNavigation(kind, { loading = false } = {}) {
  const galleryVisible = kind === "image" && attachmentPreviewGallery.length > 1;
  attachmentPreviewPrevious.hidden = !galleryVisible;
  attachmentPreviewNext.hidden = !galleryVisible;
  attachmentPreviewPrevious.disabled = loading || attachmentPreviewGalleryIndex <= 0;
  attachmentPreviewNext.disabled = loading || attachmentPreviewGalleryIndex >= attachmentPreviewGallery.length - 1;
}

function updateAttachmentPreviewHeading(attachment, kind) {
  document.querySelector("#attachment-preview-title").textContent = attachment.filename;
  const galleryPosition = kind === "image" && attachmentPreviewGallery.length > 1
    ? `图片 ${attachmentPreviewGalleryIndex + 1}/${attachmentPreviewGallery.length} · `
    : "";
  const sourceIssueKey = String(attachment.sourceIssueKey || state.selectedIssue?.key || "");
  const source = sourceIssueKey ? `${sourceIssueKey} · ` : "";
  document.querySelector("#attachment-preview-meta").textContent = `${galleryPosition}${source}${formatBytes(attachment.size)} · ${attachment.mimeType || "未知格式"} · ${attachment.author}`;
}

function issueContextAttachments(issue) {
  return [
    ...(issue?.attachments || []),
    ...(issue?.parentIssue?.attachments || [])
  ];
}

function showAttachmentPreviewError(message) {
  attachmentPreviewBody.className = "attachment-preview-body";
  attachmentPreviewBody.replaceChildren(element("div", "attachment-preview-error", message));
  attachmentPreviewHint.textContent = "预览失败时仍可返回附件列表重试。";
}

async function renderAttachmentPreview(attachment, blob, kind, requestId) {
  if (requestId !== attachmentPreviewRequestId) return;
  attachmentPreviewBody.className = `attachment-preview-body ${kind}`;
  attachmentPreviewBody.replaceChildren();

  if (kind === "text") {
    const fullText = await blob.text();
    if (requestId !== attachmentPreviewRequestId) return;
    const truncated = fullText.length > MAX_TEXT_PREVIEW_CHARACTERS;
    const text = truncated ? `${fullText.slice(0, MAX_TEXT_PREVIEW_CHARACTERS)}\n\n……预览已截断，请下载原文件查看剩余内容。` : fullText;
    attachmentPreviewBody.append(element("pre", "", text || "（空文件）"));
    attachmentPreviewHint.textContent = truncated ? "文本较长，当前仅显示前 50 万字符。" : "文本以只读方式显示。";
    return;
  }

  releaseAttachmentPreviewUrl();
  attachmentPreviewObjectUrl = URL.createObjectURL(blob);
  if (kind === "image") {
    const image = document.createElement("img");
    image.alt = attachment.filename;
    image.src = attachmentPreviewObjectUrl;
    image.addEventListener("error", () => {
      if (requestId === attachmentPreviewRequestId) showAttachmentPreviewError("浏览器无法解码这张图片，请下载原文件查看。");
    }, { once: true });
    attachmentPreviewBody.append(image);
    attachmentPreviewHint.textContent = attachmentPreviewGallery.length > 1
      ? "可使用左右按钮或方向键切换图片。"
      : "图片按原始比例缩放显示。";
    return;
  }
  if (kind === "pdf") {
    const frame = document.createElement("iframe");
    frame.title = `预览 ${attachment.filename}`;
    frame.src = attachmentPreviewObjectUrl;
    attachmentPreviewBody.append(frame);
    attachmentPreviewHint.textContent = "PDF 使用内置阅读器只读显示。";
    return;
  }
  if (kind === "video") {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = attachmentPreviewObjectUrl;
    attachmentPreviewBody.append(video);
    attachmentPreviewHint.textContent = "视频不会自动播放。";
    return;
  }
  if (kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = attachmentPreviewObjectUrl;
    attachmentPreviewBody.append(audio);
    attachmentPreviewHint.textContent = "音频不会自动播放。";
  }
}

async function loadAttachmentPreview(attachment) {
  const kind = attachmentPreviewKind(attachment);
  if (!kind) return;
  const requestId = ++attachmentPreviewRequestId;
  releaseAttachmentPreviewUrl();
  attachmentPreviewAttachment = attachment;
  attachmentPreviewBlob = null;
  updateAttachmentPreviewHeading(attachment, kind);
  attachmentPreviewBody.className = "attachment-preview-body loading";
  attachmentPreviewBody.textContent = "正在从 Jira 加载原文件…";
  attachmentPreviewHint.textContent = "预览内容来自 Jira，只读显示。";
  attachmentPreviewDownload.disabled = true;
  syncAttachmentPreviewNavigation(kind, { loading: true });
  try {
    const blob = await fetchAttachmentBlob(attachment, { cachePreview: true });
    if (requestId !== attachmentPreviewRequestId) return;
    attachmentPreviewBlob = blob;
    attachmentPreviewDownload.disabled = false;
    await renderAttachmentPreview(attachment, blob, kind, requestId);
    syncAttachmentPreviewNavigation(kind);
  } catch (error) {
    if (requestId !== attachmentPreviewRequestId) return;
    showAttachmentPreviewError(`附件加载失败：${error.message}`);
    syncAttachmentPreviewNavigation(kind);
  }
}

function openAttachmentPreview(attachment) {
  const kind = attachmentPreviewKind(attachment);
  if (!kind) return;
  attachmentPreviewReturnFocus = document.activeElement;
  attachmentPreviewGallery = kind === "image"
    ? issueContextAttachments(state.selectedIssue).filter((candidate) => attachmentPreviewKind(candidate) === "image")
    : [attachment];
  attachmentPreviewGalleryIndex = Math.max(0, attachmentPreviewGallery.findIndex((candidate) => attachmentIdentity(candidate) === attachmentIdentity(attachment)));
  attachmentPreviewBackdrop.hidden = false;
  attachmentPreviewDialog.hidden = false;
  attachmentPreviewDialog.focus();
  void loadAttachmentPreview(attachment);
}

function navigateAttachmentPreview(offset) {
  if (attachmentPreviewGallery.length < 2) return;
  const nextIndex = attachmentPreviewGalleryIndex + offset;
  if (nextIndex < 0 || nextIndex >= attachmentPreviewGallery.length) return;
  attachmentPreviewGalleryIndex = nextIndex;
  void loadAttachmentPreview(attachmentPreviewGallery[nextIndex]);
}

function updateLocalAttachmentCard(card, attachment, action) {
  const downloaded = attachmentLocalStates.has(attachmentIdentity(attachment));
  action.textContent = downloaded ? "打开" : "下载";
  card.classList.toggle("locally-cached", downloaded);
  card.title = downloaded
    ? `使用系统默认程序打开 ${attachment.filename}`
    : `下载 ${attachment.filename} 到本地缓存`;
  card.setAttribute("aria-label", card.title);
}

async function handleLocalAttachment(card, attachment, action) {
  if (card.getAttribute("aria-busy") === "true") return;
  const identity = attachmentIdentity(attachment);
  const downloaded = attachmentLocalStates.has(identity);
  card.setAttribute("aria-busy", "true");
  action.textContent = downloaded ? "打开中…" : "下载中…";
  try {
    if (!downloaded) {
      const result = await api(`/api/attachments/${encodeURIComponent(attachment.id)}/materialize`);
      attachmentLocalStates.set(identity, result.attachment || { id: attachment.id });
      showToast(`${attachment.filename} 已下载，再次点击即可打开`, 4200);
    } else {
      await api(`/api/attachments/${encodeURIComponent(attachment.id)}/open`, { method: "POST", body: {} });
      showToast(`已使用系统默认程序打开 ${attachment.filename}`, 3200);
    }
  } catch (error) {
    if (error.code === "ATTACHMENT_NOT_MATERIALIZED") attachmentLocalStates.delete(identity);
    showToast(`${downloaded ? "附件打开" : "附件下载"}失败：${error.message}`, 5000);
  } finally {
    card.removeAttribute("aria-busy");
    updateLocalAttachmentCard(card, attachment, action);
  }
}

function createAttachmentCard(attachment) {
  const card = element("a", "attachment-card");
  const previewKind = attachmentPreviewKind(attachment);
  const locallyOpenable = !previewKind && attachmentCanOpenLocally(attachment);
  card.href = window.__JIRA_WORKBENCH_EMBEDDED__ || locallyOpenable ? "#" : attachment.downloadUrl;
  card.title = previewKind ? `预览 ${attachment.filename}` : `下载 ${attachment.filename}`;
  card.setAttribute("aria-label", card.title);
  if (previewKind) card.classList.add("previewable");
  card.addEventListener("click", async (event) => {
    if (previewKind) {
      event.preventDefault();
      void openAttachmentPreview(attachment);
      return;
    }
    if (locallyOpenable) {
      event.preventDefault();
      await handleLocalAttachment(card, attachment, action);
      return;
    }
    if (!window.__JIRA_WORKBENCH_EMBEDDED__) return;
    event.preventDefault();
    if (card.getAttribute("aria-busy") === "true") return;
    card.setAttribute("aria-busy", "true");
    try {
      await downloadAttachment(attachment);
    } catch (error) {
      showToast(`附件下载失败：${error.message}`, 5000);
    } finally {
      card.removeAttribute("aria-busy");
    }
  });
  if (!previewKind && !locallyOpenable && !window.__JIRA_WORKBENCH_EMBEDDED__) card.download = attachment.filename;

  const preview = element("span", "attachment-preview");
  if (attachment.thumbnailUrl) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    const showFallback = () => {
      image.remove();
      if (!preview.querySelector("b")) preview.append(element("b", "", "FILE"));
    };
    image.addEventListener("error", showFallback, { once: true });
    preview.append(image);
    if (window.__JIRA_WORKBENCH_EMBEDDED__ && window.__jiraWorkbenchAssetUrl) {
      window.__jiraWorkbenchAssetUrl(attachment.thumbnailUrl)
        .then((url) => { if (image.isConnected) image.src = url; })
        .catch(showFallback);
    } else {
      image.src = attachment.thumbnailUrl;
    }
  } else {
    const extension = attachment.filename.includes(".")
      ? attachment.filename.split(".").pop().slice(0, 5).toUpperCase()
      : "FILE";
    preview.append(element("b", "", extension));
  }

  const info = element("span", "attachment-info");
  info.append(element("strong", "", attachment.filename));
  info.append(element("small", "", `${formatBytes(attachment.size)} · ${attachment.author}`));
  info.append(element("small", "", formatDate(attachment.created)));
  const action = element("span", "attachment-download", previewKind ? "预览" : "下载");
  card.append(preview, info, action);
  if (locallyOpenable) updateLocalAttachmentCard(card, attachment, action);
  return card;
}

function createCard(issue) {
  const card = element("article", "card");
  card.dataset.issueKey = issue.key;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `查看 ${issue.key} ${issue.title}`);

  const top = element("div", "card-top");
  const identity = element("div", "card-identity");
  identity.append(
    element("span", "issue-key", issue.key),
    element("span", `card-status ${issue.status || ""}`, issue.statusName || statusLabel(issue.status))
  );
  top.append(identity);
  card.append(top, element("h3", "", issue.title));

  const meta = element("div", "card-meta");
  meta.append(element("span", `priority ${priorityClass(issue.priority)}`, issue.priority));
  meta.append(element("span", "card-assignee", issue.assignee));
  if (state.bindings[issue.key]) {
    const conversation = element("span", "card-signal bound");
    conversation.append(icon("conversation"), document.createTextNode("已绑定"));
    conversation.title = state.bindings[issue.key].threadTitle || "已绑定 Codex 对话";
    meta.append(conversation);
  }
  if (issue.collaborators?.length) meta.append(element("span", "card-signal", `协 ${issue.collaborators.length}`));
  if (issue.parent?.key) meta.append(element("span", "card-signal", `父 ${issue.parent.key}`));
  if (issue.attachments?.length) {
    const attachment = element("span", "card-signal");
    attachment.append(icon("attachment"), document.createTextNode(String(issue.attachments.length)));
    meta.append(attachment);
  }
  card.append(meta);

  const open = () => openDetails(issue);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function bindIssueOpen(node, issue) {
  node.dataset.issueKey = issue.key;
  node.tabIndex = 0;
  node.setAttribute("aria-label", `查看 ${issue.key} ${issue.title}`);
  node.addEventListener("click", () => openDetails(issue));
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openDetails(issue);
  });
}

function createLaneStatusFilter(type, issues, selectedStatuses) {
  const filter = element("div", "lane-status-filter");
  filter.setAttribute("role", "group");
  filter.setAttribute("aria-label", "状态筛选（可多选）");
  filter.append(element("span", "lane-status-filter-hint", "状态（可多选）"));
  const selected = new Set(Array.isArray(selectedStatuses) ? selectedStatuses : []);
  const statusCounts = new Map();
  issues.forEach((issue) => {
    const statusName = issueStatusName(issue);
    statusCounts.set(statusName, (statusCounts.get(statusName) || 0) + 1);
  });
  const statusOptions = Array.from(statusCounts, ([id, count]) => ({ id, label: id, count }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  const allButton = element("button", "lane-status-button", `全部 ${issues.length}`);
  allButton.type = "button";
  allButton.dataset.filterKind = type;
  allButton.dataset.filterStatus = "";
  allButton.setAttribute("aria-pressed", String(selected.size === 0));
  allButton.classList.toggle("active", selected.size === 0);
  allButton.addEventListener("click", (event) => {
    event.stopPropagation();
    state.inboxStatusFilters[type] = [];
    renderPreservingBoardState();
  });
  filter.append(allButton);
  statusOptions.forEach((option) => {
    const button = element("button", "lane-status-button", `${option.label} ${option.count}`);
    button.type = "button";
    button.dataset.filterKind = type;
    button.dataset.filterStatus = option.id;
    button.title = `筛选状态：${option.label}`;
    button.setAttribute("aria-pressed", String(selected.has(option.id)));
    button.classList.toggle("active", selected.has(option.id));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = new Set(selected);
      if (next.has(option.id)) next.delete(option.id);
      else next.add(option.id);
      state.inboxStatusFilters[type] = Array.from(next);
      renderPreservingBoardState();
    });
    filter.append(button);
  });
  return filter;
}

function createTaskLane({ title, subtitle, type, issues, showStatusFilter = false }) {
  const selectedStatuses = showStatusFilter && Array.isArray(state.inboxStatusFilters[type])
    ? state.inboxStatusFilters[type]
    : [];
  const visibleIssues = selectedStatuses.length === 0
    ? issues
    : issues.filter((issue) => selectedStatuses.includes(issueStatusName(issue)));
  const lane = element("section", `task-lane ${type}`);
  lane.dataset.kind = type;
  const head = element("header", "lane-head");
  const heading = element("div", "lane-heading");
  const titleRow = element("div", "lane-title-row");
  titleRow.append(
    element("span", `type-icon ${type}`, type === "bug" ? "B" : "R"),
    element("h2", "", title)
  );
  heading.append(titleRow, element("p", "", subtitle));
  if (showStatusFilter) heading.append(createLaneStatusFilter(type, issues, selectedStatuses));
  head.append(heading, element("span", "lane-count", String(visibleIssues.length)));
  const list = element("div", "card-list");
  if (visibleIssues.length) visibleIssues.forEach((issue) => list.append(createCard(issue)));
  else {
    const emptyMessage = search.value.trim()
      ? "没有匹配的任务"
      : selectedStatuses.length === 0
        ? "暂无任务"
        : "所选状态暂无任务";
    list.append(element("div", "empty", emptyMessage));
  }
  lane.append(head, list);
  return lane;
}

function renderSplitView(issues, history = false) {
  const { requirements, bugs } = splitIssuesByType(issues);
  const dominance = history
    ? ""
    : requirements.length > 0 && bugs.length === 0
      ? " requirement-dominant"
      : bugs.length > 0 && requirements.length === 0
        ? " bug-dominant"
        : "";
  board.className = `board split-board${history ? " history-board" : ""}${dominance}`;
  board.append(
    createTaskLane({
      title: history ? "需求处理历史" : "CT仪表盘-需要我完成的事宜",
      subtitle: history ? "已完成的需求与任务" : "需求 · 待处理 / 处理中",
      type: "requirement",
      issues: requirements,
      showStatusFilter: !history
    }),
    createTaskLane({
      title: history ? "Bug 修复历史" : "CT-BUG-需要我修复的",
      subtitle: history ? "已完成的 Bug" : "Bug · 待修复 / 处理中",
      type: "bug",
      issues: bugs,
      showStatusFilter: !history
    })
  );
}

function sheetCell(text, className = "") {
  return element("td", className, text);
}

function createSheetRow(issue) {
  const row = element("tr", "sheet-row");
  bindIssueOpen(row, issue);

  const key = sheetCell("", "sheet-key");
  key.append(element("span", `type-icon ${issue.type}`, issue.type === "bug" ? "B" : "R"));
  key.append(element("strong", "", issue.key));

  const type = sheetCell("", "sheet-type");
  type.append(element("span", `sheet-type-pill ${issue.type}`, typeLabel(issue)));

  const title = sheetCell("", "sheet-title");
  title.append(element("strong", "", issue.title));
  title.title = issue.title;

  const status = sheetCell("", "sheet-status");
  status.append(element("span", `card-status ${issue.status || ""}`, issue.statusName || statusLabel(issue.status)));

  const priority = sheetCell("", "sheet-priority");
  priority.append(element("span", `priority ${priorityClass(issue.priority)}`, issue.priority));

  const collaborators = (issue.collaborators || []).map((person) => person.displayName).join("、") || "—";
  const attachments = issue.attachments?.length ? String(issue.attachments.length) : "—";
  row.append(
    key,
    type,
    title,
    status,
    priority,
    sheetCell(issue.assignee || "—", "sheet-assignee"),
    sheetCell(collaborators, "sheet-collaborators"),
    sheetCell(attachments, "sheet-attachments"),
    sheetCell(formatDate(issue.updated), "sheet-updated")
  );
  return row;
}

function renderSheets(issues) {
  board.className = "board sheets-board";
  const panel = element("section", "sheet-panel");
  const head = element("header", "sheet-head");
  const heading = element("div", "sheet-heading");
  const selectedSheet = activeJxlSheet();
  heading.append(
    element("h2", "", selectedSheet?.title || "JXL Sheets"),
    element("p", "", selectedSheet
      ? `${selectedSheet.projectName}（${selectedSheet.projectKey}） · 来自 Jira JXL Directory`
      : "读取 Jira JXL Directory 中当前用户可查看的 Sheets")
  );

  const controls = element("div", "sheet-controls");
  const selectorLabel = element("label", "sheet-selector-label");
  selectorLabel.append(element("span", "", "查看 Sheet"));
  const selector = document.createElement("select");
  selector.id = "sheet-selector";
  selector.setAttribute("aria-label", "选择要查看的 JXL Sheet");
  selector.disabled = state.jxlLoading || !state.jxlSheets.length;
  selector.replaceChildren(...state.jxlSheets.map((sheet) => {
    const option = document.createElement("option");
    option.value = jxlSheetKey(sheet);
    option.textContent = `[${sheet.projectKey}] ${sheet.title}`;
    return option;
  }));
  selector.value = state.activeSheet;
  selector.addEventListener("change", () => {
    state.activeSheet = selector.value;
    resetSheetTableState();
    rememberJxlSheetKey(state.activeSheet);
    state.sheetIssues = [];
    state.sheetLoadedKey = "";
    state.sheetError = "";
    state.sheetFetchedAt = null;
    render();
    void loadJxlSheetIssues();
  });
  selectorLabel.append(selector);
  const sourceActions = element("div", "sheet-source-actions");
  if (selectedSheet?.url || state.jxlDirectoryUrl) {
    const sourceLink = element("a", "sheet-source-link", selectedSheet ? "在 JXL 中打开 ↗" : "打开 JXL Directory ↗");
    sourceLink.href = selectedSheet?.url || state.jxlDirectoryUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer noopener";
    sourceActions.append(sourceLink);
  }
  const totalLabel = state.sheetLoading
    ? "加载中…"
    : state.sheetTruncated
      ? `${issues.length}/${state.sheetTotal} 项`
      : `${issues.length} 项`;
  const resetTableButton = element("button", "sheet-reset-table", "重置表头");
  resetTableButton.type = "button";
  resetTableButton.hidden = true;
  resetTableButton.title = "清除列筛选与排序";
  const totalNode = element("span", "sheet-total", totalLabel);
  sourceActions.append(resetTableButton, totalNode);
  controls.append(selectorLabel, sourceActions);
  head.append(heading, controls);
  panel.append(head);

  if (state.jxlLoading && !state.jxlLoaded) {
    panel.append(element("div", "sheet-empty", "正在读取 JXL Directory…"));
    board.append(panel);
    return;
  }

  if (state.jxlError && !state.jxlSheets.length) {
    panel.append(element("div", "sheet-empty error", state.jxlError));
    board.append(panel);
    return;
  }

  if (!state.jxlSheets.length) {
    panel.append(element("div", "sheet-empty", "JXL Directory 中没有当前用户可查看的 Sheet"));
    board.append(panel);
    return;
  }

  if (selectedSheet && !selectedSheet.queryable) {
    panel.append(element("div", "sheet-empty", "该 Sheet 不是 JQL 范围，请点击右上角在 Jira JXL 中查看。"));
    board.append(panel);
    return;
  }

  if (state.sheetLoading && !state.sheetFetchedAt && !state.sheetIssues.length) {
    panel.append(element("div", "sheet-empty", "正在按所选 JXL Sheet 的查询范围加载任务…"));
    board.append(panel);
    return;
  }

  if (state.sheetError && !state.sheetIssues.length) {
    panel.append(element("div", "sheet-empty error", state.sheetError));
    board.append(panel);
    return;
  }

  if (!issues.length) {
    panel.append(element("div", "sheet-empty", search.value.trim() ? "没有匹配的任务" : "所选 JXL Sheet 暂无任务"));
    board.append(panel);
    return;
  }

  const wrapper = element("div", "sheet-table-wrap");
  const table = element("table", "issue-sheet");
  const tableHead = document.createElement("thead");
  const headerRow = element("tr", "sheet-header-row");
  const filterRow = element("tr", "sheet-filter-row");
  const body = document.createElement("tbody");
  const sortHeaders = new Map();
  const filterControls = new Map();
  const statusChoices = Array.from(new Set(state.sheetIssues
    .map((issue) => issue.statusName || issue.status || "")
    .filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, "zh-CN"));

  const updateSortHeaders = () => {
    for (const [columnKey, parts] of sortHeaders) {
      const active = state.sheetSort.column === columnKey;
      const direction = active ? state.sheetSort.direction : "";
      parts.cell.setAttribute("aria-sort", direction === "asc"
        ? "ascending"
        : direction === "desc" ? "descending" : "none");
      parts.button.classList.toggle("active", active);
      parts.indicator.textContent = direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕";
      parts.button.title = active
        ? direction === "asc" ? "当前升序；点击切换为降序" : "当前降序；点击恢复 Jira 原顺序"
        : `按${parts.label}升序排列`;
    }
  };

  const refreshRows = () => {
    const filtered = filterAndSortSheetIssues(issues, {
      filters: state.sheetFilters,
      sort: state.sheetSort
    });
    body.replaceChildren();
    if (filtered.length) filtered.forEach((issue) => body.append(createSheetRow(issue)));
    else {
      const emptyRow = element("tr", "sheet-no-results");
      const emptyCell = sheetCell("没有符合表头筛选条件的任务");
      emptyCell.colSpan = SHEET_COLUMNS.length;
      emptyRow.append(emptyCell);
      body.append(emptyRow);
    }
    if (hasSheetFilters()) totalNode.textContent = `${filtered.length}/${issues.length} 项`;
    else if (state.sheetTruncated) totalNode.textContent = `${issues.length}/${state.sheetTotal} 项`;
    else totalNode.textContent = `${issues.length} 项`;
    resetTableButton.hidden = !hasSheetTableState();
    for (const [columnKey, control] of filterControls) {
      control.classList.toggle("active", Boolean(String(state.sheetFilters[columnKey] || "").trim()));
    }
    updateSortHeaders();
  };

  const appendOption = (select, value, label) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  };

  for (const column of SHEET_COLUMNS) {
    const headerCell = document.createElement("th");
    headerCell.scope = "col";
    const sortButton = element("button", "sheet-sort-button");
    sortButton.type = "button";
    sortButton.append(element("span", "", column.label));
    const indicator = element("i", "sheet-sort-indicator", "↕");
    indicator.setAttribute("aria-hidden", "true");
    sortButton.append(indicator);
    sortButton.addEventListener("click", () => {
      if (state.sheetSort.column !== column.key) {
        state.sheetSort = { column: column.key, direction: "asc" };
      } else if (state.sheetSort.direction === "asc") {
        state.sheetSort = { column: column.key, direction: "desc" };
      } else {
        state.sheetSort = { column: "", direction: "" };
      }
      refreshRows();
    });
    headerCell.append(sortButton);
    sortHeaders.set(column.key, {
      cell: headerCell,
      button: sortButton,
      indicator,
      label: column.label
    });
    headerRow.append(headerCell);

    const filterCell = document.createElement("th");
    filterCell.scope = "col";
    let control;
    if (column.filter === "type" || column.filter === "status" || column.filter === "attachments") {
      control = document.createElement("select");
      appendOption(control, "", "全部");
      if (column.filter === "type") {
        appendOption(control, "requirement", "需求");
        appendOption(control, "bug", "Bug");
      } else if (column.filter === "status") {
        statusChoices.forEach((status) => appendOption(control, status, status));
      } else {
        appendOption(control, "with", "有附件");
        appendOption(control, "without", "无附件");
      }
      control.addEventListener("change", () => {
        state.sheetFilters[column.key] = control.value;
        refreshRows();
      });
    } else {
      control = document.createElement("input");
      control.type = "search";
      control.placeholder = column.placeholder || "筛选";
      control.autocomplete = "off";
      control.spellcheck = false;
      control.addEventListener("input", () => {
        state.sheetFilters[column.key] = control.value;
        refreshRows();
      });
    }
    control.className = "sheet-column-filter";
    control.setAttribute("aria-label", `筛选${column.label}`);
    control.value = state.sheetFilters[column.key] || "";
    filterControls.set(column.key, control);
    filterCell.append(control);
    filterRow.append(filterCell);
  }

  resetTableButton.addEventListener("click", () => {
    resetSheetTableState();
    for (const control of filterControls.values()) control.value = "";
    refreshRows();
  });
  tableHead.append(headerRow, filterRow);
  table.append(tableHead, body);
  wrapper.append(table);
  panel.append(wrapper);
  board.append(panel);
  refreshRows();
}

function renderState(message, detail = "") {
  board.className = "board state-board";
  board.replaceChildren();
  const panel = element("div", "state-panel");
  panel.append(element("strong", "", message));
  if (detail) panel.append(element("span", "", detail));
  board.append(panel);
}

function render() {
  updateAutomationControl();
  if (state.loading && state.activeView !== "sheets") {
    return renderState("正在从 Jira 获取任务…", "查询时间可能受 Jira 网络状态影响");
  }
  if (!state.config?.configured) return renderState("尚未配置 Jira", "点击右上角齿轮填写地址和 Token");

  const visible = visibleIssues();
  board.replaceChildren();
  if (state.activeView === "sheets") renderSheets(visible);
  else renderSplitView(visible, state.activeView === "history");
}

function updateCounts() {
  const counts = summarizeIssueViews(state.issues);
  document.querySelector("#inbox-count").textContent = String(counts.inbox);
  document.querySelector("#sheets-count").textContent = state.jxlLoaded ? String(state.jxlSheets.length) : "…";
  document.querySelector("#history-count").textContent = String(counts.history);
  const summary = document.querySelector("#sync-summary");
  if (state.backgroundSyncing) {
    summary.textContent = "正在自动同步…";
    return;
  }
  if (state.activeView === "sheets") {
    if (!state.sheetFetchedAt) return void (summary.textContent = "");
    const sheetTotalText = state.sheetTruncated
      ? `显示 ${state.sheetIssues.length}/${state.sheetTotal}`
      : `${state.sheetIssues.length} 项`;
    summary.textContent = `${sheetTotalText} · ${formatDate(state.sheetFetchedAt)} 同步`;
    return;
  }
  if (!state.fetchedAt) return void (summary.textContent = "");
  const totalText = state.truncated ? `显示 ${state.issues.length}/${state.total}` : `${state.issues.length} 项`;
  summary.textContent = `${totalText} · ${formatDate(state.fetchedAt)} 同步`;
}

function transitionOptionLabel(transition) {
  const target = transition?.to?.name || "未知状态";
  const action = transition?.name || "";
  return action && action !== target ? `${target}（${action}）` : target;
}

function selectedTransition() {
  const transitionId = transitionSelect.value;
  return state.issueTransitions.find((transition) => transition.id === transitionId) || null;
}

function updateTransitionAction() {
  if (state.transitionLoading) {
    transitionAction.textContent = "正在读取…";
    transitionAction.disabled = true;
    return;
  }
  if (state.transitionError) {
    transitionAction.textContent = "重试";
    transitionAction.disabled = false;
    return;
  }
  if (state.transitioning) {
    transitionAction.textContent = "正在流转…";
    transitionAction.disabled = true;
    return;
  }
  const transition = selectedTransition();
  if (!transition) {
    const hasAvailable = state.issueTransitions.some((candidate) => !candidate.requiresInput);
    transitionAction.textContent = hasAvailable ? "确认流转" : "无可直接流转状态";
    transitionAction.disabled = true;
    return;
  }
  if (transition.requiresInput) {
    transitionAction.textContent = "请在 Jira 中完成";
    transitionAction.disabled = true;
    return;
  }
  transitionAction.textContent = `流转到 ${transition.to?.name || transition.name}`;
  transitionAction.disabled = false;
}

function renderTransitionControl() {
  const previousValue = transitionSelect.value;
  transitionSelect.replaceChildren();
  transitionHint.className = "transition-hint";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  transitionSelect.append(placeholder);

  if (!state.selectedIssue) {
    placeholder.textContent = "未选择任务";
    transitionSelect.disabled = true;
    transitionHint.textContent = "";
    updateTransitionAction();
    return;
  }
  if (state.transitionLoading) {
    placeholder.textContent = "正在读取可用流转…";
    transitionSelect.disabled = true;
    transitionHint.textContent = "正在从 Jira 读取当前用户可执行的工作流操作。";
    updateTransitionAction();
    return;
  }
  if (state.transitionError) {
    placeholder.textContent = "无法读取状态流转";
    transitionSelect.disabled = true;
    transitionHint.classList.add("error");
    transitionHint.textContent = state.transitionError;
    updateTransitionAction();
    return;
  }

  placeholder.textContent = state.issueTransitions.length ? "选择目标状态" : "当前无可用状态流转";
  for (const transition of state.issueTransitions) {
    const option = document.createElement("option");
    option.value = transition.id;
    option.disabled = Boolean(transition.requiresInput);
    const required = (transition.requiredFields || []).map((field) => field.name).join("、");
    option.textContent = transition.requiresInput
      ? `${transitionOptionLabel(transition)} · 需填写 ${required || "额外字段"}`
      : transitionOptionLabel(transition);
    transitionSelect.append(option);
  }

  const availableCount = state.issueTransitions.filter((transition) => !transition.requiresInput).length;
  const blockedCount = state.issueTransitions.length - availableCount;
  transitionSelect.disabled = state.transitioning || availableCount === 0;
  if (previousValue && state.issueTransitions.some((transition) => transition.id === previousValue && !transition.requiresInput)) {
    transitionSelect.value = previousValue;
  }
  if (!state.issueTransitions.length) {
    transitionHint.textContent = "Jira 当前没有向此用户开放下一步工作流操作。";
  } else if (!availableCount) {
    transitionHint.textContent = "当前流转都要求填写额外字段，请点击右上角“在 Jira 中打开”完成。";
  } else if (blockedCount) {
    transitionHint.textContent = `提交前会再次确认；另有 ${blockedCount} 个流转需在 Jira 中填写额外字段。`;
  } else {
    transitionHint.textContent = "提交前会再次确认，成功后立即写入 Jira 并刷新任务列表。";
  }
  updateTransitionAction();
}

async function loadIssueTransitions(issue) {
  const requestId = ++transitionRequestId;
  state.issueTransitions = [];
  state.transitionLoading = true;
  state.transitioning = false;
  state.transitionError = "";
  renderTransitionControl();
  try {
    const payload = await api(`/api/issues/${encodeURIComponent(issue.key)}/transitions`);
    if (requestId !== transitionRequestId || state.selectedIssue?.key !== issue.key) return;
    state.issueTransitions = Array.isArray(payload.transitions) ? payload.transitions : [];
  } catch (error) {
    if (requestId !== transitionRequestId || state.selectedIssue?.key !== issue.key) return;
    state.transitionError = error.message;
  } finally {
    if (requestId === transitionRequestId && state.selectedIssue?.key === issue.key) {
      state.transitionLoading = false;
      renderTransitionControl();
    }
  }
}

async function refreshActiveIssueView() {
  if (state.activeView === "sheets") await loadJxlSheetIssues();
  else await loadIssues();
}

async function submitIssueTransition() {
  const issue = state.selectedIssue;
  if (!issue) return;
  if (state.transitionError) {
    await loadIssueTransitions(issue);
    return;
  }
  const transition = selectedTransition();
  if (!transition || transition.requiresInput || state.transitioning) return;
  const currentStatus = issue.statusName || statusLabel(issue.status);
  const targetStatus = transition.to?.name || transition.name;
  const actionDetail = transition.name && transition.name !== targetStatus ? `（操作：${transition.name}）` : "";
  const confirmed = window.confirm(
    `确认将 ${issue.key} 从“${currentStatus}”流转到“${targetStatus}”${actionDetail}？\n\n提交后会立即写入 Jira。`
  );
  if (!confirmed) return;

  state.transitioning = true;
  renderTransitionControl();
  try {
    const payload = await api(`/api/issues/${encodeURIComponent(issue.key)}/transitions`, {
      method: "POST",
      body: { transitionId: transition.id, expectedTargetStatus: targetStatus }
    });
    const applied = payload.transition || transition;
    closeDetails();
    await refreshActiveIssueView();
    showToast(`${issue.key} 已流转到“${applied.to?.name || targetStatus}”`, 4200);
  } catch (error) {
    if (state.selectedIssue?.key !== issue.key) return;
    state.transitioning = false;
    showToast(`状态流转失败：${error.message}`, 6000);
    await loadIssueTransitions(issue);
  }
}

function renderParentContext(issue) {
  const section = document.querySelector("#parent-context-section");
  const parent = issue?.parentIssue || issue?.parent || null;
  section.hidden = !parent?.key;
  if (!parent?.key) return;
  const unavailable = issue?.parentContext?.status === "unavailable" && !issue?.parentIssue;
  document.querySelector("#detail-parent-title").textContent = parent.title || parent.key;
  document.querySelector("#detail-parent-status").textContent = `状态：${parent.statusName || "未知"}`;
  document.querySelector("#detail-parent-versions").textContent = parent.fixVersions?.length
    ? `父单版本：${parent.fixVersions.join("、")}`
    : "父单未设置版本";
  const link = document.querySelector("#detail-parent-link");
  link.href = parent.url || "#";
  link.textContent = `${parent.key} ↗`;
  renderRichText(
    document.querySelector("#detail-parent-summary"),
    unavailable
      ? issue.parentContext.message || "父单详情暂时无法读取；当前执行单仍可正常处理。"
      : issue.parentIssue
        ? parent.summary
        : "正在读取父级需求上下文…"
  );
  const attachments = issue.parentIssue?.attachments || [];
  document.querySelector("#parent-attachment-count").textContent = String(attachments.length);
  document.querySelector("#detail-parent-attachments").replaceChildren(...(
    attachments.length
      ? attachments.map(createAttachmentCard)
      : [element("span", "detail-empty", unavailable ? "父单附件暂不可用" : "无附件")]
  ));
}

function renderIssueDetail(issue) {
  state.selectedIssue = issue;
  document.querySelector("#detail-type").textContent = typeLabel(issue);
  document.querySelector("#detail-key").textContent = issue.key;
  document.querySelector("#detail-title").textContent = issue.title;
  renderRichText(document.querySelector("#detail-summary"), issue.summary);
  document.querySelector("#detail-status").textContent = issue.statusName || statusLabel(issue.status);
  document.querySelector("#detail-priority").textContent = issue.priority;
  document.querySelector("#detail-assignee").textContent = issue.assignee;
  document.querySelector("#detail-issue-type").textContent = typeLabel(issue);
  document.querySelector("#detail-project").textContent = issue.projectName || "—";
  document.querySelector("#detail-updated").textContent = formatDate(issue.updated);
  renderParentContext(issue);
  const collaborators = normalizeCollaborators(issue.collaborators || []);
  document.querySelector("#collaborator-count").textContent = String(collaborators.length);
  const collaboratorList = document.querySelector("#detail-collaborators");
  collaboratorList.replaceChildren(...(collaborators.length
    ? collaborators.map(createPersonChip)
    : [element("span", "detail-empty", "未设置协同处理人")]));
  const attachments = issue.attachments || [];
  document.querySelector("#attachment-count").textContent = String(attachments.length);
  const attachmentList = document.querySelector("#detail-attachments");
  attachmentList.replaceChildren(...(attachments.length
    ? attachments.map(createAttachmentCard)
    : [element("span", "detail-empty", "无附件")]));
  const issueLabels = issue.labels || [];
  const labels = document.querySelector("#detail-labels");
  labels.replaceChildren(...(issueLabels.length
    ? issueLabels.map((label) => element("span", "", label))
    : [element("em", "", "无标签")]));
  const link = document.querySelector("#detail-link");
  link.href = issue.url;
  updatePrimaryAction(issue);
  renderAssociationWait();
}

async function loadIssueDetailContext(issueKey) {
  const key = String(issueKey || "").trim().toUpperCase();
  const requestId = ++issueDetailRequestId;
  try {
    const payload = await api(`/api/issues/${encodeURIComponent(key)}`);
    if (requestId !== issueDetailRequestId || state.selectedIssue?.key !== key) return;
    if (payload?.binding) state.bindings[key] = payload.binding;
    else if (Object.prototype.hasOwnProperty.call(payload || {}, "binding")) delete state.bindings[key];
    const revision = Number(payload?.bindingsRevision);
    if (Number.isInteger(revision) && revision >= 0) state.bindingsRevision = revision;
    if (payload?.issue?.key) renderIssueDetail(payload.issue);
  } catch (error) {
    if (requestId !== issueDetailRequestId || state.selectedIssue?.key !== key) return;
    if (state.selectedIssue?.parent?.key) {
      state.selectedIssue = {
        ...state.selectedIssue,
        parentContext: {
          status: "unavailable",
          key: state.selectedIssue.parent.key,
          message: `父级上下文暂时无法刷新：${error.message}`
        }
      };
      renderIssueDetail(state.selectedIssue);
    }
  }
}

function openDetails(issue) {
  renderIssueDetail(issue);
  drawer.hidden = false;
  backdrop.hidden = false;
  drawer.focus();
  void loadIssueTransitions(issue);
  if (!Object.prototype.hasOwnProperty.call(issue, "parentContext")) {
    void loadIssueDetailContext(issue.key);
  }
}

function updatePrimaryAction(issue) {
  const action = document.querySelector("#primary-action");
  const rebindAction = document.querySelector("#rebind-action");
  const clearBindingAction = document.querySelector("#clear-binding-action");
  const svnAction = document.querySelector("#svn-action");
  const bindingSummary = document.querySelector("#binding-summary");
  const bindingThreadTitle = document.querySelector("#binding-thread-title");
  const bindingProjectScopeList = document.querySelector("#binding-project-scopes");
  const canProcess = issue.status === "todo" || issue.status === "in_progress";
  const associationWaiting = associationPendingIssueKey === String(issue.key || "").toUpperCase();
  const binding = state.bindings[issue.key];
  bindingSummary.hidden = !binding;
  bindingThreadTitle.textContent = binding?.threadTitle || "Codex 对话";
  bindingThreadTitle.title = binding?.threadTitle || "";
  const projectScopes = bindingProjectScopes(binding);
  bindingProjectScopeList.replaceChildren(...projectScopes.map((scope) => {
    const chip = element("span", "binding-project-chip", scope.projectLabel || scope.cwd || scope.projectId);
    chip.title = scope.cwd || scope.workspaceRoots?.[0] || scope.projectId || "";
    if (scope.id === binding?.workspace?.defaultProjectScopeId || (!binding?.workspace?.defaultProjectScopeId && scope === projectScopes[0])) {
      chip.classList.add("primary");
      chip.setAttribute("aria-label", `${chip.textContent}，主目录`);
    }
    return chip;
  }));
  bindingProjectScopeList.hidden = projectScopes.length === 0;
  rebindAction.hidden = !(canProcess && binding);
  rebindAction.disabled = associationWaiting;
  clearBindingAction.hidden = !binding;
  clearBindingAction.disabled = Boolean(clearingBindingIssueKey) || associationWaiting;
  clearBindingAction.textContent = clearingBindingIssueKey === issue.key ? "正在解除…" : "解除关联";
  svnAction.hidden = !binding;
  svnAction.disabled = associationWaiting;
  const firstMessageFailed = binding?.firstMessageStatus === "failed";
  const firstMessagePending = binding?.firstMessageStatus === "pending";
  action.textContent = associationWaiting
    ? associationWaitActionLabel
    : !canProcess
    ? "已完成任务仅查看"
    : binding
      ? firstMessageFailed
        ? "重新创建并发送分析会话"
        : firstMessagePending
          ? "正在发送首条分析消息…"
          : "打开已绑定的 Codex 对话"
      : "关联 Codex 会话";
  action.disabled = !canProcess || firstMessagePending || associationWaiting;
  action.classList.toggle("is-waiting", associationWaiting);
  action.classList.toggle("secondary", !canProcess);
}

function renderAssociationWait() {
  const issueKey = String(state.selectedIssue?.key || "").toUpperCase();
  const waiting = Boolean(issueKey && associationPendingIssueKey === issueKey);
  associationWait.hidden = !waiting;
  drawer.setAttribute("aria-busy", waiting ? "true" : "false");
  if (waiting) {
    associationWaitTitle.textContent = associationWaitTitleText;
    associationWaitDescription.textContent = associationWaitDescriptionText;
  }
  if (state.selectedIssue) updatePrimaryAction(state.selectedIssue);
}

function finishAssociationWait(issueKey = "") {
  const normalizedIssueKey = String(issueKey || associationPendingIssueKey || "").trim().toUpperCase();
  if (normalizedIssueKey && associationPendingIssueKey && normalizedIssueKey !== associationPendingIssueKey) return;
  if (associationWaitTimer) window.clearTimeout(associationWaitTimer);
  associationWaitTimer = 0;
  associationPendingIssueKey = "";
  renderAssociationWait();
}

function beginAssociationWait(issueKey, {
  actionLabel = "正在处理…",
  title = "正在处理 Codex 会话…",
  description = "操作确认成功后将自动跳转。"
} = {}) {
  const normalizedIssueKey = String(issueKey || "").trim().toUpperCase();
  if (!normalizedIssueKey || associationPendingIssueKey) return false;
  associationPendingIssueKey = normalizedIssueKey;
  associationWaitActionLabel = actionLabel;
  associationWaitTitleText = title;
  associationWaitDescriptionText = description;
  if (associationWaitTimer) window.clearTimeout(associationWaitTimer);
  associationWaitTimer = window.setTimeout(() => {
    if (associationPendingIssueKey !== normalizedIssueKey) return;
    finishAssociationWait(normalizedIssueKey);
    void loadCodexPanelContext({ quiet: true });
    showToast("等待 Codex 会话响应超时，已自动恢复操作。请先确认绑定状态，再决定是否重试。", 6500);
  }, ASSOCIATION_WAIT_TIMEOUT_MS);
  closeRebindDialog();
  renderAssociationWait();
  return true;
}

function desktopActionSucceeded(issueKey, action) {
  const key = String(issueKey || "").trim().toUpperCase();
  finishAssociationWait(key);
  postHostMessage("desktop-action-complete", { issueKey: key, action });
}

async function openBoundIssueConversation(issue, {
  recreateAnalysis = false,
  supplementalDescription = "",
  workspace = null,
  workspaceSelection = "preserve"
} = {}) {
  const key = String(issue?.key || "").trim().toUpperCase();
  if (!key) return;
  const revisionBeforeRequest = state.bindingsRevision;
  const threadIdBeforeRequest = String(state.bindings[key]?.threadId || "").trim();
  try {
    const result = await api(`/api/codex/issues/${encodeURIComponent(key)}/${recreateAnalysis ? "analysis" : "open"}`, {
      method: "POST",
      body: recreateAnalysis
        ? {
          supplementalDescription,
          expectedRevision: revisionBeforeRequest,
          workspace: workspace || (workspaceSelection === "preserve" ? state.bindings[key]?.workspace : null) || null,
          workspaceSelection
        }
        : {}
    });
    if (recreateAnalysis) saveAssociationDraft(key, "");
    if (result?.binding) state.bindings[key] = result.binding;
    if (Number.isInteger(Number(result?.bindingsRevision))) {
      state.bindingsRevision = Number(result.bindingsRevision);
    }
    desktopActionSucceeded(key, recreateAnalysis ? "analysis" : "open");
    void loadCodexPanelContext({ quiet: true });
  } catch (error) {
    finishAssociationWait(key);
    if (!recreateAnalysis) {
      showToast(`无法打开 Codex 会话：${error.message}`, 6500);
      void loadCodexPanelContext({ quiet: true });
      return;
    }

    const orphanThreadId = error?.details?.stage === "created_unbound"
      ? String(error.details.threadId || "").trim()
      : "";
    if (orphanThreadId) {
      openRebindDialog({ preferredMode: "existing" });
      const threadInput = document.querySelector("#rebind-thread-id");
      threadInput.value = orphanThreadId;
      updateRebindThreadPreview();
      setRebindStatus(
        `新会话 ${orphanThreadId} 已创建，但绑定状态同时发生变化，系统没有覆盖原绑定。请按“绑定已有会话”人工确认。`
      );
      void loadCodexPanelContext({ quiet: true });
      return;
    }

    openRebindDialog({ preferredMode: "new" });
    setRebindStatus(`新会话创建失败：${error.message}`);
    void loadCodexPanelContext({ quiet: true }).then(() => {
      const currentThreadId = String(state.bindings[key]?.threadId || "").trim();
      // A revision can advance because an unrelated Jira issue changed. Only
      // a genuinely different thread proves that this create operation saved
      // a new binding; the previous binding must never be reported as success.
      const bindingReallyChanged = Boolean(currentThreadId) && currentThreadId !== threadIdBeforeRequest;
      if (!bindingReallyChanged) return;
      setRebindStatus(
        `服务回执异常，但已确认绑定更新为会话 ${currentThreadId}。请关闭本窗口后直接打开已绑定会话。`
      );
    });
  }
}

async function bindExistingConversation(issue, { threadId, confirmConflict = false, workspace = null } = {}) {
  const key = String(issue?.key || "").trim().toUpperCase();
  if (!key || !threadId) return;
  let bindingSaved = false;
  try {
    const result = await api("/api/codex/bindings", {
      method: "PUT",
      body: {
        issueKey: key,
        threadId,
        expectedRevision: state.bindingsRevision,
        replaceExistingThreadBinding: Boolean(confirmConflict),
        workspace,
        workspaceSelection: workspace ? "explicit" : "thread"
      }
    });
    bindingSaved = true;
    if (Array.isArray(result.replacedIssueKeys)) {
      for (const replacedIssueKey of result.replacedIssueKeys) delete state.bindings[replacedIssueKey];
    }
    if (result.binding) state.bindings[key] = result.binding;
    if (Number.isInteger(Number(result.revision))) state.bindingsRevision = Number(result.revision);
    await api(`/api/codex/issues/${encodeURIComponent(key)}/open`, { method: "POST", body: {} });
    desktopActionSucceeded(key, "bind-existing");
    void loadCodexPanelContext({ quiet: true });
  } catch (error) {
    finishAssociationWait(key);
    if (bindingSaved) {
      showToast(`会话已关联，但暂时无法跳转：${error.message}。可以直接重试打开。`, 7000);
    } else {
      openRebindDialog({ preferredMode: "existing" });
      setRebindStatus(error.code === "ISSUE_BINDINGS_REVISION_CONFLICT"
        ? "绑定关系刚刚发生变化，已刷新最新状态，请重新确认后再绑定。"
        : error.message);
    }
    void loadCodexPanelContext({ quiet: true });
  }
}

async function clearIssueBinding(issue) {
  const key = String(issue?.key || "").trim().toUpperCase();
  if (!key || clearingBindingIssueKey) return;
  clearingBindingIssueKey = key;
  confirmClearBinding.disabled = true;
  confirmClearBinding.textContent = "正在解除…";
  setClearBindingStatus("正在从本地服务解除会话关联…", "info");
  updatePrimaryAction(issue);
  try {
    const result = await api(`/api/codex/bindings/${encodeURIComponent(key)}`, {
      method: "DELETE",
      body: { expectedRevision: state.bindingsRevision }
    });
    delete state.bindings[key];
    if (Number.isInteger(Number(result.revision))) state.bindingsRevision = Number(result.revision);
    await loadCodexPanelContext({ quiet: true });
    clearingBindingIssueKey = "";
    closeClearBindingDialog();
    render();
    if (state.selectedIssue) updatePrimaryAction(state.selectedIssue);
    showToast(`${key} 已解除会话关联`, 4200);
  } catch (error) {
    clearingBindingIssueKey = "";
    await loadCodexPanelContext({ quiet: true });
    confirmClearBinding.disabled = false;
    confirmClearBinding.textContent = "重试解除关联";
    setClearBindingStatus(error.code === "ISSUE_BINDINGS_REVISION_CONFLICT"
      ? "绑定关系刚刚发生变化，已刷新最新状态，请重新确认。"
      : error.message);
    if (state.selectedIssue) updatePrimaryAction(state.selectedIssue);
  }
}

function setClearBindingStatus(message, kind = "error") {
  clearBindingStatus.className = `settings-status ${kind}`;
  clearBindingStatus.textContent = message;
  clearBindingStatus.hidden = !message;
}

function openClearBindingDialog() {
  const issue = state.selectedIssue;
  const binding = issue ? state.bindings[issue.key] : null;
  if (!issue || !binding) return;
  document.querySelector("#clear-binding-issue-key").textContent = issue.key;
  document.querySelector("#clear-binding-thread-title").textContent = binding.threadTitle || binding.threadId || "Codex 对话";
  setClearBindingStatus("");
  confirmClearBinding.disabled = false;
  confirmClearBinding.textContent = "确认解除关联";
  clearBindingDialog.hidden = false;
  clearBindingBackdrop.hidden = false;
  clearBindingDialog.focus();
}

function closeClearBindingDialog() {
  clearBindingDialog.hidden = true;
  clearBindingBackdrop.hidden = true;
  setClearBindingStatus("");
}

function closeDetails() {
  if (!attachmentPreviewDialog.hidden) closeAttachmentPreview();
  closeClearBindingDialog();
  closeRebindDialog();
  transitionRequestId += 1;
  issueDetailRequestId += 1;
  drawer.hidden = true;
  backdrop.hidden = true;
  state.selectedIssue = null;
  state.issueTransitions = [];
  state.transitionLoading = false;
  state.transitioning = false;
  state.transitionError = "";
}

function setRebindStatus(message, kind = "error") {
  rebindStatus.className = `settings-status ${kind}`;
  rebindStatus.textContent = message;
  rebindStatus.hidden = !message;
}

function readAssociationDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(ASSOCIATION_DRAFT_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function associationDraftFor(issueKey) {
  return String(readAssociationDrafts()[String(issueKey || "").toUpperCase()] || "");
}

function saveAssociationDraft(issueKey, content) {
  const normalizedIssueKey = String(issueKey || "").trim().toUpperCase();
  if (!normalizedIssueKey) return;
  const drafts = readAssociationDrafts();
  const normalizedContent = String(content || "");
  if (normalizedContent) drafts[normalizedIssueKey] = normalizedContent;
  else delete drafts[normalizedIssueKey];
  try {
    localStorage.setItem(ASSOCIATION_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // The prompt still uses the current textarea value when local storage is unavailable.
  }
}

function comparableThreadId(value) {
  return String(value || "").trim().replace(/^local:/, "");
}

function bindingConflictForThread(threadId, issueKey) {
  const normalizedThreadId = comparableThreadId(threadId);
  const normalizedIssueKey = String(issueKey || "").trim().toUpperCase();
  if (!normalizedThreadId) return null;
  return Object.entries(state.bindings).find(([candidateIssueKey, binding]) => (
    candidateIssueKey !== normalizedIssueKey
    && [binding?.threadId, binding?.uiThreadId].some((candidate) => comparableThreadId(candidate) === normalizedThreadId)
  )) || null;
}

function updateRebindThreadPreview() {
  const threadId = document.querySelector("#rebind-thread-id").value.trim();
  const thread = state.threads.find((candidate) => comparableThreadId(candidate.threadId) === comparableThreadId(threadId));
  const conflict = bindingConflictForThread(threadId, state.selectedIssue?.key);
  const conflictConfirm = document.querySelector("#rebind-conflict-confirm");
  const conflictCheckbox = document.querySelector("#rebind-conflict-checkbox");
  const conflictIssueKey = conflict?.[0] || "";
  if (conflictConfirm.dataset.issueKey !== conflictIssueKey) conflictCheckbox.checked = false;
  conflictConfirm.dataset.issueKey = conflictIssueKey;
  conflictConfirm.hidden = !conflict;
  if (conflict) {
    document.querySelector("#rebind-conflict-label").textContent = `该会话当前关联 ${conflict[0]}。确认后将改为关联 ${state.selectedIssue?.key}，原单子会变为未绑定。`;
  }
  document.querySelector("#rebind-thread-preview").textContent = thread
    ? `将关联：${thread.threadTitle || thread.threadId}。绑定后只跳转，不发送消息。`
    : threadId
      ? "当前侧栏未显示该会话，将在绑定前按会话 ID 验证。"
      : "可以搜索当前侧栏会话，也可以直接输入会话 ID。";
  return { threadId: thread?.threadId || threadId, thread, conflict };
}

function updateRebindMode() {
  const mode = document.querySelector('input[name="rebindMode"]:checked')?.value || "existing";
  const isNew = mode === "new";
  document.querySelector("#rebind-existing-fields").hidden = isNew;
  document.querySelector("#rebind-new-fields").hidden = !isNew;
  document.querySelector("#confirm-rebind").textContent = isNew
    ? "新建并发送分析消息"
    : "绑定并打开对话";
  updateRebindProjectSelection();
  if (!isNew) updateRebindThreadPreview();
  setRebindStatus("");
  return mode;
}

function openRebindDialog({ preferredMode = "" } = {}) {
  if (!state.selectedIssue) return;
  if (associationPendingIssueKey) {
    showToast("当前 Codex 会话操作仍在等待结果，请稍候或等待自动恢复。", 3600);
    return;
  }
  const binding = state.bindings[state.selectedIssue.key];
  const options = document.querySelector("#rebind-thread-options");
  options.replaceChildren(...state.threads.map((thread) => {
    const option = document.createElement("option");
    option.value = thread.threadId;
    const prefix = thread.active ? "当前 · " : thread.pinned ? "置顶 · " : "";
    option.label = `${prefix}${thread.threadTitle || thread.threadId}`;
    return option;
  }));
  const currentThread = state.threads.find((thread) => thread.active);
  const currentButton = document.querySelector("#bind-current-thread");
  currentButton.disabled = !currentThread;
  currentButton.textContent = currentThread
    ? `使用当前会话：${currentThread.threadTitle || currentThread.threadId}`
    : "当前没有可绑定的会话";
  document.querySelector("#rebind-thread-id").value = binding?.threadId || currentThread?.threadId || "";
  document.querySelector("#rebind-supplement").value = associationDraftFor(state.selectedIssue.key);
  document.querySelector("#rebind-title").textContent = binding ? "更改关联会话" : "关联 Codex 会话";
  document.querySelector("#rebind-description").textContent = binding
    ? "可以改绑到已有会话，也可以新建任务会话。旧绑定会保留到新关联成功为止。"
    : "可以新建任务会话，也可以关联当前或已有 Codex 会话。";
  const mode = preferredMode || (binding ? "existing" : "new");
  const modeInput = document.querySelector(`input[name="rebindMode"][value="${mode}"]`);
  if (modeInput) modeInput.checked = true;
  renderRebindProjectScopes(binding);
  setRebindStatus("");
  updateRebindThreadPreview();
  updateRebindMode();
  rebindBackdrop.hidden = false;
  rebindDialog.hidden = false;
  window.setTimeout(() => {
    if (mode === "new") document.querySelector("#rebind-supplement").focus();
    else document.querySelector("#rebind-thread-id").select();
  }, 0);
}

function closeRebindDialog() {
  rebindBackdrop.hidden = true;
  rebindDialog.hidden = true;
}

function compactTemplatePreview(content) {
  return String(content || "").replace(/\s+/g, " ").trim() || "未设置消息正文";
}

function matchingAvailableSkill(reference) {
  const skill = normalizedSkillReference(reference);
  if (!skill) return null;
  if (skill.path) {
    const exactPath = state.skills.find((candidate) => candidate.path === skill.path && candidate.enabled !== false);
    if (exactPath) return exactPath;
  }
  const exactNames = state.skills.filter((candidate) => candidate.name === skill.name && candidate.enabled !== false);
  return exactNames.length === 1 ? exactNames[0] : null;
}

function renderTemplateCards() {
  for (const kind of ["requirement", "bug"]) {
    const entry = templateDrafts[kind] || defaultTemplateDrafts()[kind];
    document.querySelector(`#${kind}-template-preview`).textContent = compactTemplatePreview(entry.content);
    document.querySelector(`#${kind}-template-mode`).textContent = entry.customized ? "自定义" : "系统默认";
    const badge = document.querySelector(`#${kind}-template-skill`);
    const skill = normalizedSkillReference(entry.skill);
    badge.classList.toggle("none", !skill);
    if (!skill) {
      badge.textContent = "无";
      badge.title = "未绑定额外技能";
      continue;
    }
    const available = matchingAvailableSkill(skill);
    const unavailableLabel = state.skillsError
      ? "（技能列表读取失败）"
      : state.skills.length && !available ? "（当前不可用）" : "";
    badge.textContent = `${skill.name}${unavailableLabel}`;
    badge.title = available?.path || skill.path || "保存时按技能名称解析";
  }
}

function selectedSkillFromEditor() {
  const option = templateEditorSkill.selectedOptions[0];
  if (!option?.value) return null;
  return normalizedSkillReference({
    name: option.dataset.skillName,
    path: option.dataset.skillPath,
    scope: option.dataset.skillScope
  });
}

function populateTemplateSkillOptions(selectedReference = null) {
  const selected = normalizedSkillReference(selectedReference);
  const options = [];
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "不绑定额外技能";
  options.push(none);

  const availableSkills = state.skills
    .filter((skill) => skill?.enabled !== false && skill?.name && skill?.path)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  let selectedValue = "";
  availableSkills.forEach((skill, index) => {
    const option = document.createElement("option");
    option.value = `available:${index}`;
    option.textContent = `${skill.name}${skill.scope ? ` · ${skill.scope}` : ""}`;
    option.dataset.skillName = skill.name;
    option.dataset.skillPath = skill.path;
    option.dataset.skillScope = skill.scope || "";
    options.push(option);
    if (selected && (selected.path ? selected.path === skill.path : selected.name === skill.name) && !selectedValue) {
      selectedValue = option.value;
    }
  });
  if (selected && !selectedValue) {
    const unavailable = document.createElement("option");
    unavailable.value = "configured";
    unavailable.textContent = `${selected.name}（当前不可用，运行时自动降级）`;
    unavailable.dataset.skillName = selected.name;
    unavailable.dataset.skillPath = selected.path;
    unavailable.dataset.skillScope = selected.scope;
    options.push(unavailable);
    selectedValue = unavailable.value;
  }
  templateEditorSkill.replaceChildren(...options);
  templateEditorSkill.value = selectedValue;
  document.querySelector("#template-editor-skill-help").textContent = state.skillsError
    ? `Codex 技能列表读取失败：${state.skillsError}。绑定 Skill 可用时仍优先遵循其相关规则；运行时不可用会降级到模板和内置 Jira Skill。`
    : "绑定 Skill 后优先遵循其工具、流程、证据、安全边界和输出格式；本模板与内置 Jira Skill 仅补充未覆盖内容。Skill 不可用时自动降级。";
}

function setTemplateEditorStatus(message, kind = "error") {
  templateEditorStatus.className = `settings-status ${kind}`;
  templateEditorStatus.textContent = message;
  templateEditorStatus.hidden = !message;
}

function openTemplateEditor(kind) {
  if (!templateDrafts[kind]) return;
  editingTemplateKind = kind;
  document.querySelector("#template-editor-title").textContent = kind === "bug"
    ? "编辑 Bug 分析模板"
    : "编辑需求分析模板";
  templateEditorContent.value = templateDrafts[kind].content;
  populateTemplateSkillOptions(templateDrafts[kind].skill);
  setTemplateEditorStatus("");
  templateEditorBackdrop.hidden = false;
  templateEditorDialog.hidden = false;
  window.setTimeout(() => {
    templateEditorContent.focus();
    templateEditorContent.setSelectionRange(0, 0);
    templateEditorContent.scrollTop = 0;
  }, 0);
}

function closeTemplateEditor() {
  templateEditorBackdrop.hidden = true;
  templateEditorDialog.hidden = true;
  editingTemplateKind = "";
}

function settingsBoardSources(config) {
  const configured = config?.boardSources;
  if (configured && typeof configured === "object") {
    return {
      projectKey: String(configured.projectKey || ""),
      collaboratorFieldId: String(configured.collaboratorFieldId || ""),
      collaboratorJqlName: String(configured.collaboratorJqlName || ""),
      requirement: {
        mode: String(configured.requirement?.mode || "builtin"),
        jql: String(configured.requirement?.jql || ""),
        filterIds: Array.isArray(configured.requirement?.filterIds) ? configured.requirement.filterIds.map(String) : []
      },
      bug: {
        mode: String(configured.bug?.mode || "builtin"),
        jql: String(configured.bug?.jql || ""),
        filterIds: Array.isArray(configured.bug?.filterIds) ? configured.bug.filterIds.map(String) : []
      }
    };
  }
  const legacyJql = String(config?.jql || "").trim();
  const isLegacyDefault = /filter\s*=\s*10103/i.test(legacyJql)
    || /project\s*=\s*CT\b/i.test(legacyJql);
  return {
    projectKey: isLegacyDefault ? "CT" : "",
    collaboratorFieldId: isLegacyDefault ? "customfield_10600" : "",
    collaboratorJqlName: isLegacyDefault ? "协同处理人" : "",
    requirement: { mode: isLegacyDefault ? "builtin" : "custom", jql: isLegacyDefault ? "" : legacyJql, filterIds: [] },
    bug: { mode: isLegacyDefault ? "builtin" : "custom", jql: isLegacyDefault ? "" : legacyJql, filterIds: [] }
  };
}

function setBoardFiltersStatus(message = "", kind = "info") {
  const status = document.querySelector("#board-filters-status");
  if (!status) return;
  status.className = `board-filters-status ${kind}`;
  status.textContent = message;
  status.hidden = !message;
}

function boardDataRequest(path, { projectKey = "" } = {}) {
  const baseUrl = document.querySelector("#base-url")?.value.trim() || "";
  const token = document.querySelector("#token")?.value.trim() || "";
  const savedBaseUrl = String(state.config?.baseUrl || "").trim();
  const usingDraftConnection = Boolean(token) || (Boolean(baseUrl) && baseUrl !== savedBaseUrl);
  const query = projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : "";
  if (usingDraftConnection) {
    return {
      path: `${path}${query}`,
      options: { method: "POST", body: { baseUrl, token } },
      usingDraftConnection: true
    };
  }
  return { path: `${path}${query}`, options: {}, usingDraftConnection: false };
}

function renderBoardProjectOptions() {
  const datalist = document.querySelector("#board-project-options");
  if (!datalist) return;
  datalist.replaceChildren(...(Array.isArray(state.boardProjects) ? state.boardProjects : []).map((project) => {
    const option = document.createElement("option");
    option.value = project.key;
    option.label = `${project.key} · ${project.name}`;
    return option;
  }));
}

async function loadBoardProjects({ quiet = false, force = false } = {}) {
  const hasDraftConnection = Boolean(document.querySelector("#base-url")?.value.trim() && document.querySelector("#token")?.value.trim());
  if ((!state.config?.configured && !hasDraftConnection) || state.boardProjectsLoading || (!force && state.boardProjects.length)) return;
  state.boardProjectsLoading = true;
  state.boardProjectsError = "";
  const request = boardDataRequest("/api/projects");
  setBoardFiltersStatus(
    request.usingDraftConnection
      ? "正在使用当前表单中的新 Token 读取 Jira 项目…"
      : "正在读取当前 Token 可访问的 Jira 项目…",
    "info"
  );
  try {
    const payload = await api(request.path, request.options);
    state.boardProjects = Array.isArray(payload.projects) ? payload.projects : [];
    renderBoardProjectOptions();
    const input = document.querySelector("#board-project-key");
    const current = input?.value.trim().toUpperCase() || "";
    const exact = state.boardProjects.some((project) => project.key === current);
    if (!current && state.boardProjects.length === 1 && input) {
      input.value = state.boardProjects[0].key;
      setBoardFiltersStatus(`已自动选择项目 ${state.boardProjects[0].key}`, "info");
    } else if (current && state.boardProjects.length && !exact) {
      setBoardFiltersStatus(`当前项目 ${current} 不在 Token 可访问列表中，请从输入提示中选择有效项目。`, "error");
    } else if (!state.boardProjects.length) {
      setBoardFiltersStatus("当前 Token 没有可访问的 Jira 项目，或 Token 认证已失效。", "error");
    } else {
      setBoardFiltersStatus(`已读取 ${state.boardProjects.length} 个可访问项目`, "info");
    }
  } catch (error) {
    state.boardProjects = [];
    state.boardProjectsError = error.message;
    renderBoardProjectOptions();
    setBoardFiltersStatus(`项目读取失败：${error.message}`, "error");
    if (!quiet) showToast(`读取 Jira 项目失败：${error.message}`, 5000);
  } finally {
    state.boardProjectsLoading = false;
  }
}

function activeBoardFilterMode() {
  return ["requirement", "bug"].some((kind) => document.querySelector(`#${kind}-source-mode`)?.value === "filter");
}

function renderBoardFilterOptions() {
  for (const kind of ["requirement", "bug"]) {
    const select = document.querySelector(`#${kind}-filter-ids`);
    if (!select) continue;
    const selected = new Set((state.boardFilterSelections[kind] || []).map(String));
    const filters = Array.isArray(state.boardFilters) ? state.boardFilters : [];
    const missing = [...selected]
      .filter((id) => !filters.some((filter) => String(filter.id) === id))
      .map((id) => ({ id, name: "当前 Jira 不可访问或已删除的 Filter", unavailable: true }));
    select.replaceChildren();
    if (!filters.length && !missing.length) {
      const empty = document.createElement("option");
      empty.disabled = true;
      empty.textContent = state.boardFiltersLoading ? "正在读取 Filter…" : "暂无可用 Filter";
      select.append(empty);
      continue;
    }
    for (const filter of [...missing, ...filters]) {
      const option = document.createElement("option");
      option.value = String(filter.id);
      const scopeLabel = filter.projectMatch === "match"
        ? "（当前项目）"
        : filter.projectMatch === "other"
          ? "（其他项目）"
          : filter.projectMatch === "unknown"
            ? "（范围待确认）"
            : "";
      option.textContent = `${filter.name || `Filter ${filter.id}`} (#${filter.id})${scopeLabel}`;
      option.title = filter.jql || "";
      option.selected = selected.has(option.value);
      if (filter.unavailable) {
        option.disabled = true;
        option.title = "该 Filter 不在当前 Jira Token 的可访问列表中，请刷新后重新选择。";
      }
      select.append(option);
    }
  }
}

function updateBoardSourceVisibility() {
  let hasBuiltin = false;
  for (const kind of ["requirement", "bug"]) {
    const mode = document.querySelector(`#${kind}-source-mode`)?.value || "builtin";
    hasBuiltin ||= mode === "builtin";
    const jqlField = document.querySelector(`#${kind}-board-jql-field`);
    const filterField = document.querySelector(`#${kind}-filter-field`);
    if (jqlField) jqlField.hidden = mode !== "custom";
    if (filterField) filterField.hidden = mode !== "filter";
  }
  const projectField = document.querySelector("#board-project-field");
  if (projectField) projectField.hidden = !hasBuiltin;
  const help = document.querySelector("#board-source-help");
  if (help) {
    help.textContent = hasBuiltin
      ? "内置通用 JQL 会按项目、当前用户和任务类型自动查询；协同处理人字段会从 Jira 自动识别，识别不到时仅按经办人查询。"
      : "当前未使用内置通用 JQL；自定义 JQL 和 Filter 会按各自面板查询，并自动区分活动与历史任务。";
  }
}

async function loadBoardFilters({ quiet = false, force = false } = {}) {
  const hasDraftConnection = Boolean(document.querySelector("#base-url")?.value.trim() && document.querySelector("#token")?.value.trim());
  if ((!state.config?.configured && !hasDraftConnection) || state.boardFiltersLoading || (!force && !activeBoardFilterMode())) return;
  state.boardFiltersLoading = true;
  state.boardFiltersError = "";
  const projectKey = document.querySelector("#board-project-key")?.value.trim() || "";
  const selectedProject = state.boardProjects.find((project) => project.key === projectKey);
  const request = boardDataRequest("/api/filters", {
    projectKey,
    ...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
    ...(selectedProject?.name ? { projectName: selectedProject.name } : {})
  });
  setBoardFiltersStatus(
    request.usingDraftConnection
      ? "正在使用当前表单中的新 Token 读取 Jira Filter…"
      : "正在读取 Jira Filter…",
    "info"
  );
  renderBoardFilterOptions();
  try {
    const payload = await api(request.path, request.options);
    state.boardFilters = Array.isArray(payload.filters) ? payload.filters : [];
    setBoardFiltersStatus(`已读取 ${state.boardFilters.length} 个可用 Filter`, "info");
    renderBoardFilterOptions();
  } catch (error) {
    state.boardFilters = [];
    state.boardFiltersError = error.message;
    setBoardFiltersStatus(`Filter 读取失败：${error.message}`, "error");
    renderBoardFilterOptions();
    if (!quiet) showToast(`读取 Jira Filter 失败：${error.message}`, 5000);
  } finally {
    state.boardFiltersLoading = false;
    renderBoardFilterOptions();
  }
}

function collectBoardSourcesFromForm() {
  const source = {
    projectKey: document.querySelector("#board-project-key")?.value.trim() || "",
    collaboratorFieldId: state.config?.boardSources?.collaboratorFieldId || "",
    collaboratorJqlName: state.config?.boardSources?.collaboratorJqlName || ""
  };
  for (const kind of ["requirement", "bug"]) {
    const mode = document.querySelector(`#${kind}-source-mode`)?.value || "builtin";
    const jql = document.querySelector(`#${kind}-board-jql`)?.value.trim() || "";
    const filterIds = Array.from(document.querySelector(`#${kind}-filter-ids`)?.selectedOptions || []).map((option) => option.value);
    state.boardFilterSelections[kind] = filterIds;
    if (mode === "custom" && !jql) throw new Error(`${kind === "bug" ? "Bug" : "需求"} 面板的自定义 JQL 不能为空。`);
    if (mode === "filter" && !filterIds.length) throw new Error(`请为${kind === "bug" ? "Bug" : "需求"}面板选择至少一个 Filter。`);
    source[kind] = { mode, jql: mode === "custom" ? jql : "", filterIds: mode === "filter" ? filterIds : [] };
  }
  if (["requirement", "bug"].some((kind) => source[kind].mode === "builtin") && !source.projectKey) {
    throw new Error("使用内置通用 JQL 时必须选择项目 Key。请先刷新项目列表，或改用自定义 JQL / Filter。");
  }
  return source;
}

function validateSelectedBoardFilters(boardSources) {
  const available = new Set((Array.isArray(state.boardFilters) ? state.boardFilters : [])
    .map((filter) => String(filter?.id || "").trim())
    .filter(Boolean));
  for (const kind of ["requirement", "bug"]) {
    if (boardSources[kind]?.mode !== "filter") continue;
    const missing = boardSources[kind].filterIds.filter((id) => !available.has(String(id)));
    if (missing.length) {
      throw new Error(`${kind === "bug" ? "Bug" : "需求"} 面板包含当前 Jira Token 不可访问的 Filter（${missing.join(", ")}），请先刷新 Filter 并重新选择。`);
    }
  }
}

function populateSettings(config) {
  document.querySelector("#base-url").value = config?.baseUrl || "";
  document.querySelector("#token").value = "";
  document.querySelector("#token").placeholder = config?.hasToken ? "已安全保存；留空保持不变" : "粘贴 Token";
  document.querySelector("#wecom-webhook").value = "";
  document.querySelector("#wecom-webhook").placeholder = config?.wecomConfigured
    ? "已安全保存；留空保持不变"
    : "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...";
  document.querySelector("#wecom-help").textContent = config?.wecomConfigured
    ? "机器人已配置并使用 Windows DPAPI 加密；自动分析完成后会推送结果。"
    : "配置后，自动分析完成时会把结果推送到群机器人；留空则不推送。";
  document.querySelector("#clear-wecom").checked = false;
  document.querySelector("#clear-wecom-wrap").hidden = !config?.wecomConfigured;
  const sync = {
    ...DEFAULT_SYNC_SETTINGS,
    ...(config?.syncSettings || {})
  };
  document.querySelector("#sync-tasks-enabled").checked = Boolean(sync.tasksEnabled);
  document.querySelector("#sync-task-interval").value = String(sync.taskIntervalSeconds);
  document.querySelector("#sync-on-panel-return").checked = Boolean(sync.syncOnPanelReturn);
  document.querySelector("#sync-sheets-interval").value = String(sync.sheetsIntervalSeconds);
  document.querySelector("#update-check-enabled").checked = sync.updateCheckEnabled !== false;
  updateSyncControls();
  renderUpdateStatus();
  const boardSources = settingsBoardSources(config);
  document.querySelector("#jql").value = config?.jql || "";
  document.querySelector("#board-project-key").value = boardSources.projectKey;
  renderBoardProjectOptions();
  state.boardFilterSelections = {
    requirement: boardSources.requirement.filterIds,
    bug: boardSources.bug.filterIds
  };
  for (const kind of ["requirement", "bug"]) {
    document.querySelector(`#${kind}-source-mode`).value = boardSources[kind].mode;
    document.querySelector(`#${kind}-board-jql`).value = boardSources[kind].jql;
  }
  state.boardFilters = [];
  state.boardFiltersError = "";
  state.boardFiltersLoading = false;
  renderBoardFilterOptions();
  updateBoardSourceVisibility();
  setBoardFiltersStatus("");
  templateDrafts = templateDraftsFromConfig(config);
  renderTemplateCards();
  populateCodexProjectOptions(config?.codexProjectId || "", config?.codexProjectLabel || "");
  document.querySelector("#max-results").value = config?.maxResults || 100;
  document.querySelector("#clear-settings").hidden = !config?.configured;
  if (activeBoardFilterMode() && config?.configured) void loadBoardFilters({ quiet: true });
  if (config?.configured && ["requirement", "bug"].some((kind) => document.querySelector(`#${kind}-source-mode`)?.value === "builtin")) {
    void loadBoardProjects({ quiet: true, force: true });
  }
}

function populateCodexProjectOptions(selectedId = "", selectedLabel = "") {
  const select = document.querySelector("#codex-project");
  const choices = [{ projectId: "", projectLabel: "不绑定项目（普通对话）" }, ...state.projects];
  const selectedProject = choices.find((project) => (
    project.projectId === selectedId || `project:${project.projectId}` === selectedId
  ));
  const effectiveSelectedId = selectedProject?.projectId || selectedId;
  if (selectedId && !selectedProject) {
    choices.push({
      projectId: selectedId,
      projectLabel: selectedLabel || selectedId,
      cwd: state.config?.codexProjectPath || "",
      workspaceRoots: state.config?.codexProjectRoots || [],
      displayLabel: `${selectedLabel || selectedId}（当前不可用）`
    });
  }
  select.replaceChildren(...choices.map((project) => {
    const option = document.createElement("option");
    option.value = project.projectId;
    option.textContent = project.displayLabel || project.projectLabel;
    option.dataset.projectLabel = project.projectLabel;
    option.dataset.projectPath = project.cwd || "";
    option.dataset.projectRoots = JSON.stringify(project.workspaceRoots || (project.cwd ? [project.cwd] : []));
    return option;
  }));
  select.value = effectiveSelectedId;
}

function setSettingsStatus(message, kind = "error") {
  settingsStatus.className = `settings-status ${kind}`;
  settingsStatus.textContent = message;
  settingsStatus.hidden = !message;
}

function updateSyncControls() {
  const enabled = Boolean(document.querySelector("#sync-tasks-enabled")?.checked);
  const interval = document.querySelector("#sync-task-interval");
  if (interval) interval.disabled = !enabled;
}

function setSettingsSection(section = "jira") {
  const available = settingsSectionTabs.map((button) => button.dataset.settingsSectionTab);
  activeSettingsSection = available.includes(section) ? section : "jira";
  settingsSectionTabs.forEach((button) => {
    const active = button.dataset.settingsSectionTab === activeSettingsSection;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-settings-section]").forEach((item) => {
    item.classList.toggle("settings-section-hidden", item.dataset.settingsSection !== activeSettingsSection);
  });
}

function currentSyncSettings() {
  return {
    ...DEFAULT_SYNC_SETTINGS,
    ...(state.config?.syncSettings && typeof state.config.syncSettings === "object"
      ? state.config.syncSettings
      : {})
  };
}

function clearSyncTimers() {
  if (taskSyncTimer) window.clearInterval(taskSyncTimer);
  if (sheetsSyncTimer) window.clearInterval(sheetsSyncTimer);
  taskSyncTimer = 0;
  sheetsSyncTimer = 0;
}

function scheduleSyncTimers() {
  clearSyncTimers();
  if (!state.config?.configured) return;
  const sync = currentSyncSettings();
  if (sync.tasksEnabled && Number(sync.taskIntervalSeconds) > 0) {
    taskSyncTimer = window.setInterval(() => {
      void loadIssues({ background: true });
    }, Number(sync.taskIntervalSeconds) * 1000);
  }
  if (state.activeView === "sheets" && Number(sync.sheetsIntervalSeconds) > 0) {
    sheetsSyncTimer = window.setInterval(() => {
      void loadJxlSheets({ loadSelected: true, background: true });
    }, Number(sync.sheetsIntervalSeconds) * 1000);
  }
}

function refreshOnPanelReturn() {
  if (!initialLoadComplete || !state.config?.configured) return;
  const sync = currentSyncSettings();
  if (!sync.syncOnPanelReturn) return;
  const now = Date.now();
  if (now - lastPanelActivationAt < 1_500) return;
  lastPanelActivationAt = now;
  void loadIssues({ background: true });
  if (state.activeView === "sheets") void loadJxlSheets({ loadSelected: true, background: true });
}

settingsSectionTabs.forEach((button) => {
  button.addEventListener("click", () => setSettingsSection(button.dataset.settingsSectionTab));
});

function openSettings() {
  populateSettings(state.config);
  setSettingsStatus("");
  setSettingsSection(activeSettingsSection);
  settingsBackdrop.hidden = false;
  settingsDialog.hidden = false;
  void loadCodexPanelContext({ quiet: true });
  window.setTimeout(() => document.querySelector("#base-url").focus(), 0);
}

function closeSettings() {
  if (!templateEditorDialog.hidden) closeTemplateEditor();
  if (document.documentElement.dataset.view === "settings-only") {
    window.close();
    return;
  }
  settingsBackdrop.hidden = true;
  settingsDialog.hidden = true;
}

async function loadIssues({ background = false } = {}) {
  if (!state.config?.configured) {
    setHealth("", "需要配置 Jira");
    state.issues = [];
    updateCounts();
    render();
    return;
  }
  if (state.loading || (background && state.backgroundSyncing)) return;
  if (background) state.backgroundSyncing = true;
  else state.loading = true;
  setHealth("syncing", "正在同步 Jira");
  hideNotice();
  if (background) renderPreservingBoardState();
  else render();
  try {
    const payload = await api("/api/issues");
    state.issues = payload.issues || [];
    applyBindingState(payload);
    state.total = payload.total ?? state.issues.length;
    state.truncated = Boolean(payload.truncated);
    state.fetchedAt = payload.fetchedAt;
    setHealth("ok", "Jira 已连接");
  } catch (error) {
    if (!background && !state.issues.length) state.fetchedAt = null;
    setHealth("error", background ? "同步失败，保留旧数据" : "Jira 连接失败");
    if (!background) showNotice(error.message, { kind: "error", settings: true });
  } finally {
    if (background) state.backgroundSyncing = false;
    else state.loading = false;
    updateCounts();
    if (background) renderPreservingBoardState();
    else render();
  }
}

function resetJxlState() {
  sheetRequestId += 1;
  state.activeSheet = "";
  state.jxlSheets = [];
  state.jxlLoaded = false;
  state.jxlLoading = false;
  state.jxlError = "";
  state.jxlDirectoryUrl = "";
  state.sheetIssues = [];
  state.sheetLoadedKey = "";
  state.sheetLoading = false;
  state.sheetError = "";
  state.sheetFetchedAt = null;
  state.sheetTotal = 0;
  state.sheetTruncated = false;
  resetSheetTableState();
}

async function loadJxlSheetIssues({ background = false } = {}) {
  const sheet = activeJxlSheet();
  const requestedKey = jxlSheetKey(sheet);
  if (!sheet || !sheet.queryable) {
    state.sheetIssues = [];
    state.sheetLoadedKey = requestedKey;
    state.sheetLoading = false;
    state.sheetError = "";
    state.sheetFetchedAt = null;
    state.sheetTotal = 0;
    state.sheetTruncated = false;
    updateCounts();
    render();
    return;
  }

  if (state.sheetLoading) return;
  const requestId = ++sheetRequestId;
  state.sheetLoading = true;
  state.sheetError = "";
  if (!background) {
    state.sheetIssues = [];
    state.sheetFetchedAt = null;
    state.sheetTotal = 0;
    state.sheetTruncated = false;
  }
  updateCounts();
  render();
  try {
    const payload = await api(`/api/jxl/sheets/${encodeURIComponent(sheet.projectId)}/${encodeURIComponent(sheet.id)}/issues`);
    if (requestId !== sheetRequestId || requestedKey !== state.activeSheet) return;
    state.sheetIssues = payload.issues || [];
    state.sheetLoadedKey = requestedKey;
    state.sheetFetchedAt = payload.fetchedAt;
    state.sheetTotal = payload.total ?? state.sheetIssues.length;
    state.sheetTruncated = Boolean(payload.truncated);
  } catch (error) {
    if (requestId !== sheetRequestId || requestedKey !== state.activeSheet) return;
    state.sheetLoadedKey = requestedKey;
    state.sheetError = error.message;
  } finally {
    if (requestId === sheetRequestId && requestedKey === state.activeSheet) {
      state.sheetLoading = false;
      updateCounts();
      render();
    }
  }
}

async function loadJxlSheets({ loadSelected = true, background = false } = {}) {
  if (!state.config?.configured || state.jxlLoading) return;
  state.jxlLoading = true;
  state.jxlError = "";
  updateCounts();
  render();
  try {
    const payload = await api("/api/jxl/sheets");
    const previousKey = state.activeSheet;
    state.jxlSheets = Array.isArray(payload.sheets) ? payload.sheets : [];
    state.jxlDirectoryUrl = payload.directoryUrl || "";
    state.jxlLoaded = true;
    const candidateKey = previousKey || rememberedJxlSheetKey();
    const candidateStillExists = state.jxlSheets.some((sheet) => jxlSheetKey(sheet) === candidateKey);
    const preferredSheet = state.jxlSheets.find((sheet) => sheet.title === "CT仪表盘-需要我完成的事宜")
      || state.jxlSheets[0];
    state.activeSheet = candidateStillExists ? candidateKey : jxlSheetKey(preferredSheet);
    rememberJxlSheetKey(state.activeSheet);
    if (state.activeSheet !== previousKey) {
      resetSheetTableState();
      state.sheetIssues = [];
      state.sheetLoadedKey = "";
      state.sheetError = "";
      state.sheetFetchedAt = null;
      state.sheetTotal = 0;
      state.sheetTruncated = false;
    }
    if (loadSelected || (state.activeView === "sheets" && state.sheetLoadedKey !== state.activeSheet)) {
      await loadJxlSheetIssues();
    }
  } catch (error) {
    state.jxlLoaded = true;
    if (!background) {
      state.jxlSheets = [];
      state.activeSheet = "";
      state.sheetIssues = [];
      state.sheetLoadedKey = "";
      state.jxlError = `无法读取 JXL Sheets：${error.message}`;
    } else {
      state.jxlError = `同步失败，保留上次 Sheets 数据：${error.message}`;
    }
  } finally {
    state.jxlLoading = false;
    updateCounts();
    render();
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const saveButton = document.querySelector("#save-settings");
  saveButton.disabled = true;
  saveButton.textContent = "正在验证…";
  setSettingsStatus("正在连接 Jira 并验证 JQL…", "info");
  try {
    const codexProject = document.querySelector("#codex-project");
    const boardSources = collectBoardSourcesFromForm();
    validateSelectedBoardFilters(boardSources);
    const payload = await api("/api/config", {
      method: "PUT",
      body: {
        deployment: FIXED_DEPLOYMENT,
        baseUrl: document.querySelector("#base-url").value,
        email: "",
        codexProjectId: codexProject.value,
        codexProjectLabel: codexProject.selectedOptions[0]?.dataset.projectLabel || "",
        codexProjectPath: codexProject.selectedOptions[0]?.dataset.projectPath || "",
        codexProjectRoots: JSON.parse(codexProject.selectedOptions[0]?.dataset.projectRoots || "[]"),
        token: document.querySelector("#token").value,
        wecomWebhook: document.querySelector("#wecom-webhook").value,
        clearWecomWebhook: document.querySelector("#clear-wecom").checked,
        jql: document.querySelector("#jql").value,
        boardSources,
        promptTemplates: {
          requirement: {
            customized: Boolean(templateDrafts.requirement.customized),
            content: templateDrafts.requirement.content,
            skill: normalizedSkillReference(templateDrafts.requirement.skill)
          },
          bug: {
            customized: Boolean(templateDrafts.bug.customized),
            content: templateDrafts.bug.content,
            skill: normalizedSkillReference(templateDrafts.bug.skill)
          }
        },
        syncSettings: {
          tasksEnabled: document.querySelector("#sync-tasks-enabled").checked,
          taskIntervalSeconds: Number(document.querySelector("#sync-task-interval").value),
          syncOnPanelReturn: document.querySelector("#sync-on-panel-return").checked,
          sheetsIntervalSeconds: Number(document.querySelector("#sync-sheets-interval").value),
          updateCheckEnabled: document.querySelector("#update-check-enabled").checked
        },
        maxResults: Number(document.querySelector("#max-results").value)
      }
    });
    state.config = payload.config;
    scheduleSyncTimers();
    void loadUpdateStatus({ quiet: true });
    await loadAutomationStatus();
    resetJxlState();
    closeSettings();
    showToast("Jira 与自动化配置已安全保存");
    await loadCodexPanelContext({ quiet: true });
    await loadIssues();
    await loadJxlSheets({ loadSelected: state.activeView === "sheets" });
  } catch (error) {
    setSettingsStatus(error.message, "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "保存并连接";
  }
}

async function clearSettings() {
  if (!window.confirm("确定清除当前 Windows 用户保存的 Jira 配置和 Token？")) return;
  try {
    await api("/api/config", { method: "DELETE" });
    const payload = await api("/api/config");
    state.config = payload.config;
    void loadUpdateStatus({ quiet: true });
    clearSyncTimers();
    state.automation = null;
    state.issues = [];
    state.boardFilters = [];
    state.boardProjects = [];
    state.boardProjectsError = "";
    state.boardFilterSelections = { requirement: [], bug: [] };
    state.fetchedAt = null;
    resetJxlState();
    closeSettings();
    updateCounts();
    setHealth("", "需要配置 Jira");
    showNotice("Jira 配置已清除。", { settings: true });
    render();
  } catch (error) {
    setSettingsStatus(error.message, "error");
  }
}

pageTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    scheduleSyncTimers();
    pageTabs.forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-selected", String(active));
    });
    updateCounts();
    render();
    if (state.activeView === "sheets") {
      if (!state.jxlLoaded) void loadJxlSheets();
      else if (state.sheetLoadedKey !== state.activeSheet) void loadJxlSheetIssues();
    }
  });
});

bugMonitorToggle.addEventListener("change", async () => {
  const enabled = bugMonitorToggle.checked;
  if (!state.config?.configured) {
    bugMonitorToggle.checked = false;
    openSettings();
    return;
  }
  state.automationUpdating = true;
  updateAutomationControl();
  try {
    const payload = await api("/api/automation/monitor", {
      method: "PUT",
      body: { enabled }
    });
    state.config = payload.config;
    state.automation = payload.automation;
    showToast(enabled
      ? "监控已开启：当前待修复 Bug 已加入自动分析队列"
      : "Bug 自动监控已关闭", enabled ? 5200 : 2800);
  } catch (error) {
    bugMonitorToggle.checked = !enabled;
    showToast(`自动监控设置失败：${error.message}`, 5000);
  } finally {
    state.automationUpdating = false;
    updateAutomationControl();
  }
});

search.addEventListener("input", () => {
  if (searchRenderTimer) window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(() => {
    searchRenderTimer = 0;
    renderPreservingBoardState();
  }, 120);
});
topActions.addEventListener("click", (event) => {
  const action = event.target.closest?.("button.icon-button");
  if (!action || !topActions.contains(action)) return;
  if (action.id === "close-panel") {
    postHostMessage("close");
    return;
  }
  if (action.id === "open-settings") {
    openSettings();
    return;
  }
  if (action.id !== "refresh") return;
  if (!state.config?.configured) return openSettings();
  if (state.activeView === "sheets") return void loadJxlSheets();
  void loadIssues();
});
noticeAction.addEventListener("click", openSettings);
document.querySelector("#close-drawer").addEventListener("click", closeDetails);
transitionSelect.addEventListener("change", updateTransitionAction);
transitionAction.addEventListener("click", () => { void submitIssueTransition(); });
backdrop.addEventListener("click", closeDetails);
document.querySelector("#close-attachment-preview").addEventListener("click", closeAttachmentPreview);
attachmentPreviewBackdrop.addEventListener("click", closeAttachmentPreview);
attachmentPreviewPrevious.addEventListener("click", () => navigateAttachmentPreview(-1));
attachmentPreviewNext.addEventListener("click", () => navigateAttachmentPreview(1));
attachmentPreviewDownload.addEventListener("click", async () => {
  if (!attachmentPreviewAttachment || !attachmentPreviewBlob) return;
  attachmentPreviewDownload.disabled = true;
  try {
    await downloadAttachment(attachmentPreviewAttachment, attachmentPreviewBlob);
    showToast("已开始下载附件");
  } catch (error) {
    showToast(`附件下载失败：${error.message}`, 5000);
  } finally {
    if (!attachmentPreviewDialog.hidden) attachmentPreviewDownload.disabled = false;
  }
});
document.querySelector("#primary-action").addEventListener("click", () => {
  if (!state.selectedIssue || !["todo", "in_progress"].includes(state.selectedIssue.status)) return;
  if (associationPendingIssueKey) return;
  const binding = state.bindings[state.selectedIssue.key];
  if (!binding) {
    openRebindDialog();
    return;
  }
  const retrying = binding.firstMessageStatus === "failed";
  if (!beginAssociationWait(state.selectedIssue.key, {
    actionLabel: retrying ? "正在发送分析消息…" : "正在打开会话…",
    title: retrying ? "正在发送首条分析消息…" : "正在打开 Codex 会话…",
    description: retrying
      ? "消息确认成功后将自动进入对应会话。"
      : "会话确认可用后将自动跳转。"
  })) return;
  void openBoundIssueConversation(state.selectedIssue, {
    recreateAnalysis: retrying,
    supplementalDescription: retrying ? associationDraftFor(state.selectedIssue.key) : ""
  });
});
document.querySelector("#svn-action").addEventListener("click", () => {
  const issueKey = state.selectedIssue?.key;
  if (!issueKey || !state.bindings[issueKey]) return;
  postHostMessage("open-svn-workbench", { issueKey });
});
document.querySelector("#rebind-action").addEventListener("click", () => {
  if (!state.selectedIssue || !["todo", "in_progress"].includes(state.selectedIssue.status)) return;
  if (!state.bindings[state.selectedIssue.key]) return;
  openRebindDialog();
});
document.querySelector("#clear-binding-action").addEventListener("click", openClearBindingDialog);
document.querySelector("#close-clear-binding").addEventListener("click", closeClearBindingDialog);
document.querySelector("#cancel-clear-binding").addEventListener("click", closeClearBindingDialog);
clearBindingBackdrop.addEventListener("click", closeClearBindingDialog);
confirmClearBinding.addEventListener("click", () => {
  const issue = state.selectedIssue;
  if (!issue || !state.bindings[issue.key] || clearingBindingIssueKey) return;
  void clearIssueBinding(issue);
});
document.querySelector("#rebind-thread-id").addEventListener("input", updateRebindThreadPreview);
document.querySelector("#bind-current-thread").addEventListener("click", () => {
  const currentThread = state.threads.find((thread) => thread.active);
  if (!currentThread) return;
  document.querySelector("#rebind-thread-id").value = currentThread.threadId;
  updateRebindThreadPreview();
});
document.querySelector("#rebind-supplement").addEventListener("input", (event) => {
  if (!state.selectedIssue) return;
  saveAssociationDraft(state.selectedIssue.key, event.currentTarget.value);
});
document.querySelector("#rebind-project-options").addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-rebind-project-scope]");
  const primary = event.target.closest('input[name="rebindPrimaryScope"]');
  if (primary) {
    const matchingCheckbox = document.querySelector(`input[data-rebind-project-scope][value="${CSS.escape(primary.value)}"]`);
    if (matchingCheckbox) matchingCheckbox.checked = true;
  }
  if (checkbox || primary) updateRebindProjectSelection();
});
document.querySelectorAll('input[name="rebindMode"]').forEach((input) => input.addEventListener("change", updateRebindMode));
document.querySelector("#close-rebind").addEventListener("click", closeRebindDialog);
document.querySelector("#cancel-rebind").addEventListener("click", closeRebindDialog);
rebindBackdrop.addEventListener("click", closeRebindDialog);
rebindForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.selectedIssue || associationPendingIssueKey) return;
  const mode = updateRebindMode();
  const issue = state.selectedIssue;
  const workspace = selectedRebindWorkspace();
  if (mode === "new") {
    const supplementalDescription = document.querySelector("#rebind-supplement").value.trim();
    saveAssociationDraft(issue.key, supplementalDescription);
    if (!beginAssociationWait(issue.key, {
      actionLabel: "正在创建会话…",
      title: "正在创建 Codex 会话…",
      description: "会话和首条分析消息确认成功后将自动跳转。"
    })) return;
    void openBoundIssueConversation(issue, {
      recreateAnalysis: true,
      supplementalDescription,
      workspace,
      workspaceSelection: workspace ? "explicit" : "none"
    });
    return;
  }
  const target = updateRebindThreadPreview();
  if (!target.threadId) {
    setRebindStatus("请选择已有会话，或直接输入 Codex 会话 ID。");
    return;
  }
  if (target.conflict && !document.querySelector("#rebind-conflict-checkbox").checked) {
    setRebindStatus(`该会话已经关联 ${target.conflict[0]}，请先勾选人工确认。`);
    return;
  }
  if (!beginAssociationWait(issue.key, {
    actionLabel: "正在验证并打开…",
    title: "正在验证 Codex 会话…",
    description: "绑定保存且目标会话确认可用后将自动跳转。"
  })) return;
  void bindExistingConversation(issue, {
    threadId: target.threadId,
    confirmConflict: Boolean(target.conflict),
    workspace
  });
});
document.querySelector("#close-settings").addEventListener("click", closeSettings);
document.querySelector("#cancel-settings").addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);
settingsForm.addEventListener("submit", saveSettings);
document.querySelector("#clear-settings").addEventListener("click", clearSettings);
document.querySelector("#codex-project").addEventListener("change", (event) => {
  void loadCodexSkillsForConfiguredProject(event.currentTarget.value);
});
document.querySelector("#sync-tasks-enabled").addEventListener("change", updateSyncControls);
document.querySelector("#update-check-enabled").addEventListener("change", (event) => {
  updateCheckDetail.textContent = event.currentTarget.checked
    ? "保存后将自动从 GitHub 检查更新。"
    : "保存后将停止自动检查；仍可手动点击“立即检查”。";
});
checkUpdatesNow.addEventListener("click", () => void loadUpdateStatus({ force: true }));
downloadUpdate.addEventListener("click", () => void runUpdateAction("/api/update/download", {
  body: {},
  successMessage: "更新已开始；下载校验后会自动安装"
}));
cancelUpdateDownload.addEventListener("click", () => void runUpdateAction("/api/update/download", {
  method: "DELETE",
  successMessage: "更新下载已取消，当前安装没有变化"
}));
restartUpdate.addEventListener("click", () => void restartToCompleteUpdate());
for (const kind of ["requirement", "bug"]) {
  document.querySelector(`#${kind}-source-mode`).addEventListener("change", () => {
    updateBoardSourceVisibility();
    if (document.querySelector(`#${kind}-source-mode`).value === "filter") void loadBoardFilters({ quiet: true });
  });
  document.querySelector(`#${kind}-filter-ids`).addEventListener("change", (event) => {
    state.boardFilterSelections[kind] = Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
  });
}
document.querySelector("#board-project-key").addEventListener("change", () => {
  if (activeBoardFilterMode()) void loadBoardFilters({ quiet: true, force: true });
});
for (const connectionField of ["#base-url", "#token"]) {
  document.querySelector(connectionField)?.addEventListener("change", () => {
    state.boardFilters = [];
    state.boardProjects = [];
    renderBoardFilterOptions();
    if (activeBoardFilterMode()) void loadBoardFilters({ quiet: true, force: true });
    if (["requirement", "bug"].some((kind) => document.querySelector(`#${kind}-source-mode`)?.value === "builtin")) {
      void loadBoardProjects({ quiet: true, force: true });
    }
  });
}
document.querySelector("#refresh-board-projects").addEventListener("click", () => {
  void loadBoardProjects({ quiet: false, force: true });
});
document.querySelector("#refresh-board-filters").addEventListener("click", () => {
  void loadBoardFilters({ quiet: false, force: true });
});
document.querySelectorAll(".edit-template").forEach((button) => {
  button.addEventListener("click", () => openTemplateEditor(button.dataset.templateKind));
});
document.querySelector("#close-template-editor").addEventListener("click", closeTemplateEditor);
document.querySelector("#cancel-template-editor").addEventListener("click", closeTemplateEditor);
templateEditorBackdrop.addEventListener("click", closeTemplateEditor);
document.querySelector("#restore-template-default").addEventListener("click", () => {
  if (!editingTemplateKind) return;
  templateEditorContent.value = defaultTemplateContent(editingTemplateKind);
  setTemplateEditorStatus("已恢复系统默认正文；点击“应用”后生效。", "info");
});
templateEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editingTemplateKind) return;
  const content = templateEditorContent.value.trim();
  if (!content) {
    setTemplateEditorStatus("消息正文不能为空。");
    return;
  }
  const defaultContent = defaultTemplateContent(editingTemplateKind);
  templateDrafts[editingTemplateKind] = {
    customized: content !== defaultContent.trim(),
    content,
    skill: selectedSkillFromEditor()
  };
  renderTemplateCards();
  closeTemplateEditor();
});
document.addEventListener("keydown", (event) => {
  if (!attachmentPreviewDialog.hidden && event.key === "ArrowLeft") {
    event.preventDefault();
    navigateAttachmentPreview(-1);
    return;
  }
  if (!attachmentPreviewDialog.hidden && event.key === "ArrowRight") {
    event.preventDefault();
    navigateAttachmentPreview(1);
    return;
  }
  if (event.key !== "Escape") return;
  if (!templateEditorDialog.hidden) closeTemplateEditor();
  else if (!attachmentPreviewDialog.hidden) closeAttachmentPreview();
  else if (!clearBindingDialog.hidden) closeClearBindingDialog();
  else if (!rebindDialog.hidden) closeRebindDialog();
  else if (!settingsDialog.hidden) closeSettings();
  else if (!drawer.hidden) closeDetails();
});

async function openIssueFromHost(issueKey) {
  const key = String(issueKey || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) return;
  const cached = [...state.issues, ...state.sheetIssues]
    .find((issue) => String(issue?.key || "").toUpperCase() === key);
  try {
    const payload = await api(`/api/issues/${encodeURIComponent(key)}`);
    const issue = payload?.issue || payload;
    if (!issue?.key) throw new Error("本地服务未返回任务详情");
    if (Object.prototype.hasOwnProperty.call(payload, "binding")) {
      if (payload.binding) state.bindings[key] = payload.binding;
      else delete state.bindings[key];
    }
    const revision = Number(payload?.bindingsRevision);
    if (Number.isInteger(revision) && revision >= 0) state.bindingsRevision = revision;
    openDetails(issue);
    postHostMessage("open-issue-ack", { issueKey: key });
  } catch (error) {
    if (cached) {
      openDetails(cached);
      postHostMessage("open-issue-ack", { issueKey: key });
      showToast(`已打开缓存详情，刷新失败：${error.message}`, 5000);
      return;
    }
    showToast(`无法打开 ${key}：${error.message}`, 6000);
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.source !== "jira-workbench-host") return;
  if (message.type === "theme") applyHostTheme(message);
  if (message.type === "panel-activated") {
    refreshOnPanelReturn();
    void loadCodexPanelContext({ quiet: true });
  }
  if (message.type === "desktop-context") applyCurrentDesktopContext(message);
  if (message.type === "open-issue") void openIssueFromHost(message.issueKey);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshOnPanelReturn();
});
window.addEventListener("focus", refreshOnPanelReturn);

async function boot() {
  try {
    const payload = await api("/api/config");
    state.config = payload.config;
    void loadUpdateStatus({ quiet: true });
    // Jira is the primary board payload. Bindings, App Server conversations,
    // Desktop project context and Skills hydrate progressively without delaying it.
    void loadCodexPanelContext({ quiet: true });
    if (SETTINGS_ONLY_VIEW) {
      openSettings();
      populateCodexProjectOptions(state.config?.codexProjectId || "", state.config?.codexProjectLabel || "");
      renderTemplateCards();
    } else if (state.config.configured) {
      await loadIssues();
      void loadAutomationStatus();
      void loadJxlSheets({ loadSelected: false });
      scheduleSyncTimers();
    }
    else {
      setHealth("", "需要配置 Jira");
      showNotice("首次使用需要配置 Jira 地址和个人 Token。", { settings: true });
      render();
      openSettings();
    }
    initialLoadComplete = true;
    lastPanelActivationAt = Date.now();
  } catch (error) {
    setHealth("error", "本地服务异常");
    showNotice(error.message, { kind: "error" });
    renderState("本地服务不可用", error.message);
  } finally {
    postHostMessage("ready");
  }
}

function openSettingsFromLocation() {
  const settingsOnly = window.location.hash === "#settings";
  document.documentElement.dataset.view = settingsOnly ? "settings-only" : "board";
  if (!settingsOnly) return;
  openSettings();
}

window.addEventListener("hashchange", openSettingsFromLocation);

boot();
if (!SETTINGS_ONLY_VIEW) window.setTimeout(openSettingsFromLocation, 0);
if (!SETTINGS_ONLY_VIEW) window.setInterval(() => void loadAutomationStatus(), 10_000);
