import { gunzipSync } from "node:zlib";
import { JiraApiError, jiraAuthenticationHeader } from "./jira-client.mjs";

const SHEET_PROPERTY_PREFIX = "app.jxl.sheet.";
const SHEET_PROPERTY_PATTERN = /^app\.jxl\.sheet\.([A-Za-z0-9_-]+)$/;
const PROJECT_ID_PATTERN = /^\d+$/;
const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

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

function validateChunk(chunk) {
  return chunk
    && Number.isInteger(chunk.part)
    && Number.isInteger(chunk.total)
    && chunk.part > 0
    && chunk.total >= chunk.part
    && typeof chunk.content === "string"
    && typeof chunk.signature === "string"
    ? chunk
    : null;
}

function decodeChunkedSheet(chunks) {
  if (!chunks.length || chunks.some((chunk) => !validateChunk(chunk))) {
    throw new JiraApiError("JXL Sheet 的分块数据无效。", { code: "JXL_SHEET_DATA_INVALID" });
  }
  const ordered = [...chunks].sort((left, right) => left.part - right.part);
  const first = ordered[0];
  const compression = first.compression || "none";
  const valid = ordered.length === first.total
    && ordered.every((chunk, index) => chunk.part === index + 1
      && chunk.total === first.total
      && (chunk.compression || "none") === compression
      && chunk.signature === first.signature);
  if (!valid) {
    throw new JiraApiError("JXL Sheet 的分块数据不完整。", { code: "JXL_SHEET_DATA_INCOMPLETE" });
  }

  try {
    const content = ordered.map((chunk) => chunk.content).join("");
    const json = compression === "gzip"
      ? gunzipSync(Buffer.from(content, "base64")).toString("utf8")
      : content;
    return JSON.parse(json);
  } catch {
    throw new JiraApiError("JXL Sheet 数据无法解压或解析。", { code: "JXL_SHEET_DATA_INVALID" });
  }
}

function userIdentity(user) {
  return {
    id: String(user?.accountId || user?.key || user?.name || ""),
    alternateIds: new Set([user?.accountId, user?.key, user?.name].filter(Boolean).map(String)),
    groups: new Set((user?.groups?.items || []).flatMap((group) => [group?.groupId, group?.name]).filter(Boolean).map(String))
  };
}

function sheetAccessLevel(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return String(value.sheetAccess || value.access || "");
}

function matchesAccessRule(rule, user, access) {
  if (sheetAccessLevel(rule?.access) !== access || !rule?.holder) return false;
  if (rule.holder.type === "user") return user.alternateIds.has(String(rule.holder.id || ""));
  if (rule.holder.type === "group") return user.groups.has(String(rule.holder.id || ""));
  return false;
}

export function canViewJxlSheet(sheetData, currentUser) {
  const access = sheetData?.access;
  const defaultAccess = sheetAccessLevel(access?.default);
  if (!access || defaultAccess === "edit") return true;
  const user = userIdentity(currentUser);
  if (access.rules?.some((rule) => matchesAccessRule(rule, user, "edit"))) return true;
  if (defaultAccess === "view") return true;
  return Boolean(access.rules?.some((rule) => matchesAccessRule(rule, user, "view")));
}

function normalizedSheet(sheetData, { config, project, sheetId }) {
  if (!sheetData || typeof sheetData.title !== "string" || !sheetData.title.trim()) return null;
  const scope = sheetData.scope && typeof sheetData.scope === "object"
    ? {
      type: String(sheetData.scope.type || ""),
      value: String(sheetData.scope.value || "")
    }
    : null;
  const projectId = String(project.id || "");
  const projectKey = String(project.key || "");
  return {
    id: sheetId,
    title: sheetData.title.trim(),
    description: typeof sheetData.description === "string" ? sheetData.description : "",
    projectId,
    projectKey,
    projectName: project.name || projectKey,
    scopeType: scope?.type || "",
    queryable: scope?.type === "jql" && Boolean(scope.value),
    updatedAt: Number.isFinite(sheetData.lastUpdatedDate)
      ? new Date(sheetData.lastUpdatedDate).toISOString()
      : null,
    url: `${config.baseUrl}/projects/${encodeURIComponent(projectKey)}?selectedItem=app.jxl:sheets#s/${encodeURIComponent(sheetId)}`,
    directoryUrl: `${config.baseUrl}/secure/JXLDirectory.jspa`,
    _scope: scope
  };
}

function publicSheet(sheet) {
  if (!sheet) return null;
  const { _scope, ...result } = sheet;
  return result;
}

