export const CODEX_APPLICATION_RUNTIME_OWNER = Object.freeze({
  STANDALONE_APP_SERVER: "standalone-appserver",
  DESKTOP_APP_SERVER: "desktop-appserver"
});

const APP_SERVER_CAPABILITIES = Object.freeze({
  listSkills: true,
  listThreads: true,
  readThread: true,
  renameThread: true,
  resolveThreadId: true,
  createThread: true,
  startTurn: true,
  interruptTurn: true,
  attachImages: true,
  attachFiles: false,
  invokeSkills: true,
  navigateThread: false,
  resolveConversationTarget: false,
  renderPersistentPanel: false
});

const SAFE_MUTATION_FALLBACK_CODES = new Set([
  "CODEX_ATTACHMENT_UNSUPPORTED",
  "CODEX_APP_SERVER_UNAVAILABLE",
  "CODEX_APP_SERVER_START_TIMEOUT",
  "CODEX_THREAD_OWNED_ELSEWHERE",
  "CODEX_DESKTOP_HOST_UNAVAILABLE",
  "CODEX_DESKTOP_PREFLIGHT_FAILED"
]);

function compactValue(value) {
  return String(value || "").trim();
}

function normalizedThreadId(value) {
  const threadId = compactValue(value);
  return threadId.startsWith("local:") ? threadId.slice("local:".length) : threadId;
}

function runtimeCapabilities(runtime) {
  const declared = runtime?.getCapabilities?.() || {};
  return declared.capabilities && typeof declared.capabilities === "object"
    ? declared.capabilities
    : {};
}

function normalizedAttachments(values) {
  return (Array.isArray(values) ? values : []).flatMap((attachment) => {
    const path = compactValue(attachment?.path || attachment?.fsPath);
    if (!path) return [];
    return [{
      ...attachment,
      path,
      mimeType: compactValue(attachment?.mimeType || attachment?.contentType).toLowerCase()
    }];
  });
}

function attachmentRequirements(values, { referenceFiles = false } = {}) {
  const attachments = normalizedAttachments(values);
  let attachImages = false;
  let attachFiles = false;
  for (const attachment of attachments) {
    if (attachment.mimeType.startsWith("image/") || /\.(?:gif|jpe?g|png|webp)$/i.test(attachment.path)) {
      attachImages = true;
    } else {
      attachFiles = !referenceFiles;
    }
  }
  return { attachImages, attachFiles };
}

function runtimeSupports(runtime, capability, requirements = {}) {
  const capabilities = runtimeCapabilities(runtime);
  if (capability && capabilities[capability] !== true) return false;
  return Object.entries(requirements).every(([name, required]) => !required || capabilities[name] === true);
}

function errorSummary(error) {
  return {
    code: compactValue(error?.code || error?.name || "ERROR"),
    message: compactValue(error?.message || error)
  };
}

function enrichRuntimeResult(result, runtimeOwner, metadata = {}) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...result, runtimeOwner, ...metadata };
  }
  return { value: result, runtimeOwner, ...metadata };
}

function canFallbackAfterError(error, effect) {
  if (effect === "read" || effect === "interrupt") return true;
  if (effect !== "mutation") return true;
  return SAFE_MUTATION_FALLBACK_CODES.has(compactValue(error?.code));
}

function extractAppServerThread(result) {
  return result?.thread || result?.result?.thread || null;
}

