import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIssueBindingStore,
  normalizeBindingWorkspace
} from "../lib/issue-binding-store.mjs";

test("binding workspace keeps multiple project scopes and promotes one primary directory", () => {
  const workspace = normalizeBindingWorkspace({
    projectScopes: [
      {
        id: "project:server",
        cwd: "F:\\repo\\server",
        workspaceRoots: ["F:\\repo\\server"],
        projectId: "server",
        projectLabel: "Server"
      },
      {
        id: "project:client",
        cwd: "F:\\repo\\client",
        workspaceRoots: ["F:\\repo\\client"],
        projectId: "client",
        projectLabel: "Client"
      }
    ],
    defaultProjectScopeId: "project:client"
  });
  assert.equal(workspace.cwd, "F:\\repo\\client");
  assert.equal(workspace.projectId, "client");
  assert.equal(workspace.defaultProjectScopeId, "project:client");
  assert.deepEqual(workspace.workspaceRoots, ["F:\\repo\\server", "F:\\repo\\client"]);
  assert.deepEqual(workspace.projectScopes.map((scope) => scope.id), ["project:server", "project:client"]);
});

test("path-only project scope keeps its stable id without turning it into a Codex project id", () => {
  const first = normalizeBindingWorkspace({
    projectScopes: [{ id: "path:f:\\workspace\\tools", cwd: "F:\\workspace\\tools" }],
    defaultProjectScopeId: "path:f:\\workspace\\tools"
  });
  const roundTripped = normalizeBindingWorkspace(first);

  assert.equal(roundTripped.projectScopes[0].id, "path:f:\\workspace\\tools");
  assert.equal(roundTripped.projectScopes[0].projectId, "");
  assert.equal(roundTripped.defaultProjectScopeId, "path:f:\\workspace\\tools");
});

test("issue bindings migrate from renderer storage and persist runtime ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-bindings-"));
  const file = join(directory, "issue-bindings.json");
  try {
    const store = createIssueBindingStore({ file });
    const imported = await store.importBindings({
      "ct-13349": {
        threadId: "thread-legacy",
        threadTitle: "legacy task",
        boundAt: "2026-08-01T00:00:00.000Z"
      },
      invalid: { threadId: "ignored" }
    });
    assert.deepEqual(Object.keys(imported.bindings), ["CT-13349"]);
    assert.equal(imported.bindings["CT-13349"].runtimeOwner, "desktop-appserver");
    assert.ok(imported.bindings["CT-13349"].importedAt);
    assert.ok(imported.legacyImportCompletedAt);
    assert.equal(imported.legacyImportCount, 1);

    const repeatedImport = await store.importBindings({
      "CT-13349": { threadId: "stale-browser-copy" },
      "CT-13404": { threadId: "thread-new", runtimeOwner: "standalone-appserver" }
    });
    assert.equal(repeatedImport.revision, imported.revision);
    const migrated = await store.snapshot();
    assert.equal(migrated.bindings["CT-13349"].threadId, "thread-legacy");
    assert.equal(migrated.bindings["CT-13404"], undefined);

    await store.applyMutations({
      deletes: ["CT-13349"],
      upserts: {
        "CT-13404": {
          threadId: "thread-rebound",
          runtimeOwner: "legacy-desktop",
          workspace: {
            cwd: "F:\\repo",
            workspaceRoots: ["F:\\repo", "F:\\repo"],
            projectId: "captain-tsubasa",
            projectLabel: "Captain Tsubasa",
            source: "explicit-binding"
          }
        }
      }
    });
    const reopened = createIssueBindingStore({ file });
    const persisted = await reopened.snapshot();
    assert.equal(persisted.bindings["CT-13349"], undefined);
    assert.equal(persisted.bindings["CT-13404"].threadId, "thread-rebound");
    assert.equal(persisted.bindings["CT-13404"].runtimeOwner, "desktop-appserver");
    assert.equal(persisted.bindings["CT-13404"].workspace.cwd, "F:\\repo");
    assert.deepEqual(persisted.bindings["CT-13404"].workspace.workspaceRoots, ["F:\\repo"]);
    assert.equal(persisted.bindings["CT-13404"].workspace.projectId, "captain-tsubasa");
    assert.equal(persisted.bindings["CT-13404"].workspace.projectScopes.length, 1);
    assert.equal(persisted.bindings["CT-13404"].workspace.projectScopes[0].cwd, "F:\\repo");
    assert.equal(persisted.revision, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("binding mutations use revision compare-and-swap to reject stale updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-binding-cas-"));
  const file = join(directory, "issue-bindings.json");
  try {
    const store = createIssueBindingStore({ file });
    const initial = await store.snapshot();
    await assert.rejects(
      store.compareAndSwap({ upserts: { "CT-1": { threadId: "thread-missing-revision" } } }),
      (error) => error.code === "ISSUE_BINDINGS_REVISION_REQUIRED" && error.statusCode === 428
    );
    const first = await store.compareAndSwap({
      expectedRevision: initial.revision,
      upserts: { "CT-1": { threadId: "thread-1" } }
    });
    assert.equal(first.revision, initial.revision + 1);
    await assert.rejects(
      store.compareAndSwap({
        expectedRevision: initial.revision,
        upserts: { "CT-1": { threadId: "thread-stale" } }
      }),
      (error) => error.code === "ISSUE_BINDINGS_REVISION_CONFLICT" && error.statusCode === 409
    );
    assert.equal((await store.snapshot()).bindings["CT-1"].threadId, "thread-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bindIfAbsent atomically preserves an existing automated binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-binding-if-absent-"));
  const file = join(directory, "issue-bindings.json");
  try {
    const store = createIssueBindingStore({ file });
    const first = await store.bindIfAbsent("ct-9", { threadId: "thread-first" });
    const second = await store.bindIfAbsent("CT-9", { threadId: "thread-second" });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.binding.threadId, "thread-first");
    assert.equal(second.state.revision, first.state.revision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
