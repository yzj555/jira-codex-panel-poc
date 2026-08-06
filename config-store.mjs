import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_BUG_MESSAGE_TEMPLATE,
  DEFAULT_MESSAGE_TEMPLATE,
  DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE,
  HISTORICAL_DEFAULT_MESSAGE_TEMPLATE,
  LEGACY_DEFAULT_MESSAGE_TEMPLATE,
  PREVIOUS_BUG_MESSAGE_TEMPLATE,
  PREVIOUS_REQUIREMENT_MESSAGE_TEMPLATE
} from "./public/prompt-builder.js";

export {
  DEFAULT_BUG_MESSAGE_TEMPLATE,
  DEFAULT_MESSAGE_TEMPLATE,
  DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE
} from "./public/prompt-builder.js";

export const LEGACY_DEFAULT_JQL = "assignee = currentUser() ORDER BY updated DESC";
export const COLLABORATION_DEFAULT_JQL = '(assignee = currentUser() OR "协同处理人" = currentUser()) ORDER BY updated DESC';
export const DASHBOARD_ACTIVE_JQL = "(filter = 10103 OR filter = 10102) ORDER BY updated DESC";
export const DASHBOARD_COMPLETED_JQL = 'project = CT AND statusCategory = Done AND (assignee = currentUser() OR "协同处理人" = currentUser()) ORDER BY updated DESC';
export const DEFAULT_JQL = '((filter = 10103 OR filter = 10102) OR (project = CT AND statusCategory = Done AND (assignee = currentUser() OR "协同处理人" = currentUser()))) ORDER BY updated DESC';

export const DEFAULT_BOARD_PROJECT_KEY = "CT";
export const DEFAULT_COLLABORATOR_FIELD_ID = "customfield_10600";
export const DEFAULT_COLLABORATOR_JQL_NAME = "协同处理人";
export const BOARD_SOURCE_MODES = Object.freeze(["builtin", "custom", "filter"]);
export const TASK_SYNC_INTERVALS = Object.freeze([30, 60, 300, 600]);
export const SHEETS_SYNC_INTERVALS = Object.freeze([0, 300, 600]);
export const DEFAULT_SYNC_SETTINGS = Object.freeze({
  tasksEnabled: true,
  taskIntervalSeconds: 60,
  syncOnPanelReturn: true,
  sheetsIntervalSeconds: 300
});

export class ConfigurationError extends Error {
  constructor(message, { code = "INVALID_CONFIGURATION", statusCode = 400 } = {}) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeBoardSourceMode(value) {
  const mode = String(value || "builtin").trim().toLowerCase();
  return BOARD_SOURCE_MODES.includes(mode) ? mode : "builtin";
}

function normalizeBoardProjectKey(value, fallback = DEFAULT_BOARD_PROJECT_KEY) {
  const projectKey = String(value ?? fallback).trim();
  if (!projectKey) return "";
  if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(projectKey)) {
    throw new ConfigurationError("Jira 项目 Key 无效，请使用 1-50 位字母、数字或下划线。", {
      code: "INVALID_BOARD_PROJECT_KEY"
    });
  }
  return projectKey.toUpperCase();
}

function normalizeBoardJql(value, { required = false } = {}) {
  const jql = String(value || "").trim();
  if (required && !jql) {
    throw new ConfigurationError("自定义 JQL 不能为空。", { code: "BOARD_JQL_REQUIRED" });
  }
  if (jql.length > 12_000) {
    throw new ConfigurationError("面板 JQL 不能超过 12000 个字符。", { code: "BOARD_JQL_TOO_LONG" });
  }
  return jql;
}

function normalizeFilterIds(value, { required = false } = {}) {
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  const ids = [...new Set(values.map((id) => String(id || "").trim()).filter(Boolean))];
  if (ids.some((id) => !/^\d+$/.test(id))) {
    throw new ConfigurationError("Filter ID 必须是数字。", { code: "INVALID_BOARD_FILTER_ID" });
  }
  if (ids.length > 100) {
    throw new ConfigurationError("单个面板最多选择 100 个 Filter。", { code: "TOO_MANY_BOARD_FILTERS" });
  }
  if (required && !ids.length) {
    throw new ConfigurationError("请选择至少一个 Jira Filter。", { code: "BOARD_FILTER_REQUIRED" });
  }
  return ids;
}

