import { randomUUID } from "node:crypto";

export class ActionConfirmationError extends Error {
  constructor(message, { code = "ACTION_CONFIRMATION_INVALID", statusCode = 409 } = {}) {
    super(message);
    this.name = "ActionConfirmationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function safeRecord(value) {
  return JSON.parse(JSON.stringify(value && typeof value === "object" ? value : {}));
}

/** Short-lived, process-local one-time grants for consequential MCP UI actions. */
export function createActionConfirmationStore({ ttlMs = 2 * 60 * 1000, maxEntries = 200, now = () => Date.now() } = {}) {
  const grants = new Map();

  function cleanup() {
    const current = now();
    for (const [id, grant] of grants) {
      if (grant.expiresAtMs <= current) grants.delete(id);
    }
    while (grants.size > maxEntries) grants.delete(grants.keys().next().value);
  }

  function issue(action, payload, { lifetimeMs = ttlMs } = {}) {
    cleanup();
    const createdAtMs = now();
    const confirmationId = randomUUID();
    const grant = {
      confirmationId,
      action: String(action || ""),
      payload: safeRecord(payload),
      createdAtMs,
      expiresAtMs: createdAtMs + Math.max(5_000, Math.min(Number(lifetimeMs) || ttlMs, 10 * 60 * 1000))
    };
    grants.set(confirmationId, grant);
    cleanup();
    return {
      confirmationId,
      action: grant.action,
      expiresAt: new Date(grant.expiresAtMs).toISOString()
    };
  }

  function consume(confirmationId, action) {
    cleanup();
    const id = String(confirmationId || "").trim();
    const grant = grants.get(id);
    if (!grant || grant.action !== String(action || "")) {
      throw new ActionConfirmationError("确认已失效或不适用于当前操作，请重新检查后确认。", {
        code: "ACTION_CONFIRMATION_INVALID"
      });
    }
    grants.delete(id);
    if (grant.expiresAtMs <= now()) {
      throw new ActionConfirmationError("确认已超时，请刷新最新状态后重新确认。", {
        code: "ACTION_CONFIRMATION_EXPIRED"
      });
    }
    return safeRecord(grant.payload);
  }

  function revoke(confirmationId) {
    return grants.delete(String(confirmationId || "").trim());
  }

  return { issue, consume, revoke };
}
