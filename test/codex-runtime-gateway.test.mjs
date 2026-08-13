import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_RUNTIME_OWNER,
  createCodexRuntimeGateway
} from "../lib/codex-runtime-gateway.mjs";

function createRuntime() {
  const calls = [];
  const runtime = {
    snapshot: () => ({ state: "ready" }),
    probe: async () => ({ ok: true, runtime: { state: "ready" } }),
    listSkills: async (options) => ({ data: [], options }),
    listThreads: async (options) => ({ data: [], options }),
    readThread: async (threadId) => ({ thread: { id: threadId } }),
    readTurnResult: async (threadId, turnId) => ({ threadId, turnId, status: "completed" }),
    setThreadName: async (threadId, name) => ({ threadId, name }),
    startReadOnlyAnalysis: async () => ({ threadId: "thread-new", turnId: "turn-new" }),
    startReadOnlyTurn: async (threadId) => ({ threadId, turnId: "turn-existing" }),
    interruptTurn: async (threadId, turnId) => ({ threadId, turnId }),
    close: async () => { calls.push("close"); }
  };
  return { runtime, calls };
}

test("Codex runtime gateway exposes stable capabilities and persists runtime ownership", async () => {
  const harness = createRuntime();
  const gateway = createCodexRuntimeGateway({ appServer: harness.runtime });

  assert.equal(gateway.id, CODEX_RUNTIME_OWNER.STANDALONE_APP_SERVER);
  assert.equal(gateway.getCapabilities().capabilities.navigateThread, false);
  assert.equal(gateway.getCapabilities().capabilities.renameThread, true);
  assert.equal(gateway.snapshot().provider.state, "ready");
  assert.equal((await gateway.probe()).runtimeOwner, "standalone-appserver");
  assert.equal((await gateway.readThread("thread-1")).runtimeOwner, "standalone-appserver");
  assert.equal((await gateway.readTurnResult("thread-1", "turn-1")).status, "completed");
  assert.equal((await gateway.renameThread("thread-1", "Review")).runtimeOwner, "standalone-appserver");
  assert.equal((await gateway.startReadOnlyAnalysis({ message: "analyze" })).runtimeOwner, "standalone-appserver");
  assert.equal((await gateway.startReadOnlyTurn("thread-1", { message: "continue" })).runtimeOwner, "standalone-appserver");
  assert.equal((await gateway.interruptTurn("thread-1", "turn-1")).runtimeOwner, "standalone-appserver");

  await gateway.close();
  assert.deepEqual(harness.calls, ["close"]);
});
