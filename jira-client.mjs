const BASE_ISSUE_FIELDS = [
  "summary",
  "description",
  "issuetype",
  "priority",
  "status",
  "assignee",
  "attachment",
  "labels",
  "project",
  "fixVersions",
  "parent",
  "created",
  "updated"
];
function issueFields(config) {
  const collaboratorFieldId = String(
    config?.collaboratorFieldId || config?.boardSources?.collaboratorFieldId || ""
  ).trim();
  return [...new Set([
    ...BASE_ISSUE_FIELDS,
    ...(collaboratorFieldId ? [collaboratorFieldId] : [])
  ])];
}

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

function issueEndpoint(config, issueKey) {
  const version = config.deployment === "data_center" ? "2" : "3";
  return `${config.baseUrl}/rest/api/${version}/issue/${encodeURIComponent(issueKey)}`
    + `?fields=${encodeURIComponent(issueFields(config).join(","))}`;
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

function normalizeIssue(issue, baseUrl, collaboratorFieldId = "") {
  const fields = issue.fields || {};
  const issueKey = String(issue.key || "");
  const description = flattenAtlassianDocument(fields.description).replace(/\n{3,}/g, "\n\n").trim();
  const collaborators = Array.isArray(fields[collaboratorFieldId])
    ? fields[collaboratorFieldId].map((user) => ({
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
        : null,
      sourceIssueKey: issueKey
    }))
    : [];
  const parentFields = fields.parent?.fields || {};
  const parentKey = String(fields.parent?.key || "").trim().toUpperCase();
  const parent = parentKey ? {
    id: String(fields.parent?.id || parentKey),
    key: parentKey,
    title: String(parentFields.summary || parentKey),
    type: issueTypeGroup(parentFields),
    typeName: String(parentFields.issuetype?.name || "父级任务"),
    status: statusGroup(parentFields),
    statusName: String(parentFields.status?.name || "未知状态"),
    url: `${baseUrl}/browse/${encodeURIComponent(parentKey)}`
  } : null;
  return {
    id: String(issue.id || issue.key),
    key: issueKey,
    type: issueTypeGroup(fields),
    typeName: fields.issuetype?.name || "任务",
    title: fields.summary || "未命名 Jira 任务",
    summary: description || "Jira 中未填写描述。",
    hasDescription: Boolean(description),
    priority: fields.priority?.name || "未设置",
    status: statusGroup(fields),
    statusName: fields.status?.name || "未知状态",
    assignee: fields.assignee?.displayName || fields.assignee?.name || "未分配",
    collaborators,
    attachments,
    labels: Array.isArray(fields.labels) ? fields.labels.map(String) : [],
    projectName: fields.project?.name || fields.project?.key || "",
    fixVersions: Array.isArray(fields.fixVersions)
      ? fields.fixVersions.map((version) => String(version?.name || "").trim()).filter(Boolean)
      : [],
    parent,
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

function isAuthenticationFailure(payload, status) {
  if (status === 401) return true;
  const message = jiraErrorMessage(payload, "").toLowerCase();
  return /must be authenticated|not authenticated|未登录|必须登录|匿名用户|需要认证|认证失败|authentication required|unauthori[sz]ed/.test(message);
}

function authenticationError(payload, fallback = "Jira Token 已失效或无权访问，请重新配置 Token。") {
  return new JiraApiError(fallback, {
    code: "JIRA_AUTH_FAILED",
    upstreamStatus: 401,
    details: payload?.errors || null
  });
}

function normalizeProject(project) {
  const key = String(project?.key || "").trim().toUpperCase();
  if (!key) return null;
  return {
    id: String(project?.id || ""),
    key,
    name: String(project?.name || key).trim(),
    projectTypeKey: String(project?.projectTypeKey || "").trim(),
    archived: Boolean(project?.archived)
  };
}

function filterItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.values)) return payload.values;
  if (Array.isArray(payload?.filters)) return payload.filters;
  return [];
}

