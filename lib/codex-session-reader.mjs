import { open, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const THREAD_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SESSION_TAIL_BYTES = 4 * 1024 * 1024;
const REVIEW_REQUEST_MARKER = "SVN_REVIEW_REQUEST_V2";
const CONVERSATION_CONTEXT_CHARS = 80_000;

export function normalizeCodexThreadId(value) {
  return String(value || "").match(THREAD_ID_PATTERN)?.[0]?.toLowerCase() || "";
}

async function findFileRecursively(directory, threadId) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }

  const matchingFile = entries.find((entry) => (
    entry.isFile()
    && entry.name.toLowerCase().includes(threadId)
    && entry.name.toLowerCase().endsWith(".jsonl")
  ));
  if (matchingFile) return join(directory, matchingFile.name);

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => right.name.localeCompare(left.name));
  for (const entry of directories) {
    const match = await findFileRecursively(join(directory, entry.name), threadId);
    if (match) return match;
  }
  return "";
}

async function listSessionFilesRecursively(directory, files = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) {
      await listSessionFilesRecursively(candidate, files);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
      files.push(candidate);
    }
  }
  return files;
}

async function readSessionTail(file) {
  const handle = await open(file, "r");
  try {
    const fileStat = await handle.stat();
    const length = Math.min(fileStat.size, SESSION_TAIL_BYTES);
    const start = Math.max(0, fileStat.size - length);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let content = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) content = content.slice(Math.max(0, content.indexOf("\n") + 1));
    return content;
  } finally {
    await handle.close();
  }
}

export function parseCodexTaskCompletion(content, { after = 0 } = {}) {
  let completion = null;
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "event_msg") continue;
    const timestamp = Date.parse(entry.timestamp || "") || 0;
    if (timestamp && timestamp < Number(after || 0)) continue;
    if (entry.payload?.type === "task_complete") {
      completion = {
        status: "completed",
        completedAt: entry.timestamp || new Date(timestamp || Date.now()).toISOString(),
        result: String(entry.payload.last_agent_message || "").trim(),
        turnId: String(entry.payload.turn_id || "")
      };
    } else if (entry.payload?.type === "turn_aborted") {
      completion = {
        status: "failed",
        completedAt: entry.timestamp || new Date(timestamp || Date.now()).toISOString(),
        error: String(entry.payload.reason || entry.payload.message || "Codex 分析已中止。"),
        turnId: String(entry.payload.turn_id || "")
      };
    }
  }
  return completion;
}

function responseMessageText(entry) {
  const payload = entry?.payload;
  if (entry?.type !== "response_item" || payload?.type !== "message") return null;
  const role = String(payload.role || "").toLowerCase();
  if (!["user", "assistant"].includes(role)) return null;
  const text = Array.isArray(payload.content)
    ? payload.content.map((item) => String(item?.text || "")).filter(Boolean).join("\n")
    : String(payload.content || "");
  return text.trim() ? {
    role,
    text: text.trim(),
    turnId: String(payload.internal_chat_message_metadata_passthrough?.turn_id || "").trim()
  } : null;
}

function eventMessageText(entry) {
  const payload = entry?.payload;
  if (entry?.type !== "event_msg") return null;
  if (payload?.type === "user_message") {
    const text = String(payload.message || payload.text || "").trim();
    return text ? { role: "user", text } : null;
  }
  if (payload?.type === "agent_message") {
    const text = String(payload.message || payload.text || "").trim();
    return text ? { role: "assistant", text } : null;
  }
  return null;
}

function entryMessage(entry) {
  return responseMessageText(entry) || eventMessageText(entry);
}

