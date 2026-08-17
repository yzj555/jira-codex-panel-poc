import { createHash } from "node:crypto";
import { ConfigurationError, buildBoardQueries } from "../config-store.mjs";
import { JiraApiError } from "../jira-client.mjs";
import { materializeAttachment } from "./attachment-cache.mjs";

function boardCollaboratorJqlField(boardSources) {
  const fieldId = String(boardSources?.collaboratorFieldId || "").trim();
  const numericId = fieldId.match(/^customfield_(\d+)$/i);
  if (numericId) return `cf[${numericId[1]}]`;
  const displayName = String(boardSources?.collaboratorJqlName || "").trim();
  return displayName ? `"${displayName.replace(/"/g, '\\"')}"` : "";
}

function collaboratorFieldCandidate(field, preferredName = "") {
  if (!field?.id || field.custom === false || field.searchable === false) return false;
  const name = String(field.name || "").trim();
  const preferred = String(preferredName || "").trim().toLowerCase();
  if (preferred && name.toLowerCase() === preferred) return true;
  return /协同\s*(处理|负责|参与)|协作\s*(处理|负责|参与)|collaborat|co-?worker|watcher/i.test(name);
}

function collaboratorFieldCacheKey(config) {
  const baseUrl = String(config?.baseUrl || "").trim().toLowerCase();
  const token = String(config?.token || "");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
  return `${baseUrl}|${tokenHash}`;
}

/**
 * 任务看板数据装配器：集中 Jira 任务板查询、协同字段解析、Filter 校验与
 * Bug 监控附件物化，供 Codex 壳与 core 独立服务复用。依赖通过参数注入，
 * 不接触任何宿主（Codex App Server / CDP）能力。
 */
