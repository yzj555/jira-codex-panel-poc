import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildIssueDetailSnapshot, buildIssuePrompt, isBugIssue } from "@jira-workbench/core/index.mjs";

const FIRST_TURN_GUARD = "【首轮约束】本轮只能进行需求理解、诊断分析和影响评估；禁止修改代码、配置、文件或数据，禁止执行提交。";
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export class DshAnalysisServiceError extends Error {
  constructor(message, { code = "DSH_ANALYSIS_SERVICE_ERROR", statusCode = 400, details } = {}) {
    super(message);
    this.name = "DshAnalysisServiceError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

function normalizeIssueKey(value) {
  const issueKey = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
    throw new DshAnalysisServiceError("Jira Issue Key 无效。", {
      code: "INVALID_ISSUE_KEY",
      statusCode: 400
    });
  }
  return issueKey;
}

function rpcRequest(prefix, payload) {
  return {
    rpcId: `jira-workbench-${prefix}-${randomUUID()}`,
    payload
  };
}

async function requireRpcResult(promise, operation, { sessionId = "" } = {}) {
  const response = await promise;
  if (response?.result?.ok) return response.result.value;
  const error = response?.result?.error || {};
  throw new DshAnalysisServiceError(`${operation}失败：${error.message || "DSH Host 未返回成功回执。"}`, {
    code: String(error.code || "DSH_HOST_OPERATION_FAILED").toUpperCase().replaceAll("-", "_"),
    statusCode: error.code === "session-not-found" ? 404 : 503,
    details: {
      ...(sessionId ? { sessionId } : {}),
      hostError: error
    }
  });
}

function requireApiProxy(ctx) {
  const apiProxy = ctx?.get?.("apiProxy");
  if (!apiProxy?.sessions?.create || !apiProxy?.sessions?.prompt) {
    throw new DshAnalysisServiceError("DSH 会话服务暂不可用，请稍后重试。", {
      code: "DSH_API_PROXY_UNAVAILABLE",
      statusCode: 503
    });
  }
  return apiProxy;
}

function chooseProjectScope(workspaceState, requestedScopeId) {
  const workspace = workspaceState?.binding?.workspace;
  const scopes = Array.isArray(workspace?.projectScopes) ? workspace.projectScopes : [];
  if (!scopes.length) {
    throw new DshAnalysisServiceError("请先为当前 Jira 绑定一个 DSH 项目，再创建分析会话。", {
      code: "DSH_ANALYSIS_PROJECT_REQUIRED",
      statusCode: 409
    });
  }
  const requested = String(requestedScopeId || "").trim();
  const preferredId = requested || String(workspace.defaultProjectScopeId || "").trim();
  const selected = scopes.find((scope) => String(scope?.id || "") === preferredId) || (!requested ? scopes[0] : null);
  if (!selected) {
    throw new DshAnalysisServiceError("所选项目已不在当前 Jira 的项目绑定中，请刷新后重新选择。", {
      code: "DSH_ANALYSIS_PROJECT_NOT_BOUND",
      statusCode: 409,
      details: { projectScopeId: requested }
    });
  }
  return selected;
}

function resolveDshWorkspace(ctx, scope) {
  const registry = ctx?.get?.("workspaceRegistry");
  const entries = typeof registry?.list === "function" ? registry.list() : [];
  const projectId = String(scope?.projectId || "").trim().toLowerCase();
  const cwd = String(scope?.cwd || "").trim().toLowerCase();
  const workspace = entries.find((entry) => projectId && String(entry?.id || "").trim().toLowerCase() === projectId)
    || entries.find((entry) => cwd && String(entry?.path || "").trim().toLowerCase() === cwd);
  if (!workspace) {
    throw new DshAnalysisServiceError("绑定的项目已不在 DSH 项目列表中，请刷新项目绑定后重试。", {
      code: "DSH_ANALYSIS_WORKSPACE_NOT_FOUND",
      statusCode: 409,
      details: { projectScopeId: String(scope?.id || ""), projectId: String(scope?.projectId || ""), cwd: String(scope?.cwd || "") }
    });
  }
  return workspace;
}

async function availableSkills(apiProxy, sessionId) {
  if (typeof apiProxy?.skills?.list !== "function") return [];
  try {
    const result = await requireRpcResult(
      apiProxy.skills.list(rpcRequest("skills", { sessionId })),
      "读取 DSH Skill",
      { sessionId }
    );
    return Array.isArray(result?.skills) ? result.skills : [];
  } catch {
    // Skill 是增强能力；目录暂不可用时必须降级到模板，而不是阻断已创建会话。
    return [];
  }
}

function analysisMessage(issue, config, skills, supplementalDescription) {
  const kind = isBugIssue(issue) ? "bug" : "requirement";
  const template = config?.promptTemplates?.[kind] || {};
  const configuredSkillName = String(template?.skill?.name || "").trim();
  const configuredSkill = configuredSkillName
    ? skills.find((skill) => String(skill?.name || "") === configuredSkillName)
    : null;
  const fallbackSkill = configuredSkill ? null : skills.find((skill) => String(skill?.name || "") === "jira-first-turn-analysis");
  const selectedSkill = configuredSkill || fallbackSkill || null;
  const fallbackNotice = configuredSkillName && !configuredSkill
    ? `绑定 Skill“${configuredSkillName}”在所选 DSH 项目中不可用，已降级为 Jira 分析模板。`
    : "";
  const prompt = buildIssuePrompt(issue, {
    messageTemplate: template.content || config?.messageTemplate || "",
    includeAnalysisInstructions: !selectedSkill,
    supplementalDescription,
    fallbackNotice
  });
  return {
    text: [selectedSkill ? `/${selectedSkill.name}` : "", FIRST_TURN_GUARD, prompt].filter(Boolean).join("\n\n"),
    skill: selectedSkill ? { name: selectedSkill.name, source: configuredSkill ? "configured" : "fallback" } : null
  };
}

async function promptImageParts(materialized) {
  const parts = [];
  for (const attachment of Array.isArray(materialized) ? materialized : []) {
    const mediaType = String(attachment?.mimeType || "").toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mediaType) || !attachment?.path) continue;
    parts.push({
      type: "image",
      mediaType,
      data: (await readFile(attachment.path)).toString("base64"),
      name: String(attachment.label || "Jira 图片附件")
    });
  }
  return parts;
}