function normalizeBoardSource(kind, incoming = {}, previous = {}) {
  const source = incoming && typeof incoming === "object" ? incoming : {};
  const prior = previous && typeof previous === "object" ? previous : {};
  const mode = normalizeBoardSourceMode(source.mode ?? prior.mode);
  const jql = normalizeBoardJql(source.jql ?? prior.jql, { required: mode === "custom" });
  const filterIds = normalizeFilterIds(source.filterIds ?? source.filters ?? prior.filterIds ?? prior.filters, {
    required: mode === "filter"
  });
  return {
    mode,
    jql: mode === "custom" ? jql : "",
    filterIds: mode === "filter" ? filterIds : []
  };
}

function legacyBoardSources(jql) {
  const value = String(jql || "").trim();
  if (!value || value === DEFAULT_JQL || value === LEGACY_DEFAULT_JQL
    || value === COLLABORATION_DEFAULT_JQL || value === DASHBOARD_ACTIVE_JQL) {
    return {
      legacy: true,
      projectKey: DEFAULT_BOARD_PROJECT_KEY,
      collaboratorFieldId: DEFAULT_COLLABORATOR_FIELD_ID,
      collaboratorJqlName: DEFAULT_COLLABORATOR_JQL_NAME,
      requirement: { mode: "builtin", jql: "", filterIds: [] },
      bug: { mode: "builtin", jql: "", filterIds: [] }
    };
  }
  return {
    legacy: true,
    projectKey: "",
    collaboratorFieldId: DEFAULT_COLLABORATOR_FIELD_ID,
    collaboratorJqlName: DEFAULT_COLLABORATOR_JQL_NAME,
    requirement: { mode: "custom", jql: value, filterIds: [] },
    bug: { mode: "custom", jql: value, filterIds: [] }
  };
}

export function normalizeBoardSources(input, previous = {}, legacyJql = DEFAULT_JQL) {
  const incoming = input && typeof input === "object" ? input : null;
  const prior = previous && typeof previous === "object" ? previous : null;
  if (!incoming && (!prior || !Object.keys(prior).length)) return legacyBoardSources(legacyJql);
  if (!incoming && prior) {
    return {
      legacy: Boolean(prior.legacy),
      projectKey: normalizeBoardProjectKey(prior.projectKey, ""),
      collaboratorFieldId: String(prior.collaboratorFieldId || DEFAULT_COLLABORATOR_FIELD_ID).trim() || DEFAULT_COLLABORATOR_FIELD_ID,
      collaboratorJqlName: String(prior.collaboratorJqlName || DEFAULT_COLLABORATOR_JQL_NAME).trim() || DEFAULT_COLLABORATOR_JQL_NAME,
      requirement: normalizeBoardSource("requirement", prior.requirement, prior.requirement),
      bug: normalizeBoardSource("bug", prior.bug, prior.bug)
    };
  }

  const projectKey = normalizeBoardProjectKey(
    incoming.projectKey ?? prior?.projectKey,
    incoming.projectKey === "" ? "" : prior?.projectKey || DEFAULT_BOARD_PROJECT_KEY
  );
  const collaboratorFieldId = String(
    incoming.collaboratorFieldId ?? prior?.collaboratorFieldId ?? DEFAULT_COLLABORATOR_FIELD_ID
  ).trim() || DEFAULT_COLLABORATOR_FIELD_ID;
  const collaboratorJqlName = String(
    incoming.collaboratorJqlName ?? prior?.collaboratorJqlName ?? DEFAULT_COLLABORATOR_JQL_NAME
  ).trim() || DEFAULT_COLLABORATOR_JQL_NAME;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(collaboratorFieldId)) {
    throw new ConfigurationError("协同处理人字段 ID 无效。", { code: "INVALID_COLLABORATOR_FIELD" });
  }
  if (collaboratorJqlName.length > 200) {
    throw new ConfigurationError("协同处理人字段名称无效。", { code: "INVALID_COLLABORATOR_FIELD" });
  }
  return {
    legacy: Boolean(incoming.legacy ?? prior?.legacy),
    projectKey,
    collaboratorFieldId,
    collaboratorJqlName,
    requirement: normalizeBoardSource("requirement", incoming.requirement, prior?.requirement),
    bug: normalizeBoardSource("bug", incoming.bug, prior?.bug)
  };
}

