export const CODEX_RUNTIME_OWNER = Object.freeze({
  STANDALONE_APP_SERVER: "standalone-appserver"
});

export const CODEX_RUNTIME_CAPABILITIES = Object.freeze({
  listSkills: true,
  listThreads: true,
  readThread: true,
  createThread: true,
  startTurn: true,
  interruptTurn: true,
  attachImages: true,
  attachFiles: false,
  invokeSkills: true,
  navigateThread: false,
  renderPersistentPanel: false
});

function requireRuntime(runtime) {
  if (!runtime || typeof runtime.snapshot !== "function") {
    throw new TypeError("Codex runtime gateway requires an App Server runtime.");
  }
  return runtime;
}

function ownedResult(result, runtimeOwner) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return { ...result, runtimeOwner };
}

export function createCodexRuntimeGateway({
  appServer,
  runtimeOwner = CODEX_RUNTIME_OWNER.STANDALONE_APP_SERVER
} = {}) {
  const runtime = requireRuntime(appServer);

  return {
    id: runtimeOwner,

    getCapabilities() {
      return {
        runtimeOwner,
        capabilities: { ...CODEX_RUNTIME_CAPABILITIES }
      };
    },

    snapshot() {
      return {
        runtimeOwner,
        capabilities: { ...CODEX_RUNTIME_CAPABILITIES },
        provider: runtime.snapshot()
      };
    },

    async probe() {
      return ownedResult(await runtime.probe(), runtimeOwner);
    },

    listSkills(options) {
      return runtime.listSkills(options);
    },

    listThreads(options) {
      return runtime.listThreads(options);
    },

    async readThread(threadId, options) {
      return ownedResult(await runtime.readThread(threadId, options), runtimeOwner);
    },

    async startReadOnlyAnalysis(options) {
      return ownedResult(await runtime.startReadOnlyAnalysis(options), runtimeOwner);
    },

    async startReadOnlyTurn(threadId, options) {
      return ownedResult(await runtime.startReadOnlyTurn(threadId, options), runtimeOwner);
    },

    async interruptTurn(threadId, turnId) {
      return ownedResult(await runtime.interruptTurn(threadId, turnId), runtimeOwner);
    },

    close() {
      return runtime.close();
    }
  };
}
