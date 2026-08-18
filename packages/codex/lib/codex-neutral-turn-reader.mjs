// 中性 turnReader 适配器：把 Codex App Server 的 thread/read 原始形状
// （thread.turns[].items[]，item.type ∈ userMessage/agentMessage/fileChange）
// 映射成宿主无关的中性形状（DESIGN.md §5.3）：
//
//   thread = {
//     id, cwd,
//     turns: [{
//       turnId, startedAt, completedAt,
//       messages: [{ role: "用户" | "Codex", text }],
//       fileChanges: [{ path, observedAt }]
//     }]
//   }
//   turnResult = { threadId, turnId, status, startedAt, completedAt, result, error, source }
//
// threadId 在此剥离 local: 前缀（红线：中性形状不含 Codex 专属前缀）。
//
// 只给 svn-review-manager 用。codexRuntime 本身保持原始形状返回给前端 UI 与
// automation（它们依赖 items/fileChange），不经本适配器。

import { normalizeCodexAppServerTurn } from "./codex-app-server-client.mjs";

function normalizedThreadId(value) {
  return String(value || "").trim().replace(/^local:/i, "");
}

function itemText(item) {
  if (typeof item?.text === "string") return item.text.trim();
  const content = Array.isArray(item?.content) ? item.content : [];
  return content.map((entry) => typeof entry === "string" ? entry : String(entry?.text || "").trim())
    .filter(Boolean).join("\n").trim();
}

function observedAtOf(turn) {
  const raw = turn?.completedAt || turn?.startedAt || "";
  const numeric = Number(raw);
  const milliseconds = Number.isFinite(numeric) && numeric > 0
    ? numeric * (numeric < 10_000_000_000 ? 1_000 : 1)
    : Date.parse(String(raw));
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString()
    : "";
}

function neutralThread(thread) {
  if (!thread || typeof thread !== "object") return null;
  return {
    id: normalizedThreadId(thread.id),
    cwd: String(thread.cwd || "").trim(),
    turns: (Array.isArray(thread.turns) ? thread.turns : []).flatMap((turn) => {
      const turnId = String(turn?.id || "").trim();
      if (!turnId) return [];
      const messages = [];
      const fileChanges = [];
      for (const item of Array.isArray(turn?.items) ? turn.items : []) {
        const type = String(item?.type || "");
        if (type === "userMessage") {
          const text = itemText(item);
          if (text) messages.push({ role: "用户", text });
        } else if (type === "agentMessage") {
          const text = itemText(item);
          if (text) messages.push({ role: "Codex", text });
        } else if (["fileChange", "file_change"].includes(type)) {
          const changes = Array.isArray(item?.changes) ? item.changes : [item];
          for (const change of changes) {
            const path = String(change?.path || change?.filePath || "").trim();
            if (path) fileChanges.push({ path, observedAt: observedAtOf(turn) });
          }
        }
      }
      return [{
        turnId,
        startedAt: turn?.startedAt || "",
        completedAt: turn?.completedAt || "",
        messages,
        fileChanges
      }];
    })
  };
}

function threadFromReadResult(result) {
  return result?.thread || result?.result?.thread || result || null;
}

/**
 * 包装 codexRuntime，把 App Server 原始形状映射成中性形状。
 * @param codexRuntime - createCodexRuntimeGateway 的返回值（readThread/readTurnResult）。
 */
export function createNeutralTurnReader(codexRuntime) {
  if (!codexRuntime || typeof codexRuntime.readThread !== "function") {
    throw new TypeError("neutral turnReader 需要 codexRuntime.readThread。");
  }

  async function readThread(threadId, options = {}) {
    const raw = threadFromReadResult(await codexRuntime.readThread(
      normalizedThreadId(threadId),
      options
    ));
    return neutralThread(raw);
  }

  async function readTurnResult(threadId, turnId) {
    if (typeof codexRuntime.readTurnResult !== "function") return null;
    const observed = await codexRuntime.readTurnResult(normalizedThreadId(threadId), turnId);
    if (!observed) return null;
    // codexRuntime.readTurnResult 已由 normalizeCodexAppServerTurn 归一化到
    // { threadId, turnId, status, startedAt, completedAt, result, error, source }，
    // 但为了与中性形状严格一致，再显式归一化一次 threadId。
    return { ...observed, threadId: normalizedThreadId(observed.threadId) };
  }

  return { readThread, readTurnResult };
}

export { normalizeCodexAppServerTurn };