function stripOrderBy(jql) {
  return String(jql || "").trim().replace(/\s+ORDER\s+BY[\s\S]*$/i, "").trim();
}

function collaboratorJqlField(sources) {
  const fieldId = String(sources.collaboratorFieldId || "").trim();
  const numericId = fieldId.match(/^customfield_(\d+)$/i);
  if (numericId) return `cf[${numericId[1]}]`;
  const displayName = String(sources.collaboratorJqlName || "").trim();
  return displayName ? `"${displayName.replace(/"/g, '\\"')}"` : "";
}

function builtInBoardJql(kind, sources, bugTypeNames = []) {
  const clauses = [];
  if (sources.projectKey) clauses.push(`project = ${sources.projectKey}`);
  // Jira Data Center accepts the custom-field clause form cf[12345]. The
  // REST field ID (customfield_12345) is valid in issue payloads but is not a
  // searchable JQL field name on this Jira version.
  const collaboratorField = collaboratorJqlField(sources);
  const collaborator = collaboratorField
    ? `(assignee = currentUser() OR ${collaboratorField} = currentUser())`
    : "assignee = currentUser()";
  clauses.push(collaborator);
  const names = [...new Set((Array.isArray(bugTypeNames) ? bugTypeNames : [])
    .map((name) => String(name || "").trim()).filter(Boolean))];
  if (names.length) {
    const values = names.map((name) => `"${name.replace(/"/g, '\\"')}"`).join(", ");
    clauses.push(kind === "bug"
      ? `issuetype in (${values})`
      : `issuetype not in (${values})`);
  }
  return clauses.join(" AND ");
}

function sourceBaseJql(kind, source, sources, bugTypeNames) {
  if (source.mode === "custom") return stripOrderBy(source.jql);
  if (source.mode === "filter") return source.filterIds.map((id) => `filter = ${id}`).join(" OR ");
  return builtInBoardJql(kind, sources, bugTypeNames);
}

function historySourceJql(kind, source, sources, bugTypeNames) {
  // A saved Filter often contains its own active-status clause. Appending
  // statusCategory = Done to `filter = <id>` would intersect with that clause
  // and make the history view empty. For project-scoped Filter panels, use the
  // same project/user/type scope as the built-in history rule instead.
  if (source.mode === "filter" && sources.projectKey) {
    return builtInBoardJql(kind, sources, bugTypeNames);
  }
  return sourceBaseJql(kind, source, sources, bugTypeNames);
}

function joinSourceParts(parts, fallback) {
  const normalized = parts.map((part) => String(part || "").trim()).filter(Boolean);
  return normalized.length ? normalized.map((part) => `(${part})`).join(" OR ") : fallback;
}

export function buildBoardQueries(boardSources, { bugTypeNames = [] } = {}) {
  const sources = normalizeBoardSources(boardSources, null, DEFAULT_JQL);
  const sourceParts = ["requirement", "bug"].map((kind) => sourceBaseJql(kind, sources[kind], sources, bugTypeNames));
  const historyParts = ["requirement", "bug"].map((kind) => historySourceJql(kind, sources[kind], sources, bugTypeNames));
  const activeParts = sourceParts.map((part) => `(${part}) AND statusCategory != Done`);
  const completedParts = historyParts.map((part) => `(${part}) AND statusCategory = Done`);
  const fallback = `project = ${sources.projectKey || DEFAULT_BOARD_PROJECT_KEY}`;
  return {
    activeJql: `${joinSourceParts(activeParts, fallback)} ORDER BY updated DESC`,
    completedJql: `${joinSourceParts(completedParts, fallback)} ORDER BY updated DESC`,
    sourceJql: {
      requirement: sourceParts[0],
      bug: sourceParts[1]
    },
    historySourceJql: {
      requirement: historyParts[0],
      bug: historyParts[1]
    }
  };
}

