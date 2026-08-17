import { EventEmitter } from "node:events";
import { spawn as spawnProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import readline from "node:readline";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_START_TIMEOUT_MS = 8_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 3_000;
const DEFAULT_FORCE_CLOSE_TIMEOUT_MS = 2_000;
const MAX_STDERR_TAIL = 16_000;
const MAX_CACHED_TURN_RESULTS = 200;
export const CODEX_CLI_INSTALL_COMMAND = "npm install -g @openai/codex@latest";

export class CodexAppServerError extends Error {
  constructor(message, {
    code = "CODEX_APP_SERVER_ERROR",
    cause,
    details,
    rpcCode
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CodexAppServerError";
    this.code = code;
    this.details = details;
    this.rpcCode = rpcCode;
  }
}

function withTimeout(promise, timeoutMs, message, code = "CODEX_APP_SERVER_TIMEOUT") {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CodexAppServerError(message, { code })), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function processAlreadyExited(child) {
  return !child || child.exitCode !== null && child.exitCode !== undefined;
}

function waitForProcessExit(child, timeoutMs) {
  if (processAlreadyExited(child)) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("exit", onExit);
      resolvePromise(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(processAlreadyExited(child)), timeoutMs);
    child.once("exit", onExit);
  });
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => (
    candidate !== undefined && candidate !== null && candidate !== ""
  )));
}

const THREAD_SANDBOX_ALIASES = new Map([
  ["readonly", ["read-only", "readOnly"]],
  ["workspacewrite", ["workspace-write", "workspaceWrite"]],
  ["dangerfullaccess", ["danger-full-access", "dangerFullAccess"]]
]);

function threadSandboxCandidates(value) {
  const requested = String(value || "").trim();
  if (!requested) return [undefined];
  const aliasKey = requested.replace(/[-_\s]/g, "").toLowerCase();
  return THREAD_SANDBOX_ALIASES.get(aliasKey) || [requested];
}

function isThreadSandboxVariantError(error) {
  if (error?.code !== "CODEX_APP_SERVER_RPC_ERROR") return false;
  let details = "";
  try {
    details = typeof error.details === "string"
      ? error.details
      : JSON.stringify(error.details || {});
  } catch {}
  const message = `${error?.message || ""} ${details}`;
  return /unknown variant/i.test(message)
    && /read[-_ ]?only|workspace[-_ ]?write|danger[-_ ]?full[-_ ]?access/i.test(message);
}

function isThreadOwnedElsewhereError(error) {
  const message = `${error?.message || ""} ${typeof error?.details === "string" ? error.details : ""}`;
  return /already open in another app|running in another app|continue this conversation on the window where it was started/i
    .test(message);
}

function safeExists(path, existsFn) {
  try {
    return Boolean(path && existsFn(path));
  } catch {
    return false;
  }
}

