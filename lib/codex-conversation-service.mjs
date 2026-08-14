import { normalizeBindingWorkspace } from "./issue-binding-store.mjs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class CodexConversationServiceError extends Error {
  constructor(message, { code = "CODEX_CONVERSATION_SERVICE_ERROR", statusCode = 400, details } = {}) {
    super(message);
    this.name = "CodexConversationServiceError";
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

function requireObject(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is required.`);
  return value;
}

function normalizedThreadId(value) {
  return String(value || "").trim().replace(/^local:/i, "");
}

function normalizedIssueKey(value) {
  const key = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
    throw new CodexConversationServiceError("Jira Issue Key is invalid.", {
      code: "INVALID_ISSUE_KEY",
      statusCode: 400
    });
  }
  return key;
}

function threadList(result) {
  return [result?.data, result?.result?.data, result?.threads, result?.result?.threads]
    .find((value) => Array.isArray(value)) || [];
}

function normalizedStatus(value) {
  if (typeof value === "string") return value;
  return String(value?.type || value?.status || "");
}

function workspaceFromThread(thread, observedAt = new Date().toISOString()) {
  const projectAssignment = thread?.projectAssignment || thread?.project_assignment || {};
  const source = typeof thread?.source === "string"
    ? thread.source
    : String(thread?.source?.type || thread?.origin || "codex-app-server-thread");
  return normalizeBindingWorkspace({
    cwd: thread?.cwd,
    workspaceRoots: thread?.workspaceRoots || thread?.workspace_roots,
    projectId: thread?.projectId || thread?.project_id || projectAssignment?.projectId || projectAssignment?.project_id,
    projectLabel: thread?.projectLabel || thread?.project_name || projectAssignment?.projectLabel,
    kind: thread?.workspaceKind || thread?.workspace_kind || (projectAssignment?.projectId ? "project" : "workspace"),
    source,
    observedAt
  });
}

function mergeWorkspace(...values) {
  const candidates = values.map(normalizeBindingWorkspace).filter(Boolean);
  if (!candidates.length) return null;
  const preferred = candidates[0];
  const fallback = candidates.find((candidate) => candidate.cwd || candidate.workspaceRoots.length) || preferred;
  return normalizeBindingWorkspace({
    ...fallback,
    ...preferred,
    cwd: preferred.cwd || fallback.cwd,
    workspaceRoots: preferred.workspaceRoots.length ? preferred.workspaceRoots : fallback.workspaceRoots,
    projectId: preferred.projectId || fallback.projectId,
    projectLabel: preferred.projectLabel || fallback.projectLabel,
    projectScopes: preferred.projectScopes?.length ? preferred.projectScopes : fallback.projectScopes,
    defaultProjectScopeId: preferred.defaultProjectScopeId || fallback.defaultProjectScopeId
  });
}

function normalizedThread(thread) {
  const id = normalizedThreadId(thread?.id || thread?.threadId);
  if (!id) return null;
  const preview = String(thread?.preview || thread?.description || "").trim();
  const title = String(thread?.name || thread?.title || "").trim()
    || preview.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, "").trim()
    || id;
  const workspace = workspaceFromThread(thread);
  return {
    id,
    title: title.slice(0, 500),
    preview: preview.slice(0, 2_000),
    cwd: workspace?.cwd || String(thread?.cwd || ""),
    workspace,
    updatedAt: thread?.updatedAt ?? thread?.updated_at ?? null,
    status: normalizedStatus(thread?.status),
    archived: thread?.archived === true
  };
}

function findThreadById(threads, threadId) {
  const expected = normalizedThreadId(threadId).toLowerCase();
  return threads.find((thread) => normalizedThreadId(thread?.id || thread?.threadId).toLowerCase() === expected) || null;
}

/**
 * Service-owned facade for App Server thread discovery and Jira bindings.
 * Desktop navigation remains in the minimal host adapter because App Server
 * does not expose a public API for selecting the owning desktop window.
 */
export function createCodexConversationService({ runtime, issueBindings } = {}) {
  const codex = requireObject(runtime, "runtime");
  const bindings = requireObject(issueBindings, "issueBindings");
  if (typeof codex.listThreads !== "function" || typeof codex.readThread !== "function") {
    throw new TypeError("runtime must expose listThreads and readThread.");
  }
  if (typeof bindings.snapshot !== "function" || typeof bindings.applyMutations !== "function") {
    throw new TypeError("issueBindings must expose snapshot and applyMutations.");
  }

  async function listThreads({ searchTerm = "", cwd = "", limit = DEFAULT_LIMIT } = {}) {
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
    const [result, bindingState] = await Promise.all([
      codex.listThreads({
        limit: safeLimit,
        archived: false,
        searchTerm: String(searchTerm || "").trim() || undefined,
        cwd: String(cwd || "").trim() || undefined
      }),
      bindings.snapshot()
    ]);
    const issuesByThread = new Map();
    for (const [issueKey, binding] of Object.entries(bindingState.bindings || {})) {
      const id = normalizedThreadId(binding?.threadId).toLowerCase();
      if (!id) continue;
      issuesByThread.set(id, [...(issuesByThread.get(id) || []), issueKey]);
    }
    const items = threadList(result).map(normalizedThread).filter(Boolean).map((thread) => ({
      ...thread,
      boundIssueKeys: issuesByThread.get(thread.id.toLowerCase()) || []
    }));
    return {
      fetchedAt: new Date().toISOString(),
      runtimeOwner: String(codex.id || result?.runtimeOwner || "standalone-appserver"),
      bindingsRevision: Number(bindingState.revision || 0),
      total: items.length,
      threads: items
    };
  }

  async function readThread(threadId) {
    const id = normalizedThreadId(threadId);
    if (!id) throw new TypeError("Codex threadId is required.");
    const result = await codex.readThread(id, { includeTurns: false });
    const thread = result?.thread || result?.result?.thread || result;
    const normalized = normalizedThread(thread);
    if (!normalized?.id) {
      throw new CodexConversationServiceError(
        "The Codex conversation does not exist or App Server cannot read it.",
        { code: "CODEX_THREAD_NOT_FOUND", statusCode: 404 }
      );
    }
    return { ...normalized, runtimeOwner: String(codex.id || result?.runtimeOwner || "standalone-appserver") };
  }

  async function bindIssue({
    issueKey,
    threadId,
    expectedRevision,
    replaceExistingThreadBinding = false,
    workspace,
    workspaceSelection = "auto"
  } = {}) {
    const key = normalizedIssueKey(issueKey);
    const thread = await readThread(threadId);
    const state = await bindings.snapshot();
    const expected = Number(expectedRevision);
    if (!Number.isInteger(expected) || expected < 0 || state.revision !== expected) {
      throw new CodexConversationServiceError("Bindings changed in another client. Refresh before retrying.", {
        code: "ISSUE_BINDINGS_REVISION_CONFLICT",
        statusCode: 409
      });
    }
    const conflicts = Object.entries(state.bindings || {})
      .filter(([candidateKey, binding]) => (
        candidateKey !== key
        && normalizedThreadId(binding?.threadId).toLowerCase() === thread.id.toLowerCase()
      ));
    if (conflicts.length && replaceExistingThreadBinding !== true) {
      throw new CodexConversationServiceError(
        `This conversation is already bound to ${conflicts.map(([candidateKey]) => candidateKey).join(", ")}.`,
        {
          code: "CODEX_THREAD_ALREADY_BOUND",
          statusCode: 409,
          details: { issueKeys: conflicts.map(([candidateKey]) => candidateKey) }
        }
      );
    }
    const updatedAt = new Date().toISOString();
    const selectionMode = String(workspaceSelection || "auto").trim().toLowerCase();
    if (!new Set(["auto", "explicit", "thread"]).has(selectionMode)) {
      throw new CodexConversationServiceError("Invalid workspace selection mode.", {
        code: "INVALID_WORKSPACE_SELECTION",
        statusCode: 400
      });
    }
    if (selectionMode === "explicit" && !normalizeBindingWorkspace(workspace)) {
      throw new CodexConversationServiceError("An explicit project workspace is required.", {
        code: "INVALID_PROJECT_WORKSPACE",
        statusCode: 400
      });
    }
    const bindingWorkspace = mergeWorkspace(
      selectionMode !== "thread" && workspace
        ? { ...workspace, source: workspace.source || "explicit-binding", observedAt: updatedAt }
        : null,
      selectionMode === "auto" ? state.bindings?.[key]?.workspace : null,
      thread.workspace
    );
    const mutate = typeof bindings.compareAndSwap === "function"
      ? bindings.compareAndSwap.bind(bindings)
      : bindings.applyMutations.bind(bindings);
    const next = await mutate({
      expectedRevision: state.revision,
      deletes: conflicts.map(([candidateKey]) => candidateKey),
      upserts: {
        [key]: {
          threadId: thread.id,
          threadTitle: thread.title,
          issueTitle: state.bindings?.[key]?.issueTitle || "",
          runtimeOwner: thread.runtimeOwner,
          hostReference: "codex-app-server",
          ...(bindingWorkspace ? { workspace: bindingWorkspace } : {}),
          boundAt: state.bindings?.[key]?.boundAt || updatedAt,
          updatedAt
        }
      }
    });
    return {
      issueKey: key,
      binding: next.bindings[key],
      revision: next.revision,
      replacedIssueKeys: conflicts.map(([candidateKey]) => candidateKey)
    };
  }

  async function clearBinding({ issueKey, expectedRevision } = {}) {
    const key = normalizedIssueKey(issueKey);
    const mutate = typeof bindings.compareAndSwap === "function"
      ? bindings.compareAndSwap.bind(bindings)
      : bindings.applyMutations.bind(bindings);
    const next = await mutate({ expectedRevision, deletes: [key] });
    return { issueKey: key, binding: null, revision: next.revision };
  }

  async function resolveListedThread(threadId, options = {}) {
    const listed = await listThreads(options);
    const thread = findThreadById(listed.threads, threadId);
    return thread ? { ...thread, runtimeOwner: listed.runtimeOwner } : null;
  }

  async function getBindings() {
    return bindings.snapshot();
  }

  return {
    listThreads,
    readThread,
    getBindings,
    bindIssue,
    clearBinding,
    resolveListedThread
  };
}