function defaultConfigFile() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new ConfigurationError("无法确定当前 Windows 用户的 LOCALAPPDATA 目录。", {
      code: "LOCAL_APP_DATA_UNAVAILABLE",
      statusCode: 500
    });
  }
  return join(localAppData, "jira-codex-panel-poc", "config.json");
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigurationError("Jira 地址不是有效的 URL。", { code: "INVALID_JIRA_URL" });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConfigurationError("Jira 地址只支持 HTTP 或 HTTPS。", { code: "INVALID_JIRA_URL" });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigurationError("Jira 地址不能包含用户名、密码、查询参数或片段。", { code: "INVALID_JIRA_URL" });
  }
  return raw;
}

function normalizeMaxResults(value) {
  const number = Number(value ?? 100);
  if (!Number.isInteger(number) || number < 1 || number > 200) {
    throw new ConfigurationError("任务数量必须是 1 到 200 之间的整数。", { code: "INVALID_MAX_RESULTS" });
  }
  return number;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "false") return false;
    if (value.trim().toLowerCase() === "true") return true;
  }
  return Boolean(value);
}

function normalizeChoice(value, choices, fallback) {
  const number = Number(value);
  return choices.includes(number) ? number : fallback;
}

export function normalizeSyncSettings(input, previous = {}) {
  const source = input && typeof input === "object" ? input : {};
  const prior = previous && typeof previous === "object" ? previous : {};
  return {
    tasksEnabled: normalizeBoolean(
      source.tasksEnabled ?? source.autoSyncTasks,
      prior.tasksEnabled ?? prior.autoSyncTasks ?? DEFAULT_SYNC_SETTINGS.tasksEnabled
    ),
    taskIntervalSeconds: normalizeChoice(
      source.taskIntervalSeconds ?? source.taskInterval,
      TASK_SYNC_INTERVALS,
      normalizeChoice(
        prior.taskIntervalSeconds ?? prior.taskInterval,
        TASK_SYNC_INTERVALS,
        DEFAULT_SYNC_SETTINGS.taskIntervalSeconds
      )
    ),
    syncOnPanelReturn: normalizeBoolean(
      source.syncOnPanelReturn ?? source.refreshOnPanelReturn,
      prior.syncOnPanelReturn ?? prior.refreshOnPanelReturn ?? DEFAULT_SYNC_SETTINGS.syncOnPanelReturn
    ),
    sheetsIntervalSeconds: normalizeChoice(
      source.sheetsIntervalSeconds ?? source.sheetsInterval,
      SHEETS_SYNC_INTERVALS,
      normalizeChoice(
        prior.sheetsIntervalSeconds ?? prior.sheetsInterval,
        SHEETS_SYNC_INTERVALS,
        DEFAULT_SYNC_SETTINGS.sheetsIntervalSeconds
      )
    )
  };
}

export function normalizeWecomWebhook(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigurationError("企业微信机器人 Webhook 不是有效的 URL。", { code: "INVALID_WECOM_WEBHOOK" });
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "qyapi.weixin.qq.com"
    || url.pathname !== "/cgi-bin/webhook/send"
    || !url.searchParams.get("key")
    || url.username
    || url.password
    || url.hash
  ) {
    throw new ConfigurationError("请填写企业微信群机器人的完整 Webhook 地址。", { code: "INVALID_WECOM_WEBHOOK" });
  }
  return url.href;
}

function normalizeMessageTemplate(value, fallback = DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE) {
  const template = String(value ?? fallback).trim() || fallback;
  if (template.length > 12_000) {
    throw new ConfigurationError("对话消息模板不能超过 12000 个字符。", { code: "MESSAGE_TEMPLATE_TOO_LONG" });
  }
  return template;
}

