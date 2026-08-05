(() => {
  const VERSION = "0.24.6";
  const ENTRY_ID = "jira-codex-poc-entry";
  const PAGE_ID = "jira-codex-poc-page";
  const STYLE_ID = "jira-codex-poc-style";
  const CONVERSATION_FLOAT_ID = "jira-codex-conversation-float";
  const SVN_MODAL_ID = "jira-codex-svn-modal";
  const HIDDEN_ATTRIBUTE = "data-jira-codex-poc-hidden";
  const HOST_ATTRIBUTE = "data-jira-codex-poc-host";
  const OWNED_ATTRIBUTE = "data-jira-codex-poc-owned";
  const BINDINGS_KEY = "jira-codex-panel-poc:issue-bindings:v1";
  const PENDING_BINDING_KEY = "jira-codex-panel-poc:pending-binding:v1";
  const BUG_MONITOR_STATE_KEY = "jira-codex-panel-poc:bug-monitor:v2";
  const BUG_MONITOR_INTERVAL_MS = 30_000;
  const PANEL_URL = window.__JIRA_CODEX_POC_PANEL_URL__ || "http://127.0.0.1:47823/";
  const PANEL_ORIGIN = new URL(PANEL_URL).origin;
  const PANEL_DOCUMENT = window.__JIRA_CODEX_POC_PANEL_DOCUMENT__ || "";
  const EMBEDDED_PANEL = Boolean(PANEL_DOCUMENT);
  const BRIDGE_BINDING_NAME = window.__JIRA_CODEX_BRIDGE_BINDING__ || "__jiraCodexNodeRequest";
  const CODEX_THEME_TOKEN_SOURCES = {
    bg: "--color-token-bg-primary",
    surface: "--color-token-main-surface-primary",
    "surface-under": "--color-background-surface-under",
    elevated: "--color-background-elevated-primary-opaque",
    control: "--color-background-control-opaque",
    muted: "--color-background-button-secondary",
    hover: "--color-background-button-secondary-hover",
    text: "--color-text-foreground",
    "text-secondary": "--color-text-foreground-secondary",
    "text-muted": "--color-text-foreground-tertiary",
    border: "--color-border",
    "border-strong": "--color-border-heavy",
    accent: "--color-text-accent",
    "accent-soft": "--color-background-accent",
    "on-accent": "--color-text-on-accent",
    button: "--color-background-button-primary",
    "on-button": "--color-text-button-primary",
    success: "--color-accent-green",
    "success-soft": "--color-background-status-success",
    error: "--color-decoration-deleted",
    "error-soft": "--color-background-status-error",
    warning: "--color-icon-warning",
    "warning-soft": "--color-background-status-warning"
  };
  const THEME_FALLBACK_TOKENS = {
    light: {
      bg: "#f6f7f8", surface: "#ffffff", "surface-under": "#fafbfc", elevated: "#ffffff",
      control: "#ffffff", muted: "#f0f1f2", hover: "#f4f6f8", text: "#202124",
      "text-secondary": "#5f6670", "text-muted": "#8b9198", border: "#e0e3e6",
      "border-strong": "#cfd5dc", accent: "#315bb4", "accent-soft": "#edf3ff",
      "on-accent": "#ffffff", button: "#202124", "on-button": "#ffffff", success: "#2f8156",
      "success-soft": "#eaf7ef", error: "#ad4444", "error-soft": "#fff1f1",
      warning: "#dea64d", "warning-soft": "#fff6e8"
    },
    dark: {
      bg: "#18191b", surface: "#202123", "surface-under": "#1c1d1f", elevated: "#242528",
      control: "#292a2d", muted: "#2d2f33", hover: "#34363a", text: "#f2f3f5",
      "text-secondary": "#c0c4ca", "text-muted": "#8f969f", border: "rgba(255,255,255,.10)",
      "border-strong": "rgba(255,255,255,.17)", accent: "#73a7ff",
      "accent-soft": "rgba(73,124,217,.20)", "on-accent": "#ffffff", button: "#f2f3f5",
      "on-button": "#18191b", success: "#62cf91", "success-soft": "rgba(53,170,102,.17)",
      error: "#ff8c82", "error-soft": "rgba(210,68,68,.18)", warning: "#f1b35d",
      "warning-soft": "rgba(205,135,42,.18)"
    }
  };

  /*__JIRA_CODEX_NAVIGATION_HELPERS__*/
  /*__JIRA_CODEX_PROMPT_HELPERS__*/

  if (window.__jiraCodexPoc?.version === VERSION) {
    window.__jiraCodexPoc.ensure();
    return window.__jiraCodexPoc.state();
  }
  window.__jiraCodexPoc?.destroy?.();

  let active = false;
  let entry = null;
  let page = null;
  let frame = null;
  let observer = null;
  let themeObserver = null;
  let currentThemeFingerprint = "";
  let bindingTimer = null;
  let bugMonitorTimer = null;
  let bugMonitorRunning = false;
  let conversationFloat = null;
  let conversationFloatRequestId = 0;
  let conversationFloatState = null;
  let conversationThreadHint = null;
  let svnModal = null;
  let svnModalState = null;
  let svnReviewPollTimer = null;
  let svnFloatReviewPollTimer = null;
  let svnFloatReviewPollId = "";
  let svnAuditDispatching = false;
  let scheduled = false;
  let bridgeSequence = 0;
  const bridgeRequests = new Map();
  const collapsedConversationThreads = new Set();
  const conversationThreadAliases = new Map();
  const bindingResolutionPromises = new Map();
  const bindingFinalizationPromises = new Map();
  let lastBindingResolution = null;

  const normalizedLabel = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const pluginLabels = ["插件", "plugins", "plugin"];
  const newChatLabels = ["新对话", "新聊天", "new chat", "new task"];
  const sendLabels = ["发送", "send"];
  const nativePageLabels = [
    ...newChatLabels,
    "拉取请求", "pull requests",
    "站点", "sites",
    "已安排", "scheduled",
    "技能", "skills",
    "插件", "plugins"
  ];

  function buttonMatches(button, labels) {
    const candidates = [
      button?.textContent,
      button?.getAttribute?.("aria-label"),
      button?.getAttribute?.("title")
    ].map(normalizedLabel).filter(Boolean);
    return candidates.some((candidate) => labels.includes(candidate));
  }

  function readStoredObject(key) {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function writeStoredObject(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function readBindings() {
    return readStoredObject(BINDINGS_KEY);
  }

  function bindingMatchesThread(binding, threadId) {
    const normalizedThreadId = normalizeCodexThreadId(threadId);
    if (!normalizedThreadId || !binding) return false;
    return [binding.threadId, binding.uiThreadId]
      .map(normalizeCodexThreadId)
      .filter(Boolean)
      .includes(normalizedThreadId);
  }

  function threadRows() {
    return Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-id]"));
  }

  function availableThreads() {
    const seen = new Set();
    return threadRows().flatMap((row) => {
      const threadId = row.getAttribute("data-app-action-sidebar-thread-id");
      if (!threadId || seen.has(threadId)) return [];
      seen.add(threadId);
      return [{
        threadId,
        threadTitle: row.getAttribute("data-app-action-sidebar-thread-title") || threadId,
        pinned: row.getAttribute("data-app-action-sidebar-thread-pinned") === "true"
      }];
    });
  }

  function availableProjects() {
    const seen = new Set();
    return Array.from(document.querySelectorAll("[data-app-action-sidebar-project-id]")).flatMap((row) => {
      const projectId = row.getAttribute("data-app-action-sidebar-project-id");
      if (!projectId || seen.has(projectId)) return [];
      seen.add(projectId);
      return [{
        projectId,
        projectLabel: row.getAttribute("data-app-action-sidebar-project-label")
          || row.getAttribute("aria-label")
          || projectId
      }];
    });
  }

  function sendPanelMessage(type, payload = {}) {
    frame?.contentWindow?.postMessage({
      source: "jira-codex-panel-host",
      type,
      ...payload
    }, EMBEDDED_PANEL ? "*" : PANEL_ORIGIN);
  }

  function codexThemeName() {
    const root = document.documentElement;
    if (root.classList.contains("electron-dark")) return "dark";
    if (root.classList.contains("electron-light")) return "light";
    const colorScheme = window.getComputedStyle(root).colorScheme || "";
    if (/\bdark\b/i.test(colorScheme) && !/\blight\b/i.test(colorScheme)) return "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  function safeThemeToken(value) {
    const normalized = String(value || "").trim();
    return normalized && normalized.length <= 160 && !/[;{}<>]/.test(normalized) ? normalized : "";
  }

  function themeTokenRgb(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (/^#[0-9a-f]{3,8}$/i.test(normalized)) {
      const hex = normalized.slice(1);
      const expanded = hex.length === 3 || hex.length === 4
        ? hex.slice(0, 3).split("").map((character) => character + character).join("")
        : hex.slice(0, 6);
      return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
    }
    if (!/^rgba?\(/i.test(normalized)) return null;
    const channels = normalized.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    return channels.length === 3 && channels.every(Number.isFinite) ? channels : null;
  }

  function themeTokenLuminance(value) {
    const rgb = themeTokenRgb(value);
    if (!rgb) return null;
    const channels = rgb.map((channel) => {
      const normalized = Math.max(0, Math.min(255, channel)) / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function themeTokenContrast(background, foreground) {
    const backgroundLuminance = themeTokenLuminance(background);
    const foregroundLuminance = themeTokenLuminance(foreground);
    if (backgroundLuminance === null || foregroundLuminance === null) return null;
    const high = Math.max(backgroundLuminance, foregroundLuminance);
    const low = Math.min(backgroundLuminance, foregroundLuminance);
    return (high + 0.05) / (low + 0.05);
  }

  function normalizeCodexThemeTokens(theme, rawTokens) {
    const surfaceLuminance = themeTokenLuminance(rawTokens.surface || rawTokens.bg);
    const surfaceMatchesTheme = surfaceLuminance === null
      || (theme === "dark" ? surfaceLuminance < 0.5 : surfaceLuminance >= 0.5);
    if (!surfaceMatchesTheme) return { tokens: {}, tokenSource: "fallback" };

    const tokens = { ...rawTokens };
    const buttonContrast = themeTokenContrast(tokens.button, tokens["on-button"]);
    if (buttonContrast !== null && buttonContrast < 4.5) {
      delete tokens.button;
      delete tokens["on-button"];
      return { tokens, tokenSource: "host-with-button-fallback" };
    }
    return { tokens, tokenSource: "host" };
  }

  function readCodexThemeSnapshot() {
    const styles = window.getComputedStyle(document.documentElement);
    const rawTokens = Object.fromEntries(Object.entries(CODEX_THEME_TOKEN_SOURCES).flatMap(([key, source]) => {
      const value = safeThemeToken(styles.getPropertyValue(source));
      return value ? [[key, value]] : [];
    }));
    const theme = codexThemeName();
    return { theme, ...normalizeCodexThemeTokens(theme, rawTokens) };
  }

  function applyThemeSnapshotToFrame(snapshot) {
    if (!frame) return;
    const fallbackBackground = snapshot.theme === "dark" ? "#202123" : "#ffffff";
    frame.style.colorScheme = snapshot.theme;
    frame.style.background = snapshot.tokens.surface || snapshot.tokens.bg || fallbackBackground;
    if (page) page.style.background = frame.style.background;
    try {
      const root = frame.contentDocument?.documentElement;
      if (!root) return;
      root.dataset.theme = snapshot.theme;
      root.style.colorScheme = snapshot.theme;
      Object.keys(CODEX_THEME_TOKEN_SOURCES).forEach((key) => {
        root.style.removeProperty(`--codex-theme-${key}`);
      });
      Object.entries(snapshot.tokens).forEach(([key, value]) => {
        root.style.setProperty(`--codex-theme-${key}`, value);
      });
    } catch {}
  }

  function applyThemeSnapshotToConversationFloat(snapshot) {
    if (!conversationFloat) return;
    conversationFloat.dataset.theme = snapshot.theme;
    conversationFloat.dataset.themeSource = snapshot.tokenSource;
    const fallbackTokens = THEME_FALLBACK_TOKENS[snapshot.theme] || THEME_FALLBACK_TOKENS.light;
    Object.entries(CODEX_THEME_TOKEN_SOURCES).forEach(([key, source]) => {
      conversationFloat.style.setProperty(source, snapshot.tokens[key] || fallbackTokens[key]);
    });
  }

  function applyThemeSnapshotToSvnModal(snapshot) {
    if (!svnModal) return;
    svnModal.dataset.theme = snapshot.theme;
    svnModal.dataset.themeSource = snapshot.tokenSource;
    const fallbackTokens = THEME_FALLBACK_TOKENS[snapshot.theme] || THEME_FALLBACK_TOKENS.light;
    Object.entries(CODEX_THEME_TOKEN_SOURCES).forEach(([key, source]) => {
      svnModal.style.setProperty(source, snapshot.tokens[key] || fallbackTokens[key]);
    });
  }

  function syncCodexTheme(force = false) {
    const snapshot = readCodexThemeSnapshot();
    const fingerprint = JSON.stringify(snapshot);
    page?.setAttribute("data-theme", snapshot.theme);
    applyThemeSnapshotToConversationFloat(snapshot);
    applyThemeSnapshotToSvnModal(snapshot);
    applyThemeSnapshotToFrame(snapshot);
    if (force || fingerprint !== currentThemeFingerprint) {
      currentThemeFingerprint = fingerprint;
      sendPanelMessage("theme", snapshot);
    }
    return snapshot;
  }

  function resolveHostFetch(response) {
    const pending = bridgeRequests.get(String(response?.id || ""));
    if (!pending) return;
    bridgeRequests.delete(String(response.id));
    window.clearTimeout(pending.timer);
    if (response.error) pending.reject(new Error(response.error));
    else pending.resolve(response);
  }

  function hostBridgeRequest(request) {
    const binding = window[BRIDGE_BINDING_NAME];
    const bridgeToken = window.__JIRA_CODEX_BRIDGE_TOKEN__ || "";
    if (typeof binding !== "function" || !bridgeToken) {
      return Promise.reject(new Error("面板与本地服务的安全桥接尚未就绪。"));
    }
    const id = `${Date.now()}-${++bridgeSequence}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        bridgeRequests.delete(id);
        reject(new Error("本地面板请求超时。"));
      }, 90_000);
      bridgeRequests.set(id, { resolve, reject, timer });
      try {
        binding(JSON.stringify({ id, token: bridgeToken, ...request }));
      } catch (error) {
        window.clearTimeout(timer);
        bridgeRequests.delete(id);
        reject(error);
      }
    });
  }

  function hostFetch(request) {
    const url = new URL(String(request?.url || ""), PANEL_URL);
    if (url.origin !== PANEL_ORIGIN) {
      return Promise.reject(new Error("面板桥接拒绝访问非本地服务地址。"));
    }
    return hostBridgeRequest({ ...request, url: url.href });
  }

  async function panelJson(path, { method = "GET", body } = {}) {
    const response = await hostFetch({
      method,
      url: new URL(path, PANEL_URL).href,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return decodeBridgeJson(response);
  }

  async function reportAutomationFailure(issueKey, message) {
    if (!issueKey) return;
    try {
      const payload = await panelJson("/api/automation/jobs/fail", {
        method: "PUT",
        body: { issueKey, message: String(message || "自动分析启动失败。") }
      });
      sendPanelMessage("automation-status", { automation: payload.automation });
    } catch {}
  }

  async function registerAutomatedBinding(pending, binding) {
    try {
      const payload = await panelJson("/api/automation/jobs", {
        method: "PUT",
        body: {
          issue: {
            key: pending.issueKey,
            title: pending.issueTitle,
            url: pending.issueUrl,
            statusLabel: pending.issueStatus,
            assignee: pending.issueAssignee
          },
          threadId: binding.threadId,
          startedAt: pending.startedAt,
          monitorGeneration: pending.monitorGeneration
        }
      });
      sendPanelMessage("automation-status", { automation: payload.automation });
    } catch (error) {
      await reportAutomationFailure(pending.issueKey, `会话已创建，但自动分析结果跟踪失败：${error.message || error}`);
    }
  }

  async function captureNewConversationSvnBaseline(pending, binding) {
    if (!pending?.captureSvnBaseline || !binding?.threadId) return;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await panelJson("/api/svn/baselines", {
          method: "PUT",
          body: {
            issueKey: pending.issueKey,
            threadId: binding.threadId,
            boundAt: pending.startedAt
          }
        });
        return;
      } catch {
        if (attempt >= 11) return;
        await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 500));
      }
    }
  }

  window.__jiraCodexResolveHostFetch = resolveHostFetch;
  window.__jiraCodexHostFetch = hostFetch;

  function sendBindings() {
    sendPanelMessage("bindings", {
      bindings: readBindings(),
      threads: availableThreads(),
      projects: availableProjects()
    });
    syncCodexTheme(true);
  }

  async function completeResolvedBindingFinalization(issueKey, binding) {
    const normalizedIssueKey = String(issueKey || "").trim().toUpperCase();
    const pending = binding?.pendingFinalization;
    if (!normalizedIssueKey || !pending || isProvisionalCodexThreadId(binding.threadId)) return binding;
    if (bindingFinalizationPromises.has(normalizedIssueKey)) {
      return bindingFinalizationPromises.get(normalizedIssueKey);
    }
    const task = (async () => {
      if (pending.automated) await registerAutomatedBinding(pending, binding);
      if (pending.captureSvnBaseline) await captureNewConversationSvnBaseline(pending, binding);
      const bindings = readBindings();
      const latest = bindings[normalizedIssueKey];
      if (!latest || normalizeCodexThreadId(latest.threadId) !== normalizeCodexThreadId(binding.threadId)) {
        return latest || binding;
      }
      const finalized = { ...latest };
      delete finalized.pendingFinalization;
      bindings[normalizedIssueKey] = finalized;
      if (writeStoredObject(BINDINGS_KEY, bindings)) sendBindings();
      return finalized;
    })().finally(() => bindingFinalizationPromises.delete(normalizedIssueKey));
    bindingFinalizationPromises.set(normalizedIssueKey, task);
    return task;
  }

  async function reconcileIssueBinding(issueKey, {
    activeThreadId = activeThreadIds()[0] || "",
    retry = false
  } = {}) {
    const normalizedIssueKey = String(issueKey || "").trim().toUpperCase();
    if (!normalizedIssueKey) return null;
    if (bindingResolutionPromises.has(normalizedIssueKey)) {
      return bindingResolutionPromises.get(normalizedIssueKey);
    }
    const task = (async () => {
      const attempts = retry ? 20 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const bindings = readBindings();
        const latest = bindings[normalizedIssueKey];
        if (!latest) return null;
        if (!isProvisionalCodexThreadId(latest.threadId)) {
          void completeResolvedBindingFinalization(normalizedIssueKey, latest);
          return latest;
        }
        const provisionalThreadId = [activeThreadId, latest.uiThreadId, latest.threadId]
          .find((value) => isProvisionalCodexThreadId(value));
        if (!provisionalThreadId) return latest;
        lastBindingResolution = {
          issueKey: normalizedIssueKey,
          provisionalThreadId,
          attempt: attempt + 1,
          status: "resolving",
          error: ""
        };
        try {
          const resolvedThreadId = await resolveCodexThreadId(provisionalThreadId, { timeoutMs: 4_000 });
          if (resolvedThreadId && !isProvisionalCodexThreadId(resolvedThreadId)) {
            const currentBindings = readBindings();
            const current = currentBindings[normalizedIssueKey];
            if (!current || !isProvisionalCodexThreadId(current.threadId)) return current || null;
            const canonicalThreadId = `local:${normalizeCodexThreadId(resolvedThreadId)}`;
            const resolvedBinding = {
              ...current,
              threadId: canonicalThreadId,
              uiThreadId: provisionalThreadId,
              resolvedAt: new Date().toISOString()
            };
            currentBindings[normalizedIssueKey] = resolvedBinding;
            if (!writeStoredObject(BINDINGS_KEY, currentBindings)) return current;
            conversationThreadAliases.set(normalizeCodexThreadId(provisionalThreadId), normalizedIssueKey);
            if (collapsedConversationThreads.delete(current.threadId)) {
              collapsedConversationThreads.add(canonicalThreadId);
            }
            if (conversationThreadHint?.issueKey === normalizedIssueKey) {
              conversationThreadHint.threadId = canonicalThreadId;
              conversationThreadHint.binding = resolvedBinding;
            }
            if (conversationFloatState?.issueKey === normalizedIssueKey) {
              conversationFloatState.threadId = canonicalThreadId;
              conversationFloatState.binding = resolvedBinding;
              renderConversationIssueFloat();
            }
            sendBindings();
            lastBindingResolution = {
              ...lastBindingResolution,
              status: "resolved",
              resolvedThreadId: canonicalThreadId
            };
            void completeResolvedBindingFinalization(normalizedIssueKey, resolvedBinding);
            return resolvedBinding;
          }
          lastBindingResolution = {
            ...lastBindingResolution,
            status: "waiting",
            resolvedThreadId: String(resolvedThreadId || "")
          };
        } catch (error) {
          lastBindingResolution = {
            ...lastBindingResolution,
            status: "failed",
            error: String(error?.message || error)
          };
        }
        if (attempt + 1 < attempts) {
          await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 250));
        }
      }
      return readBindings()[normalizedIssueKey] || null;
    })().finally(() => bindingResolutionPromises.delete(normalizedIssueKey));
    bindingResolutionPromises.set(normalizedIssueKey, task);
    return task;
  }

  function tryBindPendingIssue() {
    const pending = readStoredObject(PENDING_BINDING_KEY);
    if (!pending.issueKey || !pending.startedAt) return false;
    if (Date.now() - Number(pending.startedAt) > 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(PENDING_BINDING_KEY);
      return false;
    }
    const knownIds = new Set(Array.isArray(pending.knownThreadIds) ? pending.knownThreadIds : []);
    const thread = threadRows().find((row) => {
      const threadId = row.getAttribute("data-app-action-sidebar-thread-id");
      return threadId && !knownIds.has(threadId);
    });
    if (!thread) return false;
    const threadId = thread.getAttribute("data-app-action-sidebar-thread-id");
    const bindings = readBindings();
    bindings[pending.issueKey] = {
      threadId,
      uiThreadId: isProvisionalCodexThreadId(threadId) ? threadId : "",
      threadTitle: thread.getAttribute("data-app-action-sidebar-thread-title") || pending.issueTitle || pending.issueKey,
      issueTitle: pending.issueTitle || "",
      boundAt: new Date().toISOString(),
      pendingFinalization: {
        ...pending,
        startedAt: Number(pending.startedAt)
      }
    };
    if (!writeStoredObject(BINDINGS_KEY, bindings)) return false;
    window.localStorage.removeItem(PENDING_BINDING_KEY);
    if (isProvisionalCodexThreadId(threadId)) {
      void reconcileIssueBinding(pending.issueKey, { activeThreadId: threadId, retry: true });
    } else {
      void completeResolvedBindingFinalization(pending.issueKey, bindings[pending.issueKey]);
    }
    setConversationThreadHint(pending.issueKey, bindings[pending.issueKey], knownIds.size ? Array.from(knownIds) : []);
    sendBindings();
    ensureConversationIssueFloat();
    return true;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${HIDDEN_ATTRIBUTE}="true"] { visibility: hidden !important; pointer-events: none !important; }
      [${HOST_ATTRIBUTE}="true"] {
        position: relative !important;
        z-index: 31 !important;
        overflow: hidden !important;
        pointer-events: none !important;
      }
      #${PAGE_ID} { position: absolute; inset: 0; z-index: 1; background: var(--color-token-main-surface-primary, #f7f7f5); pointer-events: auto; }
      #${PAGE_ID}[hidden] { display: none !important; }
      #${PAGE_ID} iframe { display: block; width: 100%; height: 100%; border: 0; background: var(--color-token-main-surface-primary, #f7f7f5); }
      #${ENTRY_ID}[aria-current="page"] { background: var(--color-token-sidebar-surface-secondary, rgba(0,0,0,.06)); }
      #${CONVERSATION_FLOAT_ID} {
        position: fixed;
        top: 66px;
        right: 16px;
        z-index: 30;
        width: min(370px, calc(100vw - 32px));
        max-height: calc(100vh - 148px);
        color: var(--color-text-foreground, #202124);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
      }
      #${CONVERSATION_FLOAT_ID}[hidden] { display: none !important; }
      #${CONVERSATION_FLOAT_ID} * { box-sizing: border-box; }
      .jira-codex-float-card {
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 148px);
        overflow: hidden;
        border: 1px solid var(--color-border-heavy, rgba(25, 28, 33, .14));
        border-radius: 14px;
        background: var(--color-background-elevated-primary-opaque, rgba(255, 255, 255, .97));
        box-shadow: 0 16px 44px rgba(0, 0, 0, .24), 0 2px 8px rgba(0, 0, 0, .12);
        backdrop-filter: blur(16px);
      }
      .jira-codex-float-header,
      .jira-codex-float-actions,
      .jira-codex-float-meta-row,
      .jira-codex-float-transition-row,
      .jira-codex-float-attachment,
      .jira-codex-float-collapsed-button {
        display: flex;
        align-items: center;
      }
      .jira-codex-float-header {
        min-height: 50px;
        gap: 9px;
        padding: 9px 10px 9px 12px;
        border-bottom: 1px solid var(--color-border, rgba(25, 28, 33, .09));
      }
      .jira-codex-float-type {
        flex: 0 0 auto;
        padding: 2px 6px;
        border-radius: 6px;
        color: var(--color-text-accent, #3157b7);
        background: var(--color-background-accent, #edf2ff);
        font-size: 11px;
        font-weight: 700;
      }
      .jira-codex-float-type[data-type="bug"] { color: var(--color-decoration-deleted, #b33b32); background: var(--color-background-status-error, #fff0ed); }
      .jira-codex-float-key { min-width: 0; color: var(--color-text-foreground-secondary, #687080); font-size: 12px; font-weight: 700; }
      .jira-codex-float-actions { margin-left: auto; gap: 4px; }
      .jira-codex-float-icon-button,
      .jira-codex-float-button,
      .jira-codex-float-collapsed-button {
        border: 1px solid var(--color-border-heavy, rgba(25, 28, 33, .13));
        color: var(--color-text-foreground, #34383f);
        background: var(--color-background-control-opaque, #fff);
        cursor: pointer;
      }
      .jira-codex-float-icon-button {
        display: grid;
        width: 30px;
        height: 30px;
        padding: 0;
        place-items: center;
        border-radius: 8px;
        font-size: 15px;
      }
      .jira-codex-float-icon-button:hover,
      .jira-codex-float-button:hover,
      .jira-codex-float-collapsed-button:hover { background: var(--color-background-button-secondary-hover, #f3f4f6); }
      .jira-codex-float-body { min-height: 0; padding: 14px; overflow: auto; overscroll-behavior: contain; }
      .jira-codex-float-title { margin: 0 0 10px; font-size: 16px; line-height: 1.4; font-weight: 700; }
      .jira-codex-float-status {
        display: inline-flex;
        max-width: 100%;
        margin-bottom: 12px;
        padding: 3px 8px;
        overflow: hidden;
        border-radius: 999px;
        color: var(--color-text-accent, #3157b7);
        background: var(--color-background-accent, #edf2ff);
        font-size: 12px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jira-codex-float-section { margin-top: 14px; }
      .jira-codex-float-section-title { margin: 0 0 6px; color: var(--color-text-foreground-secondary, #737b89); font-size: 11px; font-weight: 700; letter-spacing: .04em; }
      .jira-codex-float-description {
        max-height: 142px;
        margin: 0;
        padding: 10px;
        overflow: auto;
        border-radius: 9px;
        color: var(--color-text-foreground-secondary, #41464e);
        background: var(--color-background-button-secondary, #f6f7f8);
        white-space: pre-wrap;
      }
      .jira-codex-float-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 12px; }
      .jira-codex-float-meta-row { min-width: 0; align-items: flex-start; gap: 6px; }
      .jira-codex-float-meta-label { flex: 0 0 auto; color: var(--color-text-foreground-tertiary, #878e99); }
      .jira-codex-float-meta-value { min-width: 0; overflow: hidden; color: var(--color-text-foreground-secondary, #41464e); text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-float-chip-list { display: flex; flex-wrap: wrap; gap: 5px; }
      .jira-codex-float-chip { padding: 2px 7px; border: 1px solid var(--color-border, #e2e5e9); border-radius: 999px; color: var(--color-text-foreground-secondary, #4d5560); background: var(--color-background-surface-under, #fafafa); font-size: 12px; }
      .jira-codex-float-attachments { display: grid; gap: 6px; }
      .jira-codex-float-attachment {
        min-width: 0;
        gap: 8px;
        padding: 7px 9px;
        border: 1px solid var(--color-border, #e5e7ea);
        border-radius: 8px;
        color: var(--color-text-foreground-secondary, #3a4452);
        text-decoration: none;
      }
      .jira-codex-float-attachment:hover { background: var(--color-background-button-secondary-hover, #f7f8fa); }
      .jira-codex-float-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-float-attachment-size { flex: 0 0 auto; margin-left: auto; color: var(--color-text-foreground-tertiary, #949aa4); font-size: 11px; }
      .jira-codex-float-transition-row { align-items: stretch; gap: 7px; }
      .jira-codex-float-select {
        min-width: 0;
        flex: 1;
        height: 34px;
        padding: 0 8px;
        border: 1px solid var(--color-border-heavy, #d9dde3);
        border-radius: 8px;
        color: var(--color-text-foreground, #34383f);
        background: var(--color-background-control-opaque, #fff);
      }
      .jira-codex-float-button {
        flex: 0 0 auto;
        min-height: 34px;
        padding: 0 11px;
        border-radius: 8px;
        font-weight: 650;
      }
      .jira-codex-float-button:disabled,
      .jira-codex-float-icon-button:disabled { cursor: default; opacity: .5; }
      .jira-codex-float-footer {
        display: flex;
        min-height: 45px;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-top: 1px solid var(--color-border, rgba(25, 28, 33, .09));
      }
      .jira-codex-float-thread { min-width: 0; flex: 1; overflow: hidden; color: var(--color-text-foreground-tertiary, #878e99); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-float-link { flex: 0 0 auto; color: var(--color-text-accent, #3157b7); font-size: 12px; font-weight: 650; text-decoration: none; }
      .jira-codex-float-link:hover { text-decoration: underline; }
      .jira-codex-float-loading,
      .jira-codex-float-error,
      .jira-codex-float-empty { padding: 20px 4px; color: var(--color-text-foreground-secondary, #717985); text-align: center; }
      .jira-codex-float-error { color: var(--color-decoration-deleted, #a33a32); }
      .jira-codex-float-notice { margin: 0 0 10px; padding: 7px 9px; border-radius: 8px; color: var(--color-accent-green, #236943); background: var(--color-background-status-success, #edf8f1); font-size: 12px; }
      .jira-codex-float-hint { margin: 7px 0 0; color: var(--color-text-foreground-tertiary, #8b929d); font-size: 11px; }
      .jira-codex-float-collapsed-button {
        min-width: 178px;
        max-width: min(280px, calc(100vw - 32px));
        margin-left: auto;
        gap: 8px;
        padding: 9px 11px;
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(18, 22, 29, .16);
      }
      .jira-codex-float-collapsed-key { flex: 0 0 auto; font-weight: 750; }
      .jira-codex-float-collapsed-status { min-width: 0; flex: 1; overflow: hidden; color: var(--color-text-foreground-secondary, #747c88); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      #${SVN_MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 70;
        display: grid;
        padding: 24px;
        color: var(--color-text-foreground, #202124);
        background: rgba(8, 10, 14, .48);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        place-items: center;
        pointer-events: auto;
      }
      #${SVN_MODAL_ID} * { box-sizing: border-box; }
      .jira-codex-svn-dialog {
        display: flex;
        width: min(1180px, calc(100vw - 48px));
        max-height: min(860px, calc(100vh - 48px));
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--color-border-heavy, rgba(25, 28, 33, .16));
        border-radius: 16px;
        color: var(--color-text-foreground, #202124);
        background: var(--color-background-elevated-primary-opaque, #fff);
        box-shadow: 0 28px 90px rgba(0, 0, 0, .35);
      }
      .jira-codex-svn-header,
      .jira-codex-svn-toolbar,
      .jira-codex-svn-footer,
      .jira-codex-svn-file,
      .jira-codex-svn-result-heading,
      .jira-codex-svn-confirm-row {
        display: flex;
        align-items: center;
      }
      .jira-codex-svn-header {
        min-height: 62px;
        gap: 12px;
        padding: 12px 16px 12px 20px;
        border-bottom: 1px solid var(--color-border, rgba(25, 28, 33, .1));
      }
      .jira-codex-svn-header-copy { min-width: 0; flex: 1; }
      .jira-codex-svn-eyebrow { color: var(--color-text-foreground-tertiary, #858c96); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
      .jira-codex-svn-title { margin: 2px 0 0; overflow: hidden; font-size: 18px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-svn-close {
        display: grid;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 1px solid var(--color-border-heavy, rgba(25, 28, 33, .14));
        border-radius: 9px;
        color: var(--color-text-foreground, #202124);
        background: var(--color-background-control-opaque, #fff);
        cursor: pointer;
        place-items: center;
      }
      .jira-codex-svn-body { min-height: 0; padding: 18px 20px 22px; overflow: auto; overscroll-behavior: contain; }
      .jira-codex-svn-loading,
      .jira-codex-svn-empty { padding: 54px 20px; color: var(--color-text-foreground-secondary, #68707d); text-align: center; }
      .jira-codex-svn-error,
      .jira-codex-svn-banner {
        margin: 0 0 14px;
        padding: 10px 12px;
        border-radius: 9px;
        color: var(--color-decoration-deleted, #a53c36);
        background: var(--color-background-status-error, #fff0ed);
        white-space: pre-wrap;
      }
      .jira-codex-svn-banner[data-tone="warning"] { color: var(--color-icon-warning, #98620e); background: var(--color-background-status-warning, #fff6df); }
      .jira-codex-svn-banner[data-tone="success"] { color: var(--color-accent-green, #256b45); background: var(--color-background-status-success, #eaf7ef); }
      .jira-codex-svn-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, .8fr); gap: 16px; align-items: start; }
      .jira-codex-svn-stack { display: grid; min-width: 0; gap: 14px; }
      .jira-codex-svn-section {
        min-width: 0;
        padding: 14px;
        border: 1px solid var(--color-border, #e1e4e8);
        border-radius: 11px;
        background: var(--color-background-surface-under, #fafbfc);
      }
      .jira-codex-svn-section-title { margin: 0 0 10px; font-size: 13px; font-weight: 750; }
      .jira-codex-svn-mode-panel {
        min-width: 0;
        margin: 0 0 14px;
        padding: 15px 16px;
        border: 1px solid var(--color-border-heavy, #d4d9df);
        border-left: 4px solid var(--color-text-accent, #3157b7);
        border-radius: 11px;
        background: var(--color-background-surface-under, #fafbfc);
      }
      .jira-codex-svn-mode-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .jira-codex-svn-mode-heading .jira-codex-svn-section-title { margin: 0; font-size: 14px; }
      .jira-codex-svn-mode-intro { margin: 3px 0 0; color: var(--color-text-foreground-secondary, #68707d); font-size: 11px; }
      .jira-codex-svn-mode-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
      .jira-codex-svn-mode-option {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 9px;
        min-width: 0;
        padding: 11px 12px;
        border: 1px solid var(--color-border-heavy, #d4d9df);
        border-radius: 9px;
        color: var(--color-text-foreground, #202124);
        background: var(--color-background-control-opaque, #fff);
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .jira-codex-svn-mode-option:hover { background: var(--color-background-button-secondary-hover, #eff2f6); }
      .jira-codex-svn-mode-option[data-active="true"] {
        border-color: var(--color-text-accent, #3157b7);
        background: var(--color-background-accent, #edf2ff);
        box-shadow: 0 0 0 1px var(--color-text-accent, #3157b7);
      }
      .jira-codex-svn-mode-option:disabled { cursor: default; opacity: .58; }
      .jira-codex-svn-mode-radio {
        display: grid;
        width: 16px;
        height: 16px;
        margin-top: 1px;
        border: 1px solid var(--color-border-heavy, #b8bec7);
        border-radius: 999px;
        background: var(--color-background-control-opaque, #fff);
        place-items: center;
      }
      .jira-codex-svn-mode-option[data-active="true"] .jira-codex-svn-mode-radio { border-color: var(--color-text-accent, #3157b7); }
      .jira-codex-svn-mode-option[data-active="true"] .jira-codex-svn-mode-radio::after {
        width: 8px;
        height: 8px;
        border-radius: inherit;
        background: var(--color-text-accent, #3157b7);
        content: "";
      }
      .jira-codex-svn-mode-option-copy { display: grid; min-width: 0; gap: 4px; }
      .jira-codex-svn-mode-option-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; font-weight: 750; }
      .jira-codex-svn-mode-badge { padding: 2px 6px; border-radius: 999px; color: var(--color-icon-warning, #98620e); background: var(--color-background-status-warning, #fff6df); font-size: 10px; font-weight: 750; }
      .jira-codex-svn-mode-option-description { color: var(--color-text-foreground-secondary, #68707d); font-size: 11px; line-height: 1.55; }
      .jira-codex-svn-mode-flow { margin-top: 11px; padding: 9px 10px; border-radius: 8px; color: var(--color-text-foreground-secondary, #56606c); background: var(--color-background-button-secondary, #f0f2f4); font-size: 11px; line-height: 1.55; }
      .jira-codex-svn-mode-flow strong { color: var(--color-text-foreground, #202124); }
      .jira-codex-svn-mode-gate { display: block; margin-top: 3px; color: var(--color-icon-warning, #98620e); font-weight: 700; }
      .jira-codex-svn-toolbar { min-height: 30px; gap: 8px; }
      .jira-codex-svn-toolbar .jira-codex-svn-section-title { margin: 0; }
      .jira-codex-svn-toolbar-spacer { flex: 1; }
      .jira-codex-svn-subtle-button {
        padding: 4px 8px;
        border: 0;
        border-radius: 7px;
        color: var(--color-text-accent, #3157b7);
        background: transparent;
        cursor: pointer;
        font: inherit;
        font-weight: 650;
      }
      .jira-codex-svn-subtle-button:hover { background: var(--color-background-button-secondary-hover, #eff2f6); }
      .jira-codex-svn-category-tabs { display: flex; gap: 5px; margin: 9px 0 10px; overflow-x: auto; }
      .jira-codex-svn-category-tab {
        flex: 0 0 auto;
        padding: 5px 9px;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--color-text-foreground-secondary, #68707d);
        background: transparent;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        font-weight: 700;
      }
      .jira-codex-svn-category-tab:hover { background: var(--color-background-button-secondary-hover, #eff2f6); }
      .jira-codex-svn-category-tab[data-active="true"] {
        border-color: var(--color-border-heavy, #d4d9df);
        color: var(--color-text-foreground, #202124);
        background: var(--color-background-control-opaque, #fff);
      }
      .jira-codex-svn-change-browser { display: grid; grid-template-columns: minmax(320px, .85fr) minmax(0, 1.35fr); gap: 12px; }
      .jira-codex-svn-browser-pane {
        min-width: 0;
        height: 390px;
        overflow: hidden;
        border: 1px solid var(--color-border, #e1e4e8);
        border-radius: 9px;
        background: var(--color-background-control-opaque, #fff);
      }
      .jira-codex-svn-tree-pane { display: flex; flex-direction: column; }
      .jira-codex-svn-tree-summary,
      .jira-codex-svn-preview-header {
        min-height: 42px;
        padding: 9px 11px;
        border-bottom: 1px solid var(--color-border, #e1e4e8);
      }
      .jira-codex-svn-tree-summary { display: flex; align-items: center; gap: 8px; color: var(--color-text-foreground-secondary, #68707d); font-size: 11px; }
      .jira-codex-svn-tree-summary strong { color: var(--color-text-foreground, #202124); }
      .jira-codex-svn-file-tree { min-height: 0; flex: 1; padding: 5px; overflow: auto; overscroll-behavior: contain; }
      .jira-codex-svn-tree-row {
        display: grid;
        min-height: 32px;
        grid-template-columns: 18px 18px 16px minmax(0, 1fr) auto;
        align-items: center;
        gap: 4px;
        padding: 3px 6px 3px calc(6px + var(--svn-tree-depth, 0) * 16px);
        border: 1px solid transparent;
        border-radius: 6px;
        color: var(--color-text-foreground, #202124);
      }
      .jira-codex-svn-tree-row:hover { background: var(--color-background-button-secondary-hover, #f4f6f8); }
      .jira-codex-svn-tree-row[data-preview="true"] { border-color: var(--color-border-heavy, #ccd4df); background: var(--color-background-accent, #edf2ff); }
      .jira-codex-svn-tree-row[data-disabled="true"] { color: var(--color-text-foreground-tertiary, #858c96); }
      .jira-codex-svn-tree-toggle {
        width: 18px;
        height: 18px;
        padding: 0;
        border: 0;
        border-radius: 4px;
        color: var(--color-text-foreground-secondary, #68707d);
        background: transparent;
        cursor: pointer;
        font: 12px/18px ui-monospace, monospace;
      }
      .jira-codex-svn-tree-toggle:hover { background: var(--color-background-button-secondary, #eef0f3); }
      .jira-codex-svn-tree-toggle:disabled { cursor: default; opacity: 0; }
      .jira-codex-svn-tree-check { margin: 0; accent-color: var(--color-text-accent, #3157b7); }
      .jira-codex-svn-tree-icon { color: var(--color-text-foreground-tertiary, #858c96); font: 12px/1 ui-monospace, monospace; text-align: center; }
      .jira-codex-svn-tree-name {
        min-width: 0;
        overflow: hidden;
        color: inherit;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button.jira-codex-svn-tree-name { padding: 0; border: 0; background: transparent; cursor: pointer; }
      .jira-codex-svn-tree-badges { display: flex; align-items: center; gap: 4px; }
      .jira-codex-svn-tree-recommended { padding: 1px 5px; border-radius: 999px; color: var(--color-text-accent, #3157b7); background: var(--color-background-accent, #edf2ff); font-size: 9px; font-weight: 750; }
      .jira-codex-svn-tree-overlap { padding: 1px 5px; border-radius: 999px; color: var(--color-icon-warning, #98620e); background: var(--color-background-status-warning, #fff6df); font-size: 9px; font-weight: 750; }
      .jira-codex-svn-file-path { min-width: 0; flex: 1; overflow-wrap: anywhere; font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
      .jira-codex-svn-file-status { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; color: var(--color-text-foreground-secondary, #68707d); background: var(--color-background-button-secondary, #eef0f3); font-size: 10px; font-weight: 700; }
      .jira-codex-svn-file-status[data-status="added"] { color: var(--color-accent-green, #256b45); background: var(--color-background-status-success, #eaf7ef); }
      .jira-codex-svn-file-status[data-status="deleted"] { color: var(--color-decoration-deleted, #a53c36); background: var(--color-background-status-error, #fff0ed); }
      .jira-codex-svn-file-status[data-status="modified"] { color: var(--color-text-accent, #3157b7); background: var(--color-background-accent, #edf2ff); }
      .jira-codex-svn-file-status[data-status="replaced"],
      .jira-codex-svn-file-status[data-status="conflicted"] { color: var(--color-icon-warning, #98620e); background: var(--color-background-status-warning, #fff6df); }
      .jira-codex-svn-preview-pane { display: flex; min-width: 0; flex-direction: column; }
      .jira-codex-svn-preview-header { display: flex; align-items: center; gap: 8px; }
      .jira-codex-svn-preview-title { min-width: 0; flex: 1; overflow: hidden; font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-svn-preview-content {
        min-height: 0;
        max-height: 430px;
        flex: 1;
        margin: 0;
        padding: 11px 12px;
        overflow: auto;
        color: var(--color-text-foreground-secondary, #3e4650);
        background: var(--color-background-surface-under, #fafbfc);
        font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
        white-space: pre;
        tab-size: 2;
      }
      .jira-codex-svn-diff-line { display: block; min-width: max-content; padding: 0 4px; }
      .jira-codex-svn-diff-line[data-kind="added"] { color: var(--color-accent-green, #207244); background: color-mix(in srgb, var(--color-background-status-success, #eaf7ef) 68%, transparent); }
      .jira-codex-svn-diff-line[data-kind="deleted"] { color: var(--color-decoration-deleted, #a53c36); background: color-mix(in srgb, var(--color-background-status-error, #fff0ed) 68%, transparent); }
      .jira-codex-svn-diff-line[data-kind="hunk"] { color: var(--color-text-accent, #3157b7); background: var(--color-background-accent, #edf2ff); }
      .jira-codex-svn-diff-line[data-kind="meta"] { color: var(--color-text-foreground-tertiary, #858c96); font-weight: 700; }
      .jira-codex-svn-diff-stats { display: flex; min-height: 30px; align-items: center; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--color-border, #e1e4e8); color: var(--color-text-foreground-tertiary, #858c96); font-size: 10px; }
      .jira-codex-svn-diff-stats [data-kind="added"] { color: var(--color-accent-green, #207244); font-weight: 750; }
      .jira-codex-svn-diff-stats [data-kind="deleted"] { color: var(--color-decoration-deleted, #a53c36); font-weight: 750; }
      .jira-codex-svn-preview-empty { display: grid; min-height: 0; flex: 1; padding: 24px; color: var(--color-text-foreground-tertiary, #858c96); text-align: center; place-items: center; }
      .jira-codex-svn-field { display: grid; gap: 6px; }
      .jira-codex-svn-field + .jira-codex-svn-field { margin-top: 12px; }
      .jira-codex-svn-label { color: var(--color-text-foreground-secondary, #66707b); font-size: 11px; font-weight: 700; }
      .jira-codex-svn-input {
        width: 100%;
        min-height: 36px;
        padding: 7px 9px;
        border: 1px solid var(--color-border-heavy, #d4d9df);
        border-radius: 8px;
        outline: none;
        color: var(--color-text-foreground, #202124);
        background: var(--color-background-control-opaque, #fff);
        font: inherit;
      }
      .jira-codex-svn-input:focus { border-color: var(--color-text-accent, #3157b7); box-shadow: 0 0 0 2px var(--color-background-accent, #edf2ff); }
      .jira-codex-svn-code {
        max-height: 280px;
        margin: 0;
        padding: 10px;
        overflow: auto;
        border: 1px solid var(--color-border, #e2e5e9);
        border-radius: 8px;
        color: var(--color-text-foreground-secondary, #3e4650);
        background: var(--color-background-control-opaque, #fff);
        font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .jira-codex-svn-meta { display: grid; gap: 7px; margin: 0; }
      .jira-codex-svn-meta div { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 8px; }
      .jira-codex-svn-meta dt { color: var(--color-text-foreground-tertiary, #858c96); }
      .jira-codex-svn-meta dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
      .jira-codex-svn-check-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
      .jira-codex-svn-check { padding: 8px 9px; border-radius: 8px; color: var(--color-text-foreground-secondary, #56606c); background: var(--color-background-button-secondary, #f0f2f4); }
      .jira-codex-svn-check[data-tone="block"] { color: var(--color-decoration-deleted, #a53c36); background: var(--color-background-status-error, #fff0ed); }
      .jira-codex-svn-check[data-tone="warning"] { color: var(--color-icon-warning, #98620e); background: var(--color-background-status-warning, #fff6df); }
      .jira-codex-svn-check-paths { display: block; margin-top: 3px; opacity: .82; font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
      .jira-codex-svn-result-heading { gap: 8px; margin-bottom: 9px; }
      .jira-codex-svn-result-heading .jira-codex-svn-section-title { margin: 0; }
      .jira-codex-svn-verdict { padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 750; }
      .jira-codex-svn-verdict[data-verdict="pass"] { color: var(--color-accent-green, #256b45); background: var(--color-background-status-success, #eaf7ef); }
      .jira-codex-svn-verdict[data-verdict="warning"] { color: var(--color-icon-warning, #98620e); background: var(--color-background-status-warning, #fff6df); }
      .jira-codex-svn-verdict[data-verdict="block"] { color: var(--color-decoration-deleted, #a53c36); background: var(--color-background-status-error, #fff0ed); }
      .jira-codex-svn-review-copy { margin: 0; color: var(--color-text-foreground-secondary, #56606c); white-space: pre-wrap; }
      .jira-codex-svn-review-list { display: grid; gap: 7px; margin: 9px 0 0; padding-left: 18px; color: var(--color-text-foreground-secondary, #56606c); }
      .jira-codex-svn-confirm { display: grid; gap: 10px; }
      .jira-codex-svn-confirm-row { align-items: flex-start; gap: 8px; color: var(--color-text-foreground-secondary, #56606c); }
      .jira-codex-svn-confirm-row input { margin: 3px 0 0; accent-color: var(--color-text-accent, #3157b7); }
      .jira-codex-svn-footer {
        min-height: 58px;
        justify-content: flex-end;
        gap: 9px;
        padding: 10px 16px;
        border-top: 1px solid var(--color-border, rgba(25, 28, 33, .1));
      }
      .jira-codex-svn-button {
        min-height: 36px;
        padding: 0 14px;
        border: 1px solid var(--color-border-heavy, rgba(25, 28, 33, .15));
        border-radius: 9px;
        color: var(--color-text-foreground, #202124);
        background: var(--color-background-control-opaque, #fff);
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }
      .jira-codex-svn-button:hover { background: var(--color-background-button-secondary-hover, #eff2f6); }
      .jira-codex-svn-button[data-primary="true"] { border-color: transparent; color: var(--color-text-button-primary, #fff); background: var(--color-background-button-primary, #202124); }
      .jira-codex-svn-button[data-primary="true"]:hover { filter: brightness(.94); }
      .jira-codex-svn-button:disabled { cursor: default; opacity: .5; }
      .jira-codex-svn-hint { margin: 7px 0 0; color: var(--color-text-foreground-tertiary, #858c96); font-size: 11px; }
      @media (max-width: 760px) {
        #${CONVERSATION_FLOAT_ID} { top: 58px; right: 10px; width: min(330px, calc(100vw - 20px)); max-height: calc(100vh - 126px); }
        .jira-codex-float-card { max-height: calc(100vh - 126px); }
        #${SVN_MODAL_ID} { padding: 10px; }
        .jira-codex-svn-dialog { width: calc(100vw - 20px); max-height: calc(100vh - 20px); }
        .jira-codex-svn-grid { grid-template-columns: 1fr; }
        .jira-codex-svn-mode-options { grid-template-columns: 1fr; }
        .jira-codex-svn-change-browser { grid-template-columns: 1fr; }
        .jira-codex-svn-browser-pane { height: 300px; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findReferenceButton() {
    const scroll = document.querySelector("[data-app-action-sidebar-scroll]");
    if (scroll) {
      const buttons = Array.from(scroll.querySelectorAll("button"));
      const plugin = buttons.find((button) => buttonMatches(button, pluginLabels));
      if (plugin) return plugin;
      const firstSection = scroll.querySelector("[data-app-action-sidebar-section]");
      const sectionTop = firstSection?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      const groups = Array.from(scroll.querySelectorAll("div")).filter((element) => {
        const directButtons = Array.from(element.children).filter((child) => child.tagName === "BUTTON");
        return directButtons.length >= 3 && element.getBoundingClientRect().top < sectionTop;
      });
      const group = groups.sort((left, right) => right.children.length - left.children.length)[0];
      const candidates = Array.from(group?.children || []).filter((child) => child.tagName === "BUTTON");
      if (candidates.length) return candidates.at(-1);
    }
    return Array.from(document.querySelectorAll("aside button, nav button"))
      .find((button) => buttonMatches(button, pluginLabels)) || null;
  }

  function replaceEntryIcon(button) {
    const icon = button.querySelector("svg");
    if (!icon) return;
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.8");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.innerHTML = `
      <rect x="3.5" y="3.5" width="17" height="17" rx="3"></rect>
      <path d="M8 8h8M8 12h5M8 16h7"></path>
    `;
  }

  function createEntry(reference) {
    const button = reference.cloneNode(true);
    [button, ...button.querySelectorAll("*")].forEach((node) => {
      node.getAttributeNames().forEach((name) => {
        if (name.startsWith("data-") || name === "name" || name === "value" || name === "formaction") {
          node.removeAttribute(name);
        }
      });
    });
    button.id = ENTRY_ID;
    button.type = "button";
    button.removeAttribute("disabled");
    button.removeAttribute("aria-expanded");
    button.removeAttribute("aria-controls");
    button.removeAttribute("aria-describedby");
    button.removeAttribute("data-state");
    button.setAttribute("aria-label", "打开 Jira 任务");
    button.setAttribute("title", "Jira 任务");
    button.setAttribute(OWNED_ATTRIBUTE, "true");
    button.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    const label = button.querySelector(".text-fade-truncate")
      || Array.from(button.querySelectorAll("span")).find((node) => buttonMatches(node, pluginLabels));
    if (label) label.textContent = "Jira 任务";
    else button.textContent = "Jira 任务";
    replaceEntryIcon(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPanel();
    });
    return button;
  }

  function ensureEntry() {
    installStyles();
    const reference = findReferenceButton();
    if (!reference?.parentElement) return false;
    entry = document.getElementById(ENTRY_ID) || entry || createEntry(reference);
    if (entry.parentElement !== reference.parentElement || entry.previousElementSibling !== reference) {
      reference.after(entry);
    }
    if (active) entry.setAttribute("aria-current", "page");
    else entry.removeAttribute("aria-current");
    return true;
  }

  function findPageMount() {
    const direct = document.querySelector(".app-shell-main-content-frame");
    if (direct?.closest?.("[data-app-shell-main-content-layout]")) {
      const viewport = direct.closest("[data-app-shell-main-content-layout]");
      return { frameHost: direct, surface: viewport.parentElement };
    }
    const viewport = document.querySelector("[data-app-shell-main-content-layout]");
    if (!viewport) return null;
    const surface = viewport.parentElement;
    if (!surface?.closest("main")) return null;
    return { frameHost: viewport, surface };
  }

  function createPage() {
    const themeSnapshot = readCodexThemeSnapshot();
    const fallbackBackground = themeSnapshot.theme === "dark" ? "#202123" : "#ffffff";
    const element = document.createElement("section");
    element.id = PAGE_ID;
    element.hidden = true;
    element.dataset.theme = themeSnapshot.theme;
    element.style.background = themeSnapshot.tokens.surface || themeSnapshot.tokens.bg || fallbackBackground;
    element.setAttribute(OWNED_ATTRIBUTE, "true");
    frame = document.createElement("iframe");
    if (EMBEDDED_PANEL) {
      frame.srcdoc = PANEL_DOCUMENT.replace(/<html\b/i, `<html data-theme="${themeSnapshot.theme}"`);
    }
    else frame.src = PANEL_URL;
    frame.title = "Jira 任务面板 POC";
    frame.referrerPolicy = "no-referrer";
    frame.style.colorScheme = themeSnapshot.theme;
    frame.style.background = themeSnapshot.tokens.surface || themeSnapshot.tokens.bg || fallbackBackground;
    frame.addEventListener("load", () => {
      sendBindings();
      syncCodexTheme(true);
    });
    element.appendChild(frame);
    return element;
  }

  function restoreNativeContent() {
    document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(HIDDEN_ATTRIBUTE));
    document.querySelectorAll(`[${HOST_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(HOST_ATTRIBUTE));
  }

  function hideNativeHeader() {
    document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"]')
      .forEach((surface) => {
        Array.from(surface.children).forEach((child) => {
          if (child.getAttribute(OWNED_ATTRIBUTE) !== "true") {
            child.setAttribute(HIDDEN_ATTRIBUTE, "true");
          }
        });
      });
  }

  function mountActivePage() {
    if (!active) return false;
    page = document.getElementById(PAGE_ID) || page || createPage();
    const mount = findPageMount();
    if (!mount?.surface) return false;
    const { surface } = mount;
    if (page.parentElement !== surface) {
      restoreNativeContent();
      surface.appendChild(page);
    }
    surface.setAttribute(HOST_ATTRIBUTE, "true");
    Array.from(surface.children).forEach((child) => {
      if (child !== page && child.getAttribute(OWNED_ATTRIBUTE) !== "true") {
        child.setAttribute(HIDDEN_ATTRIBUTE, "true");
      }
    });
    hideNativeHeader();
    page.hidden = false;
    return true;
  }

  function openPanel() {
    active = true;
    removeSvnReviewModal();
    if (conversationFloat) conversationFloat.hidden = true;
    ensureEntry();
    mountActivePage();
    entry?.setAttribute("aria-current", "page");
    window.setTimeout(sendBindings, 0);
  }

  function closePanel() {
    active = false;
    if (page) page.hidden = true;
    restoreNativeContent();
    entry?.removeAttribute("aria-current");
    ensureConversationIssueFloat();
  }

  function setNativeInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  function isVisibleElement(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function findVisibleComposer() {
    const candidates = document.querySelectorAll(
      "main textarea:not([disabled]), main input[type='text']:not([disabled]),"
      + " main [contenteditable='true'][role='textbox'], main [contenteditable='true']"
    );
    return Array.from(candidates).find(isVisibleElement) || null;
  }

  function activeThreadIds() {
    return threadRows()
      .filter((row) => row.getAttribute("data-app-action-sidebar-thread-active") === "true")
      .map((row) => row.getAttribute("data-app-action-sidebar-thread-id"))
      .filter(Boolean);
  }

  function conversationBindingForThread(threadId) {
    const normalizedThreadId = normalizeCodexThreadId(threadId);
    if (!normalizedThreadId) return null;
    const bindings = readBindings();
    const direct = Object.entries(bindings)
      .filter(([, binding]) => bindingMatchesThread(binding, normalizedThreadId))
      .sort((left, right) => String(right[1]?.boundAt || "").localeCompare(String(left[1]?.boundAt || "")))
      .map(([issueKey, binding]) => ({ issueKey: String(issueKey).toUpperCase(), binding }))[0] || null;
    if (direct) return direct;
    const aliasedIssueKey = conversationThreadAliases.get(normalizedThreadId);
    const aliasedBinding = aliasedIssueKey ? bindings[aliasedIssueKey] : null;
    return aliasedBinding ? { issueKey: aliasedIssueKey, binding: aliasedBinding } : null;
  }

  function setConversationThreadHint(issueKey, binding, previousThreadIds = activeThreadIds()) {
    const normalizedIssueKey = String(issueKey || "").trim().toUpperCase();
    if (!normalizedIssueKey || !binding?.threadId) return;
    for (const [threadId, aliasIssueKey] of conversationThreadAliases) {
      if (aliasIssueKey === normalizedIssueKey) conversationThreadAliases.delete(threadId);
    }
    conversationThreadHint = {
      issueKey: normalizedIssueKey,
      threadId: String(binding.threadId),
      binding,
      previousThreadIds: previousThreadIds.map(normalizeCodexThreadId).filter(Boolean),
      observedThreadId: "",
      createdAt: Date.now()
    };
  }

  function clearConversationThreadHint() {
    conversationThreadHint = null;
  }

  function conversationBindingFromHint(activeThreadId) {
    const hint = conversationThreadHint;
    const normalizedActiveThreadId = normalizeCodexThreadId(activeThreadId);
    if (!hint || !normalizedActiveThreadId) return null;
    if (!hint.observedThreadId && Date.now() - hint.createdAt > 15_000) {
      clearConversationThreadHint();
      return null;
    }
    if (hint.observedThreadId && hint.observedThreadId !== normalizedActiveThreadId) {
      clearConversationThreadHint();
      return null;
    }
    if (!hint.observedThreadId) {
      if (hint.previousThreadIds.includes(normalizedActiveThreadId)) return null;
      hint.observedThreadId = normalizedActiveThreadId;
      conversationThreadAliases.set(normalizedActiveThreadId, hint.issueKey);
    }
    const binding = readBindings()[hint.issueKey] || hint.binding;
    return binding ? { issueKey: hint.issueKey, binding } : null;
  }

  function conversationFloatElement(tagName, className, textContent) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (textContent !== undefined) element.textContent = String(textContent);
    return element;
  }

  function formatAttachmentSize(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
    return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
  }

  function removeConversationIssueFloat() {
    if (!conversationFloatState && !conversationFloat) return;
    if (svnFloatReviewPollTimer) window.clearInterval(svnFloatReviewPollTimer);
    svnFloatReviewPollTimer = null;
    svnFloatReviewPollId = "";
    conversationFloatRequestId += 1;
    conversationFloatState = null;
    conversationFloat?.remove();
    conversationFloat = null;
  }

  function collapseConversationIssueFloat() {
    if (!conversationFloatState?.threadId) return;
    collapsedConversationThreads.add(conversationFloatState.threadId);
    renderConversationIssueFloat();
  }

  function expandConversationIssueFloat() {
    if (!conversationFloatState?.threadId) return;
    collapsedConversationThreads.delete(conversationFloatState.threadId);
    renderConversationIssueFloat();
  }

  function renderConversationIssueFloat() {
    const state = conversationFloatState;
    if (!state || !document.body) return;
    conversationFloat = document.getElementById(CONVERSATION_FLOAT_ID) || conversationFloat;
    if (!conversationFloat) {
      conversationFloat = conversationFloatElement("aside");
      conversationFloat.id = CONVERSATION_FLOAT_ID;
      conversationFloat.setAttribute(OWNED_ATTRIBUTE, "true");
      conversationFloat.setAttribute("aria-label", "当前会话关联的 Jira 任务");
      document.body.appendChild(conversationFloat);
    }
    conversationFloat.hidden = active;
    applyThemeSnapshotToConversationFloat(readCodexThemeSnapshot());
    conversationFloat.dataset.issueKey = state.issueKey;
    conversationFloat.dataset.threadId = state.threadId;
    conversationFloat.replaceChildren();

    const issue = state.issue;
    const isCollapsed = collapsedConversationThreads.has(state.threadId);
    if (isCollapsed) {
      const button = conversationFloatElement("button", "jira-codex-float-collapsed-button");
      button.type = "button";
      button.title = `展开 ${state.issueKey} 的 Jira 信息`;
      const type = conversationFloatElement(
        "span",
        "jira-codex-float-type",
        issue?.type === "bug" ? "B" : "R"
      );
      type.dataset.type = issue?.type || "requirement";
      button.append(
        type,
        conversationFloatElement("span", "jira-codex-float-collapsed-key", state.issueKey),
        conversationFloatElement(
          "span",
          "jira-codex-float-collapsed-status",
          ["prepared", "dispatching", "running"].includes(state.svnReviewStatus)
            ? "挂起 · Codex 检查中"
            : issue?.statusName || (state.loading ? "正在读取…" : "Jira 任务")
        ),
        conversationFloatElement("span", "", "‹")
      );
      button.addEventListener("click", expandConversationIssueFloat);
      conversationFloat.appendChild(button);
      return;
    }

    const card = conversationFloatElement("section", "jira-codex-float-card");
    const header = conversationFloatElement("header", "jira-codex-float-header");
    const type = conversationFloatElement(
      "span",
      "jira-codex-float-type",
      issue?.type === "bug" ? "Bug" : "需求"
    );
    type.dataset.type = issue?.type || "requirement";
    header.append(type, conversationFloatElement("span", "jira-codex-float-key", state.issueKey));
    const headerActions = conversationFloatElement("div", "jira-codex-float-actions");
    const refresh = conversationFloatElement("button", "jira-codex-float-icon-button", "↻");
    refresh.type = "button";
    refresh.title = "刷新 Jira 信息";
    refresh.disabled = state.refreshing || state.transitioning;
    refresh.addEventListener("click", () => void refreshConversationIssueFloat());
    const collapse = conversationFloatElement("button", "jira-codex-float-icon-button", "−");
    collapse.type = "button";
    collapse.title = "收起 Jira 浮窗";
    collapse.addEventListener("click", collapseConversationIssueFloat);
    headerActions.append(refresh, collapse);
    header.appendChild(headerActions);
    card.appendChild(header);

    const body = conversationFloatElement("div", "jira-codex-float-body");
    body.setAttribute("aria-live", "polite");
    if (state.loading && !issue) {
      body.appendChild(conversationFloatElement("div", "jira-codex-float-loading", "正在读取 Jira 任务信息…"));
    } else if (state.error && !issue) {
      body.appendChild(conversationFloatElement("div", "jira-codex-float-error", state.error));
      const retry = conversationFloatElement("button", "jira-codex-float-button", "重新读取");
      retry.type = "button";
      retry.addEventListener("click", () => void refreshConversationIssueFloat());
      body.appendChild(retry);
    } else if (issue) {
      if (state.notice) body.appendChild(conversationFloatElement("p", "jira-codex-float-notice", state.notice));
      if (state.error) body.appendChild(conversationFloatElement("p", "jira-codex-float-error", state.error));
      body.append(
        conversationFloatElement("h2", "jira-codex-float-title", issue.title || state.binding?.issueTitle || state.issueKey),
        conversationFloatElement("span", "jira-codex-float-status", issue.statusName || issue.status || "未知状态")
      );

      const meta = conversationFloatElement("div", "jira-codex-float-meta");
      [
        ["负责人", issue.assignee || "未分配"],
        ["优先级", issue.priority || "未设置"],
        ["项目", issue.projectName || "未提供"],
        ["类型", issue.typeName || (issue.type === "bug" ? "Bug" : "需求")]
      ].forEach(([label, value]) => {
        const row = conversationFloatElement("div", "jira-codex-float-meta-row");
        row.append(
          conversationFloatElement("span", "jira-codex-float-meta-label", label),
          conversationFloatElement("span", "jira-codex-float-meta-value", value)
        );
        meta.appendChild(row);
      });
      body.appendChild(meta);

      const description = conversationFloatElement("section", "jira-codex-float-section");
      description.append(
        conversationFloatElement("h3", "jira-codex-float-section-title", "描述"),
        conversationFloatElement("p", "jira-codex-float-description", issue.summary || "Jira 中未填写描述。")
      );
      body.appendChild(description);

      const collaborators = Array.isArray(issue.collaborators) ? issue.collaborators : [];
      if (collaborators.length) {
        const section = conversationFloatElement("section", "jira-codex-float-section");
        section.appendChild(conversationFloatElement("h3", "jira-codex-float-section-title", `协同处理人 · ${collaborators.length}`));
        const chips = conversationFloatElement("div", "jira-codex-float-chip-list");
        collaborators.forEach((collaborator) => {
          chips.appendChild(conversationFloatElement("span", "jira-codex-float-chip", collaborator.displayName || collaborator.name || "未知用户"));
        });
        section.appendChild(chips);
        body.appendChild(section);
      }

      const attachments = Array.isArray(issue.attachments) ? issue.attachments : [];
      if (attachments.length) {
        const section = conversationFloatElement("section", "jira-codex-float-section");
        section.appendChild(conversationFloatElement("h3", "jira-codex-float-section-title", `附件 · ${attachments.length}`));
        const list = conversationFloatElement("div", "jira-codex-float-attachments");
        attachments.slice(0, 4).forEach((attachment) => {
          const link = conversationFloatElement("a", "jira-codex-float-attachment");
          link.href = new URL(attachment.downloadUrl || `/api/attachments/${encodeURIComponent(attachment.id || "")}`, PANEL_URL).href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.title = `预览或下载 ${attachment.filename || "附件"}`;
          link.append(
            conversationFloatElement("span", "", "↗"),
            conversationFloatElement("span", "jira-codex-float-attachment-name", attachment.filename || "未命名附件"),
            conversationFloatElement("span", "jira-codex-float-attachment-size", formatAttachmentSize(attachment.size))
          );
          list.appendChild(link);
        });
        section.appendChild(list);
        if (attachments.length > 4) {
          section.appendChild(conversationFloatElement("p", "jira-codex-float-hint", `另有 ${attachments.length - 4} 个附件，可在 Jira 中查看。`));
        }
        body.appendChild(section);
      }

      const transitionSection = conversationFloatElement("section", "jira-codex-float-section");
      transitionSection.appendChild(conversationFloatElement("h3", "jira-codex-float-section-title", "状态流转"));
      const transitions = Array.isArray(state.transitions) ? state.transitions : [];
      if (state.transitionError) {
        transitionSection.appendChild(conversationFloatElement("p", "jira-codex-float-hint", state.transitionError));
      } else if (state.refreshing && !transitions.length) {
        transitionSection.appendChild(conversationFloatElement("p", "jira-codex-float-hint", "正在读取可用流转…"));
      } else if (!transitions.length) {
        transitionSection.appendChild(conversationFloatElement("p", "jira-codex-float-hint", "当前没有可直接执行的状态流转。"));
      } else {
        const row = conversationFloatElement("div", "jira-codex-float-transition-row");
        const select = conversationFloatElement("select", "jira-codex-float-select");
        select.setAttribute("aria-label", "选择 Jira 状态流转");
        const placeholder = conversationFloatElement("option", "", "选择目标状态");
        placeholder.value = "";
        select.appendChild(placeholder);
        transitions.forEach((transition) => {
          const option = conversationFloatElement(
            "option",
            "",
            `${transition.name || transition.to?.name || "未命名流转"}${transition.requiresInput ? "（需在 Jira 填写字段）" : ""}`
          );
          option.value = transition.id;
          option.disabled = Boolean(transition.requiresInput);
          select.appendChild(option);
        });
        select.value = state.selectedTransitionId || "";
        select.disabled = state.transitioning;
        select.addEventListener("change", () => {
          if (conversationFloatState === state) state.selectedTransitionId = select.value;
        });
        const submit = conversationFloatElement(
          "button",
          "jira-codex-float-button",
          state.transitioning ? "流转中…" : "执行"
        );
        submit.type = "button";
        submit.disabled = state.transitioning;
        submit.addEventListener("click", () => void executeConversationIssueTransition(select.value));
        row.append(select, submit);
        transitionSection.appendChild(row);
        if (transitions.some((transition) => transition.requiresInput)) {
          transitionSection.appendChild(conversationFloatElement("p", "jira-codex-float-hint", "需要额外字段的流转请在 Jira 中完成。"));
        }
      }
      body.appendChild(transitionSection);

      const svnSection = conversationFloatElement("section", "jira-codex-float-section");
      svnSection.appendChild(conversationFloatElement("h3", "jira-codex-float-section-title", "代码提交"));
      const svnReviewRunning = ["prepared", "dispatching", "running"].includes(state.svnReviewStatus);
      const svnButton = conversationFloatElement(
        "button",
        "jira-codex-float-button",
        svnReviewRunning ? "挂起 · Codex 检查中（查看）" : "审核并提交 SVN"
      );
      svnButton.type = "button";
      svnButton.addEventListener("click", () => void openSvnReviewModal());
      svnSection.append(
        svnButton,
        conversationFloatElement(
          "p",
          "jira-codex-float-hint",
          svnReviewRunning ? "可以查看进度或人工取消审查；真正提交仍需人工确认。" : "先检查文件和风险；真正提交前必须人工确认。"
        )
      );
      body.appendChild(svnSection);
    } else {
      body.appendChild(conversationFloatElement("div", "jira-codex-float-empty", "暂无 Jira 任务信息。"));
    }
    card.appendChild(body);

    const footer = conversationFloatElement("footer", "jira-codex-float-footer");
    footer.appendChild(conversationFloatElement(
      "span",
      "jira-codex-float-thread",
      `绑定会话：${state.binding?.threadTitle || state.threadId}`
    ));
    const jiraLink = conversationFloatElement("a", "jira-codex-float-link", "在 Jira 中打开 ↗");
    jiraLink.href = issue?.url || `${PANEL_URL}`;
    jiraLink.target = "_blank";
    jiraLink.rel = "noopener noreferrer";
    footer.appendChild(jiraLink);
    card.appendChild(footer);
    conversationFloat.appendChild(card);
  }

  async function refreshConversationIssueFloat() {
    const state = conversationFloatState;
    if (!state) return;
    const requestId = ++conversationFloatRequestId;
    state.loading = !state.issue;
    state.refreshing = true;
    state.error = "";
    state.transitionError = "";
    renderConversationIssueFloat();
    const [issueResult, transitionsResult, svnReviewResult] = await Promise.allSettled([
      panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}`),
      panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}/transitions`),
      panelJson(
        `/api/svn/reviews/latest?threadId=${encodeURIComponent(state.threadId)}`
        + `&issueKey=${encodeURIComponent(state.issueKey)}`
      )
    ]);
    if (requestId !== conversationFloatRequestId || conversationFloatState !== state) return;
    state.loading = false;
    state.refreshing = false;
    if (issueResult.status === "fulfilled" && issueResult.value?.issue) {
      state.issue = issueResult.value.issue;
    } else {
      state.error = `无法读取 ${state.issueKey}：${issueResult.reason?.message || "未知错误"}`;
    }
    if (transitionsResult.status === "fulfilled") {
      state.transitions = Array.isArray(transitionsResult.value?.transitions)
        ? transitionsResult.value.transitions
        : [];
      if (!state.transitions.some((transition) => transition.id === state.selectedTransitionId)) {
        state.selectedTransitionId = "";
      }
    } else {
      state.transitionError = `暂时无法读取状态流转：${transitionsResult.reason?.message || "未知错误"}`;
    }
    if (svnReviewResult.status === "fulfilled") {
      syncConversationFloatSvnStatus(svnReviewResult.value?.review || null);
    }
    renderConversationIssueFloat();
  }

  async function executeConversationIssueTransition(transitionId) {
    const state = conversationFloatState;
    const transition = state?.transitions?.find((candidate) => candidate.id === String(transitionId || ""));
    if (!state || !transition || transition.requiresInput || state.transitioning) return;
    const targetName = transition.to?.name || transition.name || "目标状态";
    if (!window.confirm(`确定将 ${state.issueKey} 流转为“${targetName}”吗？`)) return;
    state.transitioning = true;
    state.transitionError = "";
    renderConversationIssueFloat();
    try {
      await panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}/transitions`, {
        method: "POST",
        body: { transitionId: transition.id }
      });
      if (conversationFloatState !== state) return;
      state.transitioning = false;
      state.notice = `已提交状态流转：${targetName}`;
      state.selectedTransitionId = "";
      await refreshConversationIssueFloat();
    } catch (error) {
      if (conversationFloatState !== state) return;
      state.transitioning = false;
      state.transitionError = `状态流转失败：${error.message || error}`;
      renderConversationIssueFloat();
    }
  }

  function removeSvnReviewModal() {
    if (svnReviewPollTimer) window.clearInterval(svnReviewPollTimer);
    svnReviewPollTimer = null;
    svnModalState = null;
    svnModal?.remove();
    svnModal = null;
  }

  function syncConversationFloatSvnStatus(review) {
    if (!conversationFloatState) return;
    if (review?.issue?.key && conversationFloatState.issueKey !== review.issue.key) return;
    conversationFloatState.svnReviewStatus = review?.status || "";
    const running = ["prepared", "dispatching", "running"].includes(review?.status);
    if (running && review?.id) {
      startConversationSvnStatusPolling(review);
    } else if (svnFloatReviewPollTimer) {
      window.clearInterval(svnFloatReviewPollTimer);
      svnFloatReviewPollTimer = null;
      svnFloatReviewPollId = "";
    }
    renderConversationIssueFloat();
  }

  function startConversationSvnStatusPolling(review) {
    if (!review?.id || !conversationFloatState) return;
    if (svnFloatReviewPollTimer && svnFloatReviewPollId === review.id) return;
    if (svnFloatReviewPollTimer) window.clearInterval(svnFloatReviewPollTimer);
    svnFloatReviewPollId = review.id;
    const refresh = async () => {
      const state = conversationFloatState;
      if (!state || svnFloatReviewPollId !== review.id) return;
      try {
        const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}`);
        if (conversationFloatState !== state || svnFloatReviewPollId !== review.id) return;
        const previous = state.svnReviewStatus;
        syncConversationFloatSvnStatus(payload.review);
        if (["prepared", "dispatching", "running"].includes(previous)
          && !["prepared", "dispatching", "running"].includes(payload.review?.status)) {
          state.notice = payload.review?.status === "completed"
            ? "Codex 审查已完成。打开 SVN 提交面板查看报告并进行人工确认。"
            : "Codex 审查已结束。打开 SVN 提交面板查看状态或选择人工降级。";
          renderConversationIssueFloat();
        }
      } catch {
        // 浮窗轮询失败不阻断 Jira 与 SVN 主流程，用户仍可手动刷新或打开提交面板。
      }
    };
    svnFloatReviewPollTimer = window.setInterval(() => void refresh(), 2_500);
  }

  function svnChangeStatusLabel(change) {
    const labels = {
      modified: "修改",
      added: "新增",
      deleted: "删除",
      replaced: "替换",
      conflicted: "冲突",
      missing: "缺失",
      obstructed: "阻塞",
      incomplete: "不完整",
      unversioned: "未纳管",
      external: "External"
    };
    const label = labels[change?.item] || change?.item || "变化";
    const status = change?.properties && !["none", "normal"].includes(change.properties)
      ? `${label} + 属性`
      : label;
    const kindStatus = change?.kind === "dir" ? `${status} · 目录` : status;
    return change?.preExisting ? `${kindStatus} · 绑定前` : kindStatus;
  }

  function svnChangeStatusCode(change) {
    return {
      modified: "M",
      added: "A",
      deleted: "D",
      replaced: "R",
      conflicted: "C",
      missing: "!",
      unversioned: "?"
    }[change?.item] || "·";
  }

  function svnChangeSelectable(change) {
    return Boolean(change)
      && !change.preExisting
      && change.kind === "file"
      && !["unversioned", "ignored", "external", "conflicted", "missing", "obstructed", "incomplete"].includes(change.item)
      && !change.treeConflicted
      && !change.switched
      && !change.wcLocked;
  }

  function svnChangeCategory(change) {
    if (["unversioned", "ignored"].includes(change?.item)) return "unmanaged";
    return svnChangeSelectable(change) ? "reviewable" : "blocked";
  }

  function svnProjectDisplayPath(change, context) {
    const path = String(change?.path || "").replaceAll("\\", "/");
    const scopePath = String(context?.workingCopy?.scopePath || ".").replaceAll("\\", "/");
    if (scopePath !== "." && path.startsWith(`${scopePath}/`)) return path.slice(scopePath.length + 1);
    if (scopePath !== "." && path === scopePath) return context?.workingCopy?.scopeName || path.split("/").at(-1);
    return path;
  }

  function buildSvnChangeTree(changes, context) {
    const root = {
      id: "__project__",
      name: context?.workingCopy?.scopeName || "当前项目",
      path: context?.workingCopy?.scopePath || ".",
      change: null,
      childrenMap: new Map()
    };
    (Array.isArray(changes) ? changes : []).forEach((change) => {
      const displayPath = svnProjectDisplayPath(change, context);
      const segments = displayPath.split("/").filter(Boolean);
      if (!segments.length || (change.path === root.path && change.kind === "dir")) {
        root.change = change;
        return;
      }
      let parent = root;
      const ids = [];
      segments.forEach((segment, index) => {
        ids.push(segment);
        const id = ids.join("/");
        if (!parent.childrenMap.has(segment)) {
          parent.childrenMap.set(segment, {
            id,
            name: segment,
            path: change.path,
            change: null,
            childrenMap: new Map()
          });
        }
        parent = parent.childrenMap.get(segment);
        if (index === segments.length - 1) {
          parent.path = change.path;
          parent.change = change;
        }
      });
    });

    const finalize = (node) => {
      node.children = Array.from(node.childrenMap.values())
        .map(finalize)
        .sort((left, right) => {
          const leftDirectory = left.children.length || left.change?.kind === "dir";
          const rightDirectory = right.children.length || right.change?.kind === "dir";
          if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
          return left.name.localeCompare(right.name);
        });
      delete node.childrenMap;
      node.changes = [
        ...(node.change ? [node.change] : []),
        ...node.children.flatMap((child) => child.changes)
      ];
      node.selectablePaths = node.changes.filter(svnChangeSelectable).map((change) => change.path);
      return node;
    };
    return finalize(root);
  }

  function defaultSvnExpandedPaths(tree) {
    const expanded = new Set([tree.id]);
    const visit = (node, depth) => {
      if (!node.children.length) return;
      if (depth < 2 || node.children.length === 1) {
        expanded.add(node.id);
        node.children.forEach((child) => visit(child, depth + 1));
      }
    };
    visit(tree, 0);
    return expanded;
  }

  function svnVerdictLabel(value) {
    return { pass: "通过", warning: "有警告", block: "已阻断" }[value] || "审核中";
  }

  function svnCommitMessagePreview(state) {
    const explanation = String(state?.summary || "").trim().replace(/^--\s*/, "");
    return explanation ? `${state.messageBase}\n--${explanation}` : state.messageBase;
  }

  function appendSvnChecks(container, checks, tone) {
    (Array.isArray(checks) ? checks : []).forEach((check) => {
      const item = conversationFloatElement("li", "jira-codex-svn-check", check.message || check.code);
      item.dataset.tone = tone;
      if (Array.isArray(check.paths) && check.paths.length) {
        item.appendChild(conversationFloatElement("span", "jira-codex-svn-check-paths", check.paths.join("、")));
      }
      container.appendChild(item);
    });
  }

  function appendSvnReviewList(section, title, items, formatter = (item) => String(item || "")) {
    if (!Array.isArray(items) || !items.length) return;
    section.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", title));
    const list = conversationFloatElement("ul", "jira-codex-svn-review-list");
    items.slice(0, 100).forEach((item) => list.appendChild(conversationFloatElement("li", "", formatter(item))));
    section.appendChild(list);
  }

  async function loadSvnDiffPreview(change) {
    const state = svnModalState;
    if (!state || !change?.path) return;
    const requestId = Number(state.previewRequestId || 0) + 1;
    state.previewRequestId = requestId;
    state.previewPath = change.path;
    state.previewLoading = true;
    state.previewError = "";
    state.preview = null;
    renderSvnReviewModal();
    try {
      const payload = await panelJson(
        `/api/svn/diff?threadId=${encodeURIComponent(state.threadId)}`
        + `&path=${encodeURIComponent(change.path)}`
      );
      if (svnModalState !== state || state.previewRequestId !== requestId) return;
      state.previewLoading = false;
      state.preview = payload.preview || null;
      renderSvnReviewModal();
    } catch (error) {
      if (svnModalState !== state || state.previewRequestId !== requestId) return;
      state.previewLoading = false;
      state.previewError = error.message || String(error);
      renderSvnReviewModal();
    }
  }

  async function openSvnExternalDiff(change) {
    const state = svnModalState;
    if (!state || !change?.path || state.externalDiffBusy) return;
    state.externalDiffBusy = true;
    state.previewError = "";
    renderSvnReviewModal();
    try {
      await panelJson("/api/svn/diff/open", {
        method: "POST",
        body: { threadId: state.threadId, path: change.path }
      });
    } catch (error) {
      if (svnModalState === state) state.previewError = error.message || String(error);
    } finally {
      if (svnModalState === state) {
        state.externalDiffBusy = false;
        renderSvnReviewModal();
      }
    }
  }

  function renderSvnColoredDiff(diff) {
    const content = conversationFloatElement("pre", "jira-codex-svn-preview-content");
    String(diff || "").split("\n").forEach((line) => {
      const row = conversationFloatElement("span", "jira-codex-svn-diff-line", line);
      row.dataset.kind = line.startsWith("+++") || line.startsWith("---") || line.startsWith("Index:") || /^={5,}/.test(line)
        ? "meta"
        : line.startsWith("@@") ? "hunk"
          : line.startsWith("+") ? "added"
            : line.startsWith("-") ? "deleted" : "context";
      content.appendChild(row);
    });
    return content;
  }

  function renderSvnDiffPreview(container, state) {
    const previewHeader = conversationFloatElement("div", "jira-codex-svn-preview-header");
    const change = state.context?.changes?.find((entry) => entry.path === state.previewPath) || null;
    previewHeader.appendChild(conversationFloatElement(
      "div",
      "jira-codex-svn-preview-title",
      change ? svnProjectDisplayPath(change, state.context) : "差异预览"
    ));
    if (change) {
      const status = conversationFloatElement("span", "jira-codex-svn-file-status", `${svnChangeStatusCode(change)} · ${svnChangeStatusLabel(change)}`);
      status.dataset.status = change.item || "unknown";
      previewHeader.appendChild(status);
      const external = conversationFloatElement(
        "button",
        "jira-codex-svn-subtle-button",
        state.externalDiffBusy ? "正在打开…" : "TortoiseSVN 对比"
      );
      external.type = "button";
      external.disabled = state.externalDiffBusy || !svnChangeSelectable(change);
      external.title = "也可以双击左侧文件名打开";
      external.addEventListener("click", () => void openSvnExternalDiff(change));
      previewHeader.appendChild(external);
    }
    container.appendChild(previewHeader);
    if (!change) {
      container.appendChild(conversationFloatElement("div", "jira-codex-svn-preview-empty", "选择左侧文件查看 SVN 差异。"));
      return;
    }
    if (state.previewLoading) {
      container.appendChild(conversationFloatElement("div", "jira-codex-svn-preview-empty", "正在读取单文件差异…"));
      return;
    }
    if (state.previewError) {
      container.appendChild(conversationFloatElement("div", "jira-codex-svn-preview-empty", `无法预览：${state.previewError}`));
      return;
    }
    if (state.preview?.diff) {
      const lines = String(state.preview.diff).split("\n");
      const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const deletions = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      const stats = conversationFloatElement("div", "jira-codex-svn-diff-stats");
      const added = conversationFloatElement("span", "", `+${additions}`);
      added.dataset.kind = "added";
      const deleted = conversationFloatElement("span", "", `-${deletions}`);
      deleted.dataset.kind = "deleted";
      stats.append(added, deleted, conversationFloatElement("span", "", "双击左侧文件可调用 TortoiseSVN"));
      container.append(stats, renderSvnColoredDiff(state.preview.diff));
      return;
    }
    container.appendChild(conversationFloatElement(
      "div",
      "jira-codex-svn-preview-empty",
      state.preview?.message || "点击文件名加载 SVN 差异。"
    ));
  }

  function renderSvnSelection(body, state) {
    const context = state.context;
    if (!context.baseline?.available) {
      const banner = conversationFloatElement(
        "div",
        "jira-codex-svn-banner",
        "该会话没有任务绑定时的 SVN 基线（常见于升级前已存在的绑定）。请只选择你已人工确认属于当前 Jira 的改动。"
      );
      banner.dataset.tone = "warning";
      body.appendChild(banner);
    }
    const changes = Array.isArray(context.changes) ? context.changes : [];
    const overlaps = changes.filter((change) => change.relatedIssues?.length);
    if (overlaps.length) {
      const banner = conversationFloatElement(
        "div",
        "jira-codex-svn-banner",
        `${overlaps.length} 个文件也关联到其他 Jira 提交草稿。系统只提示，不会替你排除；选中后必须人工核对并确认放行。`
      );
      banner.dataset.tone = "warning";
      body.appendChild(banner);
    }
    const eligible = changes.filter(svnChangeSelectable);
    const categories = [
      { id: "reviewable", label: "可提交", changes: changes.filter((change) => svnChangeCategory(change) === "reviewable") },
      { id: "unmanaged", label: "未纳管", changes: changes.filter((change) => svnChangeCategory(change) === "unmanaged") },
      { id: "blocked", label: "阻断项", changes: changes.filter((change) => svnChangeCategory(change) === "blocked") },
      { id: "all", label: "全部", changes }
    ];
    const activeCategory = categories.find((category) => category.id === state.svnCategory) || categories[0];
    state.svnCategory = activeCategory.id;
    const tree = buildSvnChangeTree(activeCategory.changes, context);
    if (!state.treeExpansionInitialized) {
      state.expandedPaths = defaultSvnExpandedPaths(buildSvnChangeTree(changes, context));
      state.treeExpansionInitialized = true;
    }
    const recommendedPaths = state.recommendedPaths || new Set();
    const selectedOutsideRecommendation = Array.from(state.selectedPaths).filter((path) => !recommendedPaths.has(path)).length;
    const removedFromRecommendation = Array.from(recommendedPaths).filter((path) => !state.selectedPaths.has(path)).length;

    const codexReviewEnabled = state.codexReviewEnabled === true;
    const modeSection = conversationFloatElement("section", "jira-codex-svn-mode-panel");
    const modeHeading = conversationFloatElement("div", "jira-codex-svn-mode-heading");
    const modeHeadingCopy = conversationFloatElement("div");
    modeHeadingCopy.append(
      conversationFloatElement("h3", "jira-codex-svn-section-title", "本次提交方式"),
      conversationFloatElement("p", "jira-codex-svn-mode-intro", "先选择审核方式，再确认本次要提交的文件范围。")
    );
    modeHeading.appendChild(modeHeadingCopy);
    modeSection.appendChild(modeHeading);

    const modeOptions = conversationFloatElement("div", "jira-codex-svn-mode-options");
    modeOptions.setAttribute("role", "radiogroup");
    modeOptions.setAttribute("aria-label", "本次提交审核方式");
    const appendModeOption = ({ enabled, title, badge = "", description }) => {
      const option = conversationFloatElement("button", "jira-codex-svn-mode-option");
      const active = codexReviewEnabled === enabled;
      option.type = "button";
      option.dataset.active = String(active);
      option.disabled = state.busy;
      option.setAttribute("role", "radio");
      option.setAttribute("aria-checked", String(active));
      option.addEventListener("click", () => {
        if (state.codexReviewEnabled === enabled) return;
        state.codexReviewEnabled = enabled;
        renderSvnReviewModal();
      });
      const copy = conversationFloatElement("span", "jira-codex-svn-mode-option-copy");
      const titleRow = conversationFloatElement("span", "jira-codex-svn-mode-option-title", title);
      if (badge) titleRow.appendChild(conversationFloatElement("span", "jira-codex-svn-mode-badge", badge));
      copy.append(
        titleRow,
        conversationFloatElement("span", "jira-codex-svn-mode-option-description", description)
      );
      option.append(conversationFloatElement("span", "jira-codex-svn-mode-radio"), copy);
      modeOptions.appendChild(option);
    };
    appendModeOption({
      enabled: false,
      title: "人工审核（默认）",
      description: "生成不可变快照和机械检查后，由你查看全部差异与风险并人工确认。"
    });
    appendModeOption({
      enabled: true,
      title: "Codex 辅助审查",
      badge: "可能耗时较长",
      description: "在当前绑定会话启动只读审查；不会创建独立任务，可主动取消并降级为人工审核。"
    });
    modeSection.appendChild(modeOptions);

    const flow = conversationFloatElement("div", "jira-codex-svn-mode-flow");
    flow.append(
      conversationFloatElement("strong", "", "当前流程："),
      document.createTextNode(codexReviewEnabled
        ? "自动识别 → 人工选文件 → 机械检查 → Codex 只读审查 → 人工确认 → 提交前复检 → SVN commit"
        : "自动识别 → 人工选文件 → 机械检查 → 人工审核差异 → 人工确认 → 提交前复检 → SVN commit")
    );
    const gate = conversationFloatElement(
      "span",
      "jira-codex-svn-mode-gate",
      codexReviewEnabled
        ? "启用后必须等待审查完成，或主动取消并降级为人工审核，之后才能继续提交。"
        : "当前不会启动 Codex 审查，完成机械检查后进入人工确认。"
    );
    flow.appendChild(gate);
    modeSection.appendChild(flow);
    modeSection.appendChild(conversationFloatElement(
      "p",
      "jira-codex-svn-hint",
      "生成快照后，文件、属性、Jira 信息、提交说明或审核方式发生变化，都会使本次快照失效。"
    ));
    body.appendChild(modeSection);

    const filesSection = conversationFloatElement("section", "jira-codex-svn-section");
    const toolbar = conversationFloatElement("div", "jira-codex-svn-toolbar");
    toolbar.appendChild(conversationFloatElement(
      "h3",
      "jira-codex-svn-section-title",
      `本次需求变更 · 已选 ${state.selectedPaths.size}/${eligible.length}`
    ));
    toolbar.appendChild(conversationFloatElement("span", "jira-codex-svn-toolbar-spacer"));
    const applyRecommendation = conversationFloatElement("button", "jira-codex-svn-subtle-button", "采用系统推荐");
    applyRecommendation.type = "button";
    applyRecommendation.disabled = state.busy || !recommendedPaths.size
      || (selectedOutsideRecommendation === 0 && removedFromRecommendation === 0);
    applyRecommendation.addEventListener("click", () => {
      state.selectedPaths = new Set(recommendedPaths);
      state.selectionAdjusted = false;
      renderSvnReviewModal();
    });
    const clear = conversationFloatElement("button", "jira-codex-svn-subtle-button", "清空");
    clear.type = "button";
    clear.disabled = state.busy || !state.selectedPaths.size;
    clear.addEventListener("click", () => {
      state.selectedPaths.clear();
      state.selectionAdjusted = true;
      renderSvnReviewModal();
    });
    toolbar.append(applyRecommendation, clear);
    filesSection.appendChild(toolbar);

    const tabs = conversationFloatElement("div", "jira-codex-svn-category-tabs");
    categories.forEach((category) => {
      const tab = conversationFloatElement("button", "jira-codex-svn-category-tab", `${category.label} ${category.changes.length}`);
      tab.type = "button";
      tab.dataset.active = String(category.id === activeCategory.id);
      tab.disabled = state.busy;
      tab.addEventListener("click", () => {
        state.svnCategory = category.id;
        renderSvnReviewModal();
      });
      tabs.appendChild(tab);
    });
    filesSection.appendChild(tabs);

    const browser = conversationFloatElement("div", "jira-codex-svn-change-browser");
    const treePane = conversationFloatElement("div", "jira-codex-svn-browser-pane jira-codex-svn-tree-pane");
    const selectionSummary = recommendedPaths.size
      ? state.selectionAdjusted
        ? `系统推荐 ${recommendedPaths.size} · 人工增加 ${selectedOutsideRecommendation} / 移除 ${removedFromRecommendation}`
        : `系统已推荐并初选 ${recommendedPaths.size} 个文件，等待人工判断`
      : "未识别到可靠候选，请人工选择";
    const treeSummary = conversationFloatElement("div", "jira-codex-svn-tree-summary");
    treeSummary.append(
      conversationFloatElement("strong", "", context.workingCopy.scopeName || "当前项目"),
      conversationFloatElement("span", "", selectionSummary)
    );
    treePane.appendChild(treeSummary);
    const treeContainer = conversationFloatElement("div", "jira-codex-svn-file-tree");
    if (!activeCategory.changes.length) {
      treeContainer.appendChild(conversationFloatElement("div", "jira-codex-svn-empty", `没有${activeCategory.label}文件。`));
    } else {
      const renderTreeNode = (node, depth) => {
        const directory = node.id === "__project__" || node.children.length > 0 || node.change?.kind === "dir";
        const expanded = state.expandedPaths.has(node.id);
        const selectedCount = node.selectablePaths.filter((path) => state.selectedPaths.has(path)).length;
        const row = conversationFloatElement("div", "jira-codex-svn-tree-row");
        row.style.setProperty("--svn-tree-depth", String(depth));
        row.dataset.preview = String(Boolean(node.change && state.previewPath === node.change.path));
        row.dataset.disabled = String(Boolean(node.change && !svnChangeSelectable(node.change)));
        row.title = node.change?.recommendationReason
          ? `${node.change.path}\n${node.change.recommendationReason}`
          : node.change?.path || node.path;

        const toggle = conversationFloatElement("button", "jira-codex-svn-tree-toggle", expanded ? "▾" : "▸");
        toggle.type = "button";
        toggle.disabled = !node.children.length;
        toggle.setAttribute("aria-label", expanded ? "折叠目录" : "展开目录");
        toggle.addEventListener("click", () => {
          if (expanded) state.expandedPaths.delete(node.id);
          else state.expandedPaths.add(node.id);
          renderSvnReviewModal();
        });

        const checkbox = conversationFloatElement("input", "jira-codex-svn-tree-check");
        checkbox.type = "checkbox";
        checkbox.disabled = state.busy || !node.selectablePaths.length;
        checkbox.checked = Boolean(node.selectablePaths.length) && selectedCount === node.selectablePaths.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < node.selectablePaths.length;
        checkbox.setAttribute("aria-label", directory ? `选择目录 ${node.name} 中的可提交文件` : `选择文件 ${node.name}`);
        checkbox.addEventListener("change", () => {
          node.selectablePaths.forEach((path) => {
            if (checkbox.checked) state.selectedPaths.add(path);
            else state.selectedPaths.delete(path);
          });
          state.selectionAdjusted = true;
          renderSvnReviewModal();
          if (!directory && node.change) void loadSvnDiffPreview(node.change);
        });

        const icon = conversationFloatElement("span", "jira-codex-svn-tree-icon", directory ? "▱" : "·");
        const name = conversationFloatElement("button", "jira-codex-svn-tree-name", node.name);
        name.type = "button";
        name.addEventListener("click", () => {
          if (directory && node.children.length) {
            if (expanded) state.expandedPaths.delete(node.id);
            else state.expandedPaths.add(node.id);
            renderSvnReviewModal();
          } else if (node.change) {
            void loadSvnDiffPreview(node.change);
          }
        });
        name.addEventListener("dblclick", (event) => {
          if (!directory && node.change && svnChangeSelectable(node.change)) {
            event.preventDefault();
            event.stopPropagation();
            void openSvnExternalDiff(node.change);
          }
        });
        const badges = conversationFloatElement("span", "jira-codex-svn-tree-badges");
        if (node.change?.recommended && svnChangeSelectable(node.change)) {
          badges.appendChild(conversationFloatElement("span", "jira-codex-svn-tree-recommended", node.change.recommendationConfidence === "high" ? "高置信推荐" : "推荐"));
        }
        if (directory && node.selectablePaths.length) {
          badges.appendChild(conversationFloatElement("span", "jira-codex-svn-file-status", `${selectedCount}/${node.selectablePaths.length}`));
        } else if (node.change) {
          const status = conversationFloatElement(
            "span",
            "jira-codex-svn-file-status",
            `${svnChangeStatusCode(node.change)} · ${svnChangeStatusLabel(node.change)}`
          );
          status.dataset.status = node.change.item || "unknown";
          badges.appendChild(status);
          if (node.change.relatedIssues?.length) {
            const overlap = conversationFloatElement("span", "jira-codex-svn-tree-overlap", `关联 ${node.change.relatedIssues.length} 个其他 Jira`);
            overlap.title = node.change.relatedIssues.map((entry) => `${entry.issueKey} ${entry.title || ""}`).join("\n");
            badges.appendChild(overlap);
          }
        }
        row.append(toggle, checkbox, icon, name, badges);
        treeContainer.appendChild(row);
        if (directory && expanded) node.children.forEach((child) => renderTreeNode(child, depth + 1));
      };
      renderTreeNode(tree, 0);
    }
    treePane.appendChild(treeContainer);
    const previewPane = conversationFloatElement("div", "jira-codex-svn-browser-pane jira-codex-svn-preview-pane");
    renderSvnDiffPreview(previewPane, state);
    browser.append(treePane, previewPane);
    filesSection.appendChild(browser);
    if (!changes.length) {
      filesSection.appendChild(conversationFloatElement("div", "jira-codex-svn-empty", "当前 SVN 工作副本没有本地改动。"));
    }
    filesSection.appendChild(conversationFloatElement(
      "p",
      "jira-codex-svn-hint",
      "候选文件由项目范围、任务基线和当前会话文件操作自动识别；最终范围以你的人工增删为准。未纳管文件不会自动 svn add。"
    ));
    body.appendChild(filesSection);

    const grid = conversationFloatElement("div", "jira-codex-svn-grid");
    grid.style.marginTop = "14px";
    const main = conversationFloatElement("div", "jira-codex-svn-stack");
    const side = conversationFloatElement("div", "jira-codex-svn-stack");

    const messageSection = conversationFloatElement("section", "jira-codex-svn-section");
    messageSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "提交信息"));
    const field = conversationFloatElement("label", "jira-codex-svn-field");
    field.appendChild(conversationFloatElement("span", "jira-codex-svn-label", "本次提交简要说明（可选，限一行）"));
    const input = conversationFloatElement("input", "jira-codex-svn-input");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "例如：完成弱网重连时的新手引导状态恢复逻辑";
    input.value = state.summary;
    input.disabled = state.busy;
    const preview = conversationFloatElement("pre", "jira-codex-svn-code", svnCommitMessagePreview(state));
    input.addEventListener("input", () => {
      state.summary = input.value;
      preview.textContent = svnCommitMessagePreview(state);
    });
    field.appendChild(input);
    messageSection.append(field, preview);
    main.appendChild(messageSection);

    const contextSection = conversationFloatElement("section", "jira-codex-svn-section");
    contextSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "工作副本"));
    const meta = conversationFloatElement("dl", "jira-codex-svn-meta");
    [
      ["项目范围", context.workingCopy.scopeRoot || context.session?.cwd || "未知"],
      ["工作副本", context.workingCopy.root],
      ["仓库地址", context.workingCopy.url || "未返回"],
      ["当前版本", context.workingCopy.revisionRange || context.workingCopy.revision || "未知"],
      ["会话目录", context.session?.cwd || "未知"],
      ["任务基线", context.baseline?.available ? context.baseline.capturedAt : "当前绑定无基线"]
    ].forEach(([label, value]) => {
      const row = conversationFloatElement("div");
      row.append(
        conversationFloatElement("dt", "", label),
        conversationFloatElement("dd", "", value)
      );
      meta.appendChild(row);
    });
    contextSection.appendChild(meta);
    side.appendChild(contextSection);

    if (state.commitHistory?.length) {
      const historySection = conversationFloatElement("section", "jira-codex-svn-section");
      historySection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", `当前 Jira 的历史提交 · ${state.commitHistory.length}`));
      const historyList = conversationFloatElement("ul", "jira-codex-svn-review-list");
      state.commitHistory.slice(0, 20).forEach((entry) => historyList.appendChild(conversationFloatElement(
        "li",
        "",
        `${entry.revision ? `r${entry.revision}` : "revision 未知"} · ${entry.date || "时间未知"} · ${(entry.paths || []).length} 个文件`
      )));
      historySection.appendChild(historyList);
      side.appendChild(historySection);
    }

    grid.append(main, side);
    body.appendChild(grid);
  }

  function renderSvnReview(body, state) {
    const review = state.review;
    if (review.status === "manual_review") {
      const banner = conversationFloatElement("div", "jira-codex-svn-banner", "Codex 审核已关闭。请人工审核全部选定文件、差异、机械检查和风险；确认完成后可以提交。");
      banner.dataset.tone = review.verdict === "warning" ? "warning" : "success";
      body.appendChild(banner);
    } else if (review.status === "prepared") {
      const banner = conversationFloatElement("div", "jira-codex-svn-banner", "审核快照已生成，正在向当前绑定会话投递只读审查 turn…");
      banner.dataset.tone = "warning";
      body.appendChild(banner);
    } else if (review.status === "dispatching") {
      const banner = conversationFloatElement("div", "jira-codex-svn-banner", "正在等待当前绑定会话确认审查消息并返回真实 turnId。");
      banner.dataset.tone = "warning";
      body.appendChild(banner);
    } else if (review.status === "running") {
      const banner = conversationFloatElement("div", "jira-codex-svn-banner", `挂起：Codex 正在当前绑定会话执行只读审查${review.auditTurnId ? `（turnId: ${review.auditTurnId}）` : ""}。审查可能耗时较长；可以关闭浮窗查看过程，或人工取消后降级为人工审核。`);
      banner.dataset.tone = "warning";
      body.appendChild(banner);
    } else if (review.status === "cancelled") {
      const banner = conversationFloatElement("div", "jira-codex-svn-banner", review.cancellation?.message || "Codex 审查已人工取消。本次提交已降级为人工审核，仍需查看全部差异和风险后确认。");
      banner.dataset.tone = "warning";
      body.appendChild(banner);
    } else if (review.status === "committed") {
      const banner = conversationFloatElement(
        "div",
        "jira-codex-svn-banner",
        `SVN 提交成功${review.commit?.revision ? `，版本 r${review.commit.revision}` : ""}。`
      );
      banner.dataset.tone = "success";
      body.appendChild(banner);
    } else if (review.status === "commit_unknown") {
      const banner = conversationFloatElement("div", "jira-codex-svn-banner", review.error || "SVN 命令结果不明确，需要人工核对日志。");
      banner.dataset.tone = "warning";
      body.appendChild(banner);
    } else if (["blocked", "failed", "stale", "dispatch_failed", "timed_out", "commit_failed"].includes(review.status)) {
      const message = review.error
        || (review.status === "stale" ? "审核快照已失效，请刷新后重新审核。" : "当前审核已阻断，不能提交。")
      body.appendChild(conversationFloatElement("div", "jira-codex-svn-error", message));
    }

    const grid = conversationFloatElement("div", "jira-codex-svn-grid");
    const main = conversationFloatElement("div", "jira-codex-svn-stack");
    const side = conversationFloatElement("div", "jira-codex-svn-stack");

    const resultSection = conversationFloatElement("section", "jira-codex-svn-section");
    const resultHeading = conversationFloatElement("div", "jira-codex-svn-result-heading");
    resultHeading.appendChild(conversationFloatElement(
      "h3",
      "jira-codex-svn-section-title",
      review.semantic ? "最终审核结论" : review.codexReviewEnabled === false ? "人工审核依据" : "机械预检"
    ));
    const verdict = review.verdict || review.mechanical?.verdict || "";
    const verdictBadge = conversationFloatElement("span", "jira-codex-svn-verdict", svnVerdictLabel(verdict));
    verdictBadge.dataset.verdict = verdict || "running";
    resultHeading.appendChild(verdictBadge);
    resultSection.appendChild(resultHeading);

    const checks = conversationFloatElement("ul", "jira-codex-svn-check-list");
    appendSvnChecks(checks, review.mechanical?.blockers, "block");
    appendSvnChecks(checks, review.mechanical?.warnings, "warning");
    appendSvnChecks(checks, review.mechanical?.notes, "note");
    if (checks.children.length) resultSection.appendChild(checks);

    const semantic = review.semantic;
    if (semantic) {
      resultSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "Codex 语义审核"));
      if (semantic.summary) resultSection.appendChild(conversationFloatElement("p", "jira-codex-svn-review-copy", semantic.summary));
      appendSvnReviewList(resultSection, "需求覆盖矩阵", semantic.requirements, (item) => (
        `[${item?.status || "unknown"}] ${item?.requirement || "未命名需求"}：${item?.evidence || "未提供证据"}`
      ));
      appendSvnReviewList(resultSection, "文件改动", semantic.fileChanges, (item) => (
        `${item?.path || "未知文件"}：${item?.assessment || "未提供评价"}`
      ));
      appendSvnReviewList(resultSection, "风险分析", semantic.risks, (item) => (
        `[${item?.level || "unknown"}] ${item?.description || "未提供描述"}`
      ));
      appendSvnReviewList(resultSection, "其他逻辑影响", semantic.impactAnalysis, (item) => (
        `[${item?.severity || "unknown"}] ${item?.area || "未命名范围"}：${item?.assessment || "未提供结论"}${item?.evidence ? ` · ${item.evidence}` : ""}`
      ));
      appendSvnReviewList(resultSection, "调用链分析", semantic.callChainAnalysis, (item) => (
        `${item?.symbol || "未命名符号"}：调用方 ${(item?.callers || []).join("、") || "未核实"}；被调用方 ${(item?.callees || []).join("、") || "未核实"} · ${item?.assessment || "未提供结论"}`
      ));
      const assessment = conversationFloatElement("ul", "jira-codex-svn-review-list");
      assessment.append(
        conversationFloatElement("li", "", `需求符合性：${semantic.requirementMatch?.status || "unknown"} · ${semantic.requirementMatch?.explanation || ""}`),
        conversationFloatElement("li", "", `合规性：${semantic.compliance?.status || "unknown"} · ${semantic.compliance?.explanation || ""}`),
        conversationFloatElement("li", "", `测试：${semantic.tests?.status || "unknown"} · ${semantic.tests?.details || ""}`)
      );
      resultSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "需求、合规与验证"));
      resultSection.appendChild(assessment);
      appendSvnReviewList(resultSection, "潜在回归", semantic.regressions);
      appendSvnReviewList(resultSection, "未核实范围", semantic.unverifiedAreas);
      appendSvnReviewList(resultSection, "审核建议", semantic.recommendations);
    } else if (review.codexReviewEnabled === false) {
      resultSection.appendChild(conversationFloatElement("p", "jira-codex-svn-hint", "当前为纯人工审核模式。机械预检不会判断需求实现是否完整准确；请结合 Jira 需求、完整差异及调用影响自行审核。"));
    } else {
      resultSection.appendChild(conversationFloatElement("p", "jira-codex-svn-hint", "机械预检不代表审查通过；当前绑定会话返回结构化语义结论，或人工取消后降级审核，才能进入最终人工确认。"));
    }
    main.appendChild(resultSection);

    const diffSection = conversationFloatElement("section", "jira-codex-svn-section");
    diffSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "审核快照差异"));
    diffSection.appendChild(review.diffPreview
      ? renderSvnColoredDiff(review.diffPreview)
      : conversationFloatElement("div", "jira-codex-svn-preview-empty", "没有可展示的文本差异。"));
    main.appendChild(diffSection);

    const messageSection = conversationFloatElement("section", "jira-codex-svn-section");
    messageSection.append(
      conversationFloatElement("h3", "jira-codex-svn-section-title", "最终提交信息"),
      conversationFloatElement("pre", "jira-codex-svn-code", review.message)
    );
    side.appendChild(messageSection);

    const filesSection = conversationFloatElement("section", "jira-codex-svn-section");
    filesSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", `显式提交路径 · ${review.selectedPaths.length}`));
    const fileList = conversationFloatElement("ul", "jira-codex-svn-review-list");
    review.selectedPaths.forEach((path) => fileList.appendChild(conversationFloatElement("li", "jira-codex-svn-file-path", path)));
    filesSection.appendChild(fileList);
    side.appendChild(filesSection);

    if (review.auditThreadId) {
      const auditSection = conversationFloatElement("section", "jira-codex-svn-section");
      auditSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "当前会话审查 turn"));
      const auditMeta = conversationFloatElement("dl", "jira-codex-svn-meta");
      [
        ["状态", review.status === "dispatching" ? "等待 turnId" : review.status === "running" ? "审核中" : "已结束"],
        ["绑定会话 ID", review.auditThreadId],
        ["Turn ID", review.auditTurnId || "尚未确认"]
      ].forEach(([label, value]) => {
        const row = conversationFloatElement("div");
        row.append(conversationFloatElement("dt", "", label), conversationFloatElement("dd", "", value));
        auditMeta.appendChild(row);
      });
      auditSection.appendChild(auditMeta);
      side.appendChild(auditSection);
    }

    const reviewReadyForHumanConfirmation = ["pass", "warning"].includes(review.verdict)
      && (["completed", "cancelled"].includes(review.status)
        || (review.status === "manual_review" && review.codexReviewEnabled === false));
    if (reviewReadyForHumanConfirmation) {
      const confirmSection = conversationFloatElement("section", "jira-codex-svn-section");
      confirmSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "人工确认"));
      const confirm = conversationFloatElement("div", "jira-codex-svn-confirm");
      const reviewedLabel = conversationFloatElement("label", "jira-codex-svn-confirm-row");
      const reviewedInput = conversationFloatElement("input");
      reviewedInput.type = "checkbox";
      reviewedInput.checked = Boolean(state.humanReviewed);
      reviewedInput.addEventListener("change", () => {
        state.humanReviewed = reviewedInput.checked;
        renderSvnReviewModal();
      });
      reviewedLabel.append(reviewedInput, conversationFloatElement(
        "span",
        "",
        review.codexReviewEnabled === false || review.status === "cancelled"
          ? "我已人工审核全部文件改动、需求符合性和影响风险"
          : "我已人工查看文件改动和审核报告"
      ));
      confirm.appendChild(reviewedLabel);
      if (review.verdict === "warning") {
        const riskLabel = conversationFloatElement("label", "jira-codex-svn-confirm-row");
        const riskInput = conversationFloatElement("input");
        riskInput.type = "checkbox";
        riskInput.checked = Boolean(state.riskAcknowledged);
        riskInput.addEventListener("change", () => {
          state.riskAcknowledged = riskInput.checked;
          renderSvnReviewModal();
        });
        riskLabel.append(riskInput, conversationFloatElement("span", "", "我理解上述风险并仍要提交"));
        confirm.appendChild(riskLabel);
      }
      if (review.crossTaskConflicts?.length) {
        const overlapLabel = conversationFloatElement("label", "jira-codex-svn-confirm-row");
        const overlapInput = conversationFloatElement("input");
        overlapInput.type = "checkbox";
        overlapInput.checked = Boolean(state.overlapAcknowledged);
        overlapInput.addEventListener("change", () => {
          state.overlapAcknowledged = overlapInput.checked;
          renderSvnReviewModal();
        });
        overlapLabel.append(overlapInput, conversationFloatElement("span", "", "我已核对与其他 Jira 草稿重叠的文件，确认本次所选改动可以提交"));
        confirm.appendChild(overlapLabel);
      }
      confirmSection.appendChild(confirm);
      side.appendChild(confirmSection);
    }

    if (review.status === "committed" && review.commit) {
      const successSection = conversationFloatElement("section", "jira-codex-svn-section");
      successSection.appendChild(conversationFloatElement("h3", "jira-codex-svn-section-title", "提交记录"));
      const meta = conversationFloatElement("dl", "jira-codex-svn-meta");
      [
        ["SVN 版本", review.commit.revision ? `r${review.commit.revision}` : "命令已成功"],
        ["仓库地址", review.commit.repositoryUrl || "未返回"],
        ["提交时间", review.commit.committedAt || ""],
        ["审核 ID", review.id]
      ].forEach(([label, value]) => {
        const row = conversationFloatElement("div");
        row.append(conversationFloatElement("dt", "", label), conversationFloatElement("dd", "", value));
        meta.appendChild(row);
      });
      successSection.appendChild(meta);
      side.appendChild(successSection);
    }
    grid.append(main, side);
    body.appendChild(grid);
  }

  function svnHumanConfirmationReady(state) {
    const review = state?.review;
    const reviewReady = ["completed", "cancelled"].includes(review?.status)
      || (review?.status === "manual_review" && review?.codexReviewEnabled === false);
    return Boolean(
      reviewReady
      && state.humanReviewed
      && (review.verdict !== "warning" || state.riskAcknowledged)
      && (!review.crossTaskConflicts?.length || state.overlapAcknowledged)
      && !state.busy
    );
  }

  function renderSvnReviewModal() {
    const state = svnModalState;
    if (!state || !document.body) return;
    svnModal = document.getElementById(SVN_MODAL_ID) || svnModal;
    const currentBody = svnModal?.querySelector(".jira-codex-svn-body");
    const currentTree = svnModal?.querySelector(".jira-codex-svn-file-tree");
    const currentPreview = svnModal?.querySelector(".jira-codex-svn-preview-content");
    const nextViewKey = state.loading
      ? "loading"
      : state.review
        ? `review:${state.review.id}:${state.review.status}`
        : state.context
          ? "selection"
          : "empty";
    const preserveBodyScroll = state.renderedViewKey === nextViewKey;
    const preserveTreeScroll = preserveBodyScroll
      && state.renderedTreeCategory === state.svnCategory;
    const preservePreviewScroll = preserveBodyScroll
      && state.renderedPreviewPath === state.previewPath;
    const bodyScrollTop = preserveBodyScroll
      ? Number(currentBody?.scrollTop ?? state.bodyScrollTop ?? 0)
      : 0;
    const treeScrollTop = preserveTreeScroll
      ? Number(currentTree?.scrollTop ?? state.treeScrollTop ?? 0)
      : 0;
    const previewScrollTop = preservePreviewScroll
      ? Number(currentPreview?.scrollTop ?? state.previewScrollTop ?? 0)
      : 0;
    const previewScrollLeft = preservePreviewScroll
      ? Number(currentPreview?.scrollLeft ?? state.previewScrollLeft ?? 0)
      : 0;
    state.bodyScrollTop = bodyScrollTop;
    state.treeScrollTop = treeScrollTop;
    state.previewScrollTop = previewScrollTop;
    state.previewScrollLeft = previewScrollLeft;
    state.renderedViewKey = nextViewKey;
    state.renderedTreeCategory = state.svnCategory;
    state.renderedPreviewPath = state.previewPath;
    if (!svnModal) {
      svnModal = conversationFloatElement("div");
      svnModal.id = SVN_MODAL_ID;
      svnModal.setAttribute(OWNED_ATTRIBUTE, "true");
      svnModal.setAttribute("role", "presentation");
      svnModal.tabIndex = -1;
      svnModal.addEventListener("mousedown", (event) => {
        if (event.target === svnModal) removeSvnReviewModal();
      });
      svnModal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") removeSvnReviewModal();
      });
      document.body.appendChild(svnModal);
    }
    applyThemeSnapshotToSvnModal(readCodexThemeSnapshot());
    svnModal.replaceChildren();
    const dialog = conversationFloatElement("section", "jira-codex-svn-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", `${state.issueKey} SVN 提交审核`);
    const header = conversationFloatElement("header", "jira-codex-svn-header");
    const headerCopy = conversationFloatElement("div", "jira-codex-svn-header-copy");
    headerCopy.append(
      conversationFloatElement("div", "jira-codex-svn-eyebrow", "SVN REVIEW & COMMIT"),
      conversationFloatElement("h2", "jira-codex-svn-title", `${state.issueKey} · ${state.issue?.title || "代码提交审核"}`)
    );
    const close = conversationFloatElement("button", "jira-codex-svn-close", "×");
    close.type = "button";
    close.title = "关闭";
    close.addEventListener("click", removeSvnReviewModal);
    header.append(headerCopy, close);
    dialog.appendChild(header);

    const body = conversationFloatElement("div", "jira-codex-svn-body");
    if (state.error) body.appendChild(conversationFloatElement("div", "jira-codex-svn-error", state.error));
    if (state.loading) {
      body.appendChild(conversationFloatElement("div", "jira-codex-svn-loading", "正在读取当前会话的 SVN 工作副本与改动…"));
    } else if (state.review) {
      renderSvnReview(body, state);
    } else if (state.context) {
      renderSvnSelection(body, state);
    }
    dialog.appendChild(body);

    const footer = conversationFloatElement("footer", "jira-codex-svn-footer");
    const cancel = conversationFloatElement("button", "jira-codex-svn-button", state.review?.status === "committed" ? "完成" : "关闭");
    cancel.type = "button";
    cancel.disabled = state.busy;
    cancel.addEventListener("click", removeSvnReviewModal);
    footer.appendChild(cancel);
    if (!state.loading && state.context && !state.review) {
      const start = conversationFloatElement(
        "button",
        "jira-codex-svn-button",
        state.busy
          ? "正在生成快照…"
          : state.codexReviewEnabled !== false
            ? `Codex 审核所选 ${state.selectedPaths.size} 个文件`
            : `进入人工审核 · ${state.selectedPaths.size} 个文件`
      );
      start.type = "button";
      start.dataset.primary = "true";
      start.disabled = state.busy || !state.selectedPaths.size || !state.context.changes.length;
      start.addEventListener("click", () => void startSvnReview());
      footer.appendChild(start);
    } else if (state.review && ["prepared", "dispatching", "running"].includes(state.review.status)) {
      const stop = conversationFloatElement("button", "jira-codex-svn-button", state.busy ? "正在取消…" : "取消 Codex 审查并改为人工审核");
      stop.type = "button";
      stop.dataset.primary = "true";
      stop.disabled = state.busy;
      stop.addEventListener("click", () => void cancelSvnCodexReview());
      footer.appendChild(stop);
    } else if (state.review && ["dispatch_failed", "timed_out", "failed"].includes(state.review.status)) {
      const restart = conversationFloatElement("button", "jira-codex-svn-button", "返回文件选择并重新扫描");
      restart.type = "button";
      restart.disabled = state.busy;
      restart.addEventListener("click", () => void restartSvnReviewFromLatest());
      footer.appendChild(restart);
      const downgrade = conversationFloatElement("button", "jira-codex-svn-button", "降级为人工审核");
      downgrade.type = "button";
      downgrade.disabled = state.busy;
      downgrade.addEventListener("click", () => void cancelSvnCodexReview());
      footer.appendChild(downgrade);
      const retry = conversationFloatElement("button", "jira-codex-svn-button", state.busy ? "正在准备…" : "在当前会话重新审查");
      retry.type = "button";
      retry.dataset.primary = "true";
      retry.disabled = state.busy || svnAuditDispatching;
      retry.addEventListener("click", () => void retrySvnReviewDispatch());
      footer.appendChild(retry);
    } else if (state.review?.status === "commit_unknown") {
      const abandon = conversationFloatElement("button", "jira-codex-svn-button", "人工核对后放弃草稿");
      abandon.type = "button";
      abandon.disabled = state.busy;
      abandon.addEventListener("click", () => void abandonSvnReview());
      const reconcile = conversationFloatElement("button", "jira-codex-svn-button", state.busy ? "正在核对…" : "重新核对 SVN 日志");
      reconcile.type = "button";
      reconcile.dataset.primary = "true";
      reconcile.disabled = state.busy;
      reconcile.addEventListener("click", () => void reconcileSvnCommit());
      footer.append(abandon, reconcile);
    } else if (state.review && ["blocked", "stale", "commit_failed"].includes(state.review.status)) {
      const retry = conversationFloatElement("button", "jira-codex-svn-button", "返回文件选择并重新扫描");
      retry.type = "button";
      retry.dataset.primary = "true";
      retry.disabled = state.busy;
      retry.addEventListener("click", () => void restartSvnReviewFromLatest());
      footer.appendChild(retry);
    } else if (
      ["pass", "warning"].includes(state.review?.verdict)
      && (["completed", "cancelled"].includes(state.review?.status)
        || (state.review?.status === "manual_review" && state.review?.codexReviewEnabled === false))
    ) {
      const restart = conversationFloatElement("button", "jira-codex-svn-button", "返回文件选择并重新扫描");
      restart.type = "button";
      restart.disabled = state.busy;
      restart.addEventListener("click", () => void restartSvnReviewFromLatest());
      footer.appendChild(restart);
      const commit = conversationFloatElement("button", "jira-codex-svn-button", state.busy ? "提交前复检中…" : "确认提交到 SVN");
      commit.type = "button";
      commit.dataset.primary = "true";
      commit.dataset.svnCommitButton = "true";
      commit.disabled = !svnHumanConfirmationReady(state);
      commit.addEventListener("click", () => void confirmAndCommitSvnReview());
      footer.appendChild(commit);
    } else if (state.review?.status === "committed") {
      const next = conversationFloatElement("button", "jira-codex-svn-button", "新建下一次提交");
      next.type = "button";
      next.dataset.primary = "true";
      next.disabled = state.busy;
      next.addEventListener("click", () => void reloadLatestSvnSelection());
      footer.appendChild(next);
    }
    dialog.appendChild(footer);
    svnModal.appendChild(dialog);
    svnModal.focus({ preventScroll: true });
    body.scrollTop = bodyScrollTop;
    body.addEventListener("scroll", () => {
      if (svnModalState === state) state.bodyScrollTop = body.scrollTop;
    }, { passive: true });
    const nextTree = body.querySelector(".jira-codex-svn-file-tree");
    if (nextTree) {
      nextTree.scrollTop = treeScrollTop;
      nextTree.addEventListener("scroll", () => {
        if (svnModalState === state) state.treeScrollTop = nextTree.scrollTop;
      }, { passive: true });
    }
    const nextPreview = body.querySelector(".jira-codex-svn-preview-content");
    if (nextPreview) {
      nextPreview.scrollTop = previewScrollTop;
      nextPreview.scrollLeft = previewScrollLeft;
      nextPreview.addEventListener("scroll", () => {
        if (svnModalState !== state) return;
        state.previewScrollTop = nextPreview.scrollTop;
        state.previewScrollLeft = nextPreview.scrollLeft;
      }, { passive: true });
    }
  }

  async function markSvnAuditDispatchFailed(reviewId, message) {
    try {
      return await panelJson(`/api/svn/reviews/${encodeURIComponent(reviewId)}/dispatch-failed`, {
        method: "POST",
        body: { message }
      });
    } catch {
      return null;
    }
  }

  async function dispatchCurrentConversationSvnReview({ state, review, prompt }) {
    if (svnAuditDispatching) throw new Error("已有一个 Codex 审查 turn 正在投递，请稍候。");
    svnAuditDispatching = true;
    let turnStarted = false;
    try {
      const preflight = await readCodexThreadState(state.threadId);
      if (preflight.busy) throw new Error("绑定会话正在执行其他 turn。请等待其结束，或关闭 Codex 审查改为人工审核。");
      const started = await startCodexThreadTurn(state.threadId, prompt, {
        attachments: (review.artifacts || []).map((artifact) => ({
          label: artifact.name,
          path: artifact.path
        }))
      });
      turnStarted = true;
      const dispatched = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/dispatch`, {
        method: "POST",
        body: { auditThreadId: started.threadId, auditTurnId: started.turnId }
      });
      state.review = dispatched.review;
      syncConversationFloatSvnStatus(dispatched.review);
      if (conversationFloatState?.issueKey === state.issueKey) {
        conversationFloatState.notice = "Codex 审查已在当前绑定会话启动；浮窗状态已挂起，可随时重新打开或取消审查。";
      }
      await navigateCodexThread(state.threadId).catch(() => {});
      removeSvnReviewModal();
      ensureConversationIssueFloat();
      renderConversationIssueFloat();
      return dispatched.review;
    } catch (error) {
      if (!turnStarted) {
        await markSvnAuditDispatchFailed(review.id, `当前会话审查投递失败：${error.message || error}`);
      }
      throw error;
    } finally {
      svnAuditDispatching = false;
    }
  }

  function startSvnReviewPolling(reviewId) {
    if (svnReviewPollTimer) window.clearInterval(svnReviewPollTimer);
    const refresh = async () => {
      const state = svnModalState;
      if (!state || state.review?.id !== reviewId) return;
      try {
        const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(reviewId)}`);
        if (!svnModalState || svnModalState !== state) return;
        state.review = payload.review;
        syncConversationFloatSvnStatus(payload.review);
        state.error = "";
        renderSvnReviewModal();
        if (!["prepared", "dispatching", "running"].includes(state.review?.status) && svnReviewPollTimer) {
          window.clearInterval(svnReviewPollTimer);
          svnReviewPollTimer = null;
        }
      } catch (error) {
        if (!svnModalState || svnModalState !== state) return;
        state.error = `读取审核进度失败：${error.message || error}`;
        renderSvnReviewModal();
      }
    };
    svnReviewPollTimer = window.setInterval(() => void refresh(), 2_000);
    void refresh();
  }

  async function startSvnReview() {
    const state = svnModalState;
    if (!state || state.busy || !state.selectedPaths.size) return;
    state.busy = true;
    state.error = "";
    renderSvnReviewModal();
    try {
      const payload = await panelJson("/api/svn/reviews", {
        method: "POST",
        body: {
          threadId: state.threadId,
          activeThreadId: activeThreadIds()[0] || "",
          issueKey: state.issueKey,
          selectedPaths: Array.from(state.selectedPaths),
          summary: state.summary,
          codexReviewEnabled: state.codexReviewEnabled !== false
        }
      });
      if (svnModalState !== state) return;
      state.review = payload.review;
      syncConversationFloatSvnStatus(payload.review);
      state.codexReviewEnabled = payload.review?.codexReviewEnabled !== false;
      state.busy = false;
      renderSvnReviewModal();
      if (payload.prompt) {
        await dispatchCurrentConversationSvnReview({ state, review: payload.review, prompt: payload.prompt });
      }
    } catch (error) {
      const current = svnModalState;
      if (current?.issueKey === state.issueKey) {
        current.busy = false;
        current.error = `无法开始审核：${error.message || error}`;
        if (state.review?.id) {
          try {
            const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(state.review.id)}`);
            if (svnModalState === current) current.review = payload.review;
          } catch {}
        }
        renderSvnReviewModal();
      }
    }
  }

  async function retrySvnReviewDispatch() {
    const state = svnModalState;
    const review = state?.review;
    if (!state || !review || state.busy) return;
    state.busy = true;
    state.error = "";
    renderSvnReviewModal();
    try {
      const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/retry`, {
        method: "POST",
        body: { issueKey: state.issueKey }
      });
      if (svnModalState !== state) return;
      state.review = payload.review;
      syncConversationFloatSvnStatus(payload.review);
      state.codexReviewEnabled = payload.review?.codexReviewEnabled !== false;
      state.busy = false;
      renderSvnReviewModal();
      await dispatchCurrentConversationSvnReview({ state, review: payload.review, prompt: payload.prompt });
    } catch (error) {
      const current = svnModalState;
      if (current?.issueKey !== state.issueKey) return;
      current.busy = false;
      current.error = `无法重新投递审核：${error.message || error}`;
      renderSvnReviewModal();
    }
  }

  async function cancelSvnCodexReview() {
    const state = svnModalState;
    const review = state?.review;
    if (!state || !review || state.busy) return;
    state.busy = true;
    state.error = "";
    renderSvnReviewModal();
    let interruptMessage = "Codex 审查已由人工取消，当前提交降级为人工审核。";
    if (review.auditTurnId) {
      try {
        await interruptCodexThreadTurn(review.auditThreadId || state.threadId, review.auditTurnId, { timeoutMs: 8_000 });
      } catch (error) {
        interruptMessage = `已在提交面板取消审查，但 Codex turn 中断请求未确认（${error.message || error}）；晚到的审查结果将被忽略，提交仍降级为人工审核。`;
      }
    }
    try {
      const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/cancel`, {
        method: "POST",
        body: { message: interruptMessage }
      });
      if (svnModalState !== state) return;
      state.review = payload.review;
      syncConversationFloatSvnStatus(payload.review);
      state.busy = false;
      state.humanReviewed = false;
      state.riskAcknowledged = false;
      state.overlapAcknowledged = false;
      renderSvnReviewModal();
    } catch (error) {
      if (svnModalState !== state) return;
      state.busy = false;
      state.error = `无法完成审查降级：${error.message || error}。可以关闭后重新打开面板再试。`;
      renderSvnReviewModal();
    }
  }

  async function reconcileSvnCommit() {
    const state = svnModalState;
    const review = state?.review;
    if (!state || !review || state.busy) return;
    state.busy = true;
    state.error = "";
    renderSvnReviewModal();
    try {
      const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/reconcile`, {
        method: "POST",
        body: {}
      });
      if (svnModalState !== state) return;
      state.review = payload.review;
      syncConversationFloatSvnStatus(payload.review);
      state.busy = false;
      renderSvnReviewModal();
    } catch (error) {
      if (svnModalState !== state) return;
      state.busy = false;
      state.error = `SVN 日志核对失败：${error.message || error}`;
      renderSvnReviewModal();
    }
  }

  function resetSvnSelectionForReload(state) {
    if (!state) return;
    state.review = null;
    state.context = null;
    state.selectionInitialized = false;
    state.selectionAdjusted = false;
    state.selectedPaths = new Set();
    state.recommendedPaths = new Set();
    state.treeExpansionInitialized = false;
    state.expandedPaths = new Set();
    state.svnCategory = "reviewable";
    state.previewPath = "";
    state.preview = null;
    state.previewError = "";
    state.summary = "";
    state.codexReviewEnabled = false;
    state.bodyScrollTop = 0;
    state.treeScrollTop = 0;
    state.previewScrollTop = 0;
    state.previewScrollLeft = 0;
    state.renderedViewKey = "";
    state.renderedTreeCategory = "";
    state.renderedPreviewPath = "";
    state.humanReviewed = false;
    state.riskAcknowledged = false;
    state.overlapAcknowledged = false;
  }

  async function reloadLatestSvnSelection() {
    const state = svnModalState;
    if (!state || state.busy) return;
    resetSvnSelectionForReload(state);
    syncConversationFloatSvnStatus(null);
    await loadSvnReviewContext({ resumeReview: false });
  }

  async function restartSvnReviewFromLatest() {
    const state = svnModalState;
    const review = state?.review;
    if (!state || !review || state.busy) return;
    if (!window.confirm(
      "将放弃面板中的当前审核草稿，并重新读取 SVN 工作副本的最新文件状态。"
      + "\n\n此操作不会撤销或修改 Jira、SVN 中已经提交的内容。确定继续吗？"
    )) return;
    state.busy = true;
    state.error = "";
    renderSvnReviewModal();
    try {
      await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/abandon`, {
        method: "POST",
        body: {
          acknowledged: true,
          message: "用户放弃当前审核草稿，并要求重新扫描 SVN 最新文件状态。"
        }
      });
      if (svnModalState !== state) return;
      state.busy = false;
      resetSvnSelectionForReload(state);
      syncConversationFloatSvnStatus(null);
      await loadSvnReviewContext({ resumeReview: false });
    } catch (error) {
      if (svnModalState !== state) return;
      state.busy = false;
      state.error = `无法返回文件选择：${error.message || error}`;
      renderSvnReviewModal();
    }
  }

  async function abandonSvnReview() {
    const state = svnModalState;
    const review = state?.review;
    if (!state || !review || state.busy) return;
    if (!window.confirm("仅当你已人工查看 SVN 日志并确认仓库实际状态后，才应放弃此草稿。确定继续吗？")) return;
    state.busy = true;
    state.error = "";
    renderSvnReviewModal();
    try {
      await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/abandon`, {
        method: "POST",
        body: { acknowledged: true, message: "已人工核对 SVN 仓库状态，放弃该异常提交草稿。" }
      });
      if (svnModalState !== state) return;
      state.busy = false;
      resetSvnSelectionForReload(state);
      syncConversationFloatSvnStatus(null);
      await loadSvnReviewContext({ resumeReview: false });
    } catch (error) {
      if (svnModalState !== state) return;
      state.busy = false;
      state.error = `无法放弃草稿：${error.message || error}`;
      renderSvnReviewModal();
    }
  }

  async function confirmAndCommitSvnReview() {
    const state = svnModalState;
    const review = state?.review;
    if (!state || !review || state.busy || !svnHumanConfirmationReady(state)) return;
    state.busy = true;
    state.error = "";
    renderSvnReviewModal();
    try {
      const confirmation = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/confirm`, {
        method: "POST",
        body: {
          issueKey: state.issueKey,
          reviewed: state.humanReviewed,
          riskAcknowledged: state.riskAcknowledged,
          overlapAcknowledged: state.overlapAcknowledged
        }
      });
      const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}/commit`, {
        method: "POST",
        body: {
          issueKey: state.issueKey,
          confirmationToken: confirmation.confirmationToken
        }
      });
      if (svnModalState !== state) return;
      state.review = payload.review;
      syncConversationFloatSvnStatus(payload.review);
      state.busy = false;
      renderSvnReviewModal();
    } catch (error) {
      if (svnModalState !== state) return;
      state.busy = false;
      state.error = `SVN 提交未完成：${error.message || error}`;
      try {
        const payload = await panelJson(`/api/svn/reviews/${encodeURIComponent(review.id)}`);
        if (svnModalState === state) {
          state.review = payload.review;
          syncConversationFloatSvnStatus(payload.review);
        }
      } catch {}
      renderSvnReviewModal();
    }
  }

  async function loadSvnReviewContext({ resumeReview = true } = {}) {
    const state = svnModalState;
    if (!state) return;
    const preservedSelection = new Set(
      state.selectionInitialized
        ? state.selectedPaths
        : Array.isArray(state.review?.selectedPaths) ? state.review.selectedPaths : []
    );
    const preserveSelection = state.selectionInitialized || preservedSelection.size > 0;
    if (svnReviewPollTimer) window.clearInterval(svnReviewPollTimer);
    svnReviewPollTimer = null;
    state.loading = true;
    state.busy = false;
    state.error = "";
    state.review = null;
    state.context = null;
    state.previewRequestId += 1;
    state.previewLoading = false;
    state.previewError = "";
    state.preview = null;
    state.humanReviewed = false;
    state.riskAcknowledged = false;
    state.overlapAcknowledged = false;
    renderSvnReviewModal();
    try {
      const payload = await panelJson(
        `/api/svn/context?threadId=${encodeURIComponent(state.threadId)}`
        + `&issueKey=${encodeURIComponent(state.issueKey)}`
        + `&includeReview=${resumeReview ? "1" : "0"}`
      );
      if (svnModalState !== state) return;
      state.loading = false;
      state.context = payload.context;
      state.messageBase = payload.message || "";
      state.commitHistory = Array.isArray(payload.history) ? payload.history : [];
      state.review = payload.review || null;
      syncConversationFloatSvnStatus(state.review);
      if (state.review) state.codexReviewEnabled = state.review.codexReviewEnabled !== false;
      const eligibleChanges = state.context.changes.filter(svnChangeSelectable);
      const eligiblePaths = new Set(eligibleChanges.map((change) => change.path));
      state.recommendedPaths = new Set(
        eligibleChanges.filter((change) => change.recommended).map((change) => change.path)
      );
      state.selectedPaths = preserveSelection
        ? new Set(Array.from(preservedSelection).filter((path) => eligiblePaths.has(path)))
        : new Set(state.recommendedPaths);
      state.selectionInitialized = true;
      state.selectionAdjusted = Array.from(state.selectedPaths).some((path) => !state.recommendedPaths.has(path))
        || Array.from(state.recommendedPaths).some((path) => !state.selectedPaths.has(path));
      const previewChange = state.context.changes.find((change) => change.path === state.previewPath)
        || eligibleChanges.find((change) => state.recommendedPaths.has(change.path))
        || eligibleChanges[0]
        || state.context.changes[0]
        || null;
      state.previewPath = previewChange?.path || "";
      renderSvnReviewModal();
      if (["prepared", "dispatching", "running"].includes(state.review?.status)) startSvnReviewPolling(state.review.id);
      if (!state.review && previewChange) void loadSvnDiffPreview(previewChange);
    } catch (error) {
      if (svnModalState !== state) return;
      state.loading = false;
      state.error = `无法读取 SVN 工作副本：${error.message || error}`;
      renderSvnReviewModal();
    }
  }

  async function openSvnReviewModal() {
    const floatState = conversationFloatState;
    if (!floatState?.issue || !floatState.threadId) return;
    if (isProvisionalCodexThreadId(floatState.binding?.threadId || floatState.threadId)) {
      const resolvedBinding = await reconcileIssueBinding(floatState.issueKey, {
        activeThreadId: activeThreadIds()[0] || "",
        retry: true
      });
      if (conversationFloatState !== floatState) return;
      if (resolvedBinding) {
        floatState.binding = resolvedBinding;
        floatState.threadId = resolvedBinding.threadId;
      }
    }
    removeSvnReviewModal();
    svnModalState = {
      threadId: floatState.threadId,
      issueKey: floatState.issueKey,
      issue: floatState.issue,
      loading: true,
      busy: false,
      error: "",
      context: null,
      messageBase: "",
      summary: "",
      selectedPaths: new Set(),
      recommendedPaths: new Set(),
      selectionInitialized: false,
      selectionAdjusted: false,
      svnCategory: "reviewable",
      expandedPaths: new Set(),
      treeExpansionInitialized: false,
      previewPath: "",
      previewLoading: false,
      previewError: "",
      preview: null,
      previewRequestId: 0,
      externalDiffBusy: false,
      review: null,
      commitHistory: [],
      codexReviewEnabled: false,
      bodyScrollTop: 0,
      treeScrollTop: 0,
      previewScrollTop: 0,
      previewScrollLeft: 0,
      renderedViewKey: "",
      renderedTreeCategory: "",
      renderedPreviewPath: "",
      humanReviewed: false,
      riskAcknowledged: false,
      overlapAcknowledged: false
    };
    if (isProvisionalCodexThreadId(svnModalState.threadId)) {
      svnModalState.loading = false;
      svnModalState.error = "Codex 尚未返回该新对话的正式会话 ID，请稍后重试或重新打开该对话。";
      renderSvnReviewModal();
      return;
    }
    renderSvnReviewModal();
    await loadSvnReviewContext();
  }

  function ensureConversationIssueFloat() {
    if (active) {
      if (conversationFloat) conversationFloat.hidden = true;
      return false;
    }
    const activeThreadId = activeThreadIds()[0] || "";
    const match = conversationBindingForThread(activeThreadId)
      || conversationBindingFromHint(activeThreadId);
    if (!activeThreadId || !match) {
      removeSvnReviewModal();
      removeConversationIssueFloat();
      return false;
    }
    if (isProvisionalCodexThreadId(match.binding?.threadId)) {
      void reconcileIssueBinding(match.issueKey, { activeThreadId, retry: true });
    } else if (match.binding?.pendingFinalization) {
      void completeResolvedBindingFinalization(match.issueKey, match.binding);
    }
    const threadId = String(match.binding?.threadId || activeThreadId);
    if (conversationFloatState?.threadId === threadId
      && conversationFloatState?.issueKey === match.issueKey) {
      conversationFloatState.binding = match.binding;
      if (conversationFloat) conversationFloat.hidden = false;
      return true;
    }
    removeSvnReviewModal();
    conversationFloatRequestId += 1;
    conversationFloatState = {
      threadId,
      issueKey: match.issueKey,
      binding: match.binding,
      issue: null,
      transitions: [],
      selectedTransitionId: "",
      loading: true,
      refreshing: false,
      transitioning: false,
      error: "",
      transitionError: "",
      notice: "",
      svnReviewStatus: ""
    };
    renderConversationIssueFloat();
    void refreshConversationIssueFloat();
    return true;
  }

  function isNewConversationHeaderVisible() {
    const surfaces = document.querySelectorAll(
      '[data-testid="app-shell-header-context-menu-surface"], main header, main h1, main h2'
    );
    return Array.from(surfaces).some((surface) => {
      if (!isVisibleElement(surface)) return false;
      const text = normalizedLabel(surface.textContent);
      return newChatLabels.some((label) => text === label || text.startsWith(`${label} `));
    });
  }

  function insertComposerText(prompt) {
    const composer = findVisibleComposer();
    const input = composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
      ? composer
      : null;
    if (input) {
      input.focus();
      setNativeInputValue(input, prompt);
      return input;
    }
    const editor = composer;
    if (!editor) return null;
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.deleteContents();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, prompt);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    return editor;
  }

  function findComposerSendButton(composerInput) {
    const composerSurface = composerInput?.closest?.(".composer-surface-chrome");
    const surfaceButton = Array.from(composerSurface?.querySelectorAll("button") || [])
      .find((button) => buttonMatches(button, sendLabels) && !button.disabled && isVisibleElement(button));
    if (surfaceButton) return surfaceButton;
    let scope = composerInput;
    while (scope && scope !== document.body) {
      const sendButton = Array.from(scope.querySelectorAll?.("button") || [])
        .find((button) => buttonMatches(button, sendLabels) && !button.disabled && isVisibleElement(button));
      if (sendButton) return sendButton;
      scope = scope.parentElement;
    }
    return null;
  }

  function decodeBridgeJson(response) {
    const binary = window.atob(String(response?.bodyBase64 || ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const body = new TextDecoder().decode(bytes);
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      throw new Error("本地附件服务返回了无法解析的响应。");
    }
    if (Number(response?.status || 0) < 200 || Number(response?.status || 0) >= 300) {
      throw new Error(payload.error || `本地附件服务请求失败（HTTP ${response?.status || 0}）。`);
    }
    return payload;
  }

  function attachmentMaterializeUrl(attachment) {
    const fallback = `/api/attachments/${encodeURIComponent(String(attachment?.id || ""))}`;
    const url = new URL(String(attachment?.downloadUrl || fallback), PANEL_URL);
    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/materialize`;
    return url.href;
  }

  async function materializeIssueAttachments(issue) {
    const attachments = Array.isArray(issue?.attachments) ? issue.attachments : [];
    return Promise.all(attachments.map(async (attachment) => {
      const response = await hostFetch({ method: "GET", url: attachmentMaterializeUrl(attachment) });
      const materialized = decodeBridgeJson(response).attachment;
      if (!materialized?.path) {
        throw new Error(`附件“${attachment.filename || attachment.id || "未命名附件"}”没有可用的本地文件。`);
      }
      return materialized;
    }));
  }

  function composerAttachmentCount(composerInput) {
    const scope = composerInput?.closest?.(".composer-surface-chrome") || composerInput?.parentElement || document;
    const rows = Array.from(scope.querySelectorAll?.("[data-composer-attachments-row]") || []);
    const rowCount = rows.reduce((total, row) => total + (row.firstElementChild?.children.length || 0), 0);
    const inlineCount = Array.from(scope.querySelectorAll?.("[data-composer-attachment-pill]") || [])
      .filter((pill) => !pill.closest("[data-composer-attachments-row]"))
      .length;
    return rowCount + inlineCount;
  }

  async function attachLocalFilesToComposer(composerInput, attachments) {
    const input = document.createElement("input");
    input.id = `jira-codex-attachment-input-${crypto.randomUUID()}`;
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    const filesReady = new Promise((resolve, reject) => {
      input.addEventListener("change", () => {
        try {
          const files = Array.from(input.files || []);
          if (files.length !== attachments.length) {
            throw new Error(`Codex 只读取到 ${files.length}/${attachments.length} 个附件。`);
          }
          const transfer = new DataTransfer();
          for (const file of files) transfer.items.add(file);
          let event;
          try {
            event = new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              composed: true,
              clipboardData: transfer
            });
          } catch {
            event = new Event("paste", { bubbles: true, cancelable: true, composed: true });
            Object.defineProperty(event, "clipboardData", { value: transfer });
          }
          composerInput.dispatchEvent(event);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, { once: true });
    });
    document.body.append(input);
    try {
      const [response] = await Promise.all([
        hostBridgeRequest({
          action: "attach-files",
          inputId: input.id,
          paths: attachments.map((attachment) => attachment.path)
        }),
        filesReady
      ]);
      decodeBridgeJson(response);
    } finally {
      input.remove();
    }
  }

  function waitForComposerAttachments(composerInput, minimumCount, timeoutMs = 8_000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (composerAttachmentCount(composerInput) >= minimumCount) {
          window.clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - startedAt < timeoutMs) return;
        window.clearInterval(timer);
        reject(new Error("Codex 未确认接收全部附件。"));
      }, 100);
    });
  }

  function waitForComposerSendButton(composerInput, timeoutMs = 6_000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const sendButton = findComposerSendButton(composerInput);
        if (sendButton) {
          window.clearInterval(timer);
          resolve(sendButton);
          return;
        }
        if (Date.now() - startedAt < timeoutMs) return;
        window.clearInterval(timer);
        reject(new Error("Codex 发送按钮未就绪。"));
      }, 100);
    });
  }

  async function attachAndSubmitComposerPrompt(composerInput, issue) {
    try {
      const attachments = Array.isArray(issue?.attachments) ? issue.attachments : [];
      if (attachments.length) {
        const baselineCount = composerAttachmentCount(composerInput);
        const materialized = await materializeIssueAttachments(issue);
        await attachLocalFilesToComposer(composerInput, materialized);
        await waitForComposerAttachments(composerInput, baselineCount + materialized.length);
      }
      const sendButton = await waitForComposerSendButton(composerInput);
      sendButton.click();
    } catch (error) {
      window.localStorage.removeItem(PENDING_BINDING_KEY);
      if (issue?.__jiraCodexAutomated) {
        void reportAutomationFailure(issue.key, `首条分析消息未发送：${error.message || error}`);
      }
      openPanel();
      sendPanelMessage("binding-error", {
        message: `首条分析消息未发送：${error.message || error} 请确认 Jira 附件仍可访问后重试。`
      });
    }
  }

  function sendComposerPrompt(prompt, { threadId = "", issue = null } = {}) {
    const message = String(prompt || "").trim();
    if (!message) {
      if (issue?.__jiraCodexAutomated) void reportAutomationFailure(issue.key, "首条分析消息为空。");
      openPanel();
      sendPanelMessage("binding-error", { message: "首条分析消息为空，请先在 Jira 设置中配置消息模板。" });
      return;
    }
    let attempts = 0;
    let composerInput = null;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (threadId) {
        const target = threadRows().find((row) => row.getAttribute("data-app-action-sidebar-thread-id") === threadId);
        if (!target || target.getAttribute("data-app-action-sidebar-thread-active") !== "true") {
          if (attempts < 40) return;
          window.clearInterval(timer);
          if (issue?.__jiraCodexAutomated) {
            void reportAutomationFailure(issue.key, "无法确认自动创建的目标对话已经打开。");
          }
          openPanel();
          sendPanelMessage("binding-error", { message: "已完成会话绑定，但无法确认目标对话已打开，因此没有自动发送消息。" });
          return;
        }
      }
      if (!composerInput) composerInput = insertComposerText(message);
      if (composerInput) {
        window.clearInterval(timer);
        void attachAndSubmitComposerPrompt(composerInput, issue);
        return;
      }
      if (attempts >= 40) {
        window.clearInterval(timer);
        window.localStorage.removeItem(PENDING_BINDING_KEY);
        if (issue?.__jiraCodexAutomated) {
          void reportAutomationFailure(issue.key, "未能自动发送首条分析消息。");
        }
        openPanel();
        sendPanelMessage("binding-error", { message: "未能自动发送首条分析消息，请检查 Codex 输入区后重试。" });
      }
    }, 150);
  }

  function prepareNewConversationAndSend(prompt, {
    projectId = "",
    issue = null,
    previousComposer = null,
    previousActiveThreadIds = []
  } = {}) {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const composer = findVisibleComposer();
      const currentActiveIds = new Set(activeThreadIds());
      const leftPreviousConversation = previousActiveThreadIds.length === 0
        ? attempts >= 3
        : previousActiveThreadIds.every((threadId) => !currentActiveIds.has(threadId));
      const composerReplaced = Boolean(composer && composer !== previousComposer);
      const navigationReady = leftPreviousConversation || composerReplaced || isNewConversationHeaderVisible();
      if (!composer || !navigationReady) {
        if (attempts < 40) return;
      } else if (!projectId) {
        const clearProject = document.querySelector('[data-clear-project-button="true"]');
        if (clearProject) {
          clearProject.click();
          return;
        }
      }
      window.clearInterval(timer);
      if (!composer || !navigationReady) {
        window.localStorage.removeItem(PENDING_BINDING_KEY);
        if (issue?.__jiraCodexAutomated) {
          void reportAutomationFailure(issue.key, "Codex 未能切换到自动创建的新对话。");
        }
        openPanel();
        sendPanelMessage("binding-error", { message: "Codex 未能切换到新对话，因此没有写入或发送分析消息；原绑定保持不变。" });
        return;
      }
      sendComposerPrompt(prompt, { issue });
    }, 150);
  }

  function startIssue(issue, prompt, projectId = "", { automated = false, monitorGeneration = 0 } = {}) {
    const knownThreadIds = threadRows()
      .map((row) => row.getAttribute("data-app-action-sidebar-thread-id"))
      .filter(Boolean);
    const normalizedProjectId = String(projectId || "").trim();
    const previousComposer = findVisibleComposer();
    const previousActiveThreadIds = activeThreadIds();
    let newChat;
    if (normalizedProjectId) {
      const projectRow = Array.from(document.querySelectorAll("[data-app-action-sidebar-project-id]"))
        .find((row) => row.getAttribute("data-app-action-sidebar-project-id") === normalizedProjectId);
      newChat = Array.from(projectRow?.querySelectorAll("button") || []).find((button) => (
        button.getAttribute("aria-hidden") !== "true" && !button.hasAttribute("aria-haspopup")
      ));
      if (!projectRow || !newChat) {
        if (automated) void reportAutomationFailure(issue.key, "绑定的 Codex 项目当前不可用。");
        sendPanelMessage("binding-error", { message: "绑定的 Codex 项目当前不可用，请在 Jira 设置中重新选择项目。" });
        return;
      }
    } else {
      const buttons = Array.from(document.querySelectorAll("button"));
      newChat = buttons.find((button) => buttonMatches(button, newChatLabels));
    }
    if (!newChat) {
      if (automated) void reportAutomationFailure(issue.key, "未找到 Codex 新对话入口。");
      sendPanelMessage("binding-error", { message: "未找到 Codex 新对话入口，请刷新 Codex 后重试。" });
      return;
    }
    const pendingSaved = writeStoredObject(PENDING_BINDING_KEY, {
      issueKey: issue.key,
      issueTitle: issue.title,
      issueUrl: issue.url || "",
      issueStatus: issue.statusName || issue.status || "",
      issueAssignee: issue.assignee || "",
      automated,
      monitorGeneration,
      captureSvnBaseline: true,
      knownThreadIds,
      startedAt: Date.now()
    });
    if (!pendingSaved) {
      if (automated) void reportAutomationFailure(issue.key, "无法保存本地会话绑定。");
      sendPanelMessage("binding-error", { message: "无法保存本地会话绑定，请检查 Codex 本地存储。" });
      return;
    }
    closePanel();
    newChat.click();
    prepareNewConversationAndSend(prompt, {
      projectId: normalizedProjectId,
      issue: automated ? { ...issue, __jiraCodexAutomated: true } : issue,
      previousComposer,
      previousActiveThreadIds
    });
  }

  async function openIssueConversation(issue, prompt, projectId) {
    const binding = readBindings()[issue.key];
    if (!binding?.threadId) {
      startIssue(issue, prompt, projectId);
      return;
    }
    const thread = threadRows().find((row) => (
      bindingMatchesThread(binding, row.getAttribute("data-app-action-sidebar-thread-id"))
    ));
    setConversationThreadHint(issue.key, binding);
    if (thread) {
      closePanel();
      thread.click();
      return;
    }
    closePanel();
    try {
      await navigateCodexThread(binding.threadId);
    } catch (error) {
      clearConversationThreadHint();
      openPanel();
      sendPanelMessage("binding-error", {
        message: `无法按会话 ID 打开已绑定的 Codex 对话“${binding.threadTitle || issue.key}”：${error.message || error}。可以点击“重新绑定对话”修正绑定。`
      });
    }
  }

  function bindIssueToThread(issue, threadId) {
    const normalizedThreadId = String(threadId || "").trim();
    const thread = threadRows().find((row) => (
      row.getAttribute("data-app-action-sidebar-thread-id") === normalizedThreadId
    ));
    if (!thread) {
      sendPanelMessage("binding-error", { message: "当前 Codex 侧栏中未找到指定会话 ID，旧绑定未被修改。" });
      return;
    }
    const bindings = readBindings();
    bindings[issue.key] = {
      threadId: normalizedThreadId,
      uiThreadId: isProvisionalCodexThreadId(normalizedThreadId) ? normalizedThreadId : "",
      threadTitle: thread.getAttribute("data-app-action-sidebar-thread-title") || issue.title || issue.key,
      issueTitle: issue.title || "",
      boundAt: new Date().toISOString()
    };
    if (!writeStoredObject(BINDINGS_KEY, bindings)) {
      sendPanelMessage("binding-error", { message: "无法保存新的会话绑定，旧绑定未被修改。" });
      return;
    }
    setConversationThreadHint(issue.key, bindings[issue.key]);
    sendBindings();
    closePanel();
    thread.click();
    if (isProvisionalCodexThreadId(normalizedThreadId)) {
      window.setTimeout(() => void reconcileIssueBinding(issue.key, {
        activeThreadId: normalizedThreadId,
        retry: true
      }), 0);
    }
    window.setTimeout(ensureConversationIssueFloat, 0);
  }

  function readBugMonitorState() {
    const stored = readStoredObject(BUG_MONITOR_STATE_KEY);
    return {
      generation: Math.max(0, Number(stored.generation || 0)),
      seen: Array.isArray(stored.seen) ? stored.seen.map(String) : [],
      queue: Array.isArray(stored.queue) ? stored.queue.map(String) : [],
      activeIssueKey: String(stored.activeIssueKey || ""),
      activeStartedAt: Math.max(0, Number(stored.activeStartedAt || 0)),
      initializedAt: Math.max(0, Number(stored.initializedAt || 0))
    };
  }

  function saveBugMonitorState(state) {
    const seen = Array.from(new Set(state.seen || [])).slice(-1_000);
    const queue = Array.from(new Set(state.queue || [])).slice(0, 100);
    return writeStoredObject(BUG_MONITOR_STATE_KEY, { ...state, seen, queue });
  }

  function activeBugIssues(issues) {
    return (Array.isArray(issues) ? issues : []).filter((issue) => (
      issue?.type === "bug" && ["todo", "in_progress"].includes(issue.status)
    ));
  }

  function sendAutomationStatus(automation, extra = {}) {
    sendPanelMessage("automation-status", { automation, ...extra });
  }

  async function runBugMonitor() {
    if (bugMonitorRunning) return;
    bugMonitorRunning = true;
    try {
      const { config } = await panelJson("/api/config");
      if (!config?.configured || !config.bugMonitorEnabled) return;

      const [issuePayload, automation] = await Promise.all([
        panelJson("/api/issues"),
        panelJson("/api/automation/status")
      ]);
      const bugs = activeBugIssues(issuePayload.issues);
      const issueByKey = new Map(bugs.map((issue) => [issue.key, issue]));
      const generation = Math.max(0, Number(config.monitorGeneration || 0));
      let monitor = readBugMonitorState();

      if (monitor.generation !== generation || !monitor.initializedAt) {
        monitor = {
          generation,
          seen: bugs.map((issue) => issue.key),
          queue: bugs.map((issue) => issue.key),
          activeIssueKey: "",
          activeStartedAt: 0,
          initializedAt: Date.now()
        };
        saveBugMonitorState(monitor);
        sendAutomationStatus(automation, {
          monitorEvent: "initialized",
          message: bugs.length
            ? `已将当前 ${bugs.length} 个待修复 Bug 加入自动分析队列。`
            : "当前没有待修复 Bug，之后出现的 Bug 将自动分析。"
        });
      }

      if (monitor.activeIssueKey) {
        const activeServerJob = automation.activeJob?.issueKey === monitor.activeIssueKey
          ? automation.activeJob
          : null;
        if (activeServerJob) {
          sendAutomationStatus(automation);
          return;
        }
        const completedJob = (automation.recentJobs || []).find((job) => (
          job.issueKey === monitor.activeIssueKey && job.status !== "running"
        ));
        const pending = readStoredObject(PENDING_BINDING_KEY);
        if (!completedJob && pending.issueKey === monitor.activeIssueKey) return;
        if (!completedJob && Date.now() - monitor.activeStartedAt < 2 * 60 * 1000) return;
        if (!completedJob) {
          await reportAutomationFailure(monitor.activeIssueKey, "自动创建会话超时，未能开始结果跟踪。");
        }
        monitor.activeIssueKey = "";
        monitor.activeStartedAt = 0;
      }

      const seen = new Set(monitor.seen);
      for (const issue of bugs) {
        if (seen.has(issue.key)) continue;
        seen.add(issue.key);
        monitor.queue.push(issue.key);
      }
      monitor.seen = Array.from(seen);
      saveBugMonitorState(monitor);

      if (automation.busy) {
        sendAutomationStatus(automation);
        return;
      }

      while (monitor.queue.length) {
        const issueKey = monitor.queue.shift();
        const issue = issueByKey.get(issueKey);
        if (
          !issue
          || readBindings()[issueKey]?.threadId
          || (automation.knownIssueKeys || []).includes(issueKey)
        ) continue;
        monitor.activeIssueKey = issueKey;
        monitor.activeStartedAt = Date.now();
        saveBugMonitorState(monitor);
        const prompt = buildIssuePrompt(issue, {
          messageTemplate: config.messageTemplate,
          projectId: config.codexProjectId,
          projectLabel: config.codexProjectLabel
        });
        startIssue(issue, prompt, config.codexProjectId, {
          automated: true,
          monitorGeneration: generation
        });
        sendAutomationStatus(automation, {
          monitorEvent: "started",
          message: `已为 ${issueKey} 自动创建分析对话。`,
          pendingIssueKey: issueKey
        });
        return;
      }
      saveBugMonitorState(monitor);
      sendAutomationStatus(automation);
    } catch (error) {
      sendPanelMessage("automation-error", {
        message: `Bug 自动监控暂时失败：${error.message || error}`
      });
    } finally {
      bugMonitorRunning = false;
    }
  }

  function onMessage(event) {
    if (event.source !== frame?.contentWindow) return;
    if (!EMBEDDED_PANEL && event.origin !== PANEL_ORIGIN) return;
    const message = event.data;
    if (!message || message.source !== "jira-codex-panel-poc") return;
    if (message.type === "close") closePanel();
    if (message.type === "get-bindings" || message.type === "ready") sendBindings();
    if (message.type === "open-task" && message.issue) {
      openIssueConversation(message.issue, message.prompt, message.projectId);
    }
    if (message.type === "bind-task" && message.issue) bindIssueToThread(message.issue, message.threadId);
    if (message.type === "rebind-new-task" && message.issue) {
      startIssue(message.issue, message.prompt, message.projectId);
    }
    if (message.type === "automation-settings-changed") void runBugMonitor();
  }

  function isNativeSidebarNavigation(target) {
    const clickable = target?.closest?.(
      "button, a, [role='button'], [data-app-action-sidebar-thread-id],"
      + "[data-app-action-sidebar-project-row], [data-app-action-sidebar-project-id]"
    );
    if (!clickable || clickable === entry || clickable.closest(`#${ENTRY_ID}`)) return false;
    if (!clickable.closest("aside nav[role='navigation']")) return false;
    if (clickable.hasAttribute("data-app-action-sidebar-section-toggle")
      || clickable.closest("[data-app-action-sidebar-section-toggle]")) return false;
    if (buttonMatches(clickable, nativePageLabels)) return true;
    return Boolean(clickable.closest(
      "[data-app-action-sidebar-thread-id],"
      + "[data-app-action-sidebar-project-row],"
      + "[data-app-action-sidebar-project-id]"
    ));
  }

  function onDocumentClick(event) {
    const clickedEntry = event.target?.closest?.(`#${ENTRY_ID}`);
    if (clickedEntry) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openPanel();
      return;
    }
    if (!isNativeSidebarNavigation(event.target)) return;
    const clickedThreadId = event.target?.closest?.("[data-app-action-sidebar-thread-id]")
      ?.getAttribute("data-app-action-sidebar-thread-id");
    const keepsDirectHint = conversationThreadHint
      && clickedThreadId
      && bindingMatchesThread(conversationThreadHint.binding, clickedThreadId);
    const keepsObservedHint = !keepsDirectHint && clickedThreadId
      ? Boolean(conversationBindingFromHint(clickedThreadId))
      : false;
    const keepsHint = keepsDirectHint || keepsObservedHint;
    if (!keepsHint) clearConversationThreadHint();
    if (active) closePanel();
    window.setTimeout(ensureConversationIssueFloat, 0);
  }

  function onDocumentPointerDown(event) {
    const clickedEntry = event.target?.closest?.(`#${ENTRY_ID}`);
    if (!clickedEntry) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openPanel();
  }

  function ensure() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      tryBindPendingIssue();
      ensureEntry();
      if (active) mountActivePage();
      ensureConversationIssueFloat();
      syncCodexTheme();
    });
  }

  function state() {
    return {
      version: VERSION,
      entryMounted: Boolean(document.getElementById(ENTRY_ID)),
      panelMounted: Boolean(document.getElementById(PAGE_ID)),
      conversationFloatMounted: Boolean(document.getElementById(CONVERSATION_FLOAT_ID)),
      svnModalMounted: Boolean(document.getElementById(SVN_MODAL_ID)),
      conversationIssueKey: conversationFloatState?.issueKey || "",
      conversationHintIssueKey: conversationThreadHint?.issueKey || "",
      conversationHintObserved: Boolean(conversationThreadHint?.observedThreadId),
      conversationAliasCount: conversationThreadAliases.size,
      bindingResolution: lastBindingResolution,
      theme: codexThemeName(),
      active
    };
  }

  function destroy() {
    observer?.disconnect();
    themeObserver?.disconnect();
    if (bindingTimer) window.clearInterval(bindingTimer);
    if (bugMonitorTimer) window.clearInterval(bugMonitorTimer);
    window.removeEventListener("message", onMessage);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("click", onDocumentClick, true);
    closePanel();
    removeSvnReviewModal();
    removeConversationIssueFloat();
    document.getElementById(ENTRY_ID)?.remove();
    document.getElementById(PAGE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    for (const pending of bridgeRequests.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("Jira 面板已重新加载。"));
    }
    bridgeRequests.clear();
    delete window.__jiraCodexResolveHostFetch;
    delete window.__jiraCodexHostFetch;
    delete window.__jiraCodexPoc;
  }

  window.addEventListener("message", onMessage);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("click", onDocumentClick, true);
  observer = new MutationObserver(ensure);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-app-action-sidebar-thread-active"]
  });
  themeObserver = new MutationObserver(() => syncCodexTheme());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"]
  });
  bindingTimer = window.setInterval(() => {
    tryBindPendingIssue();
    ensureConversationIssueFloat();
  }, 500);
  bugMonitorTimer = window.setInterval(() => void runBugMonitor(), BUG_MONITOR_INTERVAL_MS);
  window.__jiraCodexPoc = { version: VERSION, ensure, open: openPanel, close: closePanel, state, destroy };
  ensure();
  window.setTimeout(() => void runBugMonitor(), 1_500);
  return state();
})();