export function createJxlClient({ fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  async function fetchJson(config, path, { missing = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        headers: {
          accept: "application/json",
          authorization: jiraAuthenticationHeader(config)
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      throw new JiraApiError(timeout ? "读取 JXL Sheets 超时。" : `无法读取 JXL Sheets：${error.message}`, {
        code: timeout ? "JIRA_TIMEOUT" : "JIRA_UNREACHABLE"
      });
    }
    if (missing && response.status === 404) return null;
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new JiraApiError(jiraErrorMessage(payload, `Jira 返回 HTTP ${response.status}。`), {
        code: "JXL_HTTP_ERROR",
        upstreamStatus: response.status,
        details: payload?.errors || null
      });
    }
    return payload;
  }

  async function fetchSheetData(config, projectId, sheetId) {
    if (!PROJECT_ID_PATTERN.test(String(projectId)) || !SHEET_ID_PATTERN.test(String(sheetId))) {
      throw new JiraApiError("JXL Sheet 标识无效。", { code: "INVALID_JXL_SHEET_ID", upstreamStatus: 400 });
    }
    const propertyKey = `${SHEET_PROPERTY_PREFIX}${sheetId}`;
    const base = await fetchJson(
      config,
      `/rest/api/2/project/${encodeURIComponent(projectId)}/properties/${encodeURIComponent(propertyKey)}`,
      { missing: true }
    );
    if (!base) return null;
    const firstChunk = validateChunk(base.value);
    if (!firstChunk) return base.value;
    const chunks = [firstChunk];
    for (let part = 2; part <= firstChunk.total; part += 1) {
      const chunk = await fetchJson(
        config,
        `/rest/api/2/project/${encodeURIComponent(projectId)}/properties/${encodeURIComponent(`${propertyKey}.${part}`)}`,
        { missing: true }
      );
      if (!chunk) {
        throw new JiraApiError("JXL Sheet 的分块数据不完整。", { code: "JXL_SHEET_DATA_INCOMPLETE" });
      }
      chunks.push(chunk.value);
    }
    return decodeChunkedSheet(chunks);
  }

  async function currentUser(config) {
    return fetchJson(config, "/rest/api/2/myself?expand=groups");
  }

  async function fetchProject(config, projectId) {
    return fetchJson(config, `/rest/api/2/project/${encodeURIComponent(projectId)}`, { missing: true });
  }

  async function getSheet(config, { projectId, sheetId }) {
    const [user, project, data] = await Promise.all([
      currentUser(config),
      fetchProject(config, projectId),
      fetchSheetData(config, projectId, sheetId)
    ]);
    if (!project || !data || !canViewJxlSheet(data, user)) return null;
    return normalizedSheet(data, { config, project, sheetId });
  }

  async function listSheets(config) {
    const [user, projects] = await Promise.all([
      currentUser(config),
      fetchJson(config, "/rest/api/2/project")
    ]);
    const visibleProjects = Array.isArray(projects) ? projects.filter((project) => !project.archived) : [];
    const projectSheets = await Promise.all(visibleProjects.map(async (project) => {
      const properties = await fetchJson(
        config,
        `/rest/api/2/project/${encodeURIComponent(project.id)}/properties`
      );
      const sheetIds = (properties?.keys || []).flatMap((item) => {
        const match = SHEET_PROPERTY_PATTERN.exec(String(item?.key || ""));
        return match ? [match[1]] : [];
      });
      const sheets = await Promise.all(sheetIds.map(async (sheetId) => {
        try {
          const data = await fetchSheetData(config, project.id, sheetId);
          if (!data || !canViewJxlSheet(data, user)) return null;
          return normalizedSheet(data, { config, project, sheetId });
        } catch (error) {
          if (error instanceof JiraApiError && ["JXL_SHEET_DATA_INVALID", "JXL_SHEET_DATA_INCOMPLETE"].includes(error.code)) {
            return null;
          }
          throw error;
        }
      }));
      return sheets.filter(Boolean);
    }));
    const sheets = projectSheets.flat().sort((left, right) => (
      left.projectName.localeCompare(right.projectName, "zh-CN")
      || left.title.localeCompare(right.title, "zh-CN")
      || left.id.localeCompare(right.id, "en-US")
    ));
    return {
      sheets: sheets.map(publicSheet),
      total: sheets.length,
      fetchedAt: new Date().toISOString(),
      site: config.baseUrl,
      directoryUrl: `${config.baseUrl}/secure/JXLDirectory.jspa`
    };
  }

  return { getSheet, listSheets };
}
