export function normalizeCodexThreadId(value) {
  const threadId = String(value || "").trim();
  return threadId.startsWith("local:") ? threadId.slice("local:".length) : threadId;
}

export function isProvisionalCodexThreadId(value) {
  return normalizeCodexThreadId(value).startsWith("client-new-thread:");
}

// The implementation uses the App Server owned by the current Codex Desktop
// window; only host discovery and navigation are supplied by this adapter.
export const CODEX_DESKTOP_APP_SERVER_HOST_ID = "desktop-appserver";

export const CODEX_DESKTOP_APP_SERVER_CAPABILITIES = Object.freeze({
  listSkills: true,
  listProjects: true,
  listThreads: false,
  readThread: true,
  resolveThreadId: true,
  createThread: true,
  startTurn: true,
  interruptTurn: true,
  attachImages: true,
  attachFiles: true,
  invokeSkills: true,
  navigateThread: true,
  resolveConversationTarget: true,
  getCurrentThread: true,
  renameThread: true,
  renderPersistentPanel: true
});

export function normalizeCodexLocalProjects(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.entries(source).flatMap(([key, project]) => {
    if (!project || typeof project !== "object") return [];
    const projectId = String(project.id || key || "").trim();
    const workspaceRoots = [
      ...(Array.isArray(project.rootPaths) ? project.rootPaths : []),
      project.path,
      project.cwd
    ].map((candidate) => String(candidate || "").trim()).filter(Boolean)
      .filter((candidate, index, all) => all.indexOf(candidate) === index);
    if (!projectId || !workspaceRoots.length) return [];
    return [{
      id: projectId,
      projectId,
      label: String(project.name || project.label || project.title || projectId).trim() || projectId,
      projectLabel: String(project.name || project.label || project.title || projectId).trim() || projectId,
      cwd: workspaceRoots[0],
      workspaceRoots,
      kind: "project",
      source: "codex-desktop-local-projects"
    }];
  }).sort((left, right) => left.projectLabel.localeCompare(right.projectLabel, "zh-CN"));
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

function withCodexErrorCode(error, code) {
  const normalized = error instanceof Error ? error : new Error(String(error || code));
  if (!normalized.code) normalized.code = code;
  return normalized;
}

function codexFunctionSource(value) {
  if (typeof value !== "function") return "";
  try {
    return Function.prototype.toString.call(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "";
    }
  }
}

export function isCodexHostRequestFunction(value) {
  const source = codexFunctionSource(value);
  if (!source || !/^async\s+function\b/.test(source)) return false;
  return value.length === 0
    && /\.\.\./.test(source)
    && /\bparams\b/.test(source)
    && /\bselect\b/.test(source)
    && /\bsignal\b/.test(source)
    && /\bsource\b/.test(source);
}

export function findCodexHostRequest(initialModule) {
  const functions = Object.values(initialModule || {}).filter((value) => typeof value === "function");
  const semanticMatches = functions.filter(isCodexHostRequestFunction);
  return semanticMatches.find((value) => ["vp", "hm"].includes(value.name))
    || semanticMatches[0]
    || null;
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
      const hostRequest = findCodexHostRequest(initialModule);
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

export async function getCurrentCodexThread(options = {}) {
  const appActions = await loadCodexAppActions(options);
  const summary = await withCodexBridgeTimeout(
    appActions.runInPrimaryWindow({ action: { kind: "codex", type: "app.get_summary" } }),
    options.timeoutMs || 8_000,
    "读取 Codex 当前会话超时。"
  );
  const thread = summary?.window?.thread || null;
  const threadId = normalizeCodexThreadId(thread?.id);
  return {
    threadId,
    hostId: threadId ? codexThreadHost(summary, threadId) : "local",
    title: String(thread?.title || thread?.name || ""),
    cwd: String(thread?.cwd || ""),
    active: Boolean(threadId)
  };
}

export async function readCodexThreadState(threadId, options = {}) {
  const bridge = await loadCodexDesktopBridge(options);
  return readCodexThreadWithBridge(bridge, threadId, options);
}

export async function renameCodexThread(threadId, name, options = {}) {
  const normalizedThreadId = normalizeCodexThreadId(threadId);
  const normalizedName = String(name || "").trim().slice(0, 200);
  if (!normalizedThreadId) throw new Error("Codex 会话 ID 为空。");
  if (!normalizedName) return { threadId: normalizedThreadId, name: "" };
  const bridge = await loadCodexDesktopBridge(options);
  const timeoutMs = options.timeoutMs || 8_000;
  const summary = await withCodexBridgeTimeout(
    bridge.appActions.runInPrimaryWindow({ action: { kind: "codex", type: "app.get_summary" } }),
    timeoutMs,
    "读取 Codex 窗口状态超时。"
  );
  const hostId = codexThreadHost(summary, normalizedThreadId);
  const result = await withCodexBridgeTimeout(
    bridge.request("send-cli-request-for-host", {
      hostId,
      method: "thread/name/set",
      params: { threadId: normalizedThreadId, name: normalizedName },
      source: "jira-conversation-title"
    }),
    timeoutMs,
    "设置 Codex 会话标题超时。"
  );
  return { threadId: normalizedThreadId, name: normalizedName, result };
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
  const hostIds = new Set(["local", hostId]);
  for (const row of Array.isArray(summary?.window?.sidebar?.rows) ? summary.window.sidebar.rows : []) {
    if (row?.type === "thread" && row?.hostId) hostIds.add(String(row.hostId));
  }
  const extraResponses = await Promise.allSettled(Array.from(hostIds)
    .filter((candidate) => candidate !== hostId)
    .map((candidate) => withCodexBridgeTimeout(
      bridge.request("send-cli-request-for-host", {
        hostId: candidate,
        method: "skills/list",
        params,
        source: "jira-template-skill-list"
      }),
      Math.min(timeoutMs, 4_000),
      "Codex skills/list timed out"
    )));
  const allResponses = [response, ...extraResponses
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)];
  const groups = allResponses.flatMap((candidate) => {
    const values = [candidate?.data, candidate?.result?.data, candidate?.skills, candidate?.result?.skills];
    return values.find((value) => Array.isArray(value)) || [];
  });
  const unique = new Map();
  for (const group of groups) {
    const skills = Array.isArray(group?.skills) ? group.skills : group?.name ? [group] : [];
    for (const skill of skills) {
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

export async function listCodexLocalProjects(options = {}) {
  const bridge = await loadCodexDesktopBridge(options);
  if (typeof bridge.hostRequest !== "function") {
    throw new Error("当前 Codex 版本未提供本地项目读取通道。");
  }
  const response = await withCodexBridgeTimeout(
    bridge.hostRequest("get-global-state", { params: { key: "local-projects" } }),
    options.timeoutMs || 8_000,
    "读取 Codex 本地项目超时。"
  );
  return normalizeCodexLocalProjects(response?.value);
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
    const project = normalizeCodexLocalProjects(response?.value)
      .find((candidate) => candidate.projectId === normalizedProjectId);
    const workspaceRoots = project?.workspaceRoots || [];
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

function explicitCodexConversationTarget(options = {}) {
  const cwd = String(options.cwd || "").trim();
  if (!cwd) return null;
  const projectId = String(options.projectId || "").trim();
  const workspaceRoots = (Array.isArray(options.workspaceRoots) ? options.workspaceRoots : [cwd])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return {
    hostId: "local",
    cwd,
    workspaceRoots: workspaceRoots.length ? workspaceRoots : [cwd],
    workspaceKind: projectId ? "project" : "projectless",
    ...(projectId ? {
      projectAssignment: {
        projectKind: "local",
        projectId,
        cwd,
        pendingCoreUpdate: false
      }
    } : {})
  };
}

export async function resolveCodexConversationTarget(projectId, prompt, options = {}) {
  const bridge = await loadCodexDesktopBridge(options);
  return resolveCodexNewConversationTarget(
    bridge,
    projectId,
    prompt,
    options.timeoutMs || 30_000
  );
}

export async function startCodexConversation(prompt, options = {}) {
  const text = String(prompt || "").trim();
  if (!text) throw new Error("Codex 消息为空。");
  const timeoutMs = options.timeoutMs || 30_000;
  let bridge;
  let target;
  try {
    bridge = await loadCodexDesktopBridge(options);
    target = explicitCodexConversationTarget(options)
      || await resolveCodexNewConversationTarget(
        bridge,
        options.projectId,
        text,
        timeoutMs
      );
  } catch (error) {
    throw withCodexErrorCode(error, bridge
      ? "CODEX_DESKTOP_PREFLIGHT_FAILED"
      : "CODEX_DESKTOP_HOST_UNAVAILABLE");
  }
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
  return {
    threadId,
    hostId: target.hostId,
    turnId: "",
    // `start-conversation` returns after the optimistic first turn is loaded
    // in Codex Desktop. The rollout can still be empty for a short interval,
    // so immediate navigation must not read or resume it from disk.
    knownLoadedThread: true
  };
}

export async function startCodexThreadTurn(threadId, prompt, options = {}) {
  const text = String(prompt || "").trim();
  if (!text) throw new Error("Codex 消息为空。");
  const { imageInputs, fileAttachments } = codexAttachmentInputs(options.attachments);
  const skills = normalizedCodexSkills(options.skills);
  let bridge;
  try {
    bridge = await loadCodexDesktopBridge(options);
  } catch (error) {
    throw withCodexErrorCode(error, "CODEX_DESKTOP_HOST_UNAVAILABLE");
  }
  let state;
  try {
    if (options.knownLoadedThread === true) {
      const loadedThreadId = normalizeCodexThreadId(threadId);
      if (!loadedThreadId || isProvisionalCodexThreadId(loadedThreadId)) {
        throw new Error("Codex 新会话没有可用的正式会话 ID。");
      }
      // thread/start already loaded this thread in the current desktop App
      // Server. Reading it before the first turn would incorrectly require a
      // rollout file that does not exist until turn/start materializes it.
      state = {
        threadId: loadedThreadId,
        hostId: String(options.hostId || "local").trim() || "local",
        busy: false,
        activeTurnId: "",
        canAcceptDirectInput: true
      };
    } else if (options.allowProvisional === true && isProvisionalCodexThreadId(threadId)) {
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
  } catch (error) {
    throw withCodexErrorCode(error, "CODEX_DESKTOP_PREFLIGHT_FAILED");
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
        useAppServerPermissionDefault: true,
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {})
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
  importModule = (url) => import(url),
  timeoutMs = 12_000,
  knownLoadedThread = false,
  showThread = true,
  hostId: requestedHostId = "local"
} = {}) {
  const normalizedThreadId = normalizeCodexThreadId(threadId);
  if (!normalizedThreadId) throw new Error("Codex 会话 ID 为空。");
  if (!documentRef || typeof fetchFn !== "function") {
    throw new Error("Codex 页面导航环境不可用。");
  }

  const bridge = await loadCodexDesktopBridge({ documentRef, fetchFn, importModule });
  let hostId = String(requestedHostId || "local").trim() || "local";
  if (!knownLoadedThread) {
    const summary = await withCodexBridgeTimeout(
      bridge.appActions.runInPrimaryWindow({ action: { kind: "codex", type: "app.get_summary" } }),
      timeoutMs,
      "读取 Codex 窗口状态超时。"
    );
    hostId = codexThreadHost(summary, normalizedThreadId);
  }
  const requestForHost = (method, params, source) => withCodexBridgeTimeout(
    bridge.request("send-cli-request-for-host", { hostId, method, params, source }),
    timeoutMs,
    `准备 Codex 会话超时：${method}`
  );

  let thread = knownLoadedThread ? { id: normalizedThreadId, status: { type: "idle" } } : null;
  if (!knownLoadedThread) {
    try {
      const read = await requestForHost(
        "thread/read",
        { threadId: normalizedThreadId, includeTurns: false },
        "jira-thread-navigation-read"
      );
      thread = read?.thread || read?.result?.thread || null;
    } catch {
      // A thread created by another App Server process may not yet be in the
      // desktop host's in-memory index. thread/resume below is the authoritative
      // adoption operation and gives a clearer error than navigating first.
    }
  }

  const threadPath = String(thread?.path || "");
  if (/(^|[\\/])archived_sessions([\\/]|$)/i.test(threadPath)) {
    const unarchived = await requestForHost(
      "thread/unarchive",
      { threadId: normalizedThreadId },
      "jira-thread-navigation-unarchive"
    );
    thread = unarchived?.thread || unarchived?.result?.thread || thread;
  }

  const status = String(thread?.status?.type || thread?.status || "");
  if (!thread?.id || status === "notLoaded") {
    const resumed = await requestForHost(
      "thread/resume",
      { threadId: normalizedThreadId },
      "jira-thread-navigation-resume"
    );
    thread = resumed?.thread || resumed?.result?.thread || thread;
  }
  if (!thread?.id) throw new Error("绑定的 Codex 会话不存在，桌面端无法接管。");

  if (showThread) {
    await withCodexBridgeTimeout(
      bridge.appActions.runInPrimaryWindow({
        action: {
          kind: "codex",
          type: "windows.show_thread",
          windowId: "current",
          threadId: normalizedThreadId
        }
      }),
      timeoutMs,
      "打开 Codex 会话超时。"
    );
  }
  return normalizedThreadId;
}

export function createCodexDesktopAppServerHostAdapter(defaultOptions = {}) {
  const withDefaults = (options = {}) => ({ ...defaultOptions, ...options });
  return {
    id: CODEX_DESKTOP_APP_SERVER_HOST_ID,

    getCapabilities() {
      return {
        hostOwner: CODEX_DESKTOP_APP_SERVER_HOST_ID,
        capabilities: { ...CODEX_DESKTOP_APP_SERVER_CAPABILITIES }
      };
    },

    resolveThreadId(threadId, options) {
      return resolveCodexThreadId(threadId, withDefaults(options));
    },

    resolveConversationTarget(projectId, prompt, options) {
      return resolveCodexConversationTarget(projectId, prompt, withDefaults(options));
    },

    listProjects(options) {
      return listCodexLocalProjects(withDefaults(options));
    },

    listSkills(options) {
      return listCodexSkills(withDefaults(options));
    },

    readThread(threadId, options) {
      return readCodexThreadState(threadId, withDefaults(options));
    },

    getCurrentThread(options) {
      return getCurrentCodexThread(withDefaults(options));
    },

    renameThread(threadId, name, options) {
      return renameCodexThread(threadId, name, withDefaults(options));
    },

    startConversation(prompt, options) {
      return startCodexConversation(prompt, withDefaults(options));
    },

    startTurn(threadId, prompt, options) {
      return startCodexThreadTurn(threadId, prompt, withDefaults(options));
    },

    interruptTurn(threadId, turnId, options) {
      return interruptCodexThreadTurn(threadId, turnId, withDefaults(options));
    },

    navigateThread(threadId, options) {
      return navigateCodexThread(threadId, withDefaults(options));
    }
  };
}