export const DEFAULT_BUG_SKILL = Object.freeze({
  name: "ct-devops-tracer",
  path: "",
  scope: "user"
});

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function normalizeSkillReference(value, fallback = null) {
  const source = value === undefined ? fallback : value;
  if (!source || typeof source !== "object") return null;
  const name = String(source.name || "").trim();
  if (!name) return null;
  const path = String(source.path || "").trim();
  const scope = String(source.scope || "").trim();
  if (name.length > 200 || path.length > 4_000 || scope.length > 100) {
    throw new ConfigurationError("绑定的 Codex 技能信息无效。", { code: "INVALID_CODEX_SKILL" });
  }
  return { name, path, scope };
}

function isManagedLegacyTemplate(value) {
  const normalized = String(value || "").trim();
  return !normalized
    || normalized === DEFAULT_MESSAGE_TEMPLATE.trim()
    || normalized === PREVIOUS_REQUIREMENT_MESSAGE_TEMPLATE.trim()
    || normalized === PREVIOUS_BUG_MESSAGE_TEMPLATE.trim()
    || normalized === HISTORICAL_DEFAULT_MESSAGE_TEMPLATE.trim()
    || normalized === LEGACY_DEFAULT_MESSAGE_TEMPLATE.trim();
}

function defaultTemplateEntry(kind) {
  return {
    customized: false,
    content: kind === "bug" ? DEFAULT_BUG_MESSAGE_TEMPLATE : DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE,
    skill: kind === "bug" ? { ...DEFAULT_BUG_SKILL } : null
  };
}

function normalizeTemplateEntry(kind, incoming, previous, legacyValue, hasLegacyValue) {
  const defaults = defaultTemplateEntry(kind);
  let customized = defaults.customized;
  let content = defaults.content;

  if (incoming && typeof incoming === "object") {
    customized = Boolean(incoming.customized);
    content = customized
      ? normalizeMessageTemplate(incoming.content, defaults.content)
      : defaults.content;
  } else if (hasLegacyValue) {
    customized = !isManagedLegacyTemplate(legacyValue);
    content = customized
      ? normalizeMessageTemplate(legacyValue, defaults.content)
      : defaults.content;
  } else if (previous && typeof previous === "object") {
    customized = Boolean(previous.customized);
    content = customized
      ? normalizeMessageTemplate(previous.content, defaults.content)
      : defaults.content;
  }

  let skill;
  if (incoming && typeof incoming === "object" && hasOwn(incoming, "skill")) {
    skill = normalizeSkillReference(incoming.skill, defaults.skill);
  } else if (previous && typeof previous === "object" && hasOwn(previous, "skill")) {
    skill = normalizeSkillReference(previous.skill, defaults.skill);
  } else {
    skill = normalizeSkillReference(undefined, defaults.skill);
  }
  return { customized, content, skill };
}

function normalizePromptTemplates(input = {}, previous = {}) {
  const incoming = input.promptTemplates && typeof input.promptTemplates === "object"
    ? input.promptTemplates
    : null;
  const prior = previous.promptTemplates && typeof previous.promptTemplates === "object"
    ? previous.promptTemplates
    : null;
  const hasLegacyInput = hasOwn(input, "messageTemplate");
  const hasLegacyPrevious = !prior && hasOwn(previous, "messageTemplate");
  const legacyValue = hasLegacyInput ? input.messageTemplate : previous.messageTemplate;
  const hasLegacyValue = hasLegacyInput || hasLegacyPrevious;
  return {
    requirement: normalizeTemplateEntry(
      "requirement",
      incoming?.requirement,
      prior?.requirement,
      legacyValue,
      hasLegacyValue
    ),
    bug: normalizeTemplateEntry(
      "bug",
      incoming?.bug,
      prior?.bug,
      legacyValue,
      hasLegacyValue
    )
  };
}

function storedPromptTemplates(promptTemplates) {
  return Object.fromEntries(Object.entries(promptTemplates).map(([kind, entry]) => [kind, {
    customized: Boolean(entry.customized),
    content: entry.customized ? entry.content : undefined,
    skill: entry.skill || null
  }]));
}

