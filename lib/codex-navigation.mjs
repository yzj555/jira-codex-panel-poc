export function normalizeCodexThreadId(value) {
  const threadId = String(value || "").trim();
  return threadId.startsWith("local:") ? threadId.slice("local:".length) : threadId;
}

export function findCodexRpcAsset(entrySource) {
  return String(entrySource || "").match(/["']\.\/(rpc-[A-Za-z0-9_-]+\.js)["']/)?.[1] || "";
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

  const entryUrls = Array.from(documentRef.scripts || [])
    .map((script) => String(script.src || ""))
    .filter((url) => url.startsWith("app://") && /\/assets\/index-[^/]+\.js(?:$|\?)/.test(url));
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
