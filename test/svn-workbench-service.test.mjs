import assert from "node:assert/strict";
import test from "node:test";
import { createSvnWorkbenchService } from "../lib/svn-workbench-service.mjs";

function harness({ dispatchFails = false } = {}) {
  const calls = [];
  const review = { id: "review-1", issue: { key: "CT-1" }, threadId: "local:thread-1", workingCopy: { root: "F:\\repo", scopeRoot: "F:\\repo" }, codexReviewEnabled: true, status: "prepared" };
  const reviews = {
    inspect: async (input) => { calls.push(["inspect", input]); return { threadId: input.threadId, changes: [] }; },
    listCommitHistory: () => [],
    findLatestReview: () => null,
    previewDiff: async (input) => ({ available: true, ...input }),
    openExternalDiff: async (input) => { calls.push(["openExternalDiff", input]); return { ok: true, path: input.path }; },
    recordBaseline: async (input) => input,
    createReview: async (input) => ({ review: { ...review, codexReviewEnabled: input.codexReviewEnabled }, prompt: input.codexReviewEnabled ? "review prompt" : "", outputSchema: input.codexReviewEnabled ? { type: "object" } : null }),
    beginDispatch: async (id, input) => ({ ...review, id, status: "running", auditTurnId: input.auditTurnId }),
    failDispatch: async (id, message) => ({ ...review, id, status: "dispatch_failed", error: message }),
    poll: async () => {},
    getReview: (id) => ({ ...review, id }),
    cancel: async (id) => ({ ...review, id, status: "cancelled" }),
    retryDispatch: async (id) => ({ review: { ...review, id }, prompt: "retry" }),
    confirm: async () => ({ confirmationToken: "token", expiresAt: new Date().toISOString() }),
    commit: async () => ({ ...review, status: "committed" }),
    reconcileCommit: async () => ({ ...review, status: "committed" }),
    confirmCommitted: async () => ({ ...review, status: "committed" }),
    abandon: async () => ({ ...review, status: "abandoned" })
  };
  const runtime = {
    startReadOnlyTurn: async () => {
      if (dispatchFails) throw new Error("context window is owned elsewhere");
      return { threadId: "local:thread-1", turnId: "turn-1" };
    }
  };
  const service = createSvnWorkbenchService({
    loadConfig: async () => ({ configured: true, token: "secret" }),
    jira: { fetchIssue: async (_config, key) => ({ key, title: "Issue", description: "", fixVersions: [] }) },
    issueBindings: { snapshot: async () => ({ revision: 4, bindings: { "CT-1": {
      threadId: "local:thread-1",
      workspaceContext: {
        cwd: "F:\\repo",
        workspaceRoots: ["F:\\repo"],
        projectId: "project-1",
        source: "service-binding"
      }
    } } }) },
    reviews,
    runtime,
    buildCommitMessage: (issue) => issue.key
  });
  return { service, calls };
}

test("SVN workbench resolves the project from the service-owned issue binding", async () => {
  const { service, calls } = harness();
  const result = await service.context({ issueKey: "ct-1" });
  assert.equal(result.context.threadId, "local:thread-1");
  assert.equal(result.message, "CT-1");
  assert.equal(calls[0][1].issue.key, "CT-1");
  assert.equal(calls[0][1].workspaceContext.cwd, "F:\\repo");
  assert.equal(calls[0][1].workspaceContext.source, "service-binding");
});

test("SVN workbench rejects a stale caller thread instead of inspecting outside the current binding", async () => {
  const { service } = harness();
  await assert.rejects(
    service.context({ issueKey: "CT-1", threadId: "another-thread" }),
    (error) => error.code === "SVN_BOUND_THREAD_CHANGED" && error.statusCode === 409
  );
});

test("TortoiseSVN external diff uses the service-owned binding workspace", async () => {
  const { service, calls } = harness();
  const result = await service.openExternalDiff({ issueKey: "ct-1", path: "src/a.go" });
  assert.deepEqual(result, { ok: true, path: "src/a.go" });
  const call = calls.find(([name]) => name === "openExternalDiff");
  assert.equal(call[1].threadId, "local:thread-1");
  assert.equal(call[1].workspaceContext.cwd, "F:\\repo");
  assert.equal(call[1].path, "src/a.go");
});

test("official Codex review dispatch uses App Server and records the real turn", async () => {
  const { service } = harness();
  const result = await service.createReview({ issueKey: "CT-1", selectedPaths: ["src/a.go"], codexReviewEnabled: true, dispatchCodexReview: true });
  assert.equal(result.review.status, "running");
  assert.equal(result.dispatch.turnId, "turn-1");
  assert.equal(result.prompt, "");
});

test("App Server dispatch failure degrades to a cancellable review instead of losing the snapshot", async () => {
  const { service } = harness({ dispatchFails: true });
  const result = await service.createReview({ issueKey: "CT-1", selectedPaths: ["src/a.go"], codexReviewEnabled: true, dispatchCodexReview: true });
  assert.equal(result.review.status, "dispatch_failed");
  assert.match(result.review.error, /人工审核/);
  assert.equal(result.dispatch.started, false);
});

test("SVN review operations reject a review id from another Jira issue", async () => {
  const { service } = harness();
  await assert.rejects(
    service.getReview("review-1", "CT-2"),
    (error) => error.code === "SVN_REVIEW_ISSUE_MISMATCH" && error.statusCode === 409
  );
  await assert.rejects(
    service.abandonReview("review-1", { acknowledged: true }, "CT-2"),
    (error) => error.code === "SVN_REVIEW_ISSUE_MISMATCH"
  );
});
