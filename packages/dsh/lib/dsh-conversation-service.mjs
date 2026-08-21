import { basename } from "node:path";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SCAN = 500;

export class DshConversationServiceError extends Error {
  constructor(message, { code = "DSH_CONVERSATION_SERVICE_ERROR", statusCode = 400, details } = {}) {
    super(message);
    this.name = "DshConversationServiceError";
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

function normalizedIssueKey(value) {
  const issueKey = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
    throw new DshConversationServiceError("Jira Issue Key 无效。", {
      code: "INVALID_ISSUE_KEY",
      statusCode: 400
    });
  }
  return issueKey;
}

function normalizedSessionId(value) {
  return String(value || "").trim().slice(0, 1_000);
}

function sessionTitle(record, observation) {
  const title = observation?.status === "fulfilled"
    ? String(observation.value?.title?.title || "").trim()
    : "";
  if (title) return title.slice(0, 500);
  const cwd = String(record?.header?.cwd || "").trim();
  return (cwd ? basename(cwd) : normalizedSessionId(record?.header?.id)).slice(0, 500);
}

function requireSessionQuery(ctx) {
  const query = ctx?.get?.("sessionQuery");
  if (!query || typeof query.listSessions !== "function" || typeof query.readTitleSnapshots !== "function") {
    throw new DshConversationServiceError("DSH 会话目录暂不可用，请稍后重试。", {
      code: "DSH_SESSION_QUERY_UNAVAILABLE",
      statusCode: 503
    });
  }
  return query;
}

function visibleRecords(records) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => normalizedSessionId(record?.header?.id))
    .filter((record) => record?.header?.origin !== "subagent")
    .slice(0, MAX_SCAN);
}

export function createDshConversationService({ ctx, issueBindings } = {}) {
  if (!ctx || typeof ctx.get !== "function") throw new TypeError("ctx is required.");
  if (!issueBindings || typeof issueBindings.snapshot !== "function") {
    throw new TypeError("issueBindings is required.");
  }

  async function observeRecords(records) {
    const query = requireSessionQuery(ctx);
    const observations = await query.readTitleSnapshots(
      records.map((record) => normalizedSessionId(record?.header?.id))
    );
    return records.map((record, index) => {
      const id = normalizedSessionId(record?.header?.id);
      const cwd = String(record?.header?.cwd || "");
      const observation = observations[index];
      const updatedAt = observation?.status === "fulfilled"
        ? Number(observation.value?.title?.updatedAt || record?.header?.createdAt || 0)
        : Number(record?.header?.createdAt || 0);
      return {
        id,
        title: sessionTitle(record, observation),
        preview: cwd,
        cwd,
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
        status: record?.live ? "live" : "persisted",
        archived: false
      };
    });
  }

  async function listThreads({ searchTerm = "", cwd = "", limit = DEFAULT_LIMIT } = {}) {
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
    const query = requireSessionQuery(ctx);
    const requestedCwd = String(cwd || "").trim().toLowerCase();
    const needle = String(searchTerm || "").trim().toLocaleLowerCase();
    let records = visibleRecords(await query.listSessions());
    if (requestedCwd) {
      records = records.filter((record) => String(record?.header?.cwd || "").trim().toLowerCase() === requestedCwd);
    }
    if (!needle) records = records.slice(0, safeLimit);

    const [threads, bindingState] = await Promise.all([
      observeRecords(records),
      issueBindings.snapshot()
    ]);
    const issuesBySession = new Map();
    for (const [issueKey, binding] of Object.entries(bindingState.bindings || {})) {
      const id = normalizedSessionId(binding?.threadId).toLowerCase();
      if (!id) continue;
      issuesBySession.set(id, [...(issuesBySession.get(id) || []), issueKey]);
    }
    const filtered = threads.filter((thread) => !needle
      || thread.id.toLocaleLowerCase().includes(needle)
      || thread.title.toLocaleLowerCase().includes(needle)
      || thread.cwd.toLocaleLowerCase().includes(needle))
      .slice(0, safeLimit)
      .map((thread) => ({
        ...thread,
        boundIssueKeys: issuesBySession.get(thread.id.toLowerCase()) || []
      }));
    return {
      fetchedAt: new Date().toISOString(),
      runtimeOwner: "dsh",
      bindingsRevision: Number(bindingState.revision || 0),
      total: filtered.length,
      threads: filtered
    };
  }

  async function readThread(threadId) {
    const id = normalizedSessionId(threadId);
    if (!id) throw new TypeError("DSH sessionId is required.");
    const query = requireSessionQuery(ctx);
    const record = visibleRecords(await query.listSessions())
      .find((candidate) => normalizedSessionId(candidate?.header?.id).toLowerCase() === id.toLowerCase());
    if (!record) {
      throw new DshConversationServiceError("该 DSH 会话不存在或当前不可见。", {
        code: "DSH_SESSION_NOT_FOUND",
        statusCode: 404
      });
    }
    return (await observeRecords([record]))[0];
  }

  async function bindIssue({
    issueKey,
    threadId,
    expectedRevision,
    replaceExistingThreadBinding = false
  } = {}) {
    const key = normalizedIssueKey(issueKey);
    const thread = await readThread(threadId);
    const state = await issueBindings.snapshot();
    const expected = Number(expectedRevision);
    if (!Number.isInteger(expected) || expected < 0 || state.revision !== expected) {
      throw new DshConversationServiceError("会话关联已在其他位置更新，请刷新后重试。", {
        code: "ISSUE_BINDINGS_REVISION_CONFLICT",
        statusCode: 409
      });
    }
    const conflicts = Object.entries(state.bindings || {}).filter(([candidateKey, binding]) => (
      candidateKey !== key
      && normalizedSessionId(binding?.threadId).toLowerCase() === thread.id.toLowerCase()
    ));
    if (conflicts.length && replaceExistingThreadBinding !== true) {
      throw new DshConversationServiceError(
        `该 DSH 会话已关联 ${conflicts.map(([candidateKey]) => candidateKey).join("、")}。`,
        {
          code: "DSH_SESSION_ALREADY_BOUND",
          statusCode: 409,
          details: { issueKeys: conflicts.map(([candidateKey]) => candidateKey) }
        }
      );
    }
    const updatedAt = new Date().toISOString();
    const mutate = typeof issueBindings.compareAndSwap === "function"
      ? issueBindings.compareAndSwap.bind(issueBindings)
      : issueBindings.applyMutations.bind(issueBindings);
    const next = await mutate({
      expectedRevision: state.revision,
      deletes: conflicts.map(([candidateKey]) => candidateKey),
      upserts: {
        [key]: {
          threadId: thread.id,
          threadTitle: thread.title,
          title: thread.title,
          issueTitle: state.bindings?.[key]?.issueTitle || "",
          runtimeOwner: "dsh",
          hostReference: "dsh-session",
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
    const mutate = typeof issueBindings.compareAndSwap === "function"
      ? issueBindings.compareAndSwap.bind(issueBindings)
      : issueBindings.applyMutations.bind(issueBindings);
    const next = await mutate({ expectedRevision, deletes: [key] });
    return { issueKey: key, binding: null, revision: next.revision };
  }

  return { listThreads, readThread, bindIssue, clearBinding };
}
