import { ConfigurationError } from "../config-store.mjs";
import { JiraApiError } from "../jira-client.mjs";
import { normalizeBindingWorkspace } from "./issue-binding-store.mjs";
import { SvnReviewError } from "./svn-review-manager.mjs";

function requireObject(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is required.`);
  return value;
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
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

function configured(config) {
  if (config?.configured && config?.token) return config;
  throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
    code: "JIRA_NOT_CONFIGURED",
    statusCode: 428
  });
}

function normalizedThreadId(value) {
  return String(value || "").trim();
}

function workspaceFromBinding(binding) {
  const candidates = [binding?.workspaceContext, binding?.workspace, binding?.projectWorkspace, binding];
  for (const candidate of candidates) {
    const workspace = normalizeBindingWorkspace(candidate);
    if (workspace) return workspace;
  }
  return null;
}

function publicProjectScope(scope, defaultProjectScopeId = "") {
  return {
    id: String(scope?.id || ""),
    cwd: String(scope?.cwd || ""),
    workspaceRoots: Array.isArray(scope?.workspaceRoots) ? scope.workspaceRoots.map(String) : [],
    projectId: String(scope?.projectId || ""),
    projectLabel: String(scope?.projectLabel || scope?.cwd || scope?.projectId || "项目目录"),
    kind: String(scope?.kind || "workspace"),
    primary: String(scope?.id || "") === String(defaultProjectScopeId || "")
  };
}

function workspaceContextForScope(scope) {
  return {
    cwd: String(scope.cwd || ""),
    workspaceRoots: Array.isArray(scope.workspaceRoots) && scope.workspaceRoots.length
      ? scope.workspaceRoots
      : [scope.cwd].filter(Boolean),
    projectId: String(scope.projectId || ""),
    projectLabel: String(scope.projectLabel || ""),
    projectScopeId: String(scope.id || ""),
    workspaceKind: String(scope.kind || "workspace"),
    source: String(scope.source || "service-binding"),
    observedAt: String(scope.observedAt || "")
  };
}

/**
 * Stable service boundary shared by the injected SVN modal, HTTP compatibility
 * routes and official MCP tools. Every mutating operation delegates to the
 * existing review manager, which owns snapshot freshness checks, one-time
 * confirmation tokens, explicit path commits and revision reconciliation.
 */
export function createSvnWorkbenchService({
  loadConfig,
  resolveConfig = async (config) => config,
  jira,
  issueBindings,
  reviews,
  runtime,
  buildCommitMessage
} = {}) {
  const readConfig = requireFunction(loadConfig, "loadConfig");
  const resolve = requireFunction(resolveConfig, "resolveConfig");
  const jiraClient = requireObject(jira, "jira");
  const bindings = requireObject(issueBindings, "issueBindings");
  const manager = requireObject(reviews, "reviews");
  const commitMessage = requireFunction(buildCommitMessage, "buildCommitMessage");

  async function effectiveConfig() {
    return resolve(configured(await readConfig()));
  }

  async function fetchIssue(issueKey) {
    return jiraClient.fetchIssue(await effectiveConfig(), normalizeIssueKey(issueKey));
  }

  function assertReviewIssue(review, issueKey) {
    if (!issueKey) return review;
    const expected = normalizeIssueKey(issueKey);
    const actual = String(review?.issue?.key || "").trim().toUpperCase();
    if (!actual || actual !== expected) {
      throw new SvnReviewError(`SVN 审核草稿不属于 ${expected}，请刷新当前任务后重试。`, {
        code: "SVN_REVIEW_ISSUE_MISMATCH",
        statusCode: 409,
        details: { expectedIssueKey: expected, actualIssueKey: actual || null }
      });
    }
    return review;
  }

  function reviewForIssue(reviewId, issueKey) {
    return assertReviewIssue(manager.getReview(reviewId), issueKey);
  }

  async function boundContext(issueKey) {
    const key = normalizeIssueKey(issueKey);
    const bindingState = await bindings.snapshot();
    const binding = bindingState.bindings?.[key] || null;
    const threadId = normalizedThreadId(binding?.threadId);
    if (!threadId) {
      const error = new Error(`${key} 尚未关联 Codex 会话，无法确定 SVN 项目范围。`);
      error.code = "SVN_ISSUE_NOT_BOUND";
      error.statusCode = 409;
      throw error;
    }
    return { issueKey: key, threadId, binding, bindingsRevision: Number(bindingState.revision || 0) };
  }

  async function operationContext(issueKey, requestedThreadId = "", requestedProjectScopeId = "", {
    allowScopeSelection = false
  } = {}) {
    const bound = await boundContext(issueKey);
    const requested = normalizedThreadId(requestedThreadId);
    if (requested && requested.replace(/^local:/i, "").toLowerCase()
      !== bound.threadId.replace(/^local:/i, "").toLowerCase()) {
      const error = new Error(`${bound.issueKey} 当前绑定会话已发生变化，请刷新后重新操作。`);
      error.code = "SVN_BOUND_THREAD_CHANGED";
      error.statusCode = 409;
      throw error;
    }
    let workspace = workspaceFromBinding(bound.binding);
    if (!workspace && typeof runtime?.readThread === "function") {
      try {
        const result = await runtime.readThread(bound.threadId, { includeTurns: false });
        const thread = result?.thread || result?.result?.thread || result;
        const cwd = String(thread?.cwd || "").trim();
        if (cwd) {
          workspace = normalizeBindingWorkspace({
            cwd,
            workspaceRoots: [cwd],
            projectId: String(bound.binding?.projectId || ""),
            kind: "app-server-thread",
            source: "app-server-thread-read",
            observedAt: new Date().toISOString()
          });
        }
      } catch {
        // The manager may still recover an imported legacy binding through the
        // rollout reader. New bindings are expected to persist workspace data.
      }
    }
    const scopes = (workspace?.projectScopes || [])
      .filter((scope) => String(scope?.cwd || "").trim())
      .map((scope) => publicProjectScope(scope, workspace?.defaultProjectScopeId));
    if (!scopes.length) {
      return { ...bound, workspaceContext: null, projectScopes: [], defaultProjectScopeId: "" };
    }
    const requestedScopeId = String(requestedProjectScopeId || "").trim();
    let selectedScope = requestedScopeId
      ? scopes.find((scope) => scope.id === requestedScopeId)
      : scopes.length === 1 ? scopes[0] : null;
    if (requestedScopeId && !selectedScope) {
      throw new SvnReviewError("所选项目目录已不在当前 Jira 绑定中，请刷新后重新选择。", {
        code: "SVN_PROJECT_SCOPE_NOT_FOUND",
        statusCode: 409,
        details: { projectScopeId: requestedScopeId, projectScopes: scopes }
      });
    }
    if (!selectedScope && !allowScopeSelection) {
      throw new SvnReviewError("当前 Jira 关联了多个项目目录，请先明确选择本次 SVN 操作范围。", {
        code: "SVN_PROJECT_SCOPE_REQUIRED",
        statusCode: 409,
        details: { projectScopes: scopes, defaultProjectScopeId: workspace?.defaultProjectScopeId || "" }
      });
    }
    return {
      ...bound,
      workspaceContext: selectedScope ? workspaceContextForScope(selectedScope) : null,
      projectScopes: scopes,
      selectedProjectScopeId: selectedScope?.id || "",
      defaultProjectScopeId: String(workspace?.defaultProjectScopeId || "")
    };
  }

  async function context({ issueKey, threadId = "", projectScopeId = "", includeReview = true } = {}) {
    const key = normalizeIssueKey(issueKey);
    const operation = await operationContext(key, threadId, projectScopeId, { allowScopeSelection: true });
    const resolvedThreadId = operation.threadId;
    const issue = await fetchIssue(key);
    if (!operation.workspaceContext && operation.projectScopes.length > 1) {
      return {
        scopeSelectionRequired: true,
        projectScopes: operation.projectScopes,
        defaultProjectScopeId: operation.defaultProjectScopeId,
        selectedProjectScopeId: "",
        context: null,
        message: commitMessage(issue),
        history: [],
        review: null
      };
    }
    const inspection = await manager.inspect({
      threadId: resolvedThreadId,
      issue,
      workspaceContext: operation.workspaceContext
    });
    return {
      scopeSelectionRequired: false,
      projectScopes: operation.projectScopes,
      defaultProjectScopeId: operation.defaultProjectScopeId,
      selectedProjectScopeId: operation.selectedProjectScopeId,
      context: inspection,
      message: commitMessage(issue),
      history: manager.listCommitHistory({
        threadId: resolvedThreadId,
        issueKey: key,
        workingCopyRoot: inspection.workingCopy?.root || operation.workspaceContext?.cwd || ""
      }),
      review: includeReview ? manager.findLatestReview({
        threadId: resolvedThreadId,
        issueKey: key,
        workingCopyRoot: inspection.workingCopy?.root || operation.workspaceContext?.cwd || ""
      }) : null
    };
  }

  async function previewDiff({ issueKey, threadId = "", projectScopeId = "", path } = {}) {
    const operation = await operationContext(issueKey, threadId, projectScopeId);
    return manager.previewDiff({ threadId: operation.threadId, path, workspaceContext: operation.workspaceContext });
  }

  async function openExternalDiff({ issueKey, threadId = "", projectScopeId = "", path } = {}) {
    const operation = await operationContext(issueKey, threadId, projectScopeId);
    return manager.openExternalDiff({ threadId: operation.threadId, path, workspaceContext: operation.workspaceContext });
  }

  async function recordBaseline({
    issueKey,
    threadId = "",
    projectScopeId = "",
    boundAt,
    preserveExisting = false
  } = {}) {
    const key = normalizeIssueKey(issueKey);
    const operation = await operationContext(key, threadId, projectScopeId);
    return manager.recordBaseline({
      threadId: operation.threadId,
      issueKey: key,
      boundAt,
      workspaceContext: operation.workspaceContext,
      preserveExisting
    });
  }

  async function recordBaselines({ issueKey, threadId = "", boundAt } = {}) {
    const operation = await operationContext(issueKey, threadId, "", { allowScopeSelection: true });
    const scopeIds = operation.projectScopes.length > 1
      ? operation.projectScopes.map((scope) => scope.id)
      : [operation.projectScopes[0]?.id || ""];
    const results = [];
    const failures = [];
    for (const projectScopeId of scopeIds) {
      try {
        results.push(await recordBaseline({
          issueKey,
          threadId,
          projectScopeId,
          boundAt,
          preserveExisting: true
        }));
      } catch (error) {
        failures.push({ projectScopeId, message: String(error?.message || error) });
      }
    }
    if (!results.length && failures.length) {
      throw new SvnReviewError("所有关联项目目录都无法建立 SVN 基线。", {
        code: "SVN_BASELINES_UNAVAILABLE",
        statusCode: 422,
        details: { failures }
      });
    }
    return { baselines: results, failures };
  }

  async function startCodexDispatch(created) {
    if (!created?.prompt || !created?.review?.id || !runtime?.startReadOnlyTurn) return created;
    try {
      const appServerThreadId = String(created.review.threadId || "").replace(/^local:/i, "");
      const started = await runtime.startReadOnlyTurn(appServerThreadId, {
        message: created.prompt,
        cwd: created.review.workingCopy?.scopeRoot || created.review.workingCopy?.root || "",
        attachments: [],
        referenceFiles: true,
        outputSchema: created.outputSchema
      });
      const review = await manager.beginDispatch(created.review.id, {
        auditThreadId: started.threadId,
        auditTurnId: started.turnId
      });
      return { ...created, review, prompt: "", outputSchema: null, dispatch: { started: true, threadId: started.threadId, turnId: started.turnId } };
    } catch (error) {
      const review = await manager.failDispatch(
        created.review.id,
        `App Server 未能启动 Codex 审查：${error?.message || error}。可取消审查并降级为人工审核。`
      );
      return {
        ...created,
        review,
        prompt: "",
        outputSchema: null,
        dispatch: { started: false, error: String(error?.message || error) }
      };
    }
  }

  async function createReview({
    issueKey,
    threadId = "",
    projectScopeId = "",
    selectedPaths,
    summary,
    codexReviewEnabled = false,
    dispatchCodexReview = false
  } = {}) {
    const key = normalizeIssueKey(issueKey);
    const operation = await operationContext(key, threadId, projectScopeId);
    const resolvedThreadId = operation.threadId;
    const issue = await fetchIssue(key);
    const created = await manager.createReview({
      threadId: resolvedThreadId,
      issue,
      selectedPaths,
      summary,
      codexReviewEnabled: codexReviewEnabled === true,
      workspaceContext: operation.workspaceContext
    });
    return dispatchCodexReview && created.review?.codexReviewEnabled
      ? startCodexDispatch(created)
      : created;
  }

  async function getReview(reviewId, issueKey = "") {
    await manager.poll();
    return reviewForIssue(reviewId, issueKey);
  }

  async function latestReview({ issueKey, threadId = "", projectScopeId = "" } = {}) {
    const key = normalizeIssueKey(issueKey);
    const operation = await operationContext(key, threadId, projectScopeId);
    const inspection = await manager.inspect({
      threadId: operation.threadId,
      workspaceContext: operation.workspaceContext,
      includeAttribution: false
    });
    await manager.poll();
    return manager.findLatestReview({
      threadId: operation.threadId,
      issueKey: key,
      workingCopyRoot: inspection.workingCopy.root
    });
  }

  async function cancelReview(reviewId, message, issueKey = "") {
    reviewForIssue(reviewId, issueKey);
    return manager.cancel(reviewId, message);
  }

  async function dispatchReview(reviewId, options, issueKey = "") {
    reviewForIssue(reviewId, issueKey);
    return manager.beginDispatch(reviewId, options);
  }

  async function failDispatch(reviewId, message, issueKey = "") {
    reviewForIssue(reviewId, issueKey);
    return manager.failDispatch(reviewId, message);
  }

  async function retryReview(reviewId, issueKey) {
    reviewForIssue(reviewId, issueKey);
    return manager.retryDispatch(reviewId, await fetchIssue(issueKey));
  }

  async function confirmReview(reviewId, {
    issueKey,
    reviewed,
    riskAcknowledged,
    overlapAcknowledged
  } = {}) {
    reviewForIssue(reviewId, issueKey);
    const issue = await fetchIssue(issueKey);
    return manager.confirm(reviewId, {
      issue,
      issueKey,
      reviewed,
      riskAcknowledged,
      overlapAcknowledged
    });
  }

  async function commitReview(reviewId, { issueKey, confirmationToken } = {}) {
    reviewForIssue(reviewId, issueKey);
    return manager.commit(reviewId, {
      issue: await fetchIssue(issueKey),
      confirmationToken
    });
  }

  async function reconcileCommit(reviewId, issueKey = "") {
    reviewForIssue(reviewId, issueKey);
    return manager.reconcileCommit(reviewId);
  }

  async function confirmCommitted(reviewId, options, issueKey = "") {
    reviewForIssue(reviewId, issueKey);
    return manager.confirmCommitted(reviewId, options);
  }

  async function abandonReview(reviewId, options, issueKey = "") {
    reviewForIssue(reviewId, issueKey);
    return manager.abandon(reviewId, options);
  }

  return {
    boundContext,
    context,
    previewDiff,
    openExternalDiff,
    recordBaseline,
    recordBaselines,
    createReview,
    getReview,
    latestReview,
    cancelReview,
    dispatchReview,
    failDispatch,
    retryReview,
    confirmReview,
    commitReview,
    reconcileCommit,
    confirmCommitted,
    abandonReview
  };
}
