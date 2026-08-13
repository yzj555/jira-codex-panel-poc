import { ConfigurationError } from "../config-store.mjs";
import { JiraApiError } from "../jira-client.mjs";
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
    if (!candidate || typeof candidate !== "object") continue;
    const cwd = String(candidate.cwd || candidate.projectPath || candidate.path || "").trim();
    if (!cwd) continue;
    return {
      cwd,
      workspaceRoots: [
        ...(Array.isArray(candidate.workspaceRoots) ? candidate.workspaceRoots : []),
        ...(Array.isArray(candidate.rootPaths) ? candidate.rootPaths : []),
        cwd
      ].map(String).map((value) => value.trim()).filter(Boolean),
      projectId: String(candidate.projectId || binding?.projectId || "").trim(),
      workspaceKind: String(candidate.workspaceKind || candidate.kind || "").trim(),
      source: String(candidate.source || "service-binding").trim(),
      observedAt: String(candidate.observedAt || candidate.updatedAt || binding?.updatedAt || "").trim()
    };
  }
  return null;
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

  async function operationContext(issueKey, requestedThreadId = "") {
    const bound = await boundContext(issueKey);
    const requested = normalizedThreadId(requestedThreadId);
    if (requested && requested.replace(/^local:/i, "").toLowerCase()
      !== bound.threadId.replace(/^local:/i, "").toLowerCase()) {
      const error = new Error(`${bound.issueKey} 当前绑定会话已发生变化，请刷新后重新操作。`);
      error.code = "SVN_BOUND_THREAD_CHANGED";
      error.statusCode = 409;
      throw error;
    }
    let workspaceContext = workspaceFromBinding(bound.binding);
    if (!workspaceContext && typeof runtime?.readThread === "function") {
      try {
        const result = await runtime.readThread(bound.threadId, { includeTurns: false });
        const thread = result?.thread || result?.result?.thread || result;
        const cwd = String(thread?.cwd || "").trim();
        if (cwd) {
          workspaceContext = {
            cwd,
            workspaceRoots: [cwd],
            projectId: String(bound.binding?.projectId || ""),
            workspaceKind: "app-server-thread",
            source: "app-server-thread-read",
            observedAt: new Date().toISOString()
          };
        }
      } catch {
        // The manager may still recover an imported legacy binding through the
        // rollout reader. New bindings are expected to persist workspace data.
      }
    }
    return { ...bound, workspaceContext };
  }

  async function context({ issueKey, threadId = "", includeReview = true } = {}) {
    const key = normalizeIssueKey(issueKey);
    const operation = await operationContext(key, threadId);
    const resolvedThreadId = operation.threadId;
    const issue = await fetchIssue(key);
    return {
      context: await manager.inspect({ threadId: resolvedThreadId, issue, workspaceContext: operation.workspaceContext }),
      message: commitMessage(issue),
      history: manager.listCommitHistory({ threadId: resolvedThreadId, issueKey: key }),
      review: includeReview ? manager.findLatestReview({ threadId: resolvedThreadId, issueKey: key }) : null
    };
  }

  async function previewDiff({ issueKey, threadId = "", path } = {}) {
    const operation = await operationContext(issueKey, threadId);
    return manager.previewDiff({ threadId: operation.threadId, path, workspaceContext: operation.workspaceContext });
  }

  async function openExternalDiff({ issueKey, threadId = "", path } = {}) {
    const operation = await operationContext(issueKey, threadId);
    return manager.openExternalDiff({ threadId: operation.threadId, path, workspaceContext: operation.workspaceContext });
  }

  async function recordBaseline({ issueKey, threadId = "", boundAt } = {}) {
    const key = normalizeIssueKey(issueKey);
    const operation = await operationContext(key, threadId);
    return manager.recordBaseline({
      threadId: operation.threadId,
      issueKey: key,
      boundAt,
      workspaceContext: operation.workspaceContext
    });
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
    selectedPaths,
    summary,
    codexReviewEnabled = false,
    dispatchCodexReview = false
  } = {}) {
    const key = normalizeIssueKey(issueKey);
    const operation = await operationContext(key, threadId);
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

  async function latestReview({ issueKey, threadId = "" } = {}) {
    const key = normalizeIssueKey(issueKey);
    const resolvedThreadId = (await operationContext(key, threadId)).threadId;
    await manager.poll();
    return manager.findLatestReview({ threadId: resolvedThreadId, issueKey: key });
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