export function normalizeConfiguration(input, previous = {}) {
  const deployment = "data_center";
  const codexProjectId = String(input.codexProjectId ?? previous.codexProjectId ?? "").trim();
  const codexProjectLabel = String(input.codexProjectLabel ?? previous.codexProjectLabel ?? "").trim();
  const suppliedToken = typeof input.token === "string" ? input.token.trim() : "";
  const token = suppliedToken || String(previous.token || "");
  const jql = String(input.jql ?? previous.jql ?? DEFAULT_JQL).trim() || DEFAULT_JQL;
  const boardSources = normalizeBoardSources(
    input.boardSources,
    previous.boardSources,
    jql
  );
  const promptTemplates = normalizePromptTemplates(input, previous);
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? previous.baseUrl);
  const suppliedWecomWebhook = typeof input.wecomWebhook === "string" ? input.wecomWebhook.trim() : "";
  const wecomWebhook = input.clearWecomWebhook === true
    ? ""
    : normalizeWecomWebhook(suppliedWecomWebhook || previous.wecomWebhook || "");
  const bugMonitorEnabled = Boolean(input.bugMonitorEnabled ?? previous.bugMonitorEnabled ?? false);
  const monitorGeneration = Math.max(0, Number(input.monitorGeneration ?? previous.monitorGeneration ?? 0) || 0);
  const syncSettings = normalizeSyncSettings(input.syncSettings, previous.syncSettings);

  if (!token) {
    throw new ConfigurationError("请填写 Jira Data Center Personal Access Token (PAT)。", { code: "TOKEN_REQUIRED" });
  }
  if (codexProjectId.length > 300 || codexProjectLabel.length > 300) {
    throw new ConfigurationError("Codex 项目标识无效。", { code: "INVALID_CODEX_PROJECT" });
  }

  return {
    deployment,
    baseUrl,
    email: "",
    codexProjectId,
    codexProjectLabel: codexProjectId ? codexProjectLabel : "",
    token,
    jql,
    boardSources,
    promptTemplates,
    messageTemplate: promptTemplates.requirement.content,
    maxResults: normalizeMaxResults(input.maxResults ?? previous.maxResults),
    syncSettings,
    bugMonitorEnabled,
    monitorGeneration,
    wecomWebhook
  };
}

function runPowerShell(script, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout).toString("utf8"));
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(detail || `PowerShell exited with code ${code}`));
    });
    child.stdin.end(input, "utf8");
  });
}

const POWERSHELL_PREFIX = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
`;

async function protectWithDpapi(token) {
  if (process.platform !== "win32") {
    throw new Error("Jira Token 的 DPAPI 存储仅支持 Windows。");
  }
  const script = `${POWERSHELL_PREFIX}
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;
  return (await runPowerShell(script, token)).trim();
}

async function unprotectWithDpapi(ciphertext) {
  if (process.platform !== "win32") {
    throw new Error("Jira Token 的 DPAPI 存储仅支持 Windows。");
  }
  const script = `${POWERSHELL_PREFIX}
$ciphertext = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($ciphertext)
$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
`;
  return runPowerShell(script, ciphertext);
}

function publicConfiguration(record) {
  const managedDefaults = new Set([
    LEGACY_DEFAULT_JQL,
    COLLABORATION_DEFAULT_JQL,
    DASHBOARD_ACTIVE_JQL
  ]);
  const storedJql = managedDefaults.has(record?.jql) ? DEFAULT_JQL : record?.jql;
  const boardSources = normalizeBoardSources(record?.boardSources, {}, storedJql || DEFAULT_JQL);
  const promptTemplates = normalizePromptTemplates({}, {
    promptTemplates: record?.promptTemplates,
    ...(hasOwn(record, "messageTemplate") ? { messageTemplate: record.messageTemplate } : {})
  });
  return {
    configured: Boolean(record?.baseUrl && record?.tokenProtected),
    deployment: "data_center",
    baseUrl: record?.baseUrl || "",
    email: "",
    codexProjectId: record?.codexProjectId || "",
    codexProjectLabel: record?.codexProjectId ? record?.codexProjectLabel || "" : "",
    jql: storedJql || DEFAULT_JQL,
    boardSources,
    promptTemplates,
    messageTemplate: promptTemplates.requirement.content,
    maxResults: record?.maxResults || 100,
    syncSettings: normalizeSyncSettings(record?.syncSettings),
    hasToken: Boolean(record?.tokenProtected),
    bugMonitorEnabled: Boolean(record?.bugMonitorEnabled),
    monitorGeneration: Math.max(0, Number(record?.monitorGeneration || 0)),
    wecomConfigured: Boolean(record?.wecomWebhookProtected),
    credentialStorage: "Windows DPAPI（当前用户）"
  };
}