function appServerThreadState(payload, requestedThreadId) {
  const result = payload?.result || payload;
  const thread = extractAppServerThread(result);
  const threadId = normalizedThreadId(thread?.id || result?.threadId || requestedThreadId);
  if (!threadId || !thread) {
    const error = new Error("绑定的 Codex 会话不存在或无法由 App Server 读取。");
    error.code = "CODEX_THREAD_NOT_FOUND";
    throw error;
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const lastTurn = turns.at(-1) || null;
  const lastTurnStatus = compactValue(lastTurn?.status?.type || lastTurn?.status || lastTurn?.state?.type);
  const threadStatus = compactValue(thread?.status?.type || thread?.status);
  const busy = ["inProgress", "running", "active"].includes(lastTurnStatus)
    || (!lastTurn && ["inProgress", "running"].includes(threadStatus));
  return {
    threadId,
    hostId: "local",
    busy,
    activeTurnId: busy ? compactValue(lastTurn?.id) : "",
    lastTurnId: compactValue(lastTurn?.id),
    lastTurnStatus,
    threadStatus,
    desktopAdoptable: threadStatus === "notLoaded" || (!threadStatus && !busy),
    canAcceptDirectInput: !busy && thread?.canAcceptDirectInput !== false,
    thread,
    result,
    runtimeOwner: CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER
  };
}

function normalizedAppServerSkills(payload) {
  const values = payload?.skills || payload?.result?.skills || [];
  return (Array.isArray(values) ? values : []).flatMap((skill) => {
    const name = compactValue(skill?.name);
    const path = compactValue(skill?.path);
    return name && path ? [{ ...skill, name, path }] : [];
  });
}

export function createPanelCodexRuntimeAdapter({ request } = {}) {
  if (typeof request !== "function") {
    throw new TypeError("App Server browser adapter requires a local HTTP request function.");
  }
  return {
    id: CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER,

    getCapabilities() {
      return {
        runtimeOwner: CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER,
        capabilities: { ...APP_SERVER_CAPABILITIES }
      };
    },

    async probe() {
      const payload = await request("/api/codex/app-server/probe", { method: "POST", body: {} });
      return enrichRuntimeResult(payload?.appServer || payload, this.id);
    },

    async listSkills(options = {}) {
      const params = new URLSearchParams();
      for (const cwd of Array.isArray(options.cwds) ? options.cwds : []) {
        if (compactValue(cwd)) params.append("cwd", compactValue(cwd));
      }
      if (options.forceReload === true) params.set("forceReload", "true");
      const query = params.toString();
      return normalizedAppServerSkills(await request(`/api/codex/app-server/skills${query ? `?${query}` : ""}`));
    },

    async listThreads(options = {}) {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(options)) {
        if (value !== undefined && value !== null && value !== "") params.set(name, String(value));
      }
      const query = params.toString();
      const payload = await request(`/api/codex/app-server/threads${query ? `?${query}` : ""}`);
      return enrichRuntimeResult(payload?.result || payload, this.id);
    },

    resolveThreadId(threadId) {
      return normalizedThreadId(threadId);
    },

    async readThread(threadId) {
      const payload = await request("/api/codex/app-server/thread-state", {
        method: "POST",
        body: { threadId: normalizedThreadId(threadId) }
      });
      return appServerThreadState(payload, threadId);
    },

    async startConversation(prompt, options = {}) {
      const payload = await request("/api/codex/app-server/analysis", {
        method: "POST",
        body: {
          message: compactValue(prompt),
          title: compactValue(options.title),
          cwd: compactValue(options.cwd),
          model: compactValue(options.model),
          effort: compactValue(options.effort),
          referenceFiles: options.referenceFiles === true,
          outputSchema: options.outputSchema,
          skills: Array.isArray(options.skills) ? options.skills : [],
          attachments: normalizedAttachments(options.attachments)
        }
      });
      return enrichRuntimeResult(payload?.result || payload, this.id);
    },

    async startTurn(threadId, prompt, options = {}) {
      const payload = await request("/api/codex/app-server/turns", {
        method: "POST",
        body: {
          threadId: normalizedThreadId(threadId),
          message: compactValue(prompt),
          cwd: compactValue(options.cwd),
          model: compactValue(options.model),
          effort: compactValue(options.effort),
          referenceFiles: options.referenceFiles === true,
          outputSchema: options.outputSchema,
          skills: Array.isArray(options.skills) ? options.skills : [],
          attachments: normalizedAttachments(options.attachments)
        }
      });
      return enrichRuntimeResult(payload?.result || payload, this.id);
    },

    async interruptTurn(threadId, turnId) {
      const payload = await request("/api/codex/app-server/interrupt", {
        method: "POST",
        body: { threadId: normalizedThreadId(threadId), turnId: compactValue(turnId) }
      });
      return enrichRuntimeResult(payload?.result || payload, this.id);
    },

    async renameThread(threadId, name) {
      const payload = await request("/api/codex/app-server/thread-name", {
        method: "POST",
        body: { threadId: normalizedThreadId(threadId), name: compactValue(name) }
      });
      return enrichRuntimeResult(payload?.result || payload, this.id);
    }
  };
}