function parseSessionEntries(content) {
  const entries = [];
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

export function parseCodexReviewTurn(content, {
  reviewId,
  snapshotHash,
  after = 0,
  turnId = ""
} = {}) {
  const expectedReviewId = String(reviewId || "").trim();
  const expectedSnapshotHash = String(snapshotHash || "").trim();
  const expectedTurnId = String(turnId || "").trim();
  let requestObserved = Boolean(expectedTurnId);
  let requestObservedAt = "";
  let observedTurnId = expectedTurnId;
  let startedAt = "";
  let candidateTurnId = "";
  let candidateStartedAt = "";
  let completion = null;

  for (const entry of parseSessionEntries(content)) {
    const timestamp = Date.parse(entry?.timestamp || "") || 0;
    if (timestamp && timestamp < Number(after || 0)) continue;
    const message = entryMessage(entry);
    if (message?.role === "user") {
      const text = message.text;
      if (text.includes(REVIEW_REQUEST_MARKER)
        && text.includes(`reviewId=${expectedReviewId}`)
        && text.includes(`snapshotHash=${expectedSnapshotHash}`)) {
        requestObserved = true;
        requestObservedAt = String(entry.timestamp || requestObservedAt);
        observedTurnId = observedTurnId || String(message.turnId || candidateTurnId || "").trim();
        startedAt = startedAt || candidateStartedAt;
      }
    }
    if (entry?.type !== "event_msg") continue;
    const payload = entry.payload || {};
    if (payload.type === "task_started") {
      candidateTurnId = String(payload.turn_id || "").trim();
      candidateStartedAt = String(entry.timestamp || "");
      if (requestObserved && !observedTurnId) {
        observedTurnId = candidateTurnId;
        startedAt = candidateStartedAt;
      }
      continue;
    }
    const payloadTurnId = String(payload.turn_id || "").trim();
    if (!observedTurnId || payloadTurnId !== observedTurnId) continue;
    if (payload.type === "task_complete") {
      completion = {
        status: "completed",
        completedAt: entry.timestamp || new Date(timestamp || Date.now()).toISOString(),
        result: String(payload.last_agent_message || "").trim(),
        turnId: observedTurnId
      };
    } else if (payload.type === "turn_aborted") {
      completion = {
        status: "failed",
        completedAt: entry.timestamp || new Date(timestamp || Date.now()).toISOString(),
        error: String(payload.reason || payload.message || "Codex 审核任务已中止。"),
        turnId: observedTurnId
      };
    }
  }

  if (completion) return { ...completion, requestObserved: true, requestObservedAt, startedAt };
  if (observedTurnId) {
    return {
      status: "running",
      requestObserved: true,
      requestObservedAt,
      startedAt,
      turnId: observedTurnId
    };
  }
  if (requestObserved) {
    return { status: "received", requestObserved: true, requestObservedAt, turnId: "" };
  }
  return null;
}

function truncateMessage(text, maximum = 12_000) {
  const value = String(text || "").trim();
  return value.length > maximum ? `${value.slice(0, maximum)}\n…（单条消息已截断）` : value;
}

export function parseCodexConversationContext(content, { maximumChars = CONVERSATION_CONTEXT_CHARS } = {}) {
  const messages = [];
  for (const entry of parseSessionEntries(content)) {
    const message = entryMessage(entry);
    if (!message || message.text.includes(REVIEW_REQUEST_MARKER)) continue;
    const text = truncateMessage(message.text);
    const previous = messages.at(-1);
    if (previous?.role === message.role && previous.text === text) continue;
    messages.push({
      index: messages.length,
      role: message.role,
      text,
      timestamp: String(entry.timestamp || "")
    });
  }

  const budget = Math.max(10_000, Number(maximumChars || CONVERSATION_CONTEXT_CHARS));
  const selected = new Map();
  let used = 0;
  const add = (message) => {
    if (!message || selected.has(message.index)) return;
    const cost = message.text.length + 80;
    if (used + cost > budget && selected.size) return;
    selected.set(message.index, message);
    used += cost;
  };
  add(messages.find((message) => message.role === "user"));
  for (const message of [...messages].reverse()) {
    if (message.role === "user") add(message);
  }
  for (const message of [...messages].reverse()) {
    if (message.role === "assistant") add(message);
  }
  const retained = Array.from(selected.values()).sort((left, right) => left.index - right.index);
  const omitted = Math.max(0, messages.length - retained.length);
  const markdown = retained.map((message) => {
    const label = message.role === "user" ? "用户需求/反馈" : "Codex 回复";
    return `## ${label}${message.timestamp ? ` · ${message.timestamp}` : ""}\n\n${message.text}`;
  }).join("\n\n");
  return {
    messages: retained,
    markdown: `${markdown || "（原任务没有可提取的对话文本。）"}${omitted ? `\n\n> 因长度限制省略了 ${omitted} 条较低优先级回复；用户需求优先保留。` : ""}`,
    omitted,
    total: messages.length
  };
}

export function parseCodexSessionContext(content) {
  let cwd = "";
  let workspaceRoots = [];
  let observedAt = "";
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload;
    if (entry?.type === "session_meta" && payload?.cwd) {
      cwd = String(payload.cwd);
      workspaceRoots = Array.isArray(payload.workspace_roots)
        ? payload.workspace_roots.map(String).filter(Boolean)
        : workspaceRoots;
      observedAt = String(entry.timestamp || observedAt);
    }
    if (entry?.type === "turn_context" && payload?.cwd) {
      cwd = String(payload.cwd);
      workspaceRoots = Array.isArray(payload.workspace_roots)
        ? payload.workspace_roots.map(String).filter(Boolean)
        : workspaceRoots;
      observedAt = String(entry.timestamp || observedAt);
    }
  }
  return cwd ? { cwd, workspaceRoots, observedAt } : null;
}

