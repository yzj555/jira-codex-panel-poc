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
      const hostRequest = Object.values(initialModule || {}).find((value) => (
        typeof value === "function" && value.name === "vp"
      ));
      const appActions = rpcModule?.appServices?.appActions;
      if (typeof appActions?.runInPrimaryWindow !== "function") {
        throw new Error("Codex 原生窗口服务不可用。");
      }
      return { appActions, request, hostRequest };
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

export async function listCodexSkills(options = {}) {
  const bridge = await loadCodexDesktopBridge(options);
  const timeoutMs = options.timeoutMs || 12_000;
  const summary = await withCodexBridgeTimeout(
    bridge.appActions.runInPrimaryWindow({ action: { kind: "codex", type: "app.get_summary" } }),
    timeoutMs,
    "读取 Codex 窗口状态超时。"
  );
  const currentThreadId = normalizeCodexThreadId(summary?.window?.thread?.id);
  const hostId = currentThreadId ? codexThreadHost(summary, currentThreadId) : "local";
  const params = {
    forceReload: options.forceReload === true
  };
  if (Array.isArray(options.cwds) && options.cwds.length) {
    params.cwds = options.cwds.map((cwd) => String(cwd || "").trim()).filter(Boolean).slice(0, 50);
  }
  const response = await withCodexBridgeTimeout(
    bridge.request("send-cli-request-for-host", {
      hostId,
      method: "skills/list",
      params,
      source: "jira-template-skill-list"
    }),
    timeoutMs,
    "读取 Codex 技能列表超时。"
  );
  const groups = Array.isArray(response?.data)
    ? response.data
    : Array.isArray(response?.result?.data) ? response.result.data : [];
  const unique = new Map();
  for (const group of groups) {
    for (const skill of Array.isArray(group?.skills) ? group.skills : []) {
      const name = String(skill?.name || "").trim();
      const path = String(skill?.path || "").trim();
      if (!name || !path) continue;
      const key = path.toLowerCase();
      if (unique.has(key)) continue;
      unique.set(key, {
        name,
        path,
        scope: String(skill?.scope || ""),
        enabled: skill?.enabled !== false,
        description: String(skill?.description || skill?.shortDescription || ""),
        shortDescription: String(skill?.shortDescription || skill?.interface?.short_description || "")
      });
    }
  }
  return Array.from(unique.values()).sort((left, right) => (
    left.name.localeCompare(right.name) || left.path.localeCompare(right.path)
  ));
}

function normalizedCodexAttachments(values) {
  return (Array.isArray(values) ? values : [])
    .slice(0, 20)
    .flatMap((attachment) => {
      const path = String(attachment?.path || attachment?.fsPath || "").trim();
      if (!path || path.length > 4_000) return [];
      const label = String(attachment?.label || attachment?.name || path.split(/[\\/]/).at(-1) || "附件")
        .trim()
        .slice(0, 300);
      return [{
        label,
        path,
        fsPath: path,
        mimeType: String(attachment?.mimeType || attachment?.contentType || "").trim().toLowerCase()
      }];
    });
}

const CODEX_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);
const CODEX_IMAGE_PATH_PATTERN = /\.(?:gif|jpe?g|png|webp)$/i;

function codexAttachmentInputs(values) {
  const imageInputs = [];
  const fileAttachments = [];
  for (const attachment of normalizedCodexAttachments(values)) {
    const { mimeType, ...fileAttachment } = attachment;
    if (CODEX_IMAGE_MIME_TYPES.has(mimeType) || CODEX_IMAGE_PATH_PATTERN.test(attachment.path)) {
      imageInputs.push({ type: "localImage", path: attachment.path });
    } else {
      fileAttachments.push(fileAttachment);
    }
  }
  return { imageInputs, fileAttachments };
}

function normalizedCodexSkills(values) {
  return (Array.isArray(values) ? values : [])
    .slice(0, 10)
    .flatMap((skill) => {
      const name = String(skill?.name || "").trim();
      const path = String(skill?.path || "").trim();
      return name && path ? [{ type: "skill", name, path }] : [];
    })
    .filter((skill, index, all) => all.findIndex((candidate) => candidate.path === skill.path) === index);
}

