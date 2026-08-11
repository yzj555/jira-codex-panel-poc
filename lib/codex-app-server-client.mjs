import { EventEmitter } from "node:events";
import { spawn as spawnProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import readline from "node:readline";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_START_TIMEOUT_MS = 8_000;
const MAX_STDERR_TAIL = 16_000;
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

const IMAGE_PATH_PATTERN = /\.(?:gif|jpe?g|png|webp)$/i;

export function buildCodexAnalysisInput({ message, skill, skills, attachments } = {}) {
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
  for (const attachment of normalizedAttachments(attachments)) {
    if (attachment.mimeType.startsWith("image/") || IMAGE_PATH_PATTERN.test(attachment.path)) {
      input.push({ type: "localImage", path: attachment.path });
    } else {
      unsupportedAttachments.push(attachment.path);
    }
  }
  return { input, unsupportedAttachments };
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
      if (this.state === "starting") return;
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

  resumeThread(threadId, options = {}) {
    return this.request("thread/resume", compactObject({
      threadId: String(threadId || "").trim(),
      model: options.model,
      cwd: options.cwd,
      personality: options.personality
    }), { timeoutMs: options.timeoutMs || this.requestTimeoutMs });
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
      summary: options.summary
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
    requireAllAttachments = false,
    desktopHandoff = false,
    timeoutMs
  } = {}) {
    const prepared = buildCodexAnalysisInput({ message, skill, skills, attachments });
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
    if (desktopHandoff) {
      let handoffWarning = "";
      try {
        await this.unsubscribeThread(threadId, { timeoutMs });
      } catch (error) {
        handoffWarning = String(error?.message || error);
      }
      return {
        threadId,
        turnId: "",
        unsupportedAttachments: prepared.unsupportedAttachments,
        titleWarning,
        handoffWarning,
        desktopHandoff: true,
        handoffPending: true,
        thread: started.thread,
        turn: null
      };
    }
    try {
      const turn = await this.startTurn(threadId, prepared.input, {
        cwd,
        model,
        effort,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
        timeoutMs
      });
      let handoffWarning = "";
      try {
        await this.unsubscribeThread(threadId, { timeoutMs });
      } catch (error) {
        handoffWarning = String(error?.message || error);
      }
      return {
        threadId,
        turnId: String(turn?.turn?.id || "").trim(),
        unsupportedAttachments: prepared.unsupportedAttachments,
        titleWarning,
        handoffWarning,
        desktopHandoff: false,
        handoffPending: true,
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
    requireAllAttachments = false,
    timeoutMs
  } = {}) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      throw new CodexAppServerError("Codex 会话 ID 为空。", { code: "CODEX_THREAD_ID_EMPTY" });
    }
    const prepared = buildCodexAnalysisInput({ message, skill, skills, attachments });
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
      timeoutMs
    });
    let handoffWarning = "";
    try {
      await this.unsubscribeThread(normalizedThreadId, { timeoutMs });
    } catch (error) {
      handoffWarning = String(error?.message || error);
    }
    return {
      threadId: normalizedThreadId,
      turnId: String(turn?.turn?.id || "").trim(),
      unsupportedAttachments: prepared.unsupportedAttachments,
      handoffWarning,
      handoffPending: true,
      turn: turn?.turn || null
    };
  }

  async close() {
    if (this.state === "stopped") return;
    this.state = "closing";
    this.#rejectPending(new CodexAppServerError("Codex App Server 客户端已关闭。", {
      code: "CODEX_APP_SERVER_CLOSED"
    }));
    this.#stopOwnedProcess();
    this.child = null;
    this.initializeResult = null;
    this.startPromise = null;
    this.state = "stopped";
  }
}

export function createCodexAppServerClient(options) {
  return new CodexAppServerClient(options);
}