export function parseCodexTouchedFiles(content, { after = 0 } = {}) {
  let cwd = "";
  const touched = new Map();
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload;
    if (["session_meta", "turn_context"].includes(entry?.type) && payload?.cwd) {
      cwd = String(payload.cwd);
    }
    if (entry?.type !== "event_msg" || payload?.type !== "patch_apply_end" || payload?.success !== true) {
      continue;
    }
    const timestamp = Date.parse(entry.timestamp || "") || 0;
    if (timestamp && timestamp < Number(after || 0)) continue;
    if (!payload.changes || typeof payload.changes !== "object" || Array.isArray(payload.changes)) continue;
    for (const [filePath, change] of Object.entries(payload.changes)) {
      const rawPath = String(filePath || "").trim();
      if (!rawPath || (!isAbsolute(rawPath) && !cwd)) continue;
      const absolutePath = resolve(isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath));
      touched.set(absolutePath.toLowerCase(), {
        path: absolutePath,
        type: String(change?.type || "update"),
        timestamp: entry.timestamp || ""
      });
    }
  }
  return Array.from(touched.values());
}

export function createCodexSessionReader({ sessionsRoot } = {}) {
  const pathCache = new Map();
  const touchedFilesCache = new Map();
  const reviewPathCache = new Map();

  async function findSessionFile(threadId) {
    const normalized = normalizeCodexThreadId(threadId);
    if (!normalized) return "";
    if (pathCache.has(normalized)) return pathCache.get(normalized);
    const file = await findFileRecursively(sessionsRoot, normalized);
    if (file) pathCache.set(normalized, file);
    return file;
  }

  async function readCompletion(threadId, { after = 0 } = {}) {
    const file = await findSessionFile(threadId);
    if (!file) return null;
    try {
      return parseCodexTaskCompletion(await readSessionTail(file), { after });
    } catch (error) {
      if (error.code === "ENOENT") {
        pathCache.delete(normalizeCodexThreadId(threadId));
        return null;
      }
      throw error;
    }
  }

  async function readReviewTurn(threadId, options = {}) {
    const file = await findSessionFile(threadId);
    if (!file) return null;
    try {
      return parseCodexReviewTurn(await readSessionTail(file), options);
    } catch (error) {
      if (error.code === "ENOENT") {
        pathCache.delete(normalizeCodexThreadId(threadId));
        return null;
      }
      throw error;
    }
  }

  async function findReviewTurn({ reviewId, snapshotHash, threadId = "", after = 0 } = {}) {
    const normalizedReviewId = String(reviewId || "").trim();
    const normalizedSnapshotHash = String(snapshotHash || "").trim();
    if (!normalizedReviewId || !normalizedSnapshotHash) return null;
    const cacheKey = `${normalizedReviewId}:${normalizedSnapshotHash}:${normalizeCodexThreadId(threadId)}`;
    const inspectFile = async (file) => {
      try {
        const content = await readSessionTail(file);
        if (!content.includes(REVIEW_REQUEST_MARKER)
          || !content.includes(`reviewId=${normalizedReviewId}`)
          || !content.includes(`snapshotHash=${normalizedSnapshotHash}`)) return null;
        const observed = parseCodexReviewTurn(content, {
          reviewId: normalizedReviewId,
          snapshotHash: normalizedSnapshotHash,
          after
        });
        if (!observed) return null;
        return {
          ...observed,
          threadId: normalizeCodexThreadId(file),
          sessionFile: file
        };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    };

    const cachedFile = reviewPathCache.get(cacheKey);
    if (cachedFile) {
      const observed = await inspectFile(cachedFile);
      if (observed) return observed;
      reviewPathCache.delete(cacheKey);
    }

    if (threadId) {
      const exactFile = await findSessionFile(threadId);
      if (!exactFile) return null;
      const observed = await inspectFile(exactFile);
      if (observed) reviewPathCache.set(cacheKey, exactFile);
      return observed;
    }

    const files = await listSessionFilesRecursively(sessionsRoot);
    files.sort((left, right) => right.localeCompare(left));
    for (const file of files) {
      const observed = await inspectFile(file);
      if (!observed) continue;
      reviewPathCache.set(cacheKey, file);
      return observed;
    }
    return null;
  }

  async function readConversationContext(threadId, options = {}) {
    const normalized = normalizeCodexThreadId(threadId);
    const file = await findSessionFile(normalized);
    if (!file) return null;
    try {
      return parseCodexConversationContext(await readFile(file, "utf8"), options);
    } catch (error) {
      if (error.code === "ENOENT") {
        pathCache.delete(normalized);
        return null;
      }
      throw error;
    }
  }

  async function readContext(threadId) {
    const normalized = normalizeCodexThreadId(threadId);
    const file = await findSessionFile(normalized);
    if (!file) return null;
    try {
      const context = parseCodexSessionContext(await readSessionTail(file));
      return context ? { threadId: normalized, sessionFile: file, ...context } : null;
    } catch (error) {
      if (error.code === "ENOENT") {
        pathCache.delete(normalized);
        return null;
      }
      throw error;
    }
  }

  async function readTouchedFiles(threadId, { after = 0 } = {}) {
    const normalized = normalizeCodexThreadId(threadId);
    const file = await findSessionFile(normalized);
    if (!file) return [];
    try {
      const fileStat = await stat(file);
      const cacheKey = `${normalized}:${Number(after || 0)}`;
      const cached = touchedFilesCache.get(cacheKey);
      if (cached?.size === fileStat.size && cached?.modifiedAt === fileStat.mtimeMs) return cached.files;
      const files = parseCodexTouchedFiles(await readFile(file, "utf8"), { after });
      touchedFilesCache.set(cacheKey, { size: fileStat.size, modifiedAt: fileStat.mtimeMs, files });
      return files;
    } catch (error) {
      if (error.code === "ENOENT") {
        pathCache.delete(normalized);
        for (const key of touchedFilesCache.keys()) {
          if (key.startsWith(`${normalized}:`)) touchedFilesCache.delete(key);
        }
        return [];
      }
      throw error;
    }
  }

  return {
    findSessionFile,
    findReviewTurn,
    readCompletion,
    readReviewTurn,
    readConversationContext,
    readContext,
    readTouchedFiles
  };
}