export function createCodexRuntimeSelector({
  runtimes = [],
  preferredRuntimeOwner = CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER,
  fallbackRuntimeOwner = CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER
} = {}) {
  const runtimeMap = new Map((Array.isArray(runtimes) ? runtimes : [])
    .filter((runtime) => compactValue(runtime?.id))
    .map((runtime) => [runtime.id, runtime]));
  const diagnostics = {
    selectionCount: 0,
    fallbackCount: 0,
    lastCommand: "",
    lastRuntimeOwner: "",
    lastFallbackFrom: "",
    lastAttempts: [],
    lastError: null
  };

  function orderedRuntimes(runtimeOwner) {
    const order = [runtimeOwner, preferredRuntimeOwner, fallbackRuntimeOwner]
      .map(compactValue)
      .filter((owner, index, values) => owner && values.indexOf(owner) === index);
    for (const owner of runtimeMap.keys()) {
      if (!order.includes(owner)) order.push(owner);
    }
    return order.map((owner) => runtimeMap.get(owner)).filter(Boolean);
  }

  async function execute(command, {
    capability,
    runtimeOwner,
    requirements,
    effect = "read",
    allowFallback = true
  } = {}, invoke) {
    if (typeof invoke !== "function") throw new TypeError("Runtime selector requires an invocation callback.");
    diagnostics.selectionCount += 1;
    diagnostics.lastCommand = compactValue(command);
    diagnostics.lastRuntimeOwner = "";
    diagnostics.lastFallbackFrom = "";
    diagnostics.lastAttempts = [];
    diagnostics.lastError = null;
    const candidates = orderedRuntimes(runtimeOwner)
      .filter((runtime) => runtimeSupports(runtime, capability, requirements));
    if (!candidates.length) {
      const error = new Error(`没有 Codex Runtime 能力可执行：${command || capability || "unknown"}`);
      error.code = "CODEX_RUNTIME_CAPABILITY_UNAVAILABLE";
      diagnostics.lastError = errorSummary(error);
      throw error;
    }

    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const runtime = candidates[index];
      try {
        const result = await invoke(runtime);
        const fallbackFrom = index > 0 ? candidates[0].id : "";
        if (fallbackFrom) diagnostics.fallbackCount += 1;
        diagnostics.lastRuntimeOwner = runtime.id;
        diagnostics.lastFallbackFrom = fallbackFrom;
        diagnostics.lastAttempts.push({ runtimeOwner: runtime.id, ok: true });
        return enrichRuntimeResult(result, runtime.id, fallbackFrom ? {
          runtimeFallback: { from: fallbackFrom, to: runtime.id }
        } : {});
      } catch (error) {
        lastError = error;
        diagnostics.lastAttempts.push({ runtimeOwner: runtime.id, ok: false, error: errorSummary(error) });
        const hasNext = index + 1 < candidates.length;
        if (!allowFallback || !hasNext || !canFallbackAfterError(error, effect)) break;
      }
    }
    diagnostics.lastError = errorSummary(lastError);
    throw lastError;
  }

  return {
    execute,
    getRuntime(runtimeOwner) {
      return runtimeMap.get(runtimeOwner) || null;
    },
    snapshot() {
      return {
        ...diagnostics,
        preferredRuntimeOwner,
        fallbackRuntimeOwner,
        runtimes: Array.from(runtimeMap.values()).map((runtime) => ({
          runtimeOwner: runtime.id,
          capabilities: { ...runtimeCapabilities(runtime) }
        }))
      };
    }
  };
}