export function createConfigStore({
  configFile = process.env.JIRA_CODEX_CONFIG_FILE || defaultConfigFile(),
  protect = protectWithDpapi,
  unprotect = unprotectWithDpapi
} = {}) {
  async function readRecord() {
    try {
      return JSON.parse(await readFile(configFile, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new ConfigurationError("本地 Jira 配置文件无法读取。", {
        code: "CONFIG_READ_FAILED",
        statusCode: 500
      });
    }
  }

  async function load() {
    const record = await readRecord();
    if (!record?.tokenProtected) {
      return { ...publicConfiguration(record), token: "" };
    }
    try {
      return {
        ...publicConfiguration(record),
        token: await unprotect(record.tokenProtected),
        wecomWebhook: record.wecomWebhookProtected
          ? await unprotect(record.wecomWebhookProtected)
          : ""
      };
    } catch {
      throw new ConfigurationError("Jira Token 无法由当前 Windows 用户解密，请重新配置。", {
        code: "TOKEN_DECRYPT_FAILED",
        statusCode: 500
      });
    }
  }

  async function prepare(input) {
    return normalizeConfiguration(input, await load());
  }

  async function save(config) {
    const normalized = normalizeConfiguration(config);
    let tokenProtected;
    let wecomWebhookProtected = "";
    try {
      tokenProtected = await protect(normalized.token);
      if (normalized.wecomWebhook) {
        wecomWebhookProtected = await protect(normalized.wecomWebhook);
      }
    } catch {
      throw new ConfigurationError("Jira Token 或企业微信 Webhook 无法写入 Windows DPAPI。", {
        code: "TOKEN_ENCRYPT_FAILED",
        statusCode: 500
      });
    }
    const record = {
      version: 3,
      deployment: normalized.deployment,
      baseUrl: normalized.baseUrl,
      email: normalized.email,
      codexProjectId: normalized.codexProjectId,
      codexProjectLabel: normalized.codexProjectLabel,
      jql: normalized.jql,
      boardSources: normalized.boardSources,
      promptTemplates: storedPromptTemplates(normalized.promptTemplates),
      maxResults: normalized.maxResults,
      syncSettings: normalized.syncSettings,
      bugMonitorEnabled: normalized.bugMonitorEnabled,
      monitorGeneration: normalized.monitorGeneration,
      tokenProtected,
      wecomWebhookProtected: wecomWebhookProtected || undefined,
      updatedAt: new Date().toISOString()
    };
    await mkdir(dirname(configFile), { recursive: true });
    await writeFile(configFile, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return publicConfiguration(record);
  }

  async function clear() {
    await rm(configFile, { force: true });
  }

  async function getPublic() {
    return publicConfiguration(await readRecord());
  }

  async function setBugMonitorEnabled(enabled) {
    const record = await readRecord();
    if (!record?.baseUrl || !record?.tokenProtected) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const nextEnabled = Boolean(enabled);
    const wasEnabled = Boolean(record.bugMonitorEnabled);
    const nextRecord = {
      ...record,
      version: Math.max(3, Number(record.version || 1)),
      bugMonitorEnabled: nextEnabled,
      monitorGeneration: !wasEnabled && nextEnabled
        ? Math.max(0, Number(record.monitorGeneration || 0)) + 1
        : Math.max(0, Number(record.monitorGeneration || 0)),
      updatedAt: new Date().toISOString()
    };
    await mkdir(dirname(configFile), { recursive: true });
    await writeFile(configFile, `${JSON.stringify(nextRecord, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return publicConfiguration(nextRecord);
  }

  return { configFile, load, prepare, save, clear, getPublic, setBugMonitorEnabled };
}
