import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_BINDINGS = 1_000;

export class IssueBindingStoreError extends Error {
  constructor(message, { code = "ISSUE_BINDING_STORE_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "IssueBindingStoreError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function safeValue(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value ?? null;
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? value.slice(0, 20_000) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 1_000).map((entry) => safeValue(entry, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (
    ["__proto__", "prototype", "constructor"].includes(key)
      ? []
      : [[key.slice(0, 200), safeValue(entry, depth + 1)]]
  )));
}

function normalizeIssueKey(value) {
  const issueKey = String(value || "").trim().toUpperCase();
  return ISSUE_KEY_PATTERN.test(issueKey) ? issueKey : "";
}

function normalizeBinding(value, { imported = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const threadId = String(value.threadId || "").trim().slice(0, 1_000);
  if (!threadId) return null;
  const binding = safeValue(value);
  binding.threadId = threadId;
  binding.runtimeOwner = String(value.runtimeOwner || "legacy-desktop").trim().slice(0, 100)
    || "legacy-desktop";
  binding.updatedAt = String(value.updatedAt || new Date().toISOString()).slice(0, 100);
  if (imported && !binding.importedAt) binding.importedAt = new Date().toISOString();
  return binding;
}

function normalizeBindings(value, options) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, MAX_BINDINGS).flatMap(([key, binding]) => {
    const issueKey = normalizeIssueKey(key);
    const normalized = normalizeBinding(binding, options);
    return issueKey && normalized ? [[issueKey, normalized]] : [];
  }));
}

function emptyState() {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: "",
    bindings: {}
  };
}

export function createIssueBindingStore({ file } = {}) {
  if (!file) throw new TypeError("Issue binding store requires a file path.");
  let statePromise = null;
  let writeQueue = Promise.resolve();

  async function load() {
    if (!statePromise) {
      statePromise = readFile(file, "utf8")
        .then((content) => {
          const record = JSON.parse(content);
          return {
            schemaVersion: 1,
            revision: Math.max(0, Number(record.revision || 0)),
            updatedAt: String(record.updatedAt || ""),
            bindings: normalizeBindings(record.bindings)
          };
        })
        .catch((error) => {
          if (error?.code === "ENOENT") return emptyState();
          throw new IssueBindingStoreError(`无法读取任务会话绑定：${error.message || error}`, {
            code: "ISSUE_BINDINGS_READ_FAILED",
            statusCode: 500
          });
        });
    }
    return statePromise;
  }

  async function persist(next) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, file);
    statePromise = Promise.resolve(next);
    return next;
  }

  function mutate(operation) {
    const pending = writeQueue.then(async () => {
      const current = await load();
      const bindings = await operation({ ...current.bindings });
      const next = {
        schemaVersion: 1,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        bindings
      };
      return persist(next);
    });
    writeQueue = pending.catch(() => {});
    return pending;
  }

  async function snapshot() {
    const state = await load();
    return JSON.parse(JSON.stringify(state));
  }

  async function importBindings(bindings) {
    const imported = normalizeBindings(bindings, { imported: true });
    if (!Object.keys(imported).length) return snapshot();
    const current = await snapshot();
    const missing = Object.fromEntries(Object.entries(imported)
      .filter(([issueKey]) => !current.bindings[issueKey]));
    if (!Object.keys(missing).length) return current;
    return mutate((stored) => ({ ...missing, ...stored }));
  }

  async function applyMutations({ upserts = {}, deletes = [] } = {}) {
    const normalizedUpserts = normalizeBindings(upserts);
    const normalizedDeletes = [...new Set((Array.isArray(deletes) ? deletes : [])
      .map(normalizeIssueKey)
      .filter(Boolean))]
      .slice(0, MAX_BINDINGS);
    if (!Object.keys(normalizedUpserts).length && !normalizedDeletes.length) return snapshot();
    return mutate((current) => {
      for (const issueKey of normalizedDeletes) delete current[issueKey];
      return { ...current, ...normalizedUpserts };
    });
  }

  return {
    file,
    snapshot,
    importBindings,
    applyMutations
  };
}
