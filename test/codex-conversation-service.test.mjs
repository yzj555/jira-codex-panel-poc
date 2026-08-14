import assert from "node:assert/strict";
import test from "node:test";
import { createCodexConversationService } from "../lib/codex-conversation-service.mjs";

function harness() {
  let state = {
    revision: 2,
    bindings: {
      "CT-1": {
        threadId: "old-thread",
        workspace: { cwd: "F:\\legacy", workspaceRoots: ["F:\\legacy"], source: "binding" }
      }
    }
  };
  const appServerThread = (threadId = "thread-2") => ({
    id: threadId,
    name: `分析 ${threadId}`,
    preview: "需求上下文",
    cwd: "F:\\repo",
    workspaceRoots: ["F:\\repo"],
    projectAssignment: { projectId: "captain-tsubasa" },
    status: { type: "notLoaded" }
  });
  const runtime = {
    id: "standalone-appserver",
    listThreads: async () => ({ data: [appServerThread()] }),
    readThread: async (threadId) => ({ thread: appServerThread(threadId) })
  };
  const issueBindings = {
    snapshot: async () => structuredClone(state),
    applyMutations: async ({ upserts = {}, deletes = [], expectedRevision }) => {
      if (expectedRevision !== state.revision) {
        const error = new Error("conflict");
        error.code = "ISSUE_BINDINGS_REVISION_CONFLICT";
        throw error;
      }
      const nextBindings = { ...state.bindings, ...upserts };
      deletes.forEach((key) => delete nextBindings[key]);
      state = { revision: state.revision + 1, bindings: nextBindings };
      return structuredClone(state);
    }
  };
  return { service: createCodexConversationService({ runtime, issueBindings }), state: () => state };
}

test("conversation service lists official App Server threads", async () => {
  const { service } = harness();
  const result = await service.listThreads({ limit: 20 });
  assert.equal(result.runtimeOwner, "standalone-appserver");
  assert.deepEqual(result.threads.map((thread) => thread.id), ["thread-2"]);
  assert.equal(result.threads[0].title, "分析 thread-2");
  assert.deepEqual(result.threads[0].boundIssueKeys, []);
  assert.equal(result.threads[0].workspace.projectId, "captain-tsubasa");
  assert.deepEqual(result.threads[0].workspace.workspaceRoots, ["F:\\repo"]);
  assert.equal(result.bindingsRevision, 2);
});

test("conversation service binds and clears with revision checks", async () => {
  const { service, state } = harness();
  const bound = await service.bindIssue({ issueKey: "ct-2", threadId: "thread-2", expectedRevision: 2 });
  assert.equal(bound.binding.threadId, "thread-2");
  assert.equal(bound.binding.runtimeOwner, "standalone-appserver");
  assert.equal(bound.binding.workspace.cwd, "F:\\repo");
  assert.equal(bound.binding.workspace.projectId, "captain-tsubasa");
  assert.equal(state().revision, 3);
  await assert.rejects(
    service.clearBinding({ issueKey: "CT-2", expectedRevision: 2 }),
    (error) => error.code === "ISSUE_BINDINGS_REVISION_CONFLICT"
  );
  const cleared = await service.clearBinding({ issueKey: "CT-2", expectedRevision: 3 });
  assert.equal(cleared.binding, null);
});

test("conversation service requires explicit confirmation before stealing a thread", async () => {
  const { service } = harness();
  await service.bindIssue({ issueKey: "CT-2", threadId: "shared", expectedRevision: 2 });
  await assert.rejects(
    service.bindIssue({ issueKey: "CT-3", threadId: "shared", expectedRevision: 3 }),
    (error) => error.code === "CODEX_THREAD_ALREADY_BOUND"
  );
  const rebound = await service.bindIssue({
    issueKey: "CT-3",
    threadId: "shared",
    expectedRevision: 3,
    replaceExistingThreadBinding: true
  });
  assert.deepEqual(rebound.replacedIssueKeys, ["CT-2"]);
});

test("conversation service rejects invalid Jira keys before mutating bindings", async () => {
  const { service, state } = harness();
  await assert.rejects(
    service.bindIssue({ issueKey: "not a key", threadId: "thread-2", expectedRevision: 2 }),
    (error) => error.code === "INVALID_ISSUE_KEY" && error.statusCode === 400
  );
  await assert.rejects(
    service.clearBinding({ issueKey: "../CT-2", expectedRevision: 2 }),
    (error) => error.code === "INVALID_ISSUE_KEY" && error.statusCode === 400
  );
  assert.equal(state().revision, 2);
});

test("conversation service does not infer Codex projects from conversation rows", async () => {
  const { service } = harness();
  assert.equal("listWorkspaces" in service, false);
  assert.equal("resolveWorkspace" in service, false);
});

test("explicit binding workspace supplements App Server metadata", async () => {
  const { service } = harness();
  const result = await service.bindIssue({
    issueKey: "CT-2",
    threadId: "thread-2",
    expectedRevision: 2,
    workspace: {
      cwd: "F:\\explicit",
      workspaceRoots: ["F:\\explicit", "F:\\shared"],
      projectId: "explicit-project",
      projectLabel: "Explicit project"
    }
  });
  assert.equal(result.binding.workspace.cwd, "F:\\explicit");
  assert.equal(result.binding.workspace.projectId, "explicit-project");
  assert.deepEqual(result.binding.workspace.workspaceRoots, ["F:\\explicit", "F:\\shared"]);
});

test("explicit multi-project binding survives App Server thread metadata", async () => {
  const { service } = harness();
  const result = await service.bindIssue({
    issueKey: "CT-2",
    threadId: "thread-2",
    expectedRevision: 2,
    workspace: {
      projectScopes: [
        { id: "project:server", cwd: "F:\\server", projectId: "server", projectLabel: "Server" },
        { id: "project:client", cwd: "F:\\client", projectId: "client", projectLabel: "Client" }
      ],
      defaultProjectScopeId: "project:client"
    }
  });
  assert.equal(result.binding.workspace.cwd, "F:\\client");
  assert.equal(result.binding.workspace.defaultProjectScopeId, "project:client");
  assert.deepEqual(
    result.binding.workspace.projectScopes.map((scope) => [scope.id, scope.cwd]),
    [["project:server", "F:\\server"], ["project:client", "F:\\client"]]
  );
});

test("choosing the target thread workspace replaces stale project scopes", async () => {
  const { service } = harness();
  const result = await service.bindIssue({
    issueKey: "CT-1",
    threadId: "thread-2",
    expectedRevision: 2,
    workspaceSelection: "thread"
  });

  assert.equal(result.binding.workspace.cwd, "F:\\repo");
  assert.equal(result.binding.workspace.projectId, "captain-tsubasa");
  assert.deepEqual(result.binding.workspace.projectScopes.map((scope) => scope.cwd), ["F:\\repo"]);
});