export function createTaskBoardLoader({
  jira,
  configStore,
  attachmentCacheRoot
} = {}) {
  const boardIssueTypeCache = new Map();
  const collaboratorFieldCache = new Map();

  async function discoverBoardBugTypes(config, boardSources) {
    const builtinRequired = ["requirement", "bug"].some((kind) => boardSources?.[kind]?.mode === "builtin");
    if (!builtinRequired) return [];
    const projectKey = String(boardSources?.projectKey || "").trim().toUpperCase();
    const cacheKey = `${config.baseUrl}|${projectKey}|${boardSources?.collaboratorFieldId || "auto"}`;
    const cached = boardIssueTypeCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) return cached.names;
    const clauses = [];
    if (projectKey) clauses.push(`project = ${projectKey}`);
    const collaboratorField = boardCollaboratorJqlField(boardSources);
    clauses.push(collaboratorField
      ? `(assignee = currentUser() OR ${collaboratorField} = currentUser())`
      : "assignee = currentUser()");
    clauses.push("statusCategory != Done");
    let names = [];
    try {
      const result = await jira.fetchIssues({
        ...config,
        jql: `${clauses.join(" AND ")} ORDER BY updated DESC`
      }, { maxResults: Math.min(Number(config.maxResults || 100), 200) });
      names = [...new Set(result.issues
        .map((issue) => String(issue.typeName || "").trim())
        .filter((name) => /bug|defect|缺陷|故障|错误/i.test(name)))];
    } catch {
      // Type discovery is an optimization. If a project or custom field is not
      // visible, leave the type clause out and let the panel classify results.
    }
    boardIssueTypeCache.set(cacheKey, { names, fetchedAt: Date.now() });
    return names;
  }

  async function resolveCollaboratorFieldConfig(config) {
    const configuredId = String(
      config?.collaboratorFieldId || config?.boardSources?.collaboratorFieldId || ""
    ).trim();
    const baseSources = config?.boardSources && typeof config.boardSources === "object"
      ? config.boardSources
      : {};
    if (configuredId) {
      const cacheKey = collaboratorFieldCacheKey(config);
      const cached = collaboratorFieldCache.get(cacheKey);
      if (cached?.configuredId === configuredId && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
        return cached.config ? { ...config, ...cached.config } : config;
      }
      try {
        const result = await jira.fetchFields(config);
        const exact = result.fields.find((field) => field.id.toLowerCase() === configuredId.toLowerCase());
        const replacement = exact || result.fields.find((field) => collaboratorFieldCandidate(
          field,
          baseSources.collaboratorJqlName
        ));
        if (replacement) {
          const resolved = {
            collaboratorFieldId: replacement.id,
            boardSources: {
              ...baseSources,
              collaboratorFieldId: replacement.id,
              collaboratorJqlName: replacement.name
            }
          };
          collaboratorFieldCache.set(cacheKey, {
            configuredId,
            config: resolved,
            fetchedAt: Date.now()
          });
          return { ...config, ...resolved };
        }
        if (result.fields.length) {
          const cleared = {
            collaboratorFieldId: "",
            boardSources: { ...baseSources, collaboratorFieldId: "", collaboratorJqlName: "" }
          };
          collaboratorFieldCache.set(cacheKey, { configuredId, config: cleared, fetchedAt: Date.now() });
          return { ...config, ...cleared };
        }
        collaboratorFieldCache.set(cacheKey, { configuredId, config: null, fetchedAt: Date.now() });
      } catch {
        // Preserve an explicitly configured field when an older Jira version
        // does not expose /field; the issue endpoint can still return it.
      }
      return {
        ...config,
        collaboratorFieldId: configuredId,
        boardSources: { ...baseSources, collaboratorFieldId: configuredId }
      };
    }
    const cacheKey = collaboratorFieldCacheKey(config);
    const cached = collaboratorFieldCache.get(cacheKey);
    if (cached && !cached.configuredId && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
      return cached.config ? { ...config, ...cached.config } : config;
    }
    try {
      const result = await jira.fetchFields(config);
      const preferredName = baseSources.collaboratorJqlName;
      const field = result.fields.find((candidate) => collaboratorFieldCandidate(candidate, preferredName));
      const resolved = field
        ? {
            collaboratorFieldId: field.id,
            boardSources: {
              ...baseSources,
              collaboratorFieldId: field.id,
              collaboratorJqlName: field.name
            }
          }
        : null;
      collaboratorFieldCache.set(cacheKey, { configuredId: "", config: resolved, fetchedAt: Date.now() });
      return resolved ? { ...config, ...resolved } : config;
    } catch {
      // Field discovery is optional. Built-in boards remain usable with the
      // assignee-only rule when Jira does not expose field metadata.
      collaboratorFieldCache.set(cacheKey, { configuredId: "", config: null, fetchedAt: Date.now() });
      return config;
    }
  }

  async function validateConfiguredFilters(config) {
    const selected = ["requirement", "bug"].flatMap((kind) => (
      config?.boardSources?.[kind]?.mode === "filter"
        ? (config.boardSources[kind].filterIds || []).map(String)
        : []
    ));
    if (!selected.length) return;
    const discovered = await jira.fetchFilters(config, {
      projectKey: config.boardSources?.projectKey || ""
    });
    const available = new Set((discovered.filters || []).map((filter) => String(filter.id)));
    const missing = [...new Set(selected.filter((id) => !available.has(id)))];
    if (missing.length) {
      throw new ConfigurationError(`当前 Jira Token 无法访问所选 Filter：${missing.join(", ")}。请刷新列表后重新选择。`, {
        code: "BOARD_FILTER_UNAVAILABLE"
      });
    }
  }

  async function boardQueriesForConfig(config) {
    const bugTypeNames = await discoverBoardBugTypes(config, config.boardSources);
    return buildBoardQueries(config.boardSources, { bugTypeNames });
  }

  async function loadTaskBoardIssues() {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const effectiveConfig = await resolveCollaboratorFieldConfig(config);
    return effectiveConfig.boardSources?.legacy && effectiveConfig.jql
      ? jira.fetchIssues(effectiveConfig)
      : jira.fetchTaskBoardIssues(effectiveConfig, await boardQueriesForConfig(effectiveConfig));
  }

  async function materializeBugMonitorAttachments(issue, config) {
    const attachmentSources = [{ issue, label: "当前执行单" }];
    if (issue?.parentIssue?.key) attachmentSources.push({ issue: issue.parentIssue, label: "父级关联单" });
    const attachments = attachmentSources.flatMap((source) => (
      Array.isArray(source.issue?.attachments)
        ? source.issue.attachments.map((attachment) => ({
          ...attachment,
          sourceIssueKey: String(source.issue.key || attachment?.sourceIssueKey || ""),
          sourceLabel: source.label
        }))
        : []
    ));
    const materialized = [];
    const failures = [];
    const seen = new Set();
    for (const descriptor of attachments) {
      const attachmentId = String(descriptor?.id || "").trim();
      if (!/^\d+$/.test(attachmentId) || seen.has(attachmentId)) continue;
      seen.add(attachmentId);
      try {
        const attachment = await jira.fetchAttachment(config, attachmentId);
        const cached = await materializeAttachment({
          cacheRoot: attachmentCacheRoot,
          attachmentId,
          attachment
        });
        materialized.push({
          path: cached.path,
          label: `[${descriptor.sourceLabel} ${descriptor.sourceIssueKey}] ${cached.filename}`,
          mimeType: cached.mimeType,
          sourceIssueKey: descriptor.sourceIssueKey
        });
      } catch (error) {
        failures.push({
          attachmentId,
          sourceIssueKey: descriptor.sourceIssueKey,
          message: String(error?.message || error)
        });
      }
    }
    const blockingFailures = failures.filter((failure) => failure.sourceIssueKey === String(issue?.key || ""));
    if (blockingFailures.length) {
      throw new JiraApiError(
        `当前执行单的 Jira 附件未能完整下载（${blockingFailures.map((failure) => failure.attachmentId).join("、")}），未创建缺少材料的分析会话。`,
        { code: "JIRA_ATTACHMENTS_INCOMPLETE", details: { failures: blockingFailures } }
      );
    }
    return materialized;
  }

  return {
    resolveCollaboratorFieldConfig,
    validateConfiguredFilters,
    loadTaskBoardIssues,
    materializeBugMonitorAttachments
  };
}
