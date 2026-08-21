import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeBindingWorkspace } from "./issue-binding-store.mjs";

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const SCHEMA_VERSION = 1;
const MAX_BINDINGS = 1_000;

export class IssueWorkspaceStoreError extends Error {
  constructor(message, { code = "ISSUE_WORKSPACE_STORE_ERROR", statusCode = 400, details } = {}) {
    super(message);
    this.name = "IssueWorkspaceStoreError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

function normalizeIssueKey(value) {
  const key = String(value || "").trim().toUpperCase();
  return ISSUE_KEY_PATTERN.test(key) ? key : "";
}

function normalizeEntry(value) {
  const workspace = normalizeBindingWorkspace(value?.workspace || value);
  if (!workspace) return null;
  return {
    workspace,
    source: String(value?.source || workspace.source || "explicit").trim().slice(0, 100),
    updatedAt: String(value?.updatedAt || new Date().toISOString()).slice(0, 100)
  };
}

function normalizeEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, MAX_BINDINGS).flatMap(([rawKey, rawEntry]) => {
    const key = normalizeIssueKey(rawKey);
    const entry = normalizeEntry(rawEntry);
    return key && entry ? [[key, entry]] : [];
  }));
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, updatedAt: "", workspaces: {} };
}

/**
 * Host-neutral Jira -> project/workspace mapping. Unlike issue-binding-store,
 * entries never require or carry a conversation/thread identifier.
 */
export function createIssueWorkspaceStore({ file } = {}) {
  if (!file) throw new TypeError("Issue workspace store requires a file path.");
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const record = JSON.parse(await readFile(file, "utf8"));
      return {
        schemaVersion: SCHEMA_VERSION,
        revision: Math.max(0, Number(record.revision || 0)),
        updatedAt: String(record.updatedAt || ""),
        workspaces: normalizeEntries(record.workspaces)
      };
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState();
      throw new IssueWorkspaceStoreError(`无法读取 Jira 项目绑定：${error?.message || error}`, {
        code: "ISSUE_WORKSPACES_READ_FAILED",
        statusCode: 500
      });
    }
  }

  async function persist(next) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
    return next;
  }

  async function snapshot() {
    return JSON.parse(JSON.stringify(await load()));
  }

  function applyMutations({ upserts = {}, deletes = [], expectedRevision } = {}) {
    const pending = writeQueue.then(async () => {
      const current = await load();
      const expected = Number(expectedRevision);
      if (!Number.isInteger(expected) || expected < 0) {
        throw new IssueWorkspaceStoreError("项目绑定 revision 缺失，请刷新后重试。", {
          code: "ISSUE_WORKSPACES_REVISION_REQUIRED",
          statusCode: 428
        });
      }
      if (current.revision !== expected) {
        throw new IssueWorkspaceStoreError("项目绑定已被其他操作更新，请刷新后重试。", {
          code: "ISSUE_WORKSPACES_REVISION_CONFLICT",
          statusCode: 409,
          details: { expectedRevision: expected, currentRevision: current.revision }
        });
      }
      const normalizedUpserts = normalizeEntries(upserts);
      const normalizedDeletes = [...new Set((Array.isArray(deletes) ? deletes : [])
        .map(normalizeIssueKey).filter(Boolean))].slice(0, MAX_BINDINGS);
      const workspaces = { ...current.workspaces, ...normalizedUpserts };
      for (const key of normalizedDeletes) delete workspaces[key];
      if (!Object.keys(normalizedUpserts).length && !normalizedDeletes.length) return current;
      return persist({
        schemaVersion: SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        workspaces
      });
    });
    writeQueue = pending.catch(() => {});
    return pending;
  }

  async function importConversationBindings(bindingState) {
    const current = await snapshot();
    const upserts = Object.fromEntries(Object.entries(bindingState?.bindings || {}).flatMap(([key, binding]) => {
      if (current.workspaces[key] || !binding?.workspace) return [];
      const entry = normalizeEntry({
        workspace: binding.workspace,
        source: "conversation-binding-migration",
        updatedAt: binding.updatedAt
      });
      return entry ? [[key, entry]] : [];
    }));
    if (!Object.keys(upserts).length) return current;
    return applyMutations({ upserts, expectedRevision: current.revision });
  }

  return { file, snapshot, applyMutations, importConversationBindings };
}