export function createDshAnalysisService({
  ctx,
  workbench,
  configStore,
  taskBoardLoader,
  issueBindings,
  workspaceBindings
} = {}) {
  if (!ctx || typeof ctx.get !== "function") throw new TypeError("ctx is required.");
  if (!workbench || typeof workbench.getIssue !== "function") throw new TypeError("workbench is required.");
  if (!configStore || typeof configStore.load !== "function") throw new TypeError("configStore is required.");
  if (!issueBindings || typeof issueBindings.snapshot !== "function") throw new TypeError("issueBindings is required.");
  if (!workspaceBindings || typeof workspaceBindings.get !== "function") throw new TypeError("workspaceBindings is required.");

  async function createIssueAnalysis(issueKey, supplementalDescription = "", {
    expectedRevision,
    projectScopeId = ""
  } = {}) {
    const key = normalizeIssueKey(issueKey);
    const supplement = String(supplementalDescription || "").trim();
    if (supplement.length > 4_000) {
      throw new DshAnalysisServiceError("补充说明不能超过 4000 个字符。", {
        code: "DSH_ANALYSIS_SUPPLEMENT_TOO_LONG",
        statusCode: 400
      });
    }
    const bindingState = await issueBindings.snapshot();
    const baselineRevision = expectedRevision == null ? Number(bindingState.revision || 0) : Number(expectedRevision);
    if (!Number.isInteger(baselineRevision) || baselineRevision < 0) {
      throw new DshAnalysisServiceError("会话绑定 revision 无效，请刷新后重试。", {
        code: "ISSUE_BINDINGS_REVISION_INVALID",
        statusCode: 400
      });
    }
    if (baselineRevision !== Number(bindingState.revision || 0)) {
      throw new DshAnalysisServiceError("会话关联已在其他位置更新，请刷新后重新确认。", {
        code: "ISSUE_BINDINGS_REVISION_CONFLICT",
        statusCode: 409,
        details: { stage: "before_create", expectedRevision: baselineRevision, currentRevision: bindingState.revision }
      });
    }

    const [workspaceState, issueResult, config] = await Promise.all([
      workspaceBindings.get(key),
      workbench.getIssue(key),
      configStore.load()
    ]);
    const scope = chooseProjectScope(workspaceState, projectScopeId);
    const workspace = resolveDshWorkspace(ctx, scope);
    const issue = issueResult?.issue;
    if (!issue) {
      throw new DshAnalysisServiceError("Jira 未返回可用于分析的单子详情。", {
        code: "JIRA_ISSUE_CONTEXT_UNAVAILABLE",
        statusCode: 502
      });
    }

    // Jira 上下文与附件必须在创建会话前准备完整；下载失败时不留下空白 DSH 会话。
    const attachments = typeof taskBoardLoader?.materializeBugMonitorAttachments === "function"
      ? await taskBoardLoader.materializeBugMonitorAttachments(issue, config)
      : [];
    const imageParts = await promptImageParts(attachments);

    const apiProxy = requireApiProxy(ctx);
    const created = await requireRpcResult(
      apiProxy.sessions.create(rpcRequest("create", { workspaceId: String(workspace.id) })),
      "创建 DSH 会话"
    );
    const sessionId = String(created?.sessionId || "").trim();
    if (!sessionId) {
      throw new DshAnalysisServiceError("DSH 未返回正式会话 ID，未保存 Jira 关联。", {
        code: "DSH_SESSION_ID_UNRESOLVED",
        statusCode: 503
      });
    }

    const skills = await availableSkills(apiProxy, sessionId);
    const message = analysisMessage(issue, config, skills, supplement);
    const content = [{ type: "text", text: message.text }, ...imageParts];
    await requireRpcResult(
      apiProxy.sessions.prompt(rpcRequest("prompt", { sessionId, mode: "queue", content })),
      "发送首条只读分析消息",
      { sessionId }
    );

    const title = [`分析 ${key}`, issue.title || ""].filter(Boolean).join(" ").slice(0, 180);
    if (typeof apiProxy.sessions.rename === "function") {
      try {
        await requireRpcResult(
          apiProxy.sessions.rename(rpcRequest("rename", { sessionId, title })),
          "设置 DSH 会话标题",
          { sessionId }
        );
      } catch {
        // 标题不影响已被 Host 接受的首轮消息；DSH 自身仍可生成标题。
      }
    }

    const boundAt = new Date().toISOString();
    const binding = {
      threadId: sessionId,
      threadTitle: title,
      title,
      issueTitle: String(issue.title || ""),
      runtimeOwner: "dsh",
      hostReference: "dsh-session",
      firstMessageStatus: "sent",
      firstMessageUpdatedAt: boundAt,
      boundAt,
      updatedAt: boundAt
    };
    let next;
    try {
      const mutate = typeof issueBindings.compareAndSwap === "function"
        ? issueBindings.compareAndSwap.bind(issueBindings)
        : issueBindings.applyMutations.bind(issueBindings);
      next = await mutate({ expectedRevision: baselineRevision, upserts: { [key]: binding } });
    } catch (error) {
      if (error?.code !== "ISSUE_BINDINGS_REVISION_CONFLICT") throw error;
      const current = await issueBindings.snapshot();
      throw new DshAnalysisServiceError(
        "DSH 分析会话已经创建并收到首条消息，但关联关系同时发生了变化，因此没有覆盖现有绑定。请在“绑定已有会话”中选择该新会话。",
        {
          code: "ISSUE_ANALYSIS_CREATED_UNBOUND",
          statusCode: 409,
          details: {
            stage: "created_unbound",
            issueKey: key,
            sessionId,
            threadId: sessionId,
            expectedRevision: baselineRevision,
            currentRevision: current.revision
          }
        }
      );
    }

    const storedBinding = next.bindings?.[key] || binding;
    return {
      issueKey: key,
      threadId: sessionId,
      sessionId,
      binding: storedBinding,
      bindingsRevision: next.revision,
      projectScopeId: String(scope.id || ""),
      workspaceId: String(workspace.id || ""),
      selectedSkill: message.skill,
      imageAttachmentCount: content.filter((part) => part.type === "image").length,
      issueSnapshot: buildIssueDetailSnapshot({
        issue,
        binding: storedBinding,
        bindingsRevision: next.revision
      })
    };
  }

  return {
    hostName: "DSH",
    createIssueAnalysis
  };
}
