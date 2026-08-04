const ISSUE_FIELDS = [
  "summary",
  "description",
  "issuetype",
  "priority",
  "status",
  "assignee",
  "attachment",
  "customfield_10600",
  "labels",
  "project",
  "created",
  "updated"
];

export class JiraApiError extends Error {
  constructor(message, { code = "JIRA_REQUEST_FAILED", upstreamStatus = null, details = null } = {}) {
    super(message);
    this.name = "JiraApiError";
    this.code = code;
    this.upstreamStatus = upstreamStatus;
    this.details = details;
    this.statusCode = [400, 401, 403, 404, 429].includes(upstreamStatus) ? upstreamStatus : 502;
  }
}

function normalizeIssueKey(value) {
  const issueKey = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
    throw new JiraApiError("Jira Issue Key 无效。", {
      code: "INVALID_ISSUE_KEY",
      upstreamStatus: 400
    });
  }
  return issueKey;
}

function transitionEndpoint(config, issueKey, { expand = false } = {}) {
  const version = config.deployment === "data_center" ? "2" : "3";
  const endpoint = `${config.baseUrl}/rest/api/${version}/issue/${encodeURIComponent(issueKey)}/transitions`;
  return expand ? `${endpoint}?expand=transitions.fields` : endpoint;
}

export function jiraAuthenticationHeader(config) {
  if (config.deployment === "data_center") return `Bearer ${config.token}`;
  return `Basic ${Buffer.from(`${config.email}:${config.token}`, "utf8").toString("base64")}`;
}

