(() => {
  const VERSION = "0.18.0";
  const ENTRY_ID = "jira-codex-poc-entry";
  const PAGE_ID = "jira-codex-poc-page";
  const STYLE_ID = "jira-codex-poc-style";
  const CONVERSATION_FLOAT_ID = "jira-codex-conversation-float";
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
  let bindingTimer = null;
  let bugMonitorTimer = null;
  let bugMonitorRunning = false;
  let conversationFloat = null;
  let conversationFloatRequestId = 0;
  let conversationFloatState = null;
  let conversationThreadHint = null;
  let scheduled = false;
  let bridgeSequence = 0;
  const bridgeRequests = new Map();
  const collapsedConversationThreads = new Set();
  const conversationThreadAliases = new Map();

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

  window.__jiraCodexResolveHostFetch = resolveHostFetch;
  window.__jiraCodexHostFetch = hostFetch;

  function sendBindings() {
    sendPanelMessage("bindings", {
      bindings: readBindings(),
      threads: availableThreads(),
      projects: availableProjects()
    });
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
      threadTitle: thread.getAttribute("data-app-action-sidebar-thread-title") || pending.issueTitle || pending.issueKey,
      issueTitle: pending.issueTitle || "",
      boundAt: new Date().toISOString()
    };
    if (!writeStoredObject(BINDINGS_KEY, bindings)) return false;
    window.localStorage.removeItem(PENDING_BINDING_KEY);
    if (pending.automated) void registerAutomatedBinding(pending, bindings[pending.issueKey]);
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
      #${PAGE_ID} { position: absolute; inset: 0; z-index: 1; background: #f7f7f5; pointer-events: auto; }
      #${PAGE_ID}[hidden] { display: none !important; }
      #${PAGE_ID} iframe { display: block; width: 100%; height: 100%; border: 0; background: #f7f7f5; }
      #${ENTRY_ID}[aria-current="page"] { background: var(--color-token-sidebar-surface-secondary, rgba(0,0,0,.06)); }
      #${CONVERSATION_FLOAT_ID} {
        position: fixed;
        top: 66px;
        right: 16px;
        z-index: 30;
        width: min(370px, calc(100vw - 32px));
        max-height: calc(100vh - 148px);
        color: #202124;
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
        border: 1px solid rgba(25, 28, 33, .14);
        border-radius: 14px;
        background: rgba(255, 255, 255, .97);
        box-shadow: 0 16px 44px rgba(18, 22, 29, .18), 0 2px 8px rgba(18, 22, 29, .08);
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
        border-bottom: 1px solid rgba(25, 28, 33, .09);
      }
      .jira-codex-float-type {
        flex: 0 0 auto;
        padding: 2px 6px;
        border-radius: 6px;
        color: #3157b7;
        background: #edf2ff;
        font-size: 11px;
        font-weight: 700;
      }
      .jira-codex-float-type[data-type="bug"] { color: #b33b32; background: #fff0ed; }
      .jira-codex-float-key { min-width: 0; color: #687080; font-size: 12px; font-weight: 700; }
      .jira-codex-float-actions { margin-left: auto; gap: 4px; }
      .jira-codex-float-icon-button,
      .jira-codex-float-button,
      .jira-codex-float-collapsed-button {
        border: 1px solid rgba(25, 28, 33, .13);
        color: #34383f;
        background: #fff;
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
      .jira-codex-float-collapsed-button:hover { background: #f3f4f6; }
      .jira-codex-float-body { min-height: 0; padding: 14px; overflow: auto; overscroll-behavior: contain; }
      .jira-codex-float-title { margin: 0 0 10px; font-size: 16px; line-height: 1.4; font-weight: 700; }
      .jira-codex-float-status {
        display: inline-flex;
        max-width: 100%;
        margin-bottom: 12px;
        padding: 3px 8px;
        overflow: hidden;
        border-radius: 999px;
        color: #3157b7;
        background: #edf2ff;
        font-size: 12px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jira-codex-float-section { margin-top: 14px; }
      .jira-codex-float-section-title { margin: 0 0 6px; color: #737b89; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
      .jira-codex-float-description {
        max-height: 142px;
        margin: 0;
        padding: 10px;
        overflow: auto;
        border-radius: 9px;
        color: #41464e;
        background: #f6f7f8;
        white-space: pre-wrap;
      }
      .jira-codex-float-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 12px; }
      .jira-codex-float-meta-row { min-width: 0; align-items: flex-start; gap: 6px; }
      .jira-codex-float-meta-label { flex: 0 0 auto; color: #878e99; }
      .jira-codex-float-meta-value { min-width: 0; overflow: hidden; color: #41464e; text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-float-chip-list { display: flex; flex-wrap: wrap; gap: 5px; }
      .jira-codex-float-chip { padding: 2px 7px; border: 1px solid #e2e5e9; border-radius: 999px; color: #4d5560; background: #fafafa; font-size: 12px; }
      .jira-codex-float-attachments { display: grid; gap: 6px; }
      .jira-codex-float-attachment {
        min-width: 0;
        gap: 8px;
        padding: 7px 9px;
        border: 1px solid #e5e7ea;
        border-radius: 8px;
        color: #3a4452;
        text-decoration: none;
      }
      .jira-codex-float-attachment:hover { background: #f7f8fa; }
      .jira-codex-float-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-float-attachment-size { flex: 0 0 auto; margin-left: auto; color: #949aa4; font-size: 11px; }
      .jira-codex-float-transition-row { align-items: stretch; gap: 7px; }
      .jira-codex-float-select {
        min-width: 0;
        flex: 1;
        height: 34px;
        padding: 0 8px;
        border: 1px solid #d9dde3;
        border-radius: 8px;
        color: #34383f;
        background: #fff;
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
        border-top: 1px solid rgba(25, 28, 33, .09);
      }
      .jira-codex-float-thread { min-width: 0; flex: 1; overflow: hidden; color: #878e99; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .jira-codex-float-link { flex: 0 0 auto; color: #3157b7; font-size: 12px; font-weight: 650; text-decoration: none; }
      .jira-codex-float-link:hover { text-decoration: underline; }
      .jira-codex-float-loading,
      .jira-codex-float-error,
      .jira-codex-float-empty { padding: 20px 4px; color: #717985; text-align: center; }
      .jira-codex-float-error { color: #a33a32; }
      .jira-codex-float-notice { margin: 0 0 10px; padding: 7px 9px; border-radius: 8px; color: #236943; background: #edf8f1; font-size: 12px; }
      .jira-codex-float-hint { margin: 7px 0 0; color: #8b929d; font-size: 11px; }
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
      .jira-codex-float-collapsed-status { min-width: 0; flex: 1; overflow: hidden; color: #747c88; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      @media (max-width: 760px) {
        #${CONVERSATION_FLOAT_ID} { top: 58px; right: 10px; width: min(330px, calc(100vw - 20px)); max-height: calc(100vh - 126px); }
        .jira-codex-float-card { max-height: calc(100vh - 126px); }
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
    const element = document.createElement("section");
    element.id = PAGE_ID;
    element.hidden = true;
    element.setAttribute(OWNED_ATTRIBUTE, "true");
    frame = document.createElement("iframe");
    if (EMBEDDED_PANEL) frame.srcdoc = PANEL_DOCUMENT;
    else frame.src = PANEL_URL;
    frame.title = "Jira 任务面板 POC";
    frame.referrerPolicy = "no-referrer";
    frame.addEventListener("load", sendBindings);
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
      .filter(([, binding]) => normalizeCodexThreadId(binding?.threadId) === normalizedThreadId)
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
          issue?.statusName || (state.loading ? "正在读取…" : "Jira 任务")
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
    const [issueResult, transitionsResult] = await Promise.allSettled([
      panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}`),
      panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}/transitions`)
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

  function ensureConversationIssueFloat() {
    if (active) {
      if (conversationFloat) conversationFloat.hidden = true;
      return false;
    }
    const activeThreadId = activeThreadIds()[0] || "";
    const match = conversationBindingForThread(activeThreadId)
      || conversationBindingFromHint(activeThreadId);
    if (!activeThreadId || !match) {
      removeConversationIssueFloat();
      return false;
    }
    const threadId = String(match.binding?.threadId || activeThreadId);
    if (conversationFloatState?.threadId === threadId
      && conversationFloatState?.issueKey === match.issueKey) {
      conversationFloatState.binding = match.binding;
      if (conversationFloat) conversationFloat.hidden = false;
      return true;
    }
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
      notice: ""
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
      row.getAttribute("data-app-action-sidebar-thread-id") === binding.threadId
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
    if (message.type === "get-bindings") sendBindings();
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
      && normalizeCodexThreadId(clickedThreadId) === normalizeCodexThreadId(conversationThreadHint.threadId);
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
    });
  }

  function state() {
    return {
      version: VERSION,
      entryMounted: Boolean(document.getElementById(ENTRY_ID)),
      panelMounted: Boolean(document.getElementById(PAGE_ID)),
      conversationFloatMounted: Boolean(document.getElementById(CONVERSATION_FLOAT_ID)),
      conversationIssueKey: conversationFloatState?.issueKey || "",
      conversationHintIssueKey: conversationThreadHint?.issueKey || "",
      conversationHintObserved: Boolean(conversationThreadHint?.observedThreadId),
      conversationAliasCount: conversationThreadAliases.size,
      active
    };
  }

  function destroy() {
    observer?.disconnect();
    if (bindingTimer) window.clearInterval(bindingTimer);
    if (bugMonitorTimer) window.clearInterval(bugMonitorTimer);
    window.removeEventListener("message", onMessage);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("click", onDocumentClick, true);
    closePanel();
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
