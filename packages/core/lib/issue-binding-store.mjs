import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_BINDINGS = 1_000;
const SCHEMA_VERSION = 3;
const MAX_PROJECT_SCOPES = 20;
const DESKTOP_APP_SERVER_RUNTIME_OWNER = "desktop-appserver";
const LEGACY_DESKTOP_RUNTIME_OWNER = "legacy-desktop";

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

function normalizeRuntimeOwner(value) {
  const runtimeOwner = String(value || "").trim().slice(0, 100);
  if (!runtimeOwner || runtimeOwner === LEGACY_DESKTOP_RUNTIME_OWNER) {
    return DESKTOP_APP_SERVER_RUNTIME_OWNER;
  }
  return runtimeOwner;
}

function normalizedText(value, maxLength = 4_000) {
  return String(value || "").trim().slice(0, maxLength);
}

function uniqueTexts(values, limit = 50) {
  return [...new Map(values
    .map((entry) => normalizedText(entry))
    .filter(Boolean)
    .map((entry) => [entry.toLowerCase(), entry])).values()].slice(0, limit);
}

export function normalizeProjectScope(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cwd = normalizedText(value.cwd || value.projectPath || value.path);
  const workspaceRoots = uniqueTexts([
    ...(Array.isArray(value.workspaceRoots) ? value.workspaceRoots : []),
    ...(Array.isArray(value.rootPaths) ? value.rootPaths : []),
    cwd
  ]);
  const rawId = normalizedText(value.scopeId || value.id, 1_000);
  const inferredProjectId = /^project:/i.test(rawId)
    ? rawId.slice(rawId.indexOf(":") + 1)
    : /^(?:path|scope):/i.test(rawId) ? "" : rawId;
  const projectId = normalizedText(value.projectId || inferredProjectId, 500);
  if (!cwd && !workspaceRoots.length && !projectId) return null;
  const fallbackId = projectId
    ? `project:${projectId}`
    : cwd
      ? `path:${cwd.toLowerCase()}`
      : `scope:${index + 1}`;
  const id = rawId || fallbackId;
  return {
    id,
    cwd: cwd || workspaceRoots[0] || "",
    workspaceRoots,
    projectId,
    projectLabel: normalizedText(
      value.projectLabel || value.label || (cwd ? basename(cwd) : projectId),
      500
    ) || projectId || `项目 ${index + 1}`,
    kind: normalizedText(value.kind || value.workspaceKind, 100) || (projectId ? "project" : "workspace"),
    source: normalizedText(value.source, 100) || "explicit",
    observedAt: normalizedText(value.observedAt || value.updatedAt, 100) || new Date().toISOString()
  };
}

export function normalizeBindingWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cwd = normalizedText(value.cwd);
  const workspaceRoots = uniqueTexts(Array.isArray(value.workspaceRoots) ? value.workspaceRoots : []);
  if (!workspaceRoots.length && cwd) workspaceRoots.push(cwd);
  const projectId = normalizedText(value.projectId, 500);
  const projectLabel = normalizedText(value.projectLabel, 500);
  let projectScopes = (Array.isArray(value.projectScopes) ? value.projectScopes : [])
    .map(normalizeProjectScope)
    .filter(Boolean);
  projectScopes = [...new Map(projectScopes.map((scope) => [
    scope.cwd ? `cwd:${scope.cwd.toLowerCase()}` : `id:${scope.id.toLowerCase()}`,
    scope
  ])).values()].slice(0, MAX_PROJECT_SCOPES);
  if (!cwd && !workspaceRoots.length && !projectId && !projectScopes.length) return null;
  if (!projectScopes.length) {
    const legacyScope = normalizeProjectScope({
      id: value.defaultProjectScopeId || value.defaultScopeId,
      cwd,
      workspaceRoots,
      projectId,
      projectLabel,
      kind: value.kind,
      source: value.source || "legacy-workspace",
      observedAt: value.observedAt
    });
    if (legacyScope) projectScopes = [legacyScope];
  }
  const requestedDefaultId = normalizedText(value.defaultProjectScopeId || value.defaultScopeId, 1_000);
  const defaultScope = projectScopes.find((scope) => scope.id === requestedDefaultId)
    || projectScopes.find((scope) => cwd && scope.cwd.toLowerCase() === cwd.toLowerCase())
    || projectScopes[0]
    || null;
  const mergedRoots = uniqueTexts([
    ...workspaceRoots,
    ...projectScopes.flatMap((scope) => scope.workspaceRoots)
  ]);
  return {
    cwd: defaultScope?.cwd || cwd || mergedRoots[0] || "",
    workspaceRoots: mergedRoots,
    projectId: defaultScope?.projectId || projectId,
    projectLabel: defaultScope?.projectLabel || projectLabel,
    kind: normalizedText(value.kind, 100) || defaultScope?.kind || ((defaultScope?.projectId || projectId) ? "project" : "workspace"),
    source: normalizedText(value.source, 100) || "explicit",
    observedAt: normalizedText(value.observedAt, 100) || new Date().toISOString(),
    projectScopes,
    defaultProjectScopeId: defaultScope?.id || ""
  };
}