function flattenAtlassianDocument(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(flattenAtlassianDocument).filter(Boolean).join("\n");
  if (typeof value !== "object") return String(value);
  if (typeof value.text === "string") return value.text;
  if (value.type === "hardBreak") return "\n";
  const content = flattenAtlassianDocument(value.content);
  if (["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(value.type)) {
    return `${content}\n`;
  }
  return content;
}

function statusGroup(fields) {
  const category = String(fields.status?.statusCategory?.key || "").toLowerCase();
  const statusName = String(fields.status?.name || "");
  if (category === "done") return "done";
  const beforeProgramStatuses = new Set([
    "规划中",
    "方案设计中",
    "待宣讲",
    "制作中",
    "美术处理",
    "待处理",
    "待PO分转",
    "待修复",
    "搁置"
  ]);
  if (beforeProgramStatuses.has(statusName)) return "todo";
  if (category === "indeterminate") return "in_progress";
  return "todo";
}

function normalizeTransition(transition) {
  const fields = transition?.fields && typeof transition.fields === "object"
    ? transition.fields
    : {};
  const requiredFields = Object.entries(fields)
    .filter(([, field]) => field?.required && !field?.hasDefaultValue)
    .map(([id, field]) => ({
      id,
      name: String(field?.name || id)
    }));
  const target = transition?.to || {};
  return {
    id: String(transition?.id || ""),
    name: String(transition?.name || target.name || "未命名流转"),
    to: {
      id: String(target.id || ""),
      name: String(target.name || transition?.name || "未知状态"),
      group: statusGroup({ status: target }),
      category: String(target.statusCategory?.key || "")
    },
    requiresInput: requiredFields.length > 0,
    requiredFields
  };
}

function issueTypeGroup(fields) {
  const name = String(fields.issuetype?.name || "");
  return /bug|defect|缺陷|故障/i.test(name) ? "bug" : "requirement";
}

function normalizeIssue(issue, baseUrl) {
  const fields = issue.fields || {};
  const description = flattenAtlassianDocument(fields.description).replace(/\n{3,}/g, "\n\n").trim();
  const collaborators = Array.isArray(fields.customfield_10600)
    ? fields.customfield_10600.map((user) => ({
      displayName: user.displayName || user.name || "未知用户",
      name: user.name || "",
      active: user.active !== false
    }))
    : [];
  const attachments = Array.isArray(fields.attachment)
    ? fields.attachment.map((attachment) => ({
      id: String(attachment.id || ""),
      filename: attachment.filename || "未命名附件",
      mimeType: attachment.mimeType || "application/octet-stream",
      size: Number(attachment.size || 0),
      author: attachment.author?.displayName || attachment.author?.name || "未知用户",
      created: attachment.created || null,
      downloadUrl: `/api/attachments/${encodeURIComponent(attachment.id || "")}`,
      thumbnailUrl: attachment.thumbnail
        ? `/api/attachments/${encodeURIComponent(attachment.id || "")}?thumbnail=1`
        : null
    }))
    : [];
  return {
    id: String(issue.id || issue.key),
    key: String(issue.key || ""),
    type: issueTypeGroup(fields),
    typeName: fields.issuetype?.name || "任务",
    title: fields.summary || "未命名 Jira 任务",
    summary: description || "Jira 中未填写描述。",
    priority: fields.priority?.name || "未设置",
    status: statusGroup(fields),
    statusName: fields.status?.name || "未知状态",
    assignee: fields.assignee?.displayName || fields.assignee?.name || "未分配",
    collaborators,
    attachments,
    labels: Array.isArray(fields.labels) ? fields.labels.map(String) : [],
    projectName: fields.project?.name || fields.project?.key || "",
    created: fields.created || null,
    updated: fields.updated || null,
    url: `${baseUrl}/browse/${encodeURIComponent(issue.key || "")}`
  };
}

function jiraErrorMessage(payload, fallback) {
  const messages = [];
  if (Array.isArray(payload?.errorMessages)) messages.push(...payload.errorMessages);
  if (payload?.errors && typeof payload.errors === "object") messages.push(...Object.values(payload.errors));
  if (typeof payload?.message === "string") messages.push(payload.message);
  return messages.filter(Boolean).join("；") || fallback;
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

export function createJiraClient({ fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  async function fetchTransitions(config, issueKey) {
    const key = normalizeIssueKey(issueKey);
    let response;
    try {
      response = await fetchImpl(transitionEndpoint(config, key, { expand: true }), {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: jiraAuthenticationHeader(config)
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "读取 Jira 状态流转超时。" : `无法读取 Jira 状态流转：${error.message}`, {
        code: timeout ? "JIRA_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      const fallback = response.status === 401
        ? "Jira 认证失败，请检查 Token。"
        : response.status === 403
          ? "当前 Jira 用户无权查看该任务的状态流转。"
          : response.status === 404
            ? "Jira Issue 不存在或当前用户无权查看。"
            : `Jira 返回 HTTP ${response.status}，无法读取状态流转。`;
      throw new JiraApiError(jiraErrorMessage(payload, fallback), {
        code: "JIRA_TRANSITIONS_HTTP_ERROR",
        upstreamStatus: response.status,
        details: payload?.errors || null
      });
    }

    const transitions = Array.isArray(payload?.transitions)
      ? payload.transitions.map(normalizeTransition).filter((transition) => transition.id)
      : [];
    return {
      key,
      transitions,
      fetchedAt: new Date().toISOString()
    };
  }

  async function executeTransition(config, issueKey, transitionId) {
    const key = normalizeIssueKey(issueKey);
    const normalizedTransitionId = String(transitionId || "").trim();
    if (!/^\d+$/.test(normalizedTransitionId)) {
      throw new JiraApiError("Jira 状态流转 ID 无效。", {
        code: "INVALID_TRANSITION_ID",
        upstreamStatus: 400
      });
    }

    const available = await fetchTransitions(config, key);
    const transition = available.transitions.find((candidate) => candidate.id === normalizedTransitionId);
    if (!transition) {
      throw new JiraApiError("该状态流转已不可用，请刷新任务后重试。", {
        code: "JIRA_TRANSITION_NOT_AVAILABLE",
        upstreamStatus: 400
      });
    }
    if (transition.requiresInput) {
      const fieldNames = transition.requiredFields.map((field) => field.name).join("、");
      throw new JiraApiError(`该状态流转需要填写额外字段（${fieldNames}），请在 Jira 中完成。`, {
        code: "JIRA_TRANSITION_REQUIRES_INPUT",
        upstreamStatus: 400,
        details: { requiredFields: transition.requiredFields }
      });
    }

    let response;
    try {
      response = await fetchImpl(transitionEndpoint(config, key), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: jiraAuthenticationHeader(config)
        },
        body: JSON.stringify({ transition: { id: normalizedTransitionId } }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "提交 Jira 状态流转超时，请刷新确认结果。" : `无法提交 Jira 状态流转：${error.message}`, {
        code: timeout ? "JIRA_TRANSITION_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      const fallback = response.status === 401
        ? "Jira 认证失败，请检查 Token。"
        : response.status === 403
          ? "当前 Jira 用户无权执行该状态流转。"
          : response.status === 404
            ? "Jira Issue 不存在或状态流转已不可用。"
            : `Jira 返回 HTTP ${response.status}，状态流转失败。`;
      throw new JiraApiError(jiraErrorMessage(payload, fallback), {
        code: "JIRA_TRANSITION_HTTP_ERROR",
        upstreamStatus: response.status,
        details: payload?.errors || null
      });
    }

    return {
      key,
      transition,
      transitionedAt: new Date().toISOString()
    };
  }

  async function fetchIssues(config, { maxResults = config.maxResults } = {}) {
    const cloud = config.deployment !== "data_center";
    const endpoint = cloud ? "/rest/api/3/search/jql" : "/rest/api/2/search";
    const requestUrl = `${config.baseUrl}${endpoint}`;
    const body = {
      jql: config.jql,
      maxResults,
      fields: ISSUE_FIELDS
    };
    if (!cloud) body.startAt = 0;

    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: jiraAuthenticationHeader(config)
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "连接 Jira 超时。" : `无法连接 Jira：${error.message}`, {
        code: timeout ? "JIRA_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      const fallback = response.status === 401
        ? "Jira 认证失败，请检查邮箱和 Token。"
        : response.status === 403
          ? "当前 Jira 用户无权查看该查询的任务。"
          : response.status === 429
            ? "Jira 请求过于频繁，请稍后重试。"
            : `Jira 返回 HTTP ${response.status}。`;
      throw new JiraApiError(jiraErrorMessage(payload, fallback), {
        code: "JIRA_HTTP_ERROR",
        upstreamStatus: response.status,
        details: payload?.errors || null
      });
    }

    const issues = Array.isArray(payload?.issues)
      ? payload.issues.map((issue) => normalizeIssue(issue, config.baseUrl))
      : [];
    const total = Number.isFinite(payload?.total) ? payload.total : issues.length;
    return {
      issues,
      total,
      truncated: Boolean(payload?.nextPageToken) || total > issues.length,
      fetchedAt: new Date().toISOString(),
      site: config.baseUrl,
      jql: config.jql
    };
  }

  async function fetchTaskBoardIssues(config, {
    activeJql,
    completedJql,
    maxResults = config.maxResults
  }) {
    const [active, completed] = await Promise.all([
      fetchIssues({ ...config, jql: activeJql }, { maxResults }),
      fetchIssues({ ...config, jql: completedJql }, { maxResults })
    ]);
    const seen = new Set();
    const activeIssues = [];
    const completedIssues = [];
    for (const issue of active.issues) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      activeIssues.push(issue);
    }
    for (const issue of completed.issues) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      completedIssues.push(issue);
    }
    const merged = [...activeIssues, ...completedIssues];
    const total = active.total + completed.total;
    return {
      issues: merged,
      activeIssues,
      completedIssues,
      total,
      truncated: active.truncated || completed.truncated || total > merged.length,
      fetchedAt: new Date().toISOString(),
      site: config.baseUrl,
      jql: config.jql,
      sources: {
        active: { total: active.total, returned: active.issues.length, jql: activeJql },
        completed: { total: completed.total, returned: completed.issues.length, jql: completedJql }
      }
    };
  }

  async function fetchAttachment(config, attachmentId, { thumbnail = false } = {}) {
    if (!/^\d+$/.test(String(attachmentId))) {
      throw new JiraApiError("附件 ID 无效。", { code: "INVALID_ATTACHMENT_ID", upstreamStatus: 400 });
    }
    const headers = {
      accept: "application/json",
      authorization: jiraAuthenticationHeader(config)
    };
    const metadataUrl = `${config.baseUrl}/rest/api/2/attachment/${attachmentId}`;
    let metadataResponse;
    try {
      metadataResponse = await fetchImpl(metadataUrl, {
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "读取 Jira 附件信息超时。" : `无法读取 Jira 附件信息：${error.message}`, {
        code: timeout ? "JIRA_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }
    const metadata = await responsePayload(metadataResponse);
    if (!metadataResponse.ok) {
      throw new JiraApiError(jiraErrorMessage(metadata, `Jira 附件不存在或无权访问（HTTP ${metadataResponse.status}）。`), {
        code: "JIRA_ATTACHMENT_METADATA_FAILED",
        upstreamStatus: metadataResponse.status
      });
    }

    const remoteValue = thumbnail && metadata.thumbnail ? metadata.thumbnail : metadata.content;
    if (!remoteValue) {
      throw new JiraApiError("Jira 没有返回附件内容地址。", { code: "JIRA_ATTACHMENT_URL_MISSING" });
    }
    const remoteUrl = new URL(remoteValue, `${config.baseUrl}/`);
    if (remoteUrl.origin !== new URL(config.baseUrl).origin) {
      throw new JiraApiError("Jira 附件地址不属于当前 Jira 实例，已拒绝转发凭据。", {
        code: "JIRA_ATTACHMENT_ORIGIN_MISMATCH"
      });
    }

    let contentResponse;
    try {
      contentResponse = await fetchImpl(remoteUrl, {
        headers: { authorization: jiraAuthenticationHeader(config) },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "下载 Jira 附件超时。" : `无法下载 Jira 附件：${error.message}`, {
        code: timeout ? "JIRA_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }
    if (!contentResponse.ok) {
      const payload = await responsePayload(contentResponse);
      throw new JiraApiError(jiraErrorMessage(payload, `Jira 附件下载失败（HTTP ${contentResponse.status}）。`), {
        code: "JIRA_ATTACHMENT_DOWNLOAD_FAILED",
        upstreamStatus: contentResponse.status
      });
    }
    return {
      body: contentResponse.body,
      filename: metadata.filename || `attachment-${attachmentId}`,
      contentType: contentResponse.headers.get("content-type") || metadata.mimeType || "application/octet-stream",
      contentLength: contentResponse.headers.get("content-length"),
      thumbnail: thumbnail && Boolean(metadata.thumbnail)
    };
  }

  return { fetchIssues, fetchTaskBoardIssues, fetchTransitions, executeTransition, fetchAttachment };
}
