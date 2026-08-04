import { buildIssuePrompt, DEFAULT_MESSAGE_TEMPLATE } from "/prompt-builder.js";
import {
  attachmentPreviewKind,
  filterAndSortSheetIssues,
  filterIssuesForView,
  splitIssuesByType,
  summarizeIssueViews
} from "/issue-views.js";

const board = document.querySelector("#board");
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
const bugMonitorControl = document.querySelector("#bug-monitor-control");
const bugMonitorToggle = document.querySelector("#bug-monitor-toggle");
const bugMonitorState = document.querySelector("#bug-monitor-state");
const rebindDialog = document.querySelector("#rebind-dialog");
const rebindBackdrop = document.querySelector("#rebind-backdrop");
const rebindForm = document.querySelector("#rebind-form");
const rebindStatus = document.querySelector("#rebind-status");
const attachmentPreviewDialog = document.querySelector("#attachment-preview-dialog");
const attachmentPreviewBackdrop = document.querySelector("#attachment-preview-backdrop");
const attachmentPreviewBody = document.querySelector("#attachment-preview-body");
const attachmentPreviewHint = document.querySelector("#attachment-preview-hint");
const attachmentPreviewDownload = document.querySelector("#download-preview-attachment");
const FIXED_DEPLOYMENT = "data_center";
const FALLBACK_MESSAGE_TEMPLATE = DEFAULT_MESSAGE_TEMPLATE;
const MAX_TEXT_PREVIEW_CHARACTERS = 500_000;
const LAST_JXL_SHEET_STORAGE_KEY = "jira-codex-panel:last-jxl-sheet:v1";
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
  threads: [],
  projects: [],
  config: null,
  automation: null,
  automationUpdating: false,
  activeView: "inbox",
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
  loading: false,
  fetchedAt: null,
  total: 0,
  truncated: false
};

let toastTimer = null;
let sheetRequestId = 0;
let attachmentPreviewRequestId = 0;
let attachmentPreviewObjectUrl = "";
let attachmentPreviewAttachment = null;
let attachmentPreviewBlob = null;
let attachmentPreviewReturnFocus = null;