export function createCodexApplicationCommands({ selector, desktopHost } = {}) {
  if (!selector || typeof selector.execute !== "function") {
    throw new TypeError("Codex Application Commands require a runtime selector.");
  }
  if (!desktopHost || !compactValue(desktopHost.id)) {
    throw new TypeError("Codex Application Commands require the current Codex Desktop App Server host for navigation and workspace resolution.");
  }

  return {
    listAvailableSkills(options = {}) {
      return selector.execute("listAvailableSkills", {
        capability: "listSkills",
        runtimeOwner: options.runtimeOwner,
        effect: "read"
      }, (runtime) => runtime.listSkills(options));
    },

    listConversations(options = {}) {
      return selector.execute("listConversations", {
        capability: "listThreads",
        runtimeOwner: options.runtimeOwner,
        effect: "read"
      }, (runtime) => runtime.listThreads(options));
    },

    resolveConversationId(threadId, options = {}) {
      const provisional = normalizedThreadId(threadId).startsWith("client-new-thread:");
      return selector.execute("resolveConversationId", {
        capability: "resolveThreadId",
        runtimeOwner: provisional ? desktopHost.id : options.runtimeOwner,
        effect: "read",
        allowFallback: !provisional
      }, (runtime) => runtime.resolveThreadId(threadId, options));
    },

    readConversation(threadId, options = {}) {
      return selector.execute("readConversation", {
        capability: "readThread",
        runtimeOwner: options.runtimeOwner,
        effect: "read"
      }, (runtime) => runtime.readThread(threadId, options));
    },

    currentConversation(options = {}) {
      return selector.execute("currentConversation", {
        capability: "getCurrentThread",
        runtimeOwner: desktopHost.id,
        effect: "read",
        allowFallback: false
      }, (runtime) => runtime.getCurrentThread(options));
    },

    renameConversation(threadId, name, options = {}) {
      return selector.execute("renameConversation", {
        capability: "renameThread",
        runtimeOwner: options.runtimeOwner,
        effect: "mutation",
        allowFallback: options.allowFallback !== false
      }, (runtime) => runtime.renameThread(threadId, name, options));
    },

    async createAnalysisConversation(prompt, options = {}) {
      const desktopOwned = options.desktopOwned === true;
      const requirements = attachmentRequirements(options.attachments, {
        referenceFiles: options.referenceFiles === true || desktopOwned
      });
      const projectId = compactValue(options.projectId);
      const explicitCwd = compactValue(options.cwd);
      let cwd = explicitCwd;
      if (!cwd && projectId) {
        const target = await desktopHost.resolveConversationTarget(projectId, prompt, options);
        cwd = compactValue(target?.cwd);
      }
      return selector.execute("createAnalysisConversation", {
        capability: "createThread",
        // An interactive conversation must be created by the App Server already
        // owned by the current Codex Desktop window. A thread created by a
        // separate App Server keeps its original context_window ownership and
        // the desktop cannot submit its first turn on that window's behalf.
        runtimeOwner: desktopOwned ? desktopHost.id : options.runtimeOwner,
        requirements,
        effect: "mutation",
        // Falling back after an interactive create can leave an orphan thread
        // and make the UI appear to jump before reporting an error.
        allowFallback: !desktopOwned
      }, (runtime) => runtime.startConversation(prompt, { ...options, cwd }));
    },

    sendAnalysisMessage(threadId, prompt, options = {}) {
      const provisional = normalizedThreadId(threadId).startsWith("client-new-thread:");
      return selector.execute("sendAnalysisMessage", {
        capability: "startTurn",
        runtimeOwner: provisional ? desktopHost.id : options.runtimeOwner,
        requirements: attachmentRequirements(options.attachments, {
          referenceFiles: options.referenceFiles === true
        }),
        effect: "mutation",
        allowFallback: !provisional && options.allowFallback !== false
      }, (runtime) => runtime.startTurn(threadId, prompt, options));
    },

    interruptAnalysis(threadId, turnId, options = {}) {
      return selector.execute("interruptAnalysis", {
        capability: "interruptTurn",
        runtimeOwner: options.runtimeOwner,
        effect: "interrupt"
      }, (runtime) => runtime.interruptTurn(threadId, turnId, options));
    },

    openConversation(threadId, options = {}) {
      return selector.execute("openConversation", {
        capability: "navigateThread",
        runtimeOwner: desktopHost.id,
        effect: "read",
        allowFallback: false
      }, (runtime) => runtime.navigateThread(threadId, options));
    },

    snapshot() {
      return selector.snapshot();
    }
  };
}
