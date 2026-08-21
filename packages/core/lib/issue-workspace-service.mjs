import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { normalizeBindingWorkspace, normalizeProjectScope } from "./issue-binding-store.mjs";
import { IssueWorkspaceStoreError } from "./issue-workspace-store.mjs";

function normalizeIssueKey(value) {
  const key = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
    throw new IssueWorkspaceStoreError("Jira Issue Key 无效。", { code: "INVALID_ISSUE_KEY" });
  }
  return key;
}

async function resolveDirectory(value) {
  const requested = String(value || "").trim();
  if (!requested || !isAbsolute(requested)) {
    throw new IssueWorkspaceStoreError("项目目录必须是本机绝对路径。", {
      code: "ISSUE_WORKSPACE_PATH_INVALID"
    });
  }
  let resolved;
  try {
    resolved = await realpath(requested);
    if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new IssueWorkspaceStoreError("项目目录不存在或当前用户无法访问。", {
      code: "ISSUE_WORKSPACE_PATH_UNAVAILABLE",
      statusCode: 404
    });
  }
  return resolved;
}

export function createIssueWorkspaceService({ store, catalog } = {}) {
  if (!store || typeof store.snapshot !== "function" || typeof store.applyMutations !== "function") {
    throw new TypeError("issue workspace service requires a workspace store.");
  }

  async function get(issueKey = "") {
    const state = await store.snapshot();
    const key = issueKey ? normalizeIssueKey(issueKey) : "";
    return {
      revision: Number(state.revision || 0),
      ...(key ? { issueKey: key, binding: state.workspaces?.[key] || null } : { workspaces: state.workspaces || {} })
    };
  }

  async function listAvailable() {
    if (!catalog || typeof catalog.list !== "function") {
      return { host: "", available: false, workspaces: [] };
    }
    const result = await catalog.list();
    const source = Array.isArray(result) ? result : result?.workspaces;
    const seen = new Set();
    const workspaces = [];
    for (const [index, entry] of (Array.isArray(source) ? source : []).entries()) {
      const cwd = String(entry?.cwd || entry?.path || "").trim();
      if (!cwd || !isAbsolute(cwd)) continue;
      const identity = cwd.toLowerCase();
      if (seen.has(identity)) continue;
      seen.add(identity);
      const projectId = String(entry?.projectId || entry?.workspaceId || entry?.id || `workspace:${index + 1}`).trim();
      workspaces.push({
        id: projectId || `workspace:${index + 1}`,
        cwd,
        projectId,
        projectLabel: String(entry?.projectLabel || entry?.title || entry?.label || basename(cwd)).trim() || basename(cwd),
        source: String(entry?.source || result?.host || "host-workspace-registry").trim()
      });
    }
    return {
      host: String(result?.host || "host").trim(),
      available: result?.available !== false,
      workspaces
    };
  }

  async function bind({
    issueKey,
    cwd,
    projectId = "",
    projectLabel = "",
    makeDefault = true,
    replaceExisting = false,
    expectedRevision
  } = {}) {
    const key = normalizeIssueKey(issueKey);
    const resolvedCwd = await resolveDirectory(cwd);
    const current = await store.snapshot();
    if (Number(expectedRevision) !== Number(current.revision)) {
      throw new IssueWorkspaceStoreError("项目绑定已更新，请刷新后重试。", {
        code: "ISSUE_WORKSPACES_REVISION_CONFLICT",
        statusCode: 409,
        details: { expectedRevision, currentRevision: current.revision }
      });
    }
    const existing = current.workspaces?.[key]?.workspace || null;
    const nextScope = normalizeProjectScope({
      id: `path:${resolvedCwd.toLowerCase()}`,
      cwd: resolvedCwd,
      workspaceRoots: [resolvedCwd],
      projectId,
      projectLabel: projectLabel || basename(resolvedCwd),
      kind: projectId ? "project" : "workspace",
      source: "explicit-host-binding",
      observedAt: new Date().toISOString()
    });
    const priorScopes = replaceExisting ? [] : (existing?.projectScopes || []);
    const projectScopes = [...priorScopes.filter((scope) => scope.id !== nextScope.id), nextScope];
    const defaultProjectScopeId = makeDefault || !existing?.defaultProjectScopeId
      ? nextScope.id
      : existing.defaultProjectScopeId;
    const workspace = normalizeBindingWorkspace({
      ...(existing || {}),
      projectScopes,
      defaultProjectScopeId,
      source: "explicit-host-binding",
      observedAt: new Date().toISOString()
    });
    const next = await store.applyMutations({
      expectedRevision: current.revision,
      upserts: { [key]: { workspace, source: "explicit-host-binding" } }
    });
    return { revision: next.revision, issueKey: key, binding: next.workspaces[key] };
  }

  async function unbind({ issueKey, projectScopeId = "", expectedRevision } = {}) {
    const key = normalizeIssueKey(issueKey);
    const current = await store.snapshot();
    if (Number(expectedRevision) !== Number(current.revision)) {
      throw new IssueWorkspaceStoreError("项目绑定已更新，请刷新后重试。", {
        code: "ISSUE_WORKSPACES_REVISION_CONFLICT",
        statusCode: 409,
        details: { expectedRevision, currentRevision: current.revision }
      });
    }
    const entry = current.workspaces?.[key] || null;
    const scopeId = String(projectScopeId || "").trim();
    if (!entry || !scopeId) {
      const next = await store.applyMutations({ expectedRevision: current.revision, deletes: [key] });
      return { revision: next.revision, issueKey: key, binding: null };
    }
    const remaining = (entry.workspace?.projectScopes || []).filter((scope) => scope.id !== scopeId);
    if (remaining.length === entry.workspace?.projectScopes?.length) {
      throw new IssueWorkspaceStoreError("所选项目目录已不在当前 Jira 绑定中。", {
        code: "ISSUE_WORKSPACE_SCOPE_NOT_FOUND",
        statusCode: 404
      });
    }
    if (!remaining.length) {
      const next = await store.applyMutations({ expectedRevision: current.revision, deletes: [key] });
      return { revision: next.revision, issueKey: key, binding: null };
    }
    const requestedDefault = entry.workspace?.defaultProjectScopeId === scopeId
      ? remaining[0].id
      : entry.workspace?.defaultProjectScopeId;
    const workspace = normalizeBindingWorkspace({
      ...entry.workspace,
      projectScopes: remaining,
      defaultProjectScopeId: requestedDefault,
      observedAt: new Date().toISOString()
    });
    const next = await store.applyMutations({
      expectedRevision: current.revision,
      upserts: { [key]: { workspace, source: "explicit-host-binding" } }
    });
    return { revision: next.revision, issueKey: key, binding: next.workspaces[key] };
  }

  return {
    get,
    bind,
    unbind,
    ...(catalog && typeof catalog.list === "function" ? { listAvailable } : {})
  };
}