class ApiError extends Error {
  constructor(message, payload = {}) {
    super(message);
    this.code = payload.code;
    this.upstreamStatus = payload.upstreamStatus;
  }
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function typeLabel(issue) {
  return issue.typeName || (issue.type === "bug" ? "Bug" : "需求");
}

function renderIssuePrompt(issue) {
  return buildIssuePrompt(issue, {
    messageTemplate: state.config?.messageTemplate || FALLBACK_MESSAGE_TEMPLATE,
    projectId: state.config?.codexProjectId || "",
    projectLabel: state.config?.codexProjectLabel || ""
  });
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
  return Array.from(text.replace(/\s+/g, "")).slice(-2).join("").toUpperCase() || "?";
}

function createPersonChip(person) {
  const chip = element("span", "person-chip");
  chip.append(element("i", "person-avatar", initials(person.displayName)));
  chip.append(element("span", "", person.displayName));
  if (person.active === false) chip.append(element("em", "", "停用"));
  return chip;
}

async function fetchAttachmentBlob(attachment) {
  const response = await fetch(attachment.downloadUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
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
  attachmentPreviewBody.replaceChildren();
  attachmentPreviewDialog.hidden = true;
  attachmentPreviewBackdrop.hidden = true;
  attachmentPreviewDownload.disabled = true;
  const returnFocus = attachmentPreviewReturnFocus;
  attachmentPreviewReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
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
    attachmentPreviewHint.textContent = "图片按原始比例缩放显示。";
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

async function openAttachmentPreview(attachment) {
  const kind = attachmentPreviewKind(attachment);
  if (!kind) return;
  const requestId = ++attachmentPreviewRequestId;
  releaseAttachmentPreviewUrl();
  attachmentPreviewAttachment = attachment;
  attachmentPreviewBlob = null;
  attachmentPreviewReturnFocus = document.activeElement;
  document.querySelector("#attachment-preview-title").textContent = attachment.filename;
  document.querySelector("#attachment-preview-meta").textContent = `${formatBytes(attachment.size)} · ${attachment.mimeType || "未知格式"} · ${attachment.author}`;
  attachmentPreviewBody.className = "attachment-preview-body loading";
  attachmentPreviewBody.textContent = "正在从 Jira 加载原文件…";
  attachmentPreviewHint.textContent = "预览内容来自 Jira，只读显示。";
  attachmentPreviewDownload.disabled = true;
  attachmentPreviewBackdrop.hidden = false;
  attachmentPreviewDialog.hidden = false;
  attachmentPreviewDialog.focus();
  try {
    const blob = await fetchAttachmentBlob(attachment);
    if (requestId !== attachmentPreviewRequestId) return;
    attachmentPreviewBlob = blob;
    attachmentPreviewDownload.disabled = false;
    await renderAttachmentPreview(attachment, blob, kind, requestId);
  } catch (error) {
    if (requestId !== attachmentPreviewRequestId) return;
    showAttachmentPreviewError(`附件加载失败：${error.message}`);
  }
}

function createAttachmentCard(attachment) {
  const card = element("a", "attachment-card");
  const previewKind = attachmentPreviewKind(attachment);
  card.href = window.__JIRA_CODEX_EMBEDDED__ ? "#" : attachment.downloadUrl;
  card.title = previewKind ? `预览 ${attachment.filename}` : `下载 ${attachment.filename}`;
  card.setAttribute("aria-label", card.title);
  if (previewKind) card.classList.add("previewable");
  card.addEventListener("click", async (event) => {
    if (previewKind) {
      event.preventDefault();
      void openAttachmentPreview(attachment);
      return;
    }
    if (!window.__JIRA_CODEX_EMBEDDED__) return;
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
  if (!previewKind && !window.__JIRA_CODEX_EMBEDDED__) card.download = attachment.filename;

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
    if (window.__JIRA_CODEX_EMBEDDED__ && window.__jiraCodexAssetUrl) {
      window.__jiraCodexAssetUrl(attachment.thumbnailUrl)
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
  card.append(preview, info, element("span", "attachment-download", previewKind ? "预览" : "↓"));
  return card;
}

function createCard(issue) {
  const card = element("article", "card");
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
  top.append(element("span", `type-icon ${issue.type}`, issue.type === "bug" ? "B" : "R"));
  card.append(top, element("h3", "", issue.title));

  const meta = element("div", "card-meta");
  meta.append(element("span", `priority ${priorityClass(issue.priority)}`, issue.priority));
  meta.append(element("span", "", `· ${issue.assignee}`));
  if (state.bindings[issue.key]) {
    const conversation = element("span", "card-signal bound", "💬 已绑定");
    conversation.title = state.bindings[issue.key].threadTitle || "已绑定 Codex 对话";
    meta.append(conversation);
  }
  if (issue.collaborators?.length) meta.append(element("span", "card-signal", `协 ${issue.collaborators.length}`));
  if (issue.attachments?.length) meta.append(element("span", "card-signal", `📎 ${issue.attachments.length}`));
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
  node.tabIndex = 0;
  node.setAttribute("aria-label", `查看 ${issue.key} ${issue.title}`);
  node.addEventListener("click", () => openDetails(issue));
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openDetails(issue);
  });
}

function createTaskLane({ title, subtitle, type, issues }) {
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
  head.append(heading, element("span", "lane-count", String(issues.length)));
  const list = element("div", "card-list");
  if (issues.length) issues.forEach((issue) => list.append(createCard(issue)));
  else list.append(element("div", "empty", search.value.trim() ? "没有匹配的任务" : "暂无任务"));
  lane.append(head, list);
  return lane;
}

function renderSplitView(issues, history = false) {
  const { requirements, bugs } = splitIssuesByType(issues);
  board.className = `board split-board${history ? " history-board" : ""}`;
  board.append(
    createTaskLane({
      title: history ? "需求处理历史" : "CT仪表盘-需要我完成的事宜",
      subtitle: history ? "已完成的需求与任务" : "需求 · 待处理 / 处理中",
      type: "requirement",
      issues: requirements
    }),
    createTaskLane({
      title: history ? "Bug 修复历史" : "CT-BUG-需要我修复的",
      subtitle: history ? "已完成的 Bug" : "Bug · 待修复 / 处理中",
      type: "bug",
      issues: bugs
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

  if (state.jxlError) {
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

  if (state.sheetLoading) {
    panel.append(element("div", "sheet-empty", "正在按所选 JXL Sheet 的查询范围加载任务…"));
    board.append(panel);
    return;
  }

  if (state.sheetError) {
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

function openDetails(issue) {
  state.selectedIssue = issue;
  document.querySelector("#detail-type").textContent = typeLabel(issue);
  document.querySelector("#detail-key").textContent = issue.key;
  document.querySelector("#detail-title").textContent = issue.title;
  document.querySelector("#detail-summary").textContent = issue.summary;
  document.querySelector("#detail-status").textContent = issue.statusName || statusLabel(issue.status);
  document.querySelector("#detail-priority").textContent = issue.priority;
  document.querySelector("#detail-assignee").textContent = issue.assignee;
  document.querySelector("#detail-issue-type").textContent = typeLabel(issue);
  document.querySelector("#detail-project").textContent = issue.projectName || "—";
  document.querySelector("#detail-updated").textContent = formatDate(issue.updated);
  const collaborators = issue.collaborators || [];
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
  const labels = document.querySelector("#detail-labels");
  labels.replaceChildren(...(issue.labels.length
    ? issue.labels.map((label) => element("span", "", label))
    : [element("em", "", "无标签")]));
  const link = document.querySelector("#detail-link");
  link.href = issue.url;
  updatePrimaryAction(issue);
  drawer.hidden = false;
  backdrop.hidden = false;
  drawer.focus();
}

function updatePrimaryAction(issue) {
  const action = document.querySelector("#primary-action");
  const rebindAction = document.querySelector("#rebind-action");
  const bindingSummary = document.querySelector("#binding-summary");
  const bindingThreadTitle = document.querySelector("#binding-thread-title");
  const canProcess = issue.status === "todo" || issue.status === "in_progress";
  const binding = state.bindings[issue.key];
  bindingSummary.hidden = !binding;
  bindingThreadTitle.textContent = binding?.threadTitle || "Codex 对话";
  bindingThreadTitle.title = binding?.threadTitle || "";
  rebindAction.hidden = !(canProcess && binding);
  action.textContent = !canProcess
    ? "已完成任务仅查看"
    : binding
      ? "打开已绑定的 Codex 对话"
      : "开始分析并绑定 Codex 对话";
  action.disabled = !canProcess;
  action.classList.toggle("secondary", !canProcess);
}

function closeDetails() {
  if (!attachmentPreviewDialog.hidden) closeAttachmentPreview();
  closeRebindDialog();
  drawer.hidden = true;
  backdrop.hidden = true;
  state.selectedIssue = null;
}

function setRebindStatus(message, kind = "error") {
  rebindStatus.className = `settings-status ${kind}`;
  rebindStatus.textContent = message;
  rebindStatus.hidden = !message;
}

function updateRebindThreadPreview() {
  const threadId = document.querySelector("#rebind-thread-id").value.trim();
  const thread = state.threads.find((candidate) => candidate.threadId === threadId);
  document.querySelector("#rebind-thread-preview").textContent = thread
    ? `将绑定到：${thread.threadTitle || thread.threadId}`
    : threadId
      ? "当前 Codex 侧栏中未找到该会话 ID。"
      : "可从当前侧栏已有对话中选择。";
  return thread;
}

function updateRebindMode() {
  const mode = document.querySelector('input[name="rebindMode"]:checked')?.value || "existing";
  const isNew = mode === "new";
  document.querySelector("#rebind-existing-fields").hidden = isNew;
  document.querySelector("#rebind-new-fields").hidden = !isNew;
  document.querySelector("#confirm-rebind").textContent = isNew
    ? "新建并发送分析消息"
    : "绑定并打开对话";
  const projectLabel = state.config?.codexProjectId
    ? `将创建在项目：${state.config.codexProjectLabel || state.config.codexProjectId}`
    : "将创建不带项目的普通对话";
  document.querySelector("#rebind-new-project").textContent = projectLabel;
  setRebindStatus("");
  return mode;
}

function openRebindDialog() {
  if (!state.selectedIssue) return;
  const options = document.querySelector("#rebind-thread-options");
  options.replaceChildren(...state.threads.map((thread) => {
    const option = document.createElement("option");
    option.value = thread.threadId;
    option.label = thread.threadTitle || thread.threadId;
    return option;
  }));
  document.querySelector("#rebind-thread-id").value = state.bindings[state.selectedIssue.key]?.threadId || "";
  document.querySelector('input[name="rebindMode"][value="existing"]').checked = true;
  setRebindStatus("");
  updateRebindThreadPreview();
  updateRebindMode();
  rebindBackdrop.hidden = false;
  rebindDialog.hidden = false;
  window.setTimeout(() => document.querySelector("#rebind-thread-id").select(), 0);
}

function closeRebindDialog() {
  rebindBackdrop.hidden = true;
  rebindDialog.hidden = true;
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
  document.querySelector("#jql").value = config?.jql
    || '((filter = 10103 OR filter = 10102) OR (project = CT AND statusCategory = Done AND (assignee = currentUser() OR "协同处理人" = currentUser()))) ORDER BY updated DESC';
  document.querySelector("#message-template").value = config?.messageTemplate || FALLBACK_MESSAGE_TEMPLATE;
  populateCodexProjectOptions(config?.codexProjectId || "", config?.codexProjectLabel || "");
  document.querySelector("#max-results").value = config?.maxResults || 100;
  document.querySelector("#clear-settings").hidden = !config?.configured;
}

function populateCodexProjectOptions(selectedId = "", selectedLabel = "") {
  const select = document.querySelector("#codex-project");
  const choices = [{ projectId: "", projectLabel: "不绑定项目（普通对话）" }, ...state.projects];
  if (selectedId && !choices.some((project) => project.projectId === selectedId)) {
    choices.push({
      projectId: selectedId,
      projectLabel: selectedLabel || selectedId,
      displayLabel: `${selectedLabel || selectedId}（当前不可用）`
    });
  }
  select.replaceChildren(...choices.map((project) => {
    const option = document.createElement("option");
    option.value = project.projectId;
    option.textContent = project.displayLabel || project.projectLabel;
    option.dataset.projectLabel = project.projectLabel;
    return option;
  }));
  select.value = selectedId;
}

function setSettingsStatus(message, kind = "error") {
  settingsStatus.className = `settings-status ${kind}`;
  settingsStatus.textContent = message;
  settingsStatus.hidden = !message;
}

function openSettings() {
  populateSettings(state.config);
  setSettingsStatus("");
  settingsBackdrop.hidden = false;
  settingsDialog.hidden = false;
  window.setTimeout(() => document.querySelector("#base-url").focus(), 0);
}

function closeSettings() {
  settingsBackdrop.hidden = true;
  settingsDialog.hidden = true;
}

async function loadIssues() {
  if (!state.config?.configured) {
    setHealth("", "需要配置 Jira");
    state.issues = [];
    updateCounts();
    render();
    return;
  }
  state.loading = true;
  setHealth("syncing", "正在同步 Jira");
  hideNotice();
  render();
  try {
    const payload = await api("/api/issues");
    state.issues = payload.issues || [];
    state.total = payload.total ?? state.issues.length;
    state.truncated = Boolean(payload.truncated);
    state.fetchedAt = payload.fetchedAt;
    setHealth("ok", "Jira 已连接");
  } catch (error) {
    state.issues = [];
    state.fetchedAt = null;
    setHealth("error", "Jira 连接失败");
    showNotice(error.message, { kind: "error", settings: true });
  } finally {
    state.loading = false;
    updateCounts();
    render();
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

async function loadJxlSheetIssues() {
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

  const requestId = ++sheetRequestId;
  state.sheetLoading = true;
  state.sheetError = "";
  state.sheetIssues = [];
  state.sheetFetchedAt = null;
  state.sheetTotal = 0;
  state.sheetTruncated = false;
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
    state.sheetIssues = [];
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

async function loadJxlSheets({ loadSelected = true } = {}) {
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
    state.jxlSheets = [];
    state.activeSheet = "";
    state.sheetIssues = [];
    state.sheetLoadedKey = "";
    state.jxlError = `无法读取 JXL Sheets：${error.message}`;
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
    const payload = await api("/api/config", {
      method: "PUT",
      body: {
        deployment: FIXED_DEPLOYMENT,
        baseUrl: document.querySelector("#base-url").value,
        email: "",
        codexProjectId: codexProject.value,
        codexProjectLabel: codexProject.selectedOptions[0]?.dataset.projectLabel || "",
        token: document.querySelector("#token").value,
        wecomWebhook: document.querySelector("#wecom-webhook").value,
        clearWecomWebhook: document.querySelector("#clear-wecom").checked,
        jql: document.querySelector("#jql").value,
        messageTemplate: document.querySelector("#message-template").value,
        maxResults: Number(document.querySelector("#max-results").value)
      }
    });
    state.config = payload.config;
    await loadAutomationStatus();
    resetJxlState();
    closeSettings();
    showToast("Jira 与自动化配置已安全保存");
    window.parent.postMessage({ source: "jira-codex-panel-poc", type: "automation-settings-changed" }, "*");
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
    state.automation = null;
    state.issues = [];
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
    window.parent.postMessage({ source: "jira-codex-panel-poc", type: "automation-settings-changed" }, "*");
  } catch (error) {
    bugMonitorToggle.checked = !enabled;
    showToast(`自动监控设置失败：${error.message}`, 5000);
  } finally {
    state.automationUpdating = false;
    updateAutomationControl();
  }
});

search.addEventListener("input", render);
document.querySelector("#close-panel").addEventListener("click", () => {
  window.parent.postMessage({ source: "jira-codex-panel-poc", type: "close" }, "*");
});
document.querySelector("#refresh").addEventListener("click", () => {
  if (!state.config?.configured) return openSettings();
  if (state.activeView === "sheets") return void loadJxlSheets();
  void loadIssues();
});
document.querySelector("#open-settings").addEventListener("click", openSettings);
noticeAction.addEventListener("click", openSettings);
document.querySelector("#close-drawer").addEventListener("click", closeDetails);
backdrop.addEventListener("click", closeDetails);
document.querySelector("#close-attachment-preview").addEventListener("click", closeAttachmentPreview);
attachmentPreviewBackdrop.addEventListener("click", closeAttachmentPreview);
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
  window.parent.postMessage({
    source: "jira-codex-panel-poc",
    type: "open-task",
    issue: state.selectedIssue,
    prompt: renderIssuePrompt(state.selectedIssue),
    projectId: state.config?.codexProjectId || ""
  }, "*");
});
document.querySelector("#rebind-action").addEventListener("click", () => {
  if (!state.selectedIssue || !["todo", "in_progress"].includes(state.selectedIssue.status)) return;
  if (!state.bindings[state.selectedIssue.key]) return;
  openRebindDialog();
});
document.querySelector("#rebind-thread-id").addEventListener("input", updateRebindThreadPreview);
document.querySelectorAll('input[name="rebindMode"]').forEach((input) => input.addEventListener("change", updateRebindMode));
document.querySelector("#close-rebind").addEventListener("click", closeRebindDialog);
document.querySelector("#cancel-rebind").addEventListener("click", closeRebindDialog);
rebindBackdrop.addEventListener("click", closeRebindDialog);
rebindForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.selectedIssue) return;
  const mode = updateRebindMode();
  const issue = state.selectedIssue;
  if (mode === "new") {
    closeRebindDialog();
    window.parent.postMessage({
      source: "jira-codex-panel-poc",
      type: "rebind-new-task",
      issue,
      prompt: renderIssuePrompt(issue),
      projectId: state.config?.codexProjectId || ""
    }, "*");
    return;
  }
  const thread = updateRebindThreadPreview();
  if (!thread) {
    setRebindStatus("请选择当前 Codex 侧栏中存在的会话 ID。");
    return;
  }
  closeRebindDialog();
  window.parent.postMessage({
    source: "jira-codex-panel-poc",
    type: "bind-task",
    issue,
    threadId: thread.threadId
  }, "*");
});
document.querySelector("#close-settings").addEventListener("click", closeSettings);
document.querySelector("#cancel-settings").addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);
settingsForm.addEventListener("submit", saveSettings);
document.querySelector("#clear-settings").addEventListener("click", clearSettings);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!attachmentPreviewDialog.hidden) closeAttachmentPreview();
  else if (!rebindDialog.hidden) closeRebindDialog();
  else if (!settingsDialog.hidden) closeSettings();
  else if (!drawer.hidden) closeDetails();
});

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.source !== "jira-codex-panel-host") return;
  if (message.type === "bindings") {
    state.bindings = message.bindings && typeof message.bindings === "object" ? message.bindings : {};
    state.threads = Array.isArray(message.threads) ? message.threads : [];
    state.projects = Array.isArray(message.projects) ? message.projects : [];
    if (!settingsDialog.hidden) {
      populateCodexProjectOptions(state.config?.codexProjectId || "", state.config?.codexProjectLabel || "");
    }
    render();
    if (state.selectedIssue) updatePrimaryAction(state.selectedIssue);
  }
  if (message.type === "binding-error" && message.message) {
    if (!rebindDialog.hidden) setRebindStatus(message.message);
    else showToast(message.message, 5000);
  }
  if (message.type === "automation-status") {
    if (message.automation) state.automation = message.automation;
    updateAutomationControl();
    if (message.message) showToast(message.message, 5000);
  }
  if (message.type === "automation-error" && message.message) {
    showToast(message.message, 5000);
  }
});

async function boot() {
  window.parent.postMessage({ source: "jira-codex-panel-poc", type: "get-bindings" }, "*");
  try {
    const payload = await api("/api/config");
    state.config = payload.config;
    if (state.config.configured) {
      await loadAutomationStatus();
      await loadIssues();
      await loadJxlSheets({ loadSelected: false });
    }
    else {
      setHealth("", "需要配置 Jira");
      showNotice("首次使用需要配置 Jira 地址和个人 Token。", { settings: true });
      render();
      openSettings();
    }
  } catch (error) {
    setHealth("error", "本地服务异常");
    showNotice(error.message, { kind: "error" });
    renderState("本地服务不可用", error.message);
  } finally {
    window.parent.postMessage({ source: "jira-codex-panel-poc", type: "ready" }, "*");
  }
}

boot();
window.setInterval(() => void loadAutomationStatus(), 10_000);