function normalizeBinding(value, { imported = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const threadId = String(value.threadId || "").trim().slice(0, 1_000);
  if (!threadId) return null;
  const binding = safeValue(value);
  binding.threadId = threadId;
  binding.runtimeOwner = normalizeRuntimeOwner(value.runtimeOwner);
  binding.updatedAt = String(value.updatedAt || new Date().toISOString()).slice(0, 100);
  const workspace = normalizeBindingWorkspace(value.workspace || {
    cwd: value.cwd,
    workspaceRoots: value.workspaceRoots,
    projectId: value.projectId,
    projectLabel: value.projectLabel,
    kind: value.workspaceKind,
    source: value.workspaceSource,
    observedAt: value.workspaceObservedAt
  });
  if (workspace) binding.workspace = workspace;
  else delete binding.workspace;
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
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: "",
    legacyImportCompletedAt: "",
    legacyImportCount: 0,
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
            schemaVersion: SCHEMA_VERSION,
            revision: Math.max(0, Number(record.revision || 0)),
            updatedAt: String(record.updatedAt || ""),
            legacyImportCompletedAt: String(record.legacyImportCompletedAt || ""),
            legacyImportCount: Math.max(0, Number(record.legacyImportCount || 0)),
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
      const outcome = await operation({ ...current.bindings }, current);
      if (outcome === null) return current;
      const structured = outcome && typeof outcome === "object" && outcome.bindings
        ? outcome
        : { bindings: outcome };
      const next = {
        ...current,
        ...(structured.state || {}),
        schemaVersion: SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        bindings: structured.bindings
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
    return mutate((stored, current) => {
      // Renderer localStorage is a migration source, never a second writer.
      // Persisting the completion marker prevents stale browser data from
      // resurrecting a binding that was later cleared on the service.
      if (current.legacyImportCompletedAt) return null;
      const missing = Object.fromEntries(Object.entries(imported)
        .filter(([issueKey]) => !stored[issueKey]));
      return {
        bindings: { ...missing, ...stored },
        state: {
          legacyImportCompletedAt: new Date().toISOString(),
          legacyImportCount: Object.keys(missing).length
        }
      };
    });
  }

  async function applyMutations({ upserts = {}, deletes = [], expectedRevision } = {}) {
    const normalizedUpserts = normalizeBindings(upserts);
    const normalizedDeletes = [...new Set((Array.isArray(deletes) ? deletes : [])
      .map(normalizeIssueKey)
      .filter(Boolean))]
      .slice(0, MAX_BINDINGS);
    const hasExpectedRevision = expectedRevision !== undefined && expectedRevision !== null;
    const normalizedExpectedRevision = hasExpectedRevision ? Number(expectedRevision) : null;
    if (hasExpectedRevision && (!Number.isInteger(normalizedExpectedRevision) || normalizedExpectedRevision < 0)) {
      throw new IssueBindingStoreError("绑定关系 revision 无效，请刷新后重试。", {
        code: "ISSUE_BINDINGS_REVISION_INVALID",
        statusCode: 400
      });
    }
    if (!Object.keys(normalizedUpserts).length && !normalizedDeletes.length) {
      const current = await snapshot();
      if (hasExpectedRevision && current.revision !== normalizedExpectedRevision) {
        throw new IssueBindingStoreError("绑定关系已被其他窗口更新，请刷新后重试。", {
          code: "ISSUE_BINDINGS_REVISION_CONFLICT",
          statusCode: 409
        });
      }
      return current;
    }
    return mutate((current, state) => {
      if (hasExpectedRevision && state.revision !== normalizedExpectedRevision) {
        throw new IssueBindingStoreError("绑定关系已被其他窗口更新，请刷新后重试。", {
          code: "ISSUE_BINDINGS_REVISION_CONFLICT",
          statusCode: 409
        });
      }
      for (const issueKey of normalizedDeletes) delete current[issueKey];
      return { ...current, ...normalizedUpserts };
    });
  }

  async function compareAndSwap(mutations = {}) {
    if (mutations.expectedRevision === undefined || mutations.expectedRevision === null) {
      throw new IssueBindingStoreError("Binding revision is required. Refresh bindings before retrying.", {
        code: "ISSUE_BINDINGS_REVISION_REQUIRED",
        statusCode: 428
      });
    }
    return applyMutations(mutations);
  }

  async function bindIfAbsent(issueKey, value) {
    const normalizedIssueKey = normalizeIssueKey(issueKey);
    const binding = normalizeBinding(value);
    if (!normalizedIssueKey || !binding) {
      throw new IssueBindingStoreError("A valid Jira issue key and Codex binding are required.", {
        code: "ISSUE_BINDING_INVALID",
        statusCode: 400
      });
    }
    let created = false;
    const state = await mutate((stored) => {
      if (stored[normalizedIssueKey]) return null;
      created = true;
      return { ...stored, [normalizedIssueKey]: binding };
    });
    return {
      created,
      binding: state.bindings[normalizedIssueKey],
      state
    };
  }

  return {
    file,
    snapshot,
    importBindings,
    applyMutations,
    compareAndSwap,
    bindIfAbsent
  };
}
