import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { buildIssueDetailSnapshot, buildIssuePrompt, isBugIssue } from "@jira-workbench/core/index.mjs";
import { createDshImageContextService } from "./dsh-image-context-service.mjs";

const FIRST_TURN_GUARD = "【首轮约束】本轮只能进行需求理解、诊断分析和影响评估；禁止修改代码、配置、文件或数据，禁止执行提交。";
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

function bindingThreadId(state, issueKey) {
  return String(state?.bindings?.[issueKey]?.threadId || "").trim();
}

function rpcRequest(prefix, payload) {
  return {
    rpcId: `jira-workbench-${prefix}-${randomUUID()}`,
    payload
  };
}

function imageProcessingRoute(config) {
  const provider = String(config?.imageProcessing?.visionProvider || "").trim();
  const model = String(config?.imageProcessing?.visionModel || "").trim();
  return provider && model ? { provider, model } : null;
}

function containsImageAttachment(attachments) {
  return (Array.isArray(attachments) ? attachments : []).some((attachment) => (
    IMAGE_MIME_TYPES.has(String(attachment?.mimeType || "").toLowerCase())
      && Boolean(String(attachment?.path || "").trim())
  ));
}

async function routeSupportsImages(ctx, route) {
  const llm = ctx?.get?.("llm");
  if (!llm?.resolveModelInfo || !route?.provider || !route?.model) return null;
  try {
    const info = await llm.resolveModelInfo(route.provider, route.model);
    return Array.isArray(info?.inputModalities) ? info.inputModalities.includes("image") : null;
  } catch {
    return null;
  }
}

async function restoreDefaultModelSelection(ctx, selection) {
  const defaults = ctx?.get?.("agentDefaultModel");
  if (typeof defaults?.saveSelection !== "function") {
    return { restored: false, reason: "unsupported" };
  }
  try {
    await defaults.saveSelection(selection);
    return { restored: true };
  } catch (error) {
    return { restored: false, reason: String(error?.code || error?.name || "restore-failed") };
  }
}

async function selectVisualRouteForNativeImage({
  ctx,
  apiProxy,
  sessionId,
  config,
  attachments,
  afterAdmissionFailure = false
} = {}) {
  const route = imageProcessingRoute(config);
  if (!route || !containsImageAttachment(attachments)) return { switched: false, reason: "not-needed" };
  if (!apiProxy?.sessions?.models || !apiProxy?.sessions?.selectModel) {
    return { switched: false, reason: "unsupported" };
  }
  if (typeof ctx?.get?.("agentDefaultModel")?.saveSelection !== "function") {
    return { switched: false, reason: "default-model-service-unsupported" };
  }
  try {
    const catalog = await apiProxy.sessions.models(rpcRequest("models-before-image", { sessionId }));
    if (catalog?.result?.ok !== true) {
      return { switched: false, reason: String(catalog?.result?.error?.code || "models-failed") };
    }
    const current = catalog.result.value?.current || {};
    const original = {
      provider: String(current.provider || "").trim(),
      model: String(current.model || "").trim(),
      ...(String(current.reasoningEffort || "").trim()
        ? { reasoningEffort: String(current.reasoningEffort).trim() }
        : {})
    };
    if (!original.provider || !original.model) return { switched: false, reason: "current-model-missing" };
    if (original.provider === route.provider && original.model === route.model) {
      return { switched: false, reason: "already-selected", route };
    }
    const [currentSupportsImages, visualSupportsImages] = await Promise.all([
      routeSupportsImages(ctx, original),
      routeSupportsImages(ctx, route)
    ]);
    if (visualSupportsImages === false) return { switched: false, reason: "visual-model-text-only" };
    if (!afterAdmissionFailure && currentSupportsImages !== false) {
      return {
        switched: false,
        reason: currentSupportsImages === true ? "current-model-supports-images" : "current-model-unknown"
      };
    }
    const selected = await apiProxy.sessions.selectModel(rpcRequest("select-image-model", {
      sessionId,
      provider: route.provider,
      model: route.model
    }));
    if (selected?.result?.ok !== true) {
      return { switched: false, reason: String(selected?.result?.error?.code || "select-failed") };
    }
    const defaultRestore = await restoreDefaultModelSelection(ctx, original);
    if (!defaultRestore.restored) {
      // session.selectModel also changes DSH's default for future sessions. If
      // that global preference cannot be put back safely, undo this session
      // switch before any image is admitted and keep the existing fallback.
      const undone = await apiProxy.sessions.selectModel(rpcRequest("undo-image-model", {
        sessionId,
        ...original
      }));
      if (undone?.result?.ok === true) {
        return { switched: false, reason: `default-${defaultRestore.reason}` };
      }
      return {
        switched: true,
        original,
        route,
        defaultRestored: false,
        warning: `default-${defaultRestore.reason};undo-${String(undone?.result?.error?.code || "failed")}`
      };
    }
    return { switched: true, original, route, defaultRestored: true };
  } catch (error) {
    return { switched: false, reason: String(error?.code || error?.name || "select-failed") };
  }
}

