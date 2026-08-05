export function normalizeCodexThreadId(value) {
  const threadId = String(value || "").trim();
  return threadId.startsWith("local:") ? threadId.slice("local:".length) : threadId;
}

export function isProvisionalCodexThreadId(value) {
  return normalizeCodexThreadId(value).startsWith("client-new-thread:");
}

export function resolveCodexThreadIdFromSummary(summary, threadId) {
  const normalizedThreadId = normalizeCodexThreadId(threadId);
  if (!normalizedThreadId || !isProvisionalCodexThreadId(normalizedThreadId)) return normalizedThreadId;
  const activeRow = (summary?.window?.sidebar?.rows || []).find((candidate) => (
    candidate?.type === "thread"
    && candidate.active === true
    && normalizeCodexThreadId(candidate.id) === normalizedThreadId
  ));
  const currentThreadId = normalizeCodexThreadId(summary?.window?.thread?.id);
  return activeRow && currentThreadId && !isProvisionalCodexThreadId(currentThreadId)
    ? currentThreadId
    : normalizedThreadId;
}

export function findCodexRpcAsset(entrySource) {
  return String(entrySource || "").match(/["']\.\/(rpc-[A-Za-z0-9_-]+\.js)["']/)?.[1] || "";
}

export function findCodexAppInitialAsset(rpcSource) {
  return String(rpcSource || "").match(/["']\.\/(app-initial-[A-Za-z0-9_-]+\.js)["']/)?.[1] || "";
}

function codexEntryUrls(documentRef) {
  return Array.from(documentRef?.scripts || [])
    .map((script) => String(script.src || ""))
    .filter((url) => url.startsWith("app://") && /\/assets\/index-[^/]+\.js(?:$|\?)/.test(url));
}

function withCodexBridgeTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => {
    if (timer) globalThis.clearTimeout(timer);
  });
}

async function loadCodexAppActions({
  documentRef = globalThis.document,
  fetchFn = globalThis.fetch?.bind(globalThis),
  importModule = (url) => import(url)
} = {}) {
  if (!documentRef || typeof fetchFn !== "function") {
    throw new Error("Codex 桌面桥接环境不可用。");
  }
  const entryUrls = codexEntryUrls(documentRef);
  if (!entryUrls.length) throw new Error("未找到 Codex 客户端入口资源。");
  let lastError = null;
  for (const entryUrl of entryUrls) {
    try {
      const entryResponse = await fetchFn(entryUrl);
      if (!entryResponse?.ok) throw new Error(`入口资源返回 HTTP ${entryResponse?.status || "unknown"}`);
      const rpcAsset = findCodexRpcAsset(await entryResponse.text());
      if (!rpcAsset) throw new Error("入口资源中未找到 Codex RPC 模块。");
      const rpcModule = await importModule(new URL(rpcAsset, entryUrl).href);
      const appActions = rpcModule?.appServices?.appActions;
      if (typeof appActions?.runInPrimaryWindow !== "function") {
        throw new Error("Codex 原生窗口服务不可用。");
      }
      return appActions;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("无法连接 Codex 原生窗口服务。");
}

async function loadCodexDesktopBridge({
  documentRef = globalThis.document,
  fetchFn = globalThis.fetch?.bind(globalThis),
  importModule = (url) => import(url)
} = {}) {
  if (!documentRef || typeof fetchFn !== "function") {
    throw new Error("Codex 桌面桥接环境不可用。");
  }
  const entryUrls = codexEntryUrls(documentRef);
  if (!entryUrls.length) throw new Error("未找到 Codex 客户端入口资源。");

  let lastError = null;
  for (const entryUrl of entryUrls) {
    try {
      const entryResponse = await fetchFn(entryUrl);
      if (!entryResponse?.ok) throw new Error(`入口资源返回 HTTP ${entryResponse?.status || "unknown"}`);
      const rpcAsset = findCodexRpcAsset(await entryResponse.text());
      if (!rpcAsset) throw new Error("入口资源中未找到 Codex RPC 模块。");
      const rpcUrl = new URL(rpcAsset, entryUrl).href;
      const [rpcModule, rpcResponse] = await Promise.all([
        importModule(rpcUrl),
        fetchFn(rpcUrl)
      ]);
      if (!rpcResponse?.ok) throw new Error(`RPC 资源返回 HTTP ${rpcResponse?.status || "unknown"}`);
      const initialAsset = findCodexAppInitialAsset(await rpcResponse.text());
      if (!initialAsset) throw new Error("RPC 资源中未找到 Codex 应用运行时模块。");
      const initialModule = await importModule(new URL(initialAsset, rpcUrl).href);
      const requestFunctions = Object.values(initialModule || {}).filter((value) => {
        if (typeof value !== "function") return false;
        try {
          return /(?:\.|\b)sendRequest\s*\(/.test(String(value));
        } catch {
          return false;
        }
      });
      const request = requestFunctions.find((value) => value.name === "tp") || requestFunctions[0];
      if (typeof request !== "function") throw new Error("Codex 当前会话请求通道不可用。");
      const appActions = rpcModule?.appServices?.appActions;
      if (typeof appActions?.runInPrimaryWindow !== "function") {
        throw new Error("Codex 原生窗口服务不可用。");
      }
      return { appActions, request };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("无法连接 Codex 桌面桥接。");
}

function codexThreadHost(summary, threadId) {
  const normalized = normalizeCodexThreadId(threadId);
  const current = summary?.window?.thread;
  if (normalizeCodexThreadId(current?.id) === normalized) return current?.hostId || "local";
  const row = (summary?.window?.sidebar?.rows || []).find((candidate) => (
    candidate?.type === "thread" && normalizeCodexThreadId(candidate.id) === normalized
  ));
  return row?.hostId || "local";
}

async function readCodexThreadWithBridge(bridge, threadId, { timeoutMs = 12_000 } = {}) {
  const requestedThreadId = normalizeCodexThreadId(threadId);
  if (!requestedThreadId) throw new Error("Codex 会话 ID 为空。");
  const summary = await withCodexBridgeTimeout(
    bridge.appActions.runInPrimaryWindow({ action: { kind: "codex", type: "app.get_summary" } }),
    timeoutMs,
    "读取 Codex 窗口状态超时。"
  );
  const normalizedThreadId = resolveCodexThreadIdFromSummary(summary, requestedThreadId);
  const hostId = codexThreadHost(summary, normalizedThreadId);
  const response = await withCodexBridgeTimeout(
    bridge.request("send-cli-request-for-host", {
      hostId,
      method: "thread/read",
      params: { threadId: normalizedThreadId, includeTurns: true },
      source: "jira-svn-review-preflight"
    }),
    timeoutMs,
    "读取绑定会话状态超时。"
  );
  const thread = response?.thread;
  if (!thread?.id) throw new Error("绑定的 Codex 会话不存在或尚未加载。");
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const lastTurn = turns.at(-1) || null;
  return {
    threadId: normalizedThreadId,
    hostId,
    busy: lastTurn?.status === "inProgress",
    activeTurnId: lastTurn?.status === "inProgress" ? String(lastTurn.id || "") : "",
    lastTurnId: String(lastTurn?.id || ""),
    lastTurnStatus: String(lastTurn?.status || ""),
    canAcceptDirectInput: thread.canAcceptDirectInput !== false
  };
}

export async function resolveCodexThreadId(threadId, options = {}) {
  const normalizedThreadId = normalizeCodexThreadId(threadId);
  if (!normalizedThreadId || !isProvisionalCodexThreadId(normalizedThreadId)) return normalizedThreadId;
  const appActions = await loadCodexAppActions(options);
  const summary = await withCodexBridgeTimeout(
    appActions.runInPrimaryWindow({ action: { kind: "codex", type: "app.get_summary" } }),
    options.timeoutMs || 12_000,
    "读取 Codex 窗口状态超时。"
  );
  return resolveCodexThreadIdFromSummary(summary, normalizedThreadId);
}

export async function readCodexThreadState(threadId, options = {}) {
  const bridge = await loadCodexDesktopBridge(options);
  return readCodexThreadWithBridge(bridge, threadId, options);
}

export async function startCodexThreadTurn(threadId, prompt, options = {}) {
  const text = String(prompt || "").trim();
  if (!text) throw new Error("Codex 审查消息为空。");
  const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
    .slice(0, 20)
    .flatMap((attachment) => {
      const path = String(attachment?.path || attachment?.fsPath || "").trim();
      if (!path || path.length > 4_000) return [];
      const label = String(attachment?.label || attachment?.name || path.split(/[\\/]/).at(-1) || "附件")
        .trim()
        .slice(0, 300);
      return [{ label, path, fsPath: path }];
    });
  const bridge = await loadCodexDesktopBridge(options);
  const state = await readCodexThreadWithBridge(bridge, threadId, options);
  if (state.busy) {
    const error = new Error("绑定会话当前正在执行其他任务。请等待当前回复结束，或关闭 Codex 审查后改为人工审核。");
    error.code = "CODEX_THREAD_BUSY";
    error.turnId = state.activeTurnId;
    throw error;
  }
  if (!state.canAcceptDirectInput) {
    const error = new Error("绑定会话当前不能接收新消息，可关闭 Codex 审查并改为人工审核。");
    error.code = "CODEX_THREAD_NOT_WRITABLE";
    throw error;
  }
  const result = await withCodexBridgeTimeout(
    bridge.request("start-turn-for-host", {
      hostId: state.hostId,
      conversationId: state.threadId,
      params: {
        clientUserMessageId: globalThis.crypto?.randomUUID?.(),
        input: [{ type: "text", text, text_elements: [] }],
        attachments,
        useAppServerPermissionDefault: true
      }
    }),
    options.timeoutMs || 20_000,
    "Codex 没有在限定时间内确认审查消息。"
  );
  const turnId = String(result?.turn?.id || "").trim();
  if (!turnId) throw new Error("Codex 已接收请求，但没有返回真实 turnId。");
  return { threadId: state.threadId, hostId: state.hostId, turnId };
}

export async function interruptCodexThreadTurn(threadId, turnId, options = {}) {
  const normalizedThreadId = normalizeCodexThreadId(threadId);
  const normalizedTurnId = String(turnId || "").trim();
  if (!normalizedThreadId || !normalizedTurnId) throw new Error("缺少要取消的 Codex 会话或 turnId。");
  const bridge = await loadCodexDesktopBridge(options);
  const state = await readCodexThreadWithBridge(bridge, normalizedThreadId, options);
  const result = await withCodexBridgeTimeout(
    bridge.request("send-cli-request-for-host", {
      hostId: state.hostId,
      method: "turn/interrupt",
      params: { threadId: state.threadId, turnId: normalizedTurnId },
      source: "jira-svn-review-cancel"
    }),
    options.timeoutMs || 10_000,
    "取消 Codex 审查超时。"
  );
  return { threadId: state.threadId, turnId: normalizedTurnId, result };
}

export async function navigateCodexThread(threadId, {
  documentRef = globalThis.document,
  fetchFn = globalThis.fetch?.bind(globalThis),
  importModule = (url) => import(url)
} = {}) {
  const normalizedThreadId = normalizeCodexThreadId(threadId);
  if (!normalizedThreadId) throw new Error("Codex 会话 ID 为空。");
  if (!documentRef || typeof fetchFn !== "function") {
    throw new Error("Codex 页面导航环境不可用。");
  }

  const entryUrls = codexEntryUrls(documentRef);
  if (!entryUrls.length) throw new Error("未找到 Codex 客户端入口资源。");

  let lastError = null;
  for (const entryUrl of entryUrls) {
    try {
      const response = await fetchFn(entryUrl);
      if (!response?.ok) throw new Error(`入口资源返回 HTTP ${response?.status || "unknown"}`);
      const rpcAsset = findCodexRpcAsset(await response.text());
      if (!rpcAsset) throw new Error("入口资源中未找到 Codex RPC 模块。");
      const rpcModule = await importModule(new URL(rpcAsset, entryUrl).href);
      const appActions = rpcModule?.appServices?.appActions;
      if (typeof appActions?.runInPrimaryWindow !== "function") {
        throw new Error("Codex 原生任务导航服务不可用。");
      }
      await appActions.runInPrimaryWindow({
        action: {
          kind: "codex",
          type: "windows.show_thread",
          windowId: "current",
          threadId: normalizedThreadId
        }
      });
      return normalizedThreadId;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("无法打开 Codex 会话。");
}
