import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_MESSAGE_TEMPLATE } from "./public/prompt-builder.js";

export { DEFAULT_MESSAGE_TEMPLATE } from "./public/prompt-builder.js";

export const LEGACY_DEFAULT_JQL = "assignee = currentUser() ORDER BY updated DESC";
export const COLLABORATION_DEFAULT_JQL = '(assignee = currentUser() OR "协同处理人" = currentUser()) ORDER BY updated DESC';
export const DASHBOARD_ACTIVE_JQL = "(filter = 10103 OR filter = 10102) ORDER BY updated DESC";
export const DASHBOARD_COMPLETED_JQL = 'project = CT AND statusCategory = Done AND (assignee = currentUser() OR "协同处理人" = currentUser()) ORDER BY updated DESC';
export const DEFAULT_JQL = '((filter = 10103 OR filter = 10102) OR (project = CT AND statusCategory = Done AND (assignee = currentUser() OR "协同处理人" = currentUser()))) ORDER BY updated DESC';
export class ConfigurationError extends Error {
  constructor(message, { code = "INVALID_CONFIGURATION", statusCode = 400 } = {}) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
    this.statusCode = statusCode;
  }
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

function normalizeMessageTemplate(value) {
  const template = String(value ?? DEFAULT_MESSAGE_TEMPLATE).trim() || DEFAULT_MESSAGE_TEMPLATE;
  if (template.length > 12_000) {
    throw new ConfigurationError("对话消息模板不能超过 12000 个字符。", { code: "MESSAGE_TEMPLATE_TOO_LONG" });
  }
  return template;
}

export function normalizeConfiguration(input, previous = {}) {
  const deployment = "data_center";
  const codexProjectId = String(input.codexProjectId ?? previous.codexProjectId ?? "").trim();
  const codexProjectLabel = String(input.codexProjectLabel ?? previous.codexProjectLabel ?? "").trim();
  const suppliedToken = typeof input.token === "string" ? input.token.trim() : "";
  const token = suppliedToken || String(previous.token || "");
  const jql = String(input.jql ?? previous.jql ?? DEFAULT_JQL).trim() || DEFAULT_JQL;
  const messageTemplate = normalizeMessageTemplate(input.messageTemplate ?? previous.messageTemplate);
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? previous.baseUrl);
  const suppliedWecomWebhook = typeof input.wecomWebhook === "string" ? input.wecomWebhook.trim() : "";
  const wecomWebhook = input.clearWecomWebhook === true
    ? ""
    : normalizeWecomWebhook(suppliedWecomWebhook || previous.wecomWebhook || "");
  const bugMonitorEnabled = Boolean(input.bugMonitorEnabled ?? previous.bugMonitorEnabled ?? false);
  const monitorGeneration = Math.max(0, Number(input.monitorGeneration ?? previous.monitorGeneration ?? 0) || 0);

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
    messageTemplate,
    maxResults: normalizeMaxResults(input.maxResults ?? previous.maxResults),
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
  return {
    configured: Boolean(record?.baseUrl && record?.tokenProtected),
    deployment: "data_center",
    baseUrl: record?.baseUrl || "",
    email: "",
    codexProjectId: record?.codexProjectId || "",
    codexProjectLabel: record?.codexProjectId ? record?.codexProjectLabel || "" : "",
    jql: storedJql || DEFAULT_JQL,
    messageTemplate: record?.messageTemplate || DEFAULT_MESSAGE_TEMPLATE,
    maxResults: record?.maxResults || 100,
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
      version: 2,
      deployment: normalized.deployment,
      baseUrl: normalized.baseUrl,
      email: normalized.email,
      codexProjectId: normalized.codexProjectId,
      codexProjectLabel: normalized.codexProjectLabel,
      jql: normalized.jql,
      messageTemplate: normalized.messageTemplate,
      maxResults: normalized.maxResults,
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
      version: Math.max(2, Number(record.version || 1)),
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
