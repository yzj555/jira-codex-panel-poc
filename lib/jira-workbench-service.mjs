import { ConfigurationError } from "../config-store.mjs";
import { JiraApiError } from "../jira-client.mjs";

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is required.`);
  return value;
}

function normalizeIssueKey(value) {
  const key = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
    throw new JiraApiError("Jira Issue Key 无效。", {
      code: "INVALID_ISSUE_KEY",
      upstreamStatus: 400
    });
  }
  return key;
}

function normalizeSheetIdentity({ projectId, sheetId } = {}) {
  const project = String(projectId || "").trim();
  const sheet = String(sheetId || "").trim();
  if (!/^\d+$/.test(project) || !/^[A-Za-z0-9_-]{1,80}$/.test(sheet)) {
    throw new JiraApiError("JXL Sheet 标识无效。", {
      code: "INVALID_JXL_SHEET_ID",
      upstreamStatus: 400
    });
  }
  return { projectId: project, sheetId: sheet };
}

function configured(config) {
  if (config?.configured && config?.token) return config;
  throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
    code: "JIRA_NOT_CONFIGURED",
    statusCode: 428
  });
}

async function readAttachmentBytes(body, maxBytes) {
  if (!body?.getReader) throw new JiraApiError("Jira 附件没有可读取的内容。", { code: "JIRA_ATTACHMENT_BODY_MISSING" });
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        throw new JiraApiError("附件预览超过 5 MB，请在 Jira 中查看原文件。", {
          code: "JIRA_ATTACHMENT_PREVIEW_TOO_LARGE",
          upstreamStatus: 413
        });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, size);
}

/**
 * Stable application-facing facade shared by the embedded HTTP panel and the
 * official MCP tools. Keeping Jira/JXL/binding joins here prevents the two UI
 * hosts from developing subtly different filtering and authorization rules.
 */
export function createJiraWorkbenchService({
  loadIssues,
  loadConfig,
  resolveConfig = async (config) => config,
  jira,
  jxl,
  issueBindings
} = {}) {
  const readIssues = requireFunction(loadIssues, "loadIssues");
  const readConfig = requireFunction(loadConfig, "loadConfig");
  const resolve = requireFunction(resolveConfig, "resolveConfig");
  const jiraClient = requireObject(jira, "jira");
  const jxlClient = requireObject(jxl, "jxl");
  const bindings = requireObject(issueBindings, "issueBindings");

  async function effectiveConfig() {
    return resolve(configured(await readConfig()));
  }

  async function listTasks() {
    const [result, bindingState] = await Promise.all([
      readIssues(),
      bindings.snapshot()
    ]);
    return {
      ...result,
      bindingState
    };
  }

  async function getIssue(issueKey) {
    const key = normalizeIssueKey(issueKey);
    const [config, bindingState] = await Promise.all([
      effectiveConfig(),
      bindings.snapshot()
    ]);
    return {
      issue: await jiraClient.fetchIssue(config, key),
      binding: bindingState.bindings?.[key] || null,
      bindingsRevision: Number(bindingState.revision || 0),
      fetchedAt: new Date().toISOString()
    };
  }

  async function getAttachmentPreview(issueKey, attachmentId) {
    const key = normalizeIssueKey(issueKey);
    const id = String(attachmentId || "").trim();
    if (!/^\d+$/.test(id)) {
      throw new JiraApiError("附件 ID 无效。", { code: "INVALID_ATTACHMENT_ID", upstreamStatus: 400 });
    }
    const config = await effectiveConfig();
    const issue = await jiraClient.fetchIssue(config, key);
    const metadata = (issue.attachments || []).find((attachment) => String(attachment?.id || "") === id);
    if (!metadata) {
      throw new JiraApiError("该附件不属于当前 Jira 任务或已被删除。", {
        code: "JIRA_ATTACHMENT_NOT_IN_ISSUE",
        upstreamStatus: 404
      });
    }
    if (!/^image\//i.test(String(metadata.mimeType || ""))) {
      throw new JiraApiError("当前官方工作台只内嵌预览图片附件，请在 Jira 中查看此文件。", {
        code: "JIRA_ATTACHMENT_PREVIEW_UNSUPPORTED",
        upstreamStatus: 415
      });
    }
    const attachment = await jiraClient.fetchAttachment(config, id, { thumbnail: true });
    if (!/^image\//i.test(String(attachment.contentType || ""))) {
      await attachment.body?.cancel?.().catch(() => {});
      throw new JiraApiError("Jira 返回的附件内容不是图片，已拒绝内嵌。", {
        code: "JIRA_ATTACHMENT_CONTENT_TYPE_MISMATCH",
        upstreamStatus: 415
      });
    }
    const declaredSize = Number(attachment.contentLength || 0);
    if (declaredSize > 5 * 1024 * 1024) {
      await attachment.body?.cancel?.().catch(() => {});
      throw new JiraApiError("附件预览超过 5 MB，请在 Jira 中查看原文件。", {
        code: "JIRA_ATTACHMENT_PREVIEW_TOO_LARGE",
        upstreamStatus: 413
      });
    }
    const bytes = await readAttachmentBytes(attachment.body, 5 * 1024 * 1024);
    return {
      issueKey: key,
      attachmentId: id,
      filename: String(attachment.filename || metadata.filename || `attachment-${id}`),
      mimeType: String(attachment.contentType || metadata.mimeType || "image/png"),
      size: bytes.length,
      thumbnail: attachment.thumbnail === true,
      dataUrl: `data:${attachment.contentType};base64,${bytes.toString("base64")}`
    };
  }

  async function listSheets() {
    return jxlClient.listSheets(await effectiveConfig());
  }

  async function getSheetIssues(identity) {
    const { projectId, sheetId } = normalizeSheetIdentity(identity);
    const config = await effectiveConfig();
    const sheet = await jxlClient.getSheet(config, { projectId, sheetId });
    if (!sheet) {
      throw new JiraApiError("JXL Sheet 不存在或当前用户无权查看。", {
        code: "JXL_SHEET_NOT_FOUND",
        upstreamStatus: 404
      });
    }
    if (sheet._scope?.type !== "jql" || !sheet._scope.value) {
      throw new JiraApiError("当前 JXL Sheet 不是 JQL 范围，暂时只能在 Jira 中打开。", {
        code: "JXL_SCOPE_UNSUPPORTED",
        upstreamStatus: 400
      });
    }
    const { _scope, ...sheetInfo } = sheet;
    const [result, bindingState] = await Promise.all([
      jiraClient.fetchIssues({ ...config, jql: _scope.value }),
      bindings.snapshot()
    ]);
    return {
      ...result,
      sheet: sheetInfo,
      bindingState
    };
  }

  async function getBindings() {
    return bindings.snapshot();
  }

  async function listTransitions(issueKey) {
    return jiraClient.fetchTransitions(await effectiveConfig(), normalizeIssueKey(issueKey));
  }

  async function executeTransition(issueKey, transitionId) {
    return jiraClient.executeTransition(
      await effectiveConfig(),
      normalizeIssueKey(issueKey),
      String(transitionId || "").trim()
    );
  }

  async function updateBindings(mutations) {
    return bindings.applyMutations(mutations);
  }

  return {
    listTasks,
    getIssue,
    getAttachmentPreview,
    listSheets,
    getSheetIssues,
    getBindings,
    listTransitions,
    executeTransition,
    updateBindings
  };
}