function filterProjectKeys(filter) {
  if (Array.isArray(filter?.projectKeys) && filter.projectKeys.length) {
    return filter.projectKeys.map((value) => String(value).toUpperCase());
  }
  const permissions = Array.isArray(filter?.sharePermissions) ? filter.sharePermissions : [];
  return permissions.flatMap((permission) => {
    const project = permission?.project || permission?.projectId || permission?.projectKey;
    if (!project) return [];
    if (typeof project === "string" || typeof project === "number") return [String(project).toUpperCase()];
    return [project.key, project.id].filter(Boolean).map((value) => String(value).toUpperCase());
  });
}

function filterMatchesProject(filter, projectKey) {
  const target = String(projectKey || "").trim().toUpperCase();
  if (!target) return true;
  if (filterProjectKeys(filter).includes(target)) return true;
  const jql = String(filter?.jql || "");
  const referenced = [];
  for (const match of jql.matchAll(/\bproject\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))/ig)) {
    referenced.push(match[1] || match[2] || match[3]);
  }
  for (const match of jql.matchAll(/\bproject\s+in\s*\(([^)]*)\)/ig)) {
    referenced.push(...match[1].split(",").map((value) => value.trim().replace(/^['"]|['"]$/g, "")));
  }
  return referenced.length === 0 || referenced.some((value) => String(value).toUpperCase() === target);
}

function filterProjectMatch(filter, projectKey) {
  const target = String(projectKey || "").trim().toUpperCase();
  if (!target) return "all";
  if (!filterMatchesRequestedProject(filter, target)) return "other";
  const shared = filterProjectKeys(filter);
  if (shared.includes(target)) return "match";
  const jql = String(filter?.jql || "");
  const hasProjectClause = /\bproject\s+(?:=|in|!=|not\s+in|is|is\s+not)\b/i.test(jql);
  return hasProjectClause ? "match" : "unknown";
}

function filterMatchesRequestedProject(filter, projectKey) {
  const target = String(projectKey || "").trim().toUpperCase();
  if (!target) return true;
  if (filterProjectKeys(filter).includes(target)) return true;
  const jql = String(filter?.jql || "");
  const positive = [];
  const negative = [];
  for (const match of jql.matchAll(/\bproject\s*(=|!=)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))/ig)) {
    const value = match[2] || match[3] || match[4];
    (match[1] === "!=" ? negative : positive).push(value);
  }
  for (const match of jql.matchAll(/\bproject\s+(in|not\s+in)\s*\(([^)]*)\)/ig)) {
    const values = match[2].split(",").map((value) => value.trim().replace(/^[\'"]|[\'"]$/g, ""));
    (match[1].toLowerCase() === "not in" ? negative : positive).push(...values);
  }
  if (positive.length) return positive.some((value) => String(value).toUpperCase() === target);
  if (negative.length) return !negative.some((value) => String(value).toUpperCase() === target);
  return true;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseManageFiltersHtml(html) {
  const filters = [];
  for (const rowMatch of String(html || "").matchAll(/<tr\b[^>]*data-filter-id=["'](\d+)["'][\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    const id = rowMatch[1];
    const nameMatch = row.match(new RegExp(`id=["']filterlink_${id}["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"));
    const ownerMatch = row.match(/data-filter-field=["']owner-full-name["'][^>]*>([\s\S]*?)<\//i);
    filters.push({
      id,
      name: decodeHtmlEntities(nameMatch?.[1] || `Filter ${id}`),
      owner: decodeHtmlEntities(ownerMatch?.[1] || "")
    });
  }
  return filters;
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
  async function fetchIssue(config, issueKey) {
    const key = normalizeIssueKey(issueKey);
    let response;
    try {
      response = await fetchImpl(issueEndpoint(config, key), {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: jiraAuthenticationHeader(config)
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "读取 Jira 任务详情超时。" : `无法读取 Jira 任务详情：${error.message}`, {
        code: timeout ? "JIRA_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      const fallback = response.status === 401
        ? "Jira 认证失败，请检查 Token。"
        : response.status === 403
          ? "当前 Jira 用户无权查看该任务。"
          : response.status === 404
            ? "Jira Issue 不存在或当前用户无权查看。"
            : `Jira 返回 HTTP ${response.status}，无法读取任务详情。`;
      throw new JiraApiError(jiraErrorMessage(payload, fallback), {
        code: "JIRA_ISSUE_HTTP_ERROR",
        upstreamStatus: response.status,
        details: payload?.errors || null
      });
    }

    return normalizeIssue(
      payload,
      config.baseUrl,
      config.collaboratorFieldId || config.boardSources?.collaboratorFieldId || ""
    );
  }

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
      fields: issueFields(config)
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
      if (isAuthenticationFailure(payload, response.status)) {
        throw authenticationError(payload);
      }
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
      ? payload.issues.map((issue) => normalizeIssue(
        issue,
        config.baseUrl,
        config.collaboratorFieldId || config.boardSources?.collaboratorFieldId || ""
      ))
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

  async function fetchProjects(config) {
    const version = config.deployment === "data_center" ? "2" : "3";
    const endpoint = `${config.baseUrl}/rest/api/${version}/project`;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: jiraAuthenticationHeader(config)
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "读取 Jira 项目列表超时。" : `无法读取 Jira 项目列表：${error.message}`, {
        code: timeout ? "JIRA_PROJECTS_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      if (isAuthenticationFailure(payload, response.status)) {
        throw authenticationError(payload);
      }
      const fallback = response.status === 403
        ? "当前 Jira 用户无权读取可用项目列表。"
        : response.status === 404
          ? "当前 Jira 实例不支持项目列表接口。"
          : `Jira 返回 HTTP ${response.status}，无法读取项目列表。`;
      throw new JiraApiError(jiraErrorMessage(payload, fallback), {
        code: "JIRA_PROJECTS_HTTP_ERROR",
        upstreamStatus: response.status,
        details: payload?.errors || null
      });
    }

    const projects = (Array.isArray(payload) ? payload : filterItems(payload))
      .map(normalizeProject)
      .filter(Boolean)
      .filter((project) => !project.archived)
      .sort((left, right) => left.key.localeCompare(right.key, "en", { sensitivity: "base" }));
    return {
      projects,
      total: projects.length,
      fetchedAt: new Date().toISOString(),
      site: config.baseUrl
    };
  }

  async function fetchFields(config) {
    const version = config.deployment === "data_center" ? "2" : "3";
    const endpoint = `${config.baseUrl}/rest/api/${version}/field`;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: jiraAuthenticationHeader(config)
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "读取 Jira 字段列表超时。" : `无法读取 Jira 字段：${error.message}`, {
        code: timeout ? "JIRA_FIELDS_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }
    const payload = await responsePayload(response);
    if (!response.ok) {
      if (isAuthenticationFailure(payload, response.status)) throw authenticationError(payload);
      throw new JiraApiError(jiraErrorMessage(payload, `Jira 字段请求失败（HTTP ${response.status}）。`), {
        code: "JIRA_FIELDS_HTTP_ERROR",
        upstreamStatus: response.status,
        details: payload?.errors || null
      });
    }
    const fields = (Array.isArray(payload) ? payload : filterItems(payload))
      .map((field) => ({
        id: String(field?.id || "").trim(),
        name: String(field?.name || "").trim(),
        custom: Boolean(field?.custom),
        searchable: field?.searchable !== false,
        orderable: field?.orderable !== false
      }))
      .filter((field) => field.id && field.name);
    return { fields, total: fields.length, fetchedAt: new Date().toISOString(), site: config.baseUrl };
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

  async function fetchFilters(config, { projectKey = "" } = {}) {
    const version = config.deployment === "data_center" ? "2" : "3";
    const endpoints = [
      `${config.baseUrl}/rest/api/${version}/filter/search?maxResults=1000`,
      `${config.baseUrl}/rest/api/${version}/filter/my`,
      `${config.baseUrl}/rest/api/${version}/filter/favourite`
    ];
    const results = [];
    let lastFailure = null;
    for (const endpoint of endpoints) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: jiraAuthenticationHeader(config)
          },
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        const timeout = error.name === "TimeoutError" || error.name === "AbortError";
        lastFailure = new JiraApiError(timeout ? "读取 Jira Filter 超时。" : `无法读取 Jira Filter：${error.message}`, {
          code: timeout ? "JIRA_FILTER_TIMEOUT" : "JIRA_UNREACHABLE"
        });
        continue;
      }
      const payload = await responsePayload(response);
      if (!response.ok) {
        if (isAuthenticationFailure(payload, response.status)) {
          throw authenticationError(payload);
        }
        lastFailure = new JiraApiError(jiraErrorMessage(payload, `Jira Filter 请求失败（HTTP ${response.status}）。`), {
          code: "JIRA_FILTER_HTTP_ERROR",
          upstreamStatus: response.status,
          details: payload?.errors || null
        });
        if (![403, 404].includes(response.status)) throw lastFailure;
        continue;
      }
      results.push(...filterItems(payload));
      if (endpoint.includes("/filter/search")) {
        const firstPage = filterItems(payload);
        const total = Number(payload?.total || payload?.resultCount || 0);
        const pageSize = Math.max(firstPage.length, Number(payload?.maxResults || 1000), 1);
        let startAt = firstPage.length;
        let pages = 0;
        while (total > startAt && pages < 50) {
          const pageUrl = `${config.baseUrl}/rest/api/${version}/filter/search?startAt=${startAt}&maxResults=${pageSize}`;
          let pageResponse;
          try {
            pageResponse = await fetchImpl(pageUrl, {
              method: "GET",
              headers: {
                accept: "application/json",
                authorization: jiraAuthenticationHeader(config)
              },
              signal: AbortSignal.timeout(timeoutMs)
            });
          } catch {
            break;
          }
          const pagePayload = await responsePayload(pageResponse);
          if (!pageResponse.ok) break;
          const pageItems = filterItems(pagePayload);
          if (!pageItems.length) break;
          results.push(...pageItems);
          startAt += pageItems.length;
          pages += 1;
        }
      }
    }
    if (!results.length && config.deployment === "data_center") {
      // Jira 9.x installations may disable the REST collection endpoints
      // while still exposing the authenticated Manage Filters view. Use it
      // only as a read-only discovery fallback, then resolve each JQL through
      // the normal REST detail endpoint.
      const manageUrl = `${config.baseUrl}/secure/ManageFilters.jspa?search=search&searchName=`;
      try {
        const manageResponse = await fetchImpl(manageUrl, {
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml",
            authorization: jiraAuthenticationHeader(config)
          },
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (manageResponse.ok) {
          const html = await manageResponse.text();
          const discovered = parseManageFiltersHtml(html).slice(0, 200);
          const details = await Promise.all(discovered.map(async (filter) => {
            try {
              const detailResponse = await fetchImpl(`${config.baseUrl}/rest/api/${version}/filter/${filter.id}`, {
                method: "GET",
                headers: {
                  accept: "application/json",
                  authorization: jiraAuthenticationHeader(config)
                },
                signal: AbortSignal.timeout(timeoutMs)
              });
              const detail = await responsePayload(detailResponse);
              if (!detailResponse.ok) return filter;
              return { ...filter, ...detail };
            } catch {
              return filter;
            }
          }));
          results.push(...details);
        }
      } catch {
        // Keep an empty list if the HTML fallback is unavailable.
      }
    }
    if (!results.length && lastFailure && endpoints.length) {
      // A user may have access to neither collection endpoint. Preserve the
      // useful upstream error instead of presenting an empty selector.
      if (lastFailure.code !== "JIRA_FILTER_HTTP_ERROR" || !lastFailure.upstreamStatus || ![403, 404].includes(lastFailure.upstreamStatus)) {
        throw lastFailure;
      }
    }
    const seen = new Set();
    const filters = results
      .map((filter) => {
        const id = String(filter?.id || "").trim();
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return {
          id,
          name: String(filter?.name || `Filter ${id}`).trim(),
          jql: String(filter?.jql || "").trim(),
          owner: filter?.owner?.displayName || filter?.owner?.name || filter?.owner?.key || "",
          favourite: Boolean(filter?.favourite),
          projectKeys: filterProjectKeys(filter),
          projectMatch: filterProjectMatch(filter, projectKey)
        };
      })
      .filter(Boolean)
      .filter((filter) => filter.projectMatch !== "other")
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base" }));
    return {
      filters,
      total: filters.length,
      fetchedAt: new Date().toISOString(),
      site: config.baseUrl,
      projectKey: String(projectKey || "").trim()
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

  return {
    fetchIssue,
    fetchIssues,
    fetchProjects,
    fetchTaskBoardIssues,
    fetchFilters,
    fetchFields,
    fetchTransitions,
    executeTransition,
    fetchAttachment
  };
}
