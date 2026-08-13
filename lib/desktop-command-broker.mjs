import { randomUUID } from "node:crypto";

export class DesktopCommandError extends Error {
  constructor(message, { code = "DESKTOP_COMMAND_ERROR", statusCode = 503, details } = {}) {
    super(message);
    this.name = "DesktopCommandError";
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

/**
 * Small in-memory rendezvous between official MCP tools and the current Codex
 * Desktop window. Commands are short-lived and explicitly completed by the
 * minimal injected host; durable Jira/Codex state is still written by services.
 */
export function createDesktopCommandBroker({ now = Date.now, defaultTimeoutMs = 20_000 } = {}) {
  const commands = new Map();
  const queue = [];
  const clients = new Map();

  function remove(id) {
    commands.delete(id);
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
  }

  function rejectExpired() {
    const timestamp = now();
    for (const [id, entry] of commands) {
      if (entry.expiresAt > timestamp) continue;
      remove(id);
      entry.reject(new DesktopCommandError("Codex Desktop 未在限定时间内接收操作，请确认应用已通过统一入口启动后重试。", {
        code: "DESKTOP_COMMAND_TIMEOUT",
        statusCode: 504
      }));
    }
  }

  function request(type, payload = {}, { timeoutMs = defaultTimeoutMs, targetClientId = "" } = {}) {
    rejectExpired();
    const id = randomUUID();
    const createdAt = now();
    const expiresAt = createdAt + Math.max(1_000, Math.min(60_000, Number(timeoutMs) || defaultTimeoutMs));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => rejectExpired(), Math.max(1, expiresAt - now()));
      timer.unref?.();
      commands.set(id, {
        command: {
          id,
          type: String(type || ""),
          payload,
          targetClientId: String(targetClientId || "").trim(),
          createdAt: new Date(createdAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString()
        },
        expiresAt,
        lease: "",
        leasedAt: 0,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      queue.push(id);
    });
  }

  function take(clientId) {
    rejectExpired();
    const owner = String(clientId || "").trim();
    if (!owner) throw new DesktopCommandError("Desktop clientId is required.", { code: "DESKTOP_CLIENT_ID_REQUIRED", statusCode: 400 });
    const timestamp = now();
    clients.set(owner, timestamp);
    for (const id of queue) {
      const entry = commands.get(id);
      if (!entry) continue;
      if (entry.command.targetClientId && entry.command.targetClientId !== owner) continue;
      // Desktop actions can create conversations and send messages. Once a
      // window has accepted one, never lease it to another window: an expired
      // request must fail visibly instead of replaying a side effect.
      if (entry.lease) continue;
      entry.lease = randomUUID();
      entry.leasedAt = timestamp;
      return { ...entry.command, lease: entry.lease };
    }
    return null;
  }

  function activeClients({ maxAgeMs = 15_000 } = {}) {
    const timestamp = now();
    const maximumAge = Math.max(1_000, Number(maxAgeMs) || 15_000);
    for (const [clientId, lastSeenAt] of clients) {
      if (timestamp - lastSeenAt > maximumAge) clients.delete(clientId);
    }
    return [...clients.keys()];
  }

  function complete(id, { lease, ok, result, error } = {}) {
    rejectExpired();
    const entry = commands.get(String(id || ""));
    if (!entry) return { accepted: false, reason: "missing" };
    if (!lease || lease !== entry.lease) {
      throw new DesktopCommandError("Desktop command lease is invalid.", { code: "DESKTOP_COMMAND_LEASE_INVALID", statusCode: 409 });
    }
    remove(entry.command.id);
    if (ok === true) entry.resolve(result ?? null);
    else entry.reject(new DesktopCommandError(String(error?.message || error || "Codex Desktop 操作失败。"), {
      code: String(error?.code || "DESKTOP_COMMAND_FAILED"),
      statusCode: 503
    }));
    return { accepted: true };
  }

  function close() {
    for (const [id, entry] of commands) {
      remove(id);
      entry.reject(new DesktopCommandError("本地服务正在关闭。", { code: "DESKTOP_COMMAND_BROKER_CLOSED", statusCode: 503 }));
    }
  }

  return {
    request,
    take,
    complete,
    close,
    activeClients,
    snapshot: () => ({ pending: commands.size, activeClients: activeClients().length })
  };
}