async function resolveCodexNewConversationTarget(bridge, projectId, prompt, timeoutMs) {
  if (typeof bridge.hostRequest !== "function") {
    throw new Error("当前 Codex 版本未提供新会话工作区解析通道。");
  }
  const normalizedProjectId = String(projectId || "").trim();
  if (normalizedProjectId) {
    const response = await withCodexBridgeTimeout(
      bridge.hostRequest("get-global-state", { params: { key: "local-projects" } }),
      timeoutMs,
      "读取 Codex 项目信息超时。"
    );
    const project = response?.value?.[normalizedProjectId];
    const workspaceRoots = (Array.isArray(project?.rootPaths) ? project.rootPaths : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const cwd = workspaceRoots[0] || "";
    if (!cwd) throw new Error("绑定的 Codex 项目不存在或没有可用的本地目录。");
    return {
      hostId: "local",
      cwd,
      workspaceRoots,
      workspaceKind: "project",
      projectAssignment: {
        projectKind: "local",
        projectId: normalizedProjectId,
        cwd,
        pendingCoreUpdate: false
      }
    };
  }

  const workspace = await withCodexBridgeTimeout(
    bridge.hostRequest("projectless-thread-cwd", {
      params: { prompt: String(prompt || "").trim() || null }
    }),
    timeoutMs,
    "创建 Codex 独立会话目录超时。"
  );
  const cwd = String(workspace?.cwd || "").trim();
  const workspaceRoot = String(workspace?.workspaceRoot || "").trim();
  const projectlessOutputDirectory = String(workspace?.outputDirectory || "").trim();
  if (!cwd || !workspaceRoot || !projectlessOutputDirectory) {
    throw new Error("Codex 没有返回完整的独立会话目录信息。");
  }
  return {
    hostId: "local",
    cwd,
    workspaceRoots: [workspaceRoot],
    workspaceKind: "projectless",
    projectlessOutputDirectory
  };
}

export async function startCodexConversation(prompt, options = {}) {
  const text = String(prompt || "").trim();
  if (!text) throw new Error("Codex 消息为空。");
  const timeoutMs = options.timeoutMs || 30_000;
  const bridge = await loadCodexDesktopBridge(options);
  const target = await resolveCodexNewConversationTarget(
    bridge,
    options.projectId,
    text,
    timeoutMs
  );
  const { imageInputs, fileAttachments } = codexAttachmentInputs(options.attachments);
  const skills = normalizedCodexSkills(options.skills);
  const title = String(options.title || "").trim().slice(0, 200);
  const result = await withCodexBridgeTimeout(
    bridge.request("start-conversation", {
      hostId: target.hostId,
      input: [...skills, { type: "text", text, text_elements: [] }, ...imageInputs],
      attachments: fileAttachments,
      clientUserMessageId: globalThis.crypto?.randomUUID?.(),
      cwd: target.cwd,
      workspaceRoots: target.workspaceRoots,
      workspaceKind: target.workspaceKind,
      collaborationMode: null,
      threadSource: "user",
      useAppServerPermissionDefault: true,
      ...(target.projectAssignment ? { projectAssignment: target.projectAssignment } : {}),
      ...(target.projectlessOutputDirectory
        ? { projectlessOutputDirectory: target.projectlessOutputDirectory }
        : {}),
      ...(title ? { initialTitle: title, skipAutoTitleGeneration: true } : {})
    }),
    timeoutMs,
    "Codex 没有在限定时间内创建新会话并接收首条消息。"
  );
  const threadId = normalizeCodexThreadId(
    typeof result === "string" ? result : result?.threadId || result?.thread?.id || result?.conversation?.id
  );
  if (!threadId || isProvisionalCodexThreadId(threadId)) {
    throw new Error("Codex 已接收创建请求，但没有返回正式会话 ID。");
  }
  return { threadId, hostId: target.hostId, turnId: "" };
}

export async function startCodexThreadTurn(threadId, prompt, options = {}) {
  const text = String(prompt || "").trim();
  if (!text) throw new Error("Codex 消息为空。");
  const { imageInputs, fileAttachments } = codexAttachmentInputs(options.attachments);
  const skills = normalizedCodexSkills(options.skills);
  const bridge = await loadCodexDesktopBridge(options);
  let state;
  if (options.allowProvisional === true && isProvisionalCodexThreadId(threadId)) {
    const summary = await withCodexBridgeTimeout(
      bridge.appActions.runInPrimaryWindow({ action: { kind: "codex", type: "app.get_summary" } }),
      options.timeoutMs || 12_000,
      "读取 Codex 新对话状态超时。"
    );
    const provisionalThreadId = normalizeCodexThreadId(threadId);
    const row = (summary?.window?.sidebar?.rows || []).find((candidate) => (
      candidate?.type === "thread"
      && normalizeCodexThreadId(candidate.id) === provisionalThreadId
      && candidate.active === true
    ));
    if (!row) throw new Error("Codex 新对话尚未就绪。");
    state = {
      threadId: provisionalThreadId,
      hostId: row.hostId || "local",
      busy: false,
      activeTurnId: "",
      canAcceptDirectInput: true
    };
  } else {
    state = await readCodexThreadWithBridge(bridge, threadId, options);
  }
  if (state.busy) {
    const error = new Error("绑定会话当前正在执行其他任务。请等待当前回复结束后重试。");
    error.code = "CODEX_THREAD_BUSY";
    error.turnId = state.activeTurnId;
    throw error;
  }
  if (!state.canAcceptDirectInput) {
    const error = new Error("绑定会话当前不能接收新消息。");
    error.code = "CODEX_THREAD_NOT_WRITABLE";
    throw error;
  }
  const result = await withCodexBridgeTimeout(
    bridge.request("start-turn-for-host", {
      hostId: state.hostId,
      conversationId: state.threadId,
      params: {
        clientUserMessageId: globalThis.crypto?.randomUUID?.(),
        input: [...skills, { type: "text", text, text_elements: [] }, ...imageInputs],
        attachments: fileAttachments,
        useAppServerPermissionDefault: true
      }
    }),
    options.timeoutMs || 20_000,
    "Codex 没有在限定时间内确认消息。"
  );
  const turnId = String(result?.turn?.id || "").trim();
  if (!turnId) throw new Error("Codex 已接收请求，但没有返回真实 turnId。");
  const startedThreadId = normalizeCodexThreadId(
    result?.thread?.id || result?.conversation?.id || result?.turn?.threadId || state.threadId
  );
  return { threadId: startedThreadId, hostId: state.hostId, turnId };
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