async function restoreModelImmediately(apiProxy, sessionId, routing) {
  if (!routing?.switched || !apiProxy?.sessions?.selectModel) return;
  try {
    await apiProxy.sessions.selectModel(rpcRequest("restore-model-after-failure", {
      sessionId,
      ...routing.original
    }));
  } catch {
    // The original prompt did not land, so restoration is best effort. The
    // session remains visible and the user can still select a model manually.
  }
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

function isAttachmentAdmissionError(response) {
  return response?.result?.ok === false && response.result.error?.code === "attachment-error";
}

function messageWithImageContext(message, imageContext) {
  const textContext = String(imageContext?.textContext || "").trim();
  return textContext ? `${message.text}\n\n${textContext}` : message.text;
}

export function createDshAnalysisService({
  ctx,
  workbench,
  configStore,
  taskBoardLoader,
  issueBindings,
  workspaceBindings,
  imageContextService
} = {}) {
  if (!ctx || typeof ctx.get !== "function") throw new TypeError("ctx is required.");
  if (!workbench || typeof workbench.getIssue !== "function") throw new TypeError("workbench is required.");
  if (!configStore || typeof configStore.load !== "function") throw new TypeError("configStore is required.");
  if (!issueBindings || typeof issueBindings.snapshot !== "function") throw new TypeError("issueBindings is required.");
  if (!workspaceBindings || typeof workspaceBindings.get !== "function") throw new TypeError("workspaceBindings is required.");
  const images = imageContextService || createDshImageContextService({
    ctx,
    cacheRoot: join(dirname(String(configStore.configFile || join(process.cwd(), "config.json"))), "image-context-cache")
  });

  async function createIssueAnalysis(issueKey, supplementalDescription = "", {
    expectedRevision,
    expectedThreadId,
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
    const currentRevision = Number(bindingState.revision || 0);
    let baselineRevision = expectedRevision == null ? currentRevision : Number(expectedRevision);
    const hasExpectedThreadId = expectedThreadId !== undefined && expectedThreadId !== null;
    const expectedTargetThreadId = hasExpectedThreadId
      ? String(expectedThreadId || "").trim()
      : bindingThreadId(bindingState, key);
    if (!Number.isInteger(baselineRevision) || baselineRevision < 0) {
      throw new DshAnalysisServiceError("会话绑定 revision 无效，请刷新后重试。", {
        code: "ISSUE_BINDINGS_REVISION_INVALID",
        statusCode: 400
      });
    }
    if (baselineRevision !== currentRevision) {
      // issue-bindings.json uses one global revision. A different Jira being
      // bound must not block this issue as long as this issue's own binding is
      // still exactly what the UI reviewed.
      if (!hasExpectedThreadId || bindingThreadId(bindingState, key) !== expectedTargetThreadId) {
        throw new DshAnalysisServiceError("会话关联已在其他位置更新，请刷新后重新确认。", {
          code: "ISSUE_BINDINGS_REVISION_CONFLICT",
          statusCode: 409,
          details: { stage: "before_create", expectedRevision: baselineRevision, currentRevision: bindingState.revision }
        });
      }
      baselineRevision = currentRevision;
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
    let modelRouting = await selectVisualRouteForNativeImage({
      ctx,
      apiProxy,
      sessionId,
      config,
      attachments
    });
    let imageContext = await images.prepare({ sessionId, attachments, config });
    let content = [
      { type: "text", text: messageWithImageContext(message, imageContext) },
      ...(Array.isArray(imageContext?.imageParts) ? imageContext.imageParts : [])
    ];
    let promptRequest = rpcRequest("prompt", {
      sessionId,
      mode: "queue",
      content
    });
    let promptResponse = await apiProxy.sessions.prompt(promptRequest);
    if (imageContext?.mode === "native" && isAttachmentAdmissionError(promptResponse)) {
      // An unknown current model may only reveal its text-only limitation at
      // Host admission. That rejection happens before the message is stored,
      // so it is safe to select the configured visual route and retry the same
      // native image exactly once.
      if (!modelRouting.switched) {
        const lateRouting = await selectVisualRouteForNativeImage({
          ctx,
          apiProxy,
          sessionId,
          config,
          attachments,
          afterAdmissionFailure: true
        });
        if (lateRouting.switched) {
          modelRouting = lateRouting;
          imageContext = await images.prepare({ sessionId, attachments, config });
          content = [
            { type: "text", text: messageWithImageContext(message, imageContext) },
            ...(Array.isArray(imageContext?.imageParts) ? imageContext.imageParts : [])
          ];
          promptRequest = rpcRequest("prompt-visual-model", { sessionId, mode: "queue", content });
          promptResponse = await apiProxy.sessions.prompt(promptRequest);
        }
      }
      if (isAttachmentAdmissionError(promptResponse)) {
        // The configured route also rejected the original image, or the Host
        // cannot switch models. Keep the existing compatibility chain as the
        // final non-blocking fallback.
        imageContext = await images.prepare({ sessionId, attachments, config, forceFallback: true });
        content = [{ type: "text", text: messageWithImageContext(message, imageContext) }];
        promptRequest = rpcRequest("prompt-fallback", { sessionId, mode: "queue", content });
        promptResponse = await apiProxy.sessions.prompt(promptRequest);
      }
    }
    try {
      await requireRpcResult(
        Promise.resolve(promptResponse),
        "发送首条只读分析消息",
        { sessionId }
      );
    } catch (error) {
      await restoreModelImmediately(apiProxy, sessionId, modelRouting);
      throw error;
    }
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
    const mutate = typeof issueBindings.compareAndSwap === "function"
      ? issueBindings.compareAndSwap.bind(issueBindings)
      : issueBindings.applyMutations.bind(issueBindings);
    let next;
    let attemptedRevision = baselineRevision;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        next = await mutate({ expectedRevision: attemptedRevision, upserts: { [key]: binding } });
        break;
      } catch (error) {
        if (error?.code !== "ISSUE_BINDINGS_REVISION_CONFLICT") throw error;
        const current = await issueBindings.snapshot();
        if (bindingThreadId(current, key) === expectedTargetThreadId && attempt < 2) {
          attemptedRevision = Number(current.revision || 0);
          continue;
        }
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
              expectedRevision: attemptedRevision,
              currentRevision: current.revision
            }
          }
        );
      }
    }
    if (!next) throw new DshAnalysisServiceError("DSH 会话已创建，但保存 Jira 关联时没有得到结果。", {
      code: "ISSUE_ANALYSIS_CREATED_UNBOUND",
      statusCode: 409,
      details: { stage: "created_unbound", issueKey: key, sessionId, threadId: sessionId }
    });

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
      imageProcessing: {
        mode: String(imageContext?.mode || "none"),
        statuses: Array.isArray(imageContext?.statuses) ? imageContext.statuses : [],
        modelRouting: modelRouting.switched
          ? {
              mode: "session-vision-model",
              provider: modelRouting.route.provider,
              model: modelRouting.route.model,
              sessionRetainsModel: true,
              defaultModelRestored: Boolean(modelRouting.defaultRestored),
              ...(modelRouting.warning ? { warning: modelRouting.warning } : {})
            }
          : { mode: "unchanged", reason: String(modelRouting.reason || "not-needed") }
      },
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
