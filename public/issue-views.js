const VALID_VIEWS = new Set(["inbox", "sheets", "history"]);
const IMAGE_EXTENSIONS = new Set(["apng", "avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const TEXT_EXTENSIONS = new Set(["csv", "json", "log", "md", "text", "txt", "xml", "yaml", "yml"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav", "webm"]);
const SHEET_COLUMN_KEYS = new Set([
  "issue", "type", "title", "status", "priority", "assignee", "collaborators", "attachments", "updated"
]);
const SHEET_COLLATOR = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function fileExtension(filename) {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

export function attachmentPreviewKind(attachment) {
  const mimeType = String(attachment?.mimeType || "").toLowerCase().split(";")[0].trim();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || ["application/json", "application/xml"].includes(mimeType)) return "text";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  const extension = fileExtension(attachment?.filename);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "";
}

function normalizedView(view) {
  return VALID_VIEWS.has(view) ? view : "inbox";
}

function matchesKeyword(issue, keyword) {
  const query = String(keyword || "").trim().toLowerCase();
  if (!query) return true;
  const collaborators = Array.isArray(issue.collaborators)
    ? issue.collaborators.map((person) => person.displayName).join(" ")
    : "";
  return [
    issue.key,
    issue.title,
    issue.summary,
    issue.projectName,
    issue.statusName,
    issue.assignee,
    collaborators,
    ...(Array.isArray(issue.labels) ? issue.labels : [])
  ].join(" ").toLowerCase().includes(query);
}

export function filterIssuesForView(issues, view = "inbox", keyword = "") {
  const scope = normalizedView(view);
  return (Array.isArray(issues) ? issues : []).filter((issue) => {
    if (scope === "inbox" && issue.status === "done") return false;
    if (scope === "history" && issue.status !== "done") return false;
    return matchesKeyword(issue, keyword);
  });
}

export function splitIssuesByType(issues) {
  const result = { requirements: [], bugs: [] };
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (issue.type === "bug") result.bugs.push(issue);
    else result.requirements.push(issue);
  }
  return result;
}

export function summarizeIssueViews(issues) {
  const list = Array.isArray(issues) ? issues : [];
  const history = list.filter((issue) => issue.status === "done").length;
  return {
    inbox: list.length - history,
    sheets: list.length,
    history
  };
}

function sheetCollaborators(issue) {
  return Array.isArray(issue?.collaborators)
    ? issue.collaborators.map((person) => person?.displayName || "").filter(Boolean).join("、")
    : "";
}

function sheetColumnValue(issue, column) {
  switch (column) {
    case "issue": return issue?.key || "";
    case "type": return issue?.type === "bug" ? "Bug" : "需求";
    case "title": return issue?.title || "";
    case "status": return issue?.statusName || issue?.status || "";
    case "priority": return issue?.priority || "";
    case "assignee": return issue?.assignee || "";
    case "collaborators": return sheetCollaborators(issue);
    case "attachments": return Array.isArray(issue?.attachments) ? issue.attachments.length : 0;
    case "updated": return Date.parse(issue?.updated || "") || 0;
    default: return "";
  }
}

function updatedSearchText(value) {
  const raw = String(value || "");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (part) => String(part).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${raw} ${year}-${month}-${day} ${month}/${day} ${month}-${day} ${hour}:${minute}`;
}

function includesFilter(value, filter) {
  const query = String(filter || "").trim().toLowerCase();
  return !query || String(value || "").toLowerCase().includes(query);
}

function matchesSheetFilters(issue, filters) {
  const type = String(filters.type || "");
  if (type && issue?.type !== type) return false;
  const status = String(filters.status || "");
  if (status && String(issue?.statusName || issue?.status || "") !== status) return false;
  const attachmentFilter = String(filters.attachments || "");
  const attachmentCount = Array.isArray(issue?.attachments) ? issue.attachments.length : 0;
  if (attachmentFilter === "with" && attachmentCount === 0) return false;
  if (attachmentFilter === "without" && attachmentCount > 0) return false;
  return includesFilter(issue?.key, filters.issue)
    && includesFilter(issue?.title, filters.title)
    && includesFilter(issue?.priority, filters.priority)
    && includesFilter(issue?.assignee, filters.assignee)
    && includesFilter(sheetCollaborators(issue), filters.collaborators)
    && includesFilter(updatedSearchText(issue?.updated), filters.updated);
}

export function filterAndSortSheetIssues(issues, { filters = {}, sort = {} } = {}) {
  const filtered = (Array.isArray(issues) ? issues : []).filter((issue) => matchesSheetFilters(issue, filters));
  const column = String(sort.column || "");
  if (!SHEET_COLUMN_KEYS.has(column)) return filtered;
  const direction = sort.direction === "desc" ? -1 : 1;
  return filtered
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => {
      const leftValue = sheetColumnValue(left.issue, column);
      const rightValue = sheetColumnValue(right.issue, column);
      const leftEmpty = leftValue === "" || leftValue === null || leftValue === undefined;
      const rightEmpty = rightValue === "" || rightValue === null || rightValue === undefined;
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : SHEET_COLLATOR.compare(String(leftValue), String(rightValue));
      return comparison === 0 ? left.index - right.index : comparison * direction;
    })
    .map(({ issue }) => issue);
}