function windowsNpmCodexCandidates(root) {
  const normalized = String(root || "").trim().replace(/[\\/]+$/, "");
  if (!normalized) return [];
  const packageRoots = [
    join(normalized, "node_modules"),
    normalized.toLowerCase().endsWith("node_modules") ? normalized : "",
    normalized.toLowerCase().endsWith(".bin") ? join(normalized, "..") : ""
  ].filter(Boolean);
  return packageRoots.flatMap((packageRoot) => [
    join(packageRoot, "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
    join(packageRoot, "@openai", "codex-win32-arm64", "vendor", "aarch64-pc-windows-msvc", "bin", "codex.exe"),
    join(packageRoot, "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
    join(packageRoot, "@openai", "codex", "node_modules", "@openai", "codex-win32-arm64", "vendor", "aarch64-pc-windows-msvc", "bin", "codex.exe")
  ]);
}

export function discoverCodexAppServerCommand({
  command,
  env = process.env,
  platform = process.platform,
  existsFn = existsSync
} = {}) {
  const explicit = String(
    command || env.JIRA_CODEX_APP_SERVER_COMMAND || env.CODEX_CLI_PATH || ""
  ).trim();
  if (explicit) {
    return {
      command: explicit,
      source: command ? "option" : "environment",
      installCommand: CODEX_CLI_INSTALL_COMMAND
    };
  }

  if (platform === "win32") {
    const roots = new Set([
      env.npm_config_prefix,
      env.APPDATA ? join(env.APPDATA, "npm") : "",
      ...String(env.PATH || env.Path || "").split(delimiter)
    ].map((value) => String(value || "").trim()).filter(Boolean));
    for (const candidate of Array.from(roots).flatMap(windowsNpmCodexCandidates)) {
      if (!safeExists(candidate, existsFn)) continue;
      return {
        command: candidate,
        source: "npm-vendor",
        installCommand: CODEX_CLI_INSTALL_COMMAND
      };
    }
  }

  return {
    command: "codex",
    source: "path",
    installCommand: CODEX_CLI_INSTALL_COMMAND
  };
}

function normalizedAttachments(values) {
  return (Array.isArray(values) ? values : []).flatMap((attachment) => {
    const path = String(attachment?.path || attachment?.fsPath || "").trim();
    if (!path) return [];
    return [{
      path,
      mimeType: String(attachment?.mimeType || attachment?.contentType || "").toLowerCase()
    }];
  });
}

function normalizedId(value) {
  return String(value || "").trim().replace(/^local:/i, "");
}

function turnCacheKey(threadId, turnId) {
  return `${normalizedId(threadId)}:${String(turnId || "").trim()}`;
}

function isoTimestamp(seconds, fallbackMs = 0) {
  const milliseconds = Number(seconds) * 1_000 || Number(fallbackMs) || 0;
  return milliseconds > 0 ? new Date(milliseconds).toISOString() : "";
}

function mergeTurnItems(turnItems, completedItems) {
  const merged = new Map();
  for (const item of Array.isArray(turnItems) ? turnItems : []) {
    const id = String(item?.id || "").trim();
    if (id) merged.set(id, item);
  }
  for (const item of completedItems?.values?.() || []) {
    const id = String(item?.id || "").trim();
    if (id) merged.set(id, item);
  }
  return Array.from(merged.values());
}

function finalTurnText(items) {
  const messages = (Array.isArray(items) ? items : [])
    .filter((item) => item?.type === "agentMessage" && String(item.text || "").trim());
  const finalMessage = [...messages].reverse().find((item) => item.phase === "final_answer")
    || messages.at(-1);
  if (finalMessage) return String(finalMessage.text || "").trim();
  const review = [...(Array.isArray(items) ? items : [])]
    .reverse()
    .find((item) => item?.type === "exitedReviewMode" && String(item.review || "").trim());
  return String(review?.review || "").trim();
}

export function normalizeCodexAppServerTurn(turn, {
  threadId = "",
  completedItems,
  observedAtMs = 0,
  source = "app-server"
} = {}) {
  const normalizedTurnId = String(turn?.id || "").trim();
  if (!normalizedTurnId) return null;
  const items = mergeTurnItems(turn?.items, completedItems);
  const rawStatus = String(turn?.status || "").trim();
  const status = rawStatus === "completed"
    ? "completed"
    : ["failed", "interrupted"].includes(rawStatus) ? "failed" : "running";
  const error = status === "failed"
    ? String(turn?.error?.message || (rawStatus === "interrupted" ? "Codex turn was interrupted." : "Codex turn failed.")).trim()
    : "";
  return {
    threadId: normalizedId(threadId),
    turnId: normalizedTurnId,
    status,
    rawStatus,
    startedAt: isoTimestamp(turn?.startedAt),
    completedAt: status === "running" ? "" : isoTimestamp(turn?.completedAt, observedAtMs),
    result: status === "completed" ? finalTurnText(items) : "",
    error,
    source,
    items
  };
}

const IMAGE_PATH_PATTERN = /\.(?:gif|jpe?g|png|webp)$/i;

export function buildCodexAnalysisInput({
  message,
  skill,
  skills,
  attachments,
  referenceFiles = false
} = {}) {
  const text = String(message || "").trim();
  if (!text) throw new CodexAppServerError("Codex 分析消息不能为空。", {
    code: "CODEX_MESSAGE_EMPTY"
  });

  const input = [{ type: "text", text }];
  const requestedSkills = [skill, ...(Array.isArray(skills) ? skills : [])];
  const seenSkillPaths = new Set();
  for (const requestedSkill of requestedSkills) {
    const name = String(requestedSkill?.name || "").trim();
    const path = String(requestedSkill?.path || "").trim();
    if (!name || !path || seenSkillPaths.has(path)) continue;
    seenSkillPaths.add(path);
    input.push({ type: "skill", name, path });
  }

  const unsupportedAttachments = [];
  const referencedAttachments = [];
  for (const attachment of normalizedAttachments(attachments)) {
    if (attachment.mimeType.startsWith("image/") || IMAGE_PATH_PATTERN.test(attachment.path)) {
      input.push({ type: "localImage", path: attachment.path });
    } else if (referenceFiles) {
      referencedAttachments.push(attachment.path);
    } else {
      unsupportedAttachments.push(attachment.path);
    }
  }
  if (referencedAttachments.length) {
    input.push({
      type: "text",
      text: [
        "以下文件不是原生附件，而是本机只读上下文。请直接从绝对路径读取；只能分析，不得修改：",
        ...referencedAttachments.map((path) => `- ${path}`)
      ].join("\n")
    });
  }
  return { input, unsupportedAttachments, referencedAttachments };
}

export class CodexAppServerClient extends EventEmitter {
  constructor({
    command,
    args = ["app-server"],
    cwd,
    env,
    spawnFn = spawnProcess,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    clientInfo = {
      name: "jira_codex_panel",
      title: "Jira Codex Panel",
      version: "0.1.0"
    }
  } = {}) {
    super();
    this.commandInfo = discoverCodexAppServerCommand({ command, env: env ? { ...process.env, ...env } : process.env });
    this.command = this.commandInfo.command;
    this.args = Array.isArray(args) ? args.map(String) : ["app-server"];
    this.cwd = cwd ? String(cwd) : undefined;
    this.env = env ? { ...process.env, ...env } : process.env;
    this.spawnFn = spawnFn;
    this.requestTimeoutMs = requestTimeoutMs;
    this.startTimeoutMs = startTimeoutMs;
    this.clientInfo = { ...clientInfo };
    this.state = "stopped";
    this.child = null;
    this.readline = null;
    this.startPromise = null;
    this.initializeResult = null;
    this.lastError = null;
    this.stderrTail = "";
    this.nextRequestId = 0;
    this.pending = new Map();
    this.pendingTurnItems = new Map();
    this.trackedTurns = new Map();
    this.turnResults = new Map();
    this.unsubscribeInFlight = new Set();
  }

  snapshot() {
    return {
      state: this.state,
      command: this.command,
      commandSource: this.commandInfo.source,
      args: [...this.args],
      pid: Number(this.child?.pid || 0) || null,
      initialized: Boolean(this.initializeResult),
      error: this.lastError ? {
        code: this.lastError.code || this.lastError.name,
        message: this.lastError.message
      } : null,
      stderr: this.stderrTail,
      installCommand: this.commandInfo.installCommand
    };
  }

  async start() {
    if (this.state === "ready") return this.initializeResult;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#startInternal();
    try {
      return await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async #startInternal() {
    this.state = "starting";
    this.lastError = null;
    this.stderrTail = "";
    let child;
    try {
      child = this.spawnFn(this.command, this.args, {
        cwd: this.cwd,
        env: this.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (cause) {
      throw this.#markUnavailable(cause);
    }
    this.child = child;
    this.#attachProcess(child);

    try {
      await withTimeout(new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      }), this.startTimeoutMs, `启动 Codex App Server 超时：${this.command}`, "CODEX_APP_SERVER_START_TIMEOUT");
      this.readline = readline.createInterface({ input: child.stdout });
      this.readline.on("line", (line) => this.#handleLine(line));
      const result = await this.#sendRequest("initialize", { clientInfo: this.clientInfo }, this.startTimeoutMs);
      this.#sendNotification("initialized", {});
      this.initializeResult = result;
      this.state = "ready";
      this.emit("ready", this.snapshot());
      return result;
    } catch (cause) {
      const error = cause instanceof CodexAppServerError ? cause : this.#markUnavailable(cause);
      this.#stopOwnedProcess();
      throw error;
    }
  }

  #attachProcess(child) {
    child.stderr?.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${Buffer.from(chunk).toString("utf8")}`.slice(-MAX_STDERR_TAIL);
      this.emit("stderr", Buffer.from(chunk).toString("utf8"));
    });
    child.on("error", (cause) => {
      if (["starting", "closing", "stopped"].includes(this.state)) return;
      this.#handleProcessFailure(this.#markUnavailable(cause));
    });
    child.on("exit", (code, signal) => {
      if (["closing", "stopped"].includes(this.state)) return;
      this.#handleProcessFailure(new CodexAppServerError(
        `Codex App Server 已退出（code=${code ?? "null"}, signal=${signal || "none"}）。`,
        {
          code: "CODEX_APP_SERVER_EXITED",
          details: { exitCode: code, signal, stderr: this.stderrTail }
        }
      ));
    });
  }

  #markUnavailable(cause) {
    const permissionDenied = process.platform === "win32"
      && ["EACCES", "EPERM"].includes(String(cause?.code || "").toUpperCase());
    const guidance = permissionDenied && this.commandInfo.source === "path"
      ? `。当前命令可能解析到了 Microsoft Store 包内置程序；请安装独立 Codex CLI（${CODEX_CLI_INSTALL_COMMAND}），或设置 JIRA_CODEX_APP_SERVER_COMMAND`
      : "";
    const error = new CodexAppServerError(
      `无法启动 Codex App Server：${cause?.message || cause || this.command}${guidance}`,
      {
        code: "CODEX_APP_SERVER_UNAVAILABLE",
        cause,
        details: { command: this.command, args: this.args, stderr: this.stderrTail }
      }
    );
    this.lastError = error;
    this.state = "failed";
    return error;
  }

  #handleProcessFailure(error) {
    this.lastError = error;
    this.state = "failed";
    this.initializeResult = null;
    this.startPromise = null;
    this.#rejectPending(error);
    this.emit("failed", error);
  }

  #rememberTurnResult(key, result) {
    if (this.turnResults.has(key)) this.turnResults.delete(key);
    this.turnResults.set(key, result);
    while (this.turnResults.size > MAX_CACHED_TURN_RESULTS) {
      this.turnResults.delete(this.turnResults.keys().next().value);
    }
  }

  #observeTurnNotification(message) {
    const method = String(message?.method || "");
    const params = message?.params || {};
    const threadId = normalizedId(params.threadId);
    const turnId = String(params.turnId || params.turn?.id || "").trim();
    if (!threadId || !turnId) return;
    const key = turnCacheKey(threadId, turnId);

    if (method === "item/completed") {
      const itemId = String(params.item?.id || "").trim();
      if (!itemId) return;
      const items = this.pendingTurnItems.get(key) || new Map();
      items.set(itemId, params.item);
      this.pendingTurnItems.set(key, items);
      return;
    }

    if (method !== "turn/completed") return;
    const wasTracked = this.trackedTurns.has(key);
    const result = normalizeCodexAppServerTurn(params.turn, {
      threadId,
      completedItems: this.pendingTurnItems.get(key),
      observedAtMs: message.emittedAtMs,
      source: "app-server-notification"
    });
    this.pendingTurnItems.delete(key);
    this.trackedTurns.delete(key);
    if (!result) return;
    this.#rememberTurnResult(key, result);
    this.emit("turnResult", result);
    if (wasTracked) void this.#unsubscribeCompletedThread(threadId);
  }

  #trackTurn(threadId, turn) {
    const normalizedThreadId = normalizedId(threadId);
    const turnId = String(turn?.id || "").trim();
    if (!normalizedThreadId || !turnId) return;
    const key = turnCacheKey(normalizedThreadId, turnId);
    if (this.turnResults.has(key)) {
      void this.#unsubscribeCompletedThread(normalizedThreadId);
      return;
    }
    this.trackedTurns.set(key, { threadId: normalizedThreadId, turnId });
  }

  async #unsubscribeCompletedThread(threadId) {
    const normalizedThreadId = normalizedId(threadId);
    if (!normalizedThreadId || this.unsubscribeInFlight.has(normalizedThreadId)) return;
    if ([...this.trackedTurns.values()].some((entry) => entry.threadId === normalizedThreadId)) return;
    this.unsubscribeInFlight.add(normalizedThreadId);
    try {
      await this.unsubscribeThread(normalizedThreadId);
    } catch (error) {
      this.emit("subscriptionWarning", {
        threadId: normalizedThreadId,
        message: String(error?.message || error)
      });
    } finally {
      this.unsubscribeInFlight.delete(normalizedThreadId);
    }
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(String(line || ""));
    } catch {
      this.emit("protocolWarning", { line: String(line || "") });
      return;
    }

    if (message?.id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new CodexAppServerError(message.error.message || "Codex App Server 请求失败。", {
          code: "CODEX_APP_SERVER_RPC_ERROR",
          rpcCode: message.error.code,
          details: message.error.data
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message?.method && message.id !== undefined) {
      const reply = (result, error) => this.#write(error
        ? { id: message.id, error }
        : { id: message.id, result: result ?? {} });
      if (this.listenerCount("serverRequest") > 0) {
        this.emit("serverRequest", { ...message, reply });
      } else {
        reply(null, { code: -32601, message: `Unsupported client request: ${message.method}` });
      }
      return;
    }

    if (message?.method) {
      this.#observeTurnNotification(message);
      this.emit("notification", message);
      this.emit(`notification:${message.method}`, message.params);
    }
  }

  #write(message) {
    if (!this.child?.stdin?.writable) {
      throw new CodexAppServerError("Codex App Server 输入通道不可用。", {
        code: "CODEX_APP_SERVER_CHANNEL_CLOSED"
      });
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #sendNotification(method, params) {
    this.#write({ method, params });
  }

  #sendRequest(method, params, timeoutMs = this.requestTimeoutMs) {
    const id = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAppServerError(`Codex App Server 请求超时：${method}`, {
          code: "CODEX_APP_SERVER_TIMEOUT",
          details: { method, timeoutMs }
        }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  #stopOwnedProcess() {
    try { this.readline?.close(); } catch {}
    this.readline = null;
    try { this.child?.stdin?.end(); } catch {}
    try { this.child?.kill(); } catch {}
  }

  async request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    await this.start();
    return this.#sendRequest(method, params, timeoutMs);
  }

  async probe() {
    try {
      await this.start();
      const result = await this.request("thread/list", { limit: 1, archived: false });
      return {
        ok: true,
        runtime: this.snapshot(),
        threadVisible: Array.isArray(result?.data),
        sampleThreadCount: Array.isArray(result?.data) ? result.data.length : 0
      };
    } catch (error) {
      return {
        ok: false,
        runtime: this.snapshot(),
        error: {
          code: error.code || error.name,
          message: error.message,
          details: error.details
        }
      };
    }
  }

  listThreads({ cursor, limit = 50, archived = false, searchTerm, cwd } = {}) {
    return this.request("thread/list", compactObject({ cursor, limit, archived, searchTerm, cwd }));
  }

  readThread(threadId, { includeTurns = true } = {}) {
    return this.request("thread/read", {
      threadId: String(threadId || "").trim(),
      includeTurns: Boolean(includeTurns)
    });
  }

  async readTurnResult(threadId, turnId) {
    const normalizedThreadId = normalizedId(threadId);
    const normalizedTurnId = String(turnId || "").trim();
    if (!normalizedThreadId || !normalizedTurnId) return null;
    const key = turnCacheKey(normalizedThreadId, normalizedTurnId);
    const cached = this.turnResults.get(key);
    if (cached) return { ...cached, items: [...cached.items] };

    const response = await this.readThread(normalizedThreadId, { includeTurns: true });
    const turn = (Array.isArray(response?.thread?.turns) ? response.thread.turns : [])
      .find((candidate) => String(candidate?.id || "").trim() === normalizedTurnId);
    if (!turn) return null;
    const result = normalizeCodexAppServerTurn(turn, {
      threadId: normalizedThreadId,
      source: "app-server-thread-read"
    });
    if (result && result.status !== "running") {
      this.pendingTurnItems.delete(key);
      const wasTracked = this.trackedTurns.delete(key);
      this.#rememberTurnResult(key, result);
      if (wasTracked) void this.#unsubscribeCompletedThread(normalizedThreadId);
    }
    return result;
  }

  listSkills({ cwds, forceReload = false } = {}) {
    return this.request("skills/list", compactObject({
      cwds: Array.isArray(cwds) && cwds.length ? cwds.map(String) : undefined,
      forceReload: Boolean(forceReload)
    }));
  }

  async startThread(options = {}) {
    const sandboxCandidates = threadSandboxCandidates(options.sandbox);
    let lastError;
    for (let index = 0; index < sandboxCandidates.length; index += 1) {
      try {
        return await this.request("thread/start", compactObject({
          model: options.model,
          cwd: options.cwd,
          approvalPolicy: options.approvalPolicy,
          sandbox: sandboxCandidates[index],
          personality: options.personality,
          serviceName: options.serviceName || "jira_codex_panel"
        }), { timeoutMs: options.timeoutMs || this.requestTimeoutMs });
      } catch (error) {
        lastError = error;
        const hasFallback = index < sandboxCandidates.length - 1;
        if (!hasFallback || !isThreadSandboxVariantError(error)) throw error;
      }
    }
    throw lastError;
  }

  async resumeThread(threadId, options = {}) {
    try {
      return await this.request("thread/resume", compactObject({
        threadId: String(threadId || "").trim(),
        model: options.model,
        cwd: options.cwd,
        personality: options.personality
      }), { timeoutMs: options.timeoutMs || this.requestTimeoutMs });
    } catch (cause) {
      if (!isThreadOwnedElsewhereError(cause)) throw cause;
      throw new CodexAppServerError(
        "该 Codex 会话当前由桌面端持有，应由当前 Codex Desktop 的 App Server 继续处理。",
        {
          code: "CODEX_THREAD_OWNED_ELSEWHERE",
          cause,
          details: { threadId: String(threadId || "").trim() }
        }
      );
    }
  }

  setThreadName(threadId, name) {
    return this.request("thread/name/set", {
      threadId: String(threadId || "").trim(),
      name: String(name || "").trim()
    });
  }

  startTurn(threadId, input, options = {}) {
    return this.request("turn/start", compactObject({
      threadId: String(threadId || "").trim(),
      input: Array.isArray(input) ? input : [],
      cwd: options.cwd,
      approvalPolicy: options.approvalPolicy,
      sandboxPolicy: options.sandboxPolicy,
      model: options.model,
      effort: options.effort,
      personality: options.personality,
      summary: options.summary,
      outputSchema: options.outputSchema
    }), { timeoutMs: options.timeoutMs || this.requestTimeoutMs });
  }

  interruptTurn(threadId, turnId) {
    return this.request("turn/interrupt", {
      threadId: String(threadId || "").trim(),
      turnId: String(turnId || "").trim()
    });
  }

  unsubscribeThread(threadId, options = {}) {
    return this.request("thread/unsubscribe", {
      threadId: String(threadId || "").trim()
    }, { timeoutMs: options.timeoutMs || this.requestTimeoutMs });
  }

  async startReadOnlyAnalysis({
    message,
    title,
    cwd,
    model,
    effort,
    skill,
    skills,
    attachments,
    referenceFiles = false,
    requireAllAttachments = false,
    outputSchema,
    timeoutMs
  } = {}) {
    const prepared = buildCodexAnalysisInput({ message, skill, skills, attachments, referenceFiles });
    if (requireAllAttachments && prepared.unsupportedAttachments.length) {
      throw new CodexAppServerError("当前 App Server 不能真实挂载非图片附件，已保留旧通道处理。", {
        code: "CODEX_ATTACHMENT_UNSUPPORTED",
        details: { unsupportedAttachments: prepared.unsupportedAttachments }
      });
    }
    const started = await this.startThread({
      cwd,
      model,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "jira_codex_panel",
      timeoutMs
    });
    const threadId = String(started?.thread?.id || "").trim();
    if (!threadId) {
      throw new CodexAppServerError("Codex App Server 未返回新会话 ID。", {
        code: "CODEX_THREAD_ID_MISSING"
      });
    }
    let titleWarning = "";
    if (String(title || "").trim()) {
      try {
        await this.setThreadName(threadId, title);
      } catch (error) {
        titleWarning = String(error?.message || error);
      }
    }
    try {
      const turn = await this.startTurn(threadId, prepared.input, {
        cwd,
        model,
        effort,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
        outputSchema,
        timeoutMs
      });
      this.#trackTurn(threadId, turn?.turn);
      return {
        threadId,
        turnId: String(turn?.turn?.id || "").trim(),
        unsupportedAttachments: prepared.unsupportedAttachments,
        referencedAttachments: prepared.referencedAttachments,
        titleWarning,
        completionTracking: "app-server",
        thread: started.thread,
        turn: turn.turn
      };
    } catch (cause) {
      throw new CodexAppServerError(
        `Codex 会话 ${threadId} 已创建，但首条分析消息发送失败：${cause?.message || cause}`,
        {
          code: "CODEX_TURN_START_FAILED",
          cause,
          details: { threadId, unsupportedAttachments: prepared.unsupportedAttachments }
        }
      );
    }
  }

  async startReadOnlyTurn(threadId, {
    message,
    cwd,
    model,
    effort,
    skill,
    skills,
    attachments,
    referenceFiles = false,
    requireAllAttachments = false,
    outputSchema,
    timeoutMs
  } = {}) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      throw new CodexAppServerError("Codex 会话 ID 为空。", { code: "CODEX_THREAD_ID_EMPTY" });
    }
    const prepared = buildCodexAnalysisInput({ message, skill, skills, attachments, referenceFiles });
    if (requireAllAttachments && prepared.unsupportedAttachments.length) {
      throw new CodexAppServerError("当前 App Server 不能真实挂载非图片附件，已保留旧通道处理。", {
        code: "CODEX_ATTACHMENT_UNSUPPORTED",
        details: { unsupportedAttachments: prepared.unsupportedAttachments }
      });
    }
    await this.resumeThread(normalizedThreadId, { cwd, model, timeoutMs });
    const turn = await this.startTurn(normalizedThreadId, prepared.input, {
      cwd,
      model,
      effort,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
      outputSchema,
      timeoutMs
    });
    this.#trackTurn(normalizedThreadId, turn?.turn);
    return {
      threadId: normalizedThreadId,
      turnId: String(turn?.turn?.id || "").trim(),
      unsupportedAttachments: prepared.unsupportedAttachments,
      referencedAttachments: prepared.referencedAttachments,
      completionTracking: "app-server",
      turn: turn?.turn || null
    };
  }

  async close({
    gracefulTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
    forceTimeoutMs = DEFAULT_FORCE_CLOSE_TIMEOUT_MS
  } = {}) {
    if (this.state === "stopped") return { exited: true, forced: false };
    this.state = "closing";
    this.#rejectPending(new CodexAppServerError("Codex App Server 客户端已关闭。", {
      code: "CODEX_APP_SERVER_CLOSED"
    }));
    const child = this.child;
    try { this.readline?.close(); } catch {}
    this.readline = null;
    try { child?.stdin?.end(); } catch {}

    let exited = await waitForProcessExit(child, gracefulTimeoutMs);
    let forced = false;
    if (!exited && child) {
      try { forced = child.kill() !== false; } catch {}
      exited = await waitForProcessExit(child, forceTimeoutMs);
    }
    this.child = null;
    this.initializeResult = null;
    this.startPromise = null;
    this.pendingTurnItems.clear();
    this.trackedTurns.clear();
    this.turnResults.clear();
    this.unsubscribeInFlight.clear();
    this.state = "stopped";
    return { exited, forced };
  }
}

export function createCodexAppServerClient(options) {
  return new CodexAppServerClient(options);
}
