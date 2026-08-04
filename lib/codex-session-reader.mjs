import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const THREAD_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

export function createCodexSessionReader({ sessionsRoot } = {}) {
  const pathCache = new Map();

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
      return parseCodexTaskCompletion(await readFile(file, "utf8"), { after });
    } catch (error) {
      if (error.code === "ENOENT") {
        pathCache.delete(normalizeCodexThreadId(threadId));
        return null;
      }
      throw error;
    }
  }

  return { findSessionFile, readCompletion };
}
