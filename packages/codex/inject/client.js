(() => {
  const VERSION = "0.32.3";
  const INJECTION_REVISION = String(window.__JIRA_WORKBENCH_POC_INJECTION_REVISION__ || VERSION);
  const ENTRY_ID = "jira-workbench-poc-entry";
  const PAGE_ID = "jira-workbench-poc-page";
  const FLOAT_ID = "jira-workbench-conversation-float";
  const SVN_OVERLAY_ID = "jira-workbench-svn-workbench-overlay";
  const STYLE_ID = "jira-workbench-poc-style";
  const OWNED = "data-jira-workbench-poc-owned";
  const HIDDEN = "data-jira-workbench-poc-hidden";
  const HOST = "data-jira-workbench-poc-host";
  const BINDINGS_KEY = "jira-workbench:issue-bindings:v1";
  const BUG_MONITOR_STATE_KEY = "jira-workbench:bug-monitor:v2";
  const MCP_WIDGET_STATE_KEY = "jira-workbench-mcp-app:widget-state:v1";
  const PANEL_URL = window.__JIRA_WORKBENCH_POC_PANEL_URL__ || "http://127.0.0.1:47823/";
  const PANEL_DOCUMENT = String(window.__JIRA_WORKBENCH_POC_PANEL_DOCUMENT__ || "");
  const PANEL_ORIGIN = new URL(PANEL_URL).origin;
  const BRIDGE_BINDING_NAME = window.__JIRA_WORKBENCH_BRIDGE_BINDING__ || "__jiraWorkbenchNodeRequest";
  const DESKTOP_CLIENT_ID = `desktop-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;

  /*__JIRA_WORKBENCH_NAVIGATION_HELPERS__*/
  /*__JIRA_WORKBENCH_APPLICATION_COMMANDS__*/

  if (window.__jiraWorkbenchPoc?.version === VERSION
    && window.__jiraWorkbenchPoc?.revision === INJECTION_REVISION) {
    window.__jiraWorkbenchPoc.ensure();
    return window.__jiraWorkbenchPoc.state();
  }
  window.__jiraWorkbenchPoc?.destroy?.();

  let active = false;
  let entry = null;
  let page = null;
  let frame = null;
  let svnFrame = null;
  let svnOverlay = null;
  let svnReturnFocus = null;
  let observer = null;
  let timer = null;
  let bridgeSequence = 0;
  let desktopBusy = false;
  let currentThreadId = "";
  let currentIssueKey = "";
  let bindingRevision = 0;
  let bindingCache = {};
  let lastBindingRefreshAt = 0;
  let floatState = null;
  let floatRequestId = 0;
  let pendingOpenIssueKey = "";
  let lastPanelMountErrorAt = 0;
  let destroyed = false;
  let desktopProjects = [];
  let desktopProjectsRequest = null;
  const collapsedConversationThreads = new Set();
  const bridgeRequests = new Map();

  function normalizedLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function buttonMatches(button, labels) {
    return [button?.textContent, button?.getAttribute?.("aria-label"), button?.getAttribute?.("title")]
      .map(normalizedLabel)
      .filter(Boolean)
      .some((value) => labels.includes(value));
  }

  function resolveHostFetch(response) {
    const pending = bridgeRequests.get(String(response?.id || ""));
    if (!pending) return;
    bridgeRequests.delete(String(response.id));
    clearTimeout(pending.timer);
    response?.error ? pending.reject(new Error(response.error)) : pending.resolve(response);
  }

  function hostFetch(request) {
    const binding = window[BRIDGE_BINDING_NAME];
    const bridgeToken = window.__JIRA_WORKBENCH_BRIDGE_TOKEN__ || "";
    if (typeof binding !== "function" || !bridgeToken) {
      return Promise.reject(new Error("Jira 本地服务桥接尚未就绪。"));
    }
    const url = new URL(String(request?.url || ""), PANEL_URL);
    if (url.origin !== PANEL_ORIGIN) return Promise.reject(new Error("拒绝访问非本地服务地址。"));
    const id = `${Date.now()}-${++bridgeSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        bridgeRequests.delete(id);
        reject(new Error("Jira 本地服务请求超时。"));
      }, 120_000);
      bridgeRequests.set(id, { resolve, reject, timer });
      try {
        binding(JSON.stringify({
          id,
          token: bridgeToken,
          ...request,
          url: url.href,
          headers: {
            ...(request?.headers || {}),
            "x-jira-workbench-desktop-client": DESKTOP_CLIENT_ID
          }
        }));
      } catch (error) {
        clearTimeout(timer);
        bridgeRequests.delete(id);
        reject(error);
      }
    });
  }

  function decodeJson(response) {
    const text = decodeText(response);
    let payload;
    try { payload = JSON.parse(text || "{}"); }
    catch { throw new Error("Jira 本地服务返回了无效 JSON。"); }
    const status = Number(response?.status || 0);
    if (status < 200 || status >= 300) {
      const error = new Error(payload.error || `Jira 本地服务请求失败（HTTP ${status}）。`);
      error.code = String(payload.code || "PANEL_API_ERROR");
      error.status = status;
      throw error;
    }
    return payload;
  }

  function decodeText(response) {
    const binary = window.atob(String(response?.bodyBase64 || ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function panelJson(path, { method = "GET", body } = {}) {
    return decodeJson(await hostFetch({
      method,
      url: new URL(path, PANEL_URL).href,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
  }

  window.__jiraWorkbenchResolveHostFetch = resolveHostFetch;
  window.__jiraWorkbenchHostFetch = hostFetch;

  const desktopHost = createCodexDesktopAppServerHostAdapter();
  const selector = createCodexRuntimeSelector({ runtimes: [desktopHost] });
  const codexCommands = createCodexApplicationCommands({ selector, desktopHost });

  function theme() {
    if (document.documentElement.classList.contains("electron-dark")) return "dark";
    if (document.documentElement.classList.contains("electron-light")) return "light";
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${HIDDEN}="true"] { visibility: hidden !important; pointer-events: none !important; }
      [${HOST}="true"] { position: relative !important; overflow: hidden !important; pointer-events: auto !important; }
      #${PAGE_ID} { position: absolute; inset: 0; z-index: 1; min-width: 0; background: var(--color-background-primary, #f5f6f8); pointer-events: auto; }
      #${PAGE_ID}[hidden] { display: none !important; }
      #${PAGE_ID} iframe { display: block; width: 100%; height: 100%; border: 0; background: inherit; }
      #${ENTRY_ID}[aria-current="page"] { background: var(--color-background-button-secondary-hover, rgba(127,127,127,.10)); }
      #${FLOAT_ID} { position: fixed; top: 66px; right: 16px; z-index: 30; width: min(390px, calc(100vw - 32px)); max-height: calc(100vh - 84px); color: var(--color-text-foreground, #202124); font: 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      #${FLOAT_ID}[hidden] { display: none !important; }
      #${FLOAT_ID} .jira-float { overflow: hidden; border: 1px solid var(--color-border-heavy, rgba(25,28,33,.14)); border-radius: 14px; background: var(--color-background-elevated-primary-opaque, #fff); box-shadow: 0 16px 44px rgba(0,0,0,.22); }
      #${FLOAT_ID} header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--color-border, #e1e4e8); }
      #${FLOAT_ID} header strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${FLOAT_ID} header button { width: 30px; height: 30px; padding: 0; border: 1px solid var(--color-border, #e1e4e8); border-radius: 8px; color: inherit; background: transparent; cursor: pointer; }
      #${FLOAT_ID} .body { max-height: calc(100vh - 205px); padding: 13px; overflow: auto; }
      #${FLOAT_ID} .title { margin-bottom: 9px; font-size: 15px; font-weight: 700; }
      #${FLOAT_ID} .status { display: inline-flex; padding: 2px 7px; border-radius: 999px; color: var(--color-text-accent, #3157b7); background: var(--color-background-accent, #edf3ff); }
      #${FLOAT_ID} .description { max-height: 150px; margin-top: 10px; overflow: auto; color: var(--color-text-foreground-secondary, #5f6670); white-space: pre-wrap; }
      #${FLOAT_ID} .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-top: 11px; padding: 10px; border-radius: 10px; background: var(--color-background-secondary, rgba(127,127,127,.07)); }
      #${FLOAT_ID} .meta div { min-width: 0; }
      #${FLOAT_ID} .meta span { display: block; color: var(--color-text-foreground-secondary, #727984); font-size: 11px; }
      #${FLOAT_ID} .meta strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${FLOAT_ID} .section { margin-top: 12px; }
      #${FLOAT_ID} .section h3 { margin: 0 0 6px; font-size: 12px; }
      #${FLOAT_ID} .parent-context { padding: 9px; border: 1px solid var(--color-border-accent, rgba(63,111,217,.28)); border-radius: 9px; background: var(--color-background-accent, rgba(63,111,217,.06)); }
      #${FLOAT_ID} .parent-context h3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      #${FLOAT_ID} .parent-context h3 a { color: var(--color-text-accent, #3157b7); text-decoration: none; }
      #${FLOAT_ID} .parent-context strong { display: block; }
      #${FLOAT_ID} .parent-context p { margin: 6px 0 0; color: var(--color-text-foreground-secondary, #5f6670); font-size: 12px; white-space: pre-wrap; }
      #${FLOAT_ID} .chips { display: flex; flex-wrap: wrap; gap: 5px; }
      #${FLOAT_ID} .chip { padding: 2px 7px; border: 1px solid var(--color-border, #e1e4e8); border-radius: 999px; }
      #${FLOAT_ID} .project-chip.primary { border-color: var(--color-border-accent, rgba(63,111,217,.36)); color: var(--color-text-accent, #3157b7); background: var(--color-background-accent, rgba(63,111,217,.08)); }
      #${FLOAT_ID} .project-chip.primary::before { margin-right: 4px; content: "主"; font-size: 9px; font-weight: 700; }
      #${FLOAT_ID} .transition { display: flex; gap: 7px; }
      #${FLOAT_ID} select { min-width: 0; flex: 1; height: 32px; border: 1px solid var(--color-border-heavy, #ccd1d8); border-radius: 8px; color: inherit; background: var(--color-background-control-opaque, #fff); }
      #${FLOAT_ID} .hint, #${FLOAT_ID} .error { margin: 6px 0 0; color: var(--color-text-foreground-secondary, #727984); font-size: 11px; }
      #${FLOAT_ID} .error { color: var(--color-text-danger, #b42318); }
      #${FLOAT_ID} footer { display: flex; gap: 7px; padding: 10px 12px; border-top: 1px solid var(--color-border, #e1e4e8); }
      #${FLOAT_ID} footer a { margin-right: auto; align-self: center; color: var(--color-text-accent, #3157b7); text-decoration: none; }
      #${FLOAT_ID} button { min-height: 32px; padding: 0 10px; border: 1px solid var(--color-border-heavy, #ccd1d8); border-radius: 8px; color: inherit; background: var(--color-background-control-opaque, #fff); cursor: pointer; }
      #${FLOAT_ID} button:disabled { cursor: wait; opacity: .58; }
      #${FLOAT_ID} button:focus-visible, #${FLOAT_ID} a:focus-visible, #${FLOAT_ID} select:focus-visible,
      #${SVN_OVERLAY_ID} button:focus-visible, #${SVN_OVERLAY_ID} iframe:focus-visible { outline: 2px solid var(--color-border-accent, #4b7bec); outline-offset: 2px; }
      #${FLOAT_ID} .collapsed { display: flex; width: 100%; align-items: center; gap: 8px; min-height: 42px; border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,.18); }
      #${SVN_OVERLAY_ID} { position: fixed; inset: 0; z-index: 80; padding: 22px; background: rgba(16,18,22,.48); backdrop-filter: blur(3px); -webkit-app-region: no-drag !important; }
      #${SVN_OVERLAY_ID}[hidden] { display: none !important; }
      #${SVN_OVERLAY_ID} .svn-shell { position: relative; width: min(1380px, 100%); height: 100%; margin: auto; overflow: hidden; border: 1px solid var(--color-border-heavy, rgba(25,28,33,.18)); border-radius: 16px; background: var(--color-background-primary, #f5f6f8); box-shadow: 0 26px 80px rgba(0,0,0,.34); -webkit-app-region: no-drag !important; }
      #${SVN_OVERLAY_ID} iframe { display: block; width: 100%; height: 100%; border: 0; -webkit-app-region: no-drag !important; }
      #${SVN_OVERLAY_ID} .svn-overlay-close { position: absolute; top: 10px; right: 10px; z-index: 2; width: 34px; height: 34px; padding: 0; border: 1px solid var(--color-border-heavy, #ccd1d8); border-radius: 9px; color: inherit; background: var(--color-background-elevated-primary-opaque, #fff); cursor: pointer; -webkit-app-region: no-drag !important; }
      #${SVN_OVERLAY_ID}.svn-frame-ready .svn-overlay-close { display: none; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findReferenceButton() {
    const scroll = document.querySelector("[data-app-action-sidebar-scroll]");
    const buttons = Array.from(scroll?.querySelectorAll("button") || []);
    return buttons.find((button) => buttonMatches(button, ["插件", "plugins", "plugin"]))
      || buttons.at(4)
      || Array.from(document.querySelectorAll("aside button, nav button"))[0]
      || null;
  }

  function createEntry(reference) {
    const button = reference.cloneNode(true);
    [button, ...button.querySelectorAll("*")].forEach((node) => {
      node.getAttributeNames().forEach((name) => {
        if (name.startsWith("data-") || ["name", "value", "formaction"].includes(name)) node.removeAttribute(name);
      });
    });
    button.id = ENTRY_ID;
    button.type = "button";
    button.removeAttribute("disabled");
    button.removeAttribute("aria-expanded");
    button.setAttribute("aria-label", "打开 Jira 工作台");
    button.setAttribute("title", "Jira 任务");
    button.setAttribute(OWNED, "true");
    button.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    const label = button.querySelector(".text-fade-truncate") || Array.from(button.querySelectorAll("span")).at(-1);
    if (label) label.textContent = "Jira 任务";
    else button.textContent = "Jira 任务";
    const icon = button.querySelector("svg");
    if (icon) {
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.innerHTML = '<rect x="3.5" y="3.5" width="17" height="17" rx="3"></rect><path d="M8 8h8M8 12h5M8 16h7"></path>';
    }
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
    if (entry.parentElement !== reference.parentElement || entry.previousElementSibling !== reference) reference.after(entry);
    active ? entry.setAttribute("aria-current", "page") : entry.removeAttribute("aria-current");
    return true;
  }

  function createPage() {
    const element = document.createElement("section");
    element.id = PAGE_ID;
    element.hidden = true;
    element.setAttribute(OWNED, "true");
    element.setAttribute("aria-label", "Jira 任务工作台");
    frame = document.createElement("iframe");
    frame.srcdoc = PANEL_DOCUMENT || `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:${theme() === "dark" ? "#17191d" : "#f5f6f8"};color:${theme() === "dark" ? "#f0f2f5" : "#181b20"};font:14px system-ui"><div><strong>Jira 任务工作台资源不可用</strong><p>请通过维护助手更新或修复安装。</p></div></body></html>`;
    frame.title = "Jira 任务工作台";
    frame.referrerPolicy = "no-referrer";
    frame.style.colorScheme = theme();
    element.appendChild(frame);
    return element;
  }

  function initialWidgetState() {
    try { return JSON.parse(localStorage.getItem(MCP_WIDGET_STATE_KEY) || "{}"); }
    catch { return {}; }
  }

  function desktopBridgeDocument(html, widgetState = initialWidgetState()) {
    const state = JSON.stringify(widgetState || {}).replaceAll("<", "\\u003c");
    const desktopTheme = theme();
    return String(html || "")
      .replace(/<html\b([^>]*)>/i, `<html$1 data-transport="desktop-bridge" data-theme="${desktopTheme}">`)
      .replace("<script>", `<script>window.__JIRA_WORKBENCH_INITIAL_WIDGET_STATE__ = ${state};</script><script>`);
  }

  async function loadMcpFrame(target, widgetState = {}) {
    try {
      const response = await hostFetch({ method: "GET", url: new URL("mcp-app.html", PANEL_URL).href });
      const status = Number(response?.status || 0);
      if (status < 200 || status >= 300) throw new Error(`读取任务工作台失败（HTTP ${status}）。`);
      if (!target?.isConnected || destroyed) return;
      const priorState = initialWidgetState();
      try { localStorage.setItem(MCP_WIDGET_STATE_KEY, JSON.stringify({ ...priorState, ...widgetState })); } catch {}
      target.srcdoc = desktopBridgeDocument(decodeText(response), { ...priorState, ...widgetState });
    } catch (error) {
      if (!target?.isConnected || destroyed) return;
      target.srcdoc = `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f6f8;color:#b42318;font:14px system-ui"><div><strong>Jira 任务工作台加载失败</strong><p>${escapeHtml(error?.message || error)}</p></div></body></html>`;
    }
  }

  function restoreNativeContent() {
    document.querySelectorAll(`[${HIDDEN}="true"]`).forEach((node) => node.removeAttribute(HIDDEN));
    document.querySelectorAll(`[${HOST}="true"]`).forEach((node) => node.removeAttribute(HOST));
  }

  function findPageMount() {
    const candidates = Array.from(document.querySelectorAll("[data-app-shell-main-content-layout]"))
      .map((viewport) => viewport.parentElement)
      .filter((surface) => surface?.closest?.("main") && !surface.closest?.(`#${PAGE_ID}, #${SVN_OVERLAY_ID}`))
      .map((surface) => ({ surface, bounds: surface.getBoundingClientRect?.(), style: getComputedStyle(surface) }))
      .filter(({ bounds, style }) => bounds?.width > 320 && bounds?.height > 280
        && style?.display !== "none" && style?.visibility !== "hidden" && Number(style?.opacity || 1) > 0)
      .filter(({ surface }) => !Array.from(surface.querySelectorAll("webview")).some((webview) => {
        const bounds = webview.getBoundingClientRect?.();
        const style = getComputedStyle(webview);
        return bounds?.width > 120 && bounds?.height > 120
          && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
      }))
      .sort((left, right) => (right.bounds.width * right.bounds.height) - (left.bounds.width * left.bounds.height));
    return candidates[0]?.surface || null;
  }

  function hideNativeHeader(pageSurface) {
    const targetBounds = pageSurface?.getBoundingClientRect?.();
    const headers = Array.from(document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"]'))
      .map((surface) => ({ surface, bounds: surface.getBoundingClientRect?.() }))
      .filter(({ bounds }) => bounds?.width > 0 && bounds?.height > 0
        && Math.max(0, Math.min(bounds.right, targetBounds?.right || 0) - Math.max(bounds.left, targetBounds?.left || 0)) > 0)
      .sort((left, right) => {
        const overlap = (bounds) => Math.max(0, Math.min(bounds.right, targetBounds?.right || 0) - Math.max(bounds.left, targetBounds?.left || 0));
        return overlap(right.bounds) - overlap(left.bounds);
      });
    const header = headers[0]?.surface;
    Array.from(header?.children || []).forEach((child) => {
      if (child.getAttribute(OWNED) !== "true") child.setAttribute(HIDDEN, "true");
    });
  }

  function mountPage() {
    page = document.getElementById(PAGE_ID) || page || createPage();
    const surface = findPageMount();
    if (!surface) return false;
    if (page.parentElement !== surface) {
      restoreNativeContent();
      surface.appendChild(page);
    }
    surface.setAttribute(HOST, "true");
    Array.from(surface.children).forEach((child) => {
      if (child !== page && child.getAttribute(OWNED) !== "true") child.setAttribute(HIDDEN, "true");
    });
    hideNativeHeader(surface);
    page.hidden = false;
    return true;
  }

  function openPanel() {
    active = true;
    ensureEntry();
    if (!mountPage()) {
      active = false;
      entry?.removeAttribute("aria-current");
      const now = Date.now();
      if (now - lastPanelMountErrorAt > 3_000) {
        lastPanelMountErrorAt = now;
        window.alert("暂时无法定位 Codex 主内容区。请关闭侧边浏览器后重试，或通过维护助手检查兼容状态。");
      }
      return false;
    }
    document.getElementById(FLOAT_ID)?.setAttribute("hidden", "");
    sendPanelContext();
    void refreshDesktopProjects();
    return true;
  }

  function closePanel() {
    active = false;
    if (page) page.hidden = true;
    restoreNativeContent();
    entry?.removeAttribute("aria-current");
    void refreshConversationFloat();
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function renderFloat(issue, binding) {
    let element = document.getElementById(FLOAT_ID);
    if (!binding || active) {
      element?.remove();
      return;
    }
    const state = floatState || {};
    const hasIssueDetails = Boolean(issue);
    issue = issue || {
      key: state.issueKey || currentIssueKey || "Jira",
      title: state.refreshing ? "正在读取 Jira 任务…" : "暂时无法读取任务详情",
      statusName: "等待重试",
      typeName: "Jira 任务",
      summary: "任务关联仍然有效；本地服务恢复后会自动重新读取详情。"
    };
    if (!element) {
      element = document.createElement("aside");
      element.id = FLOAT_ID;
      element.setAttribute(OWNED, "true");
      document.body.appendChild(element);
    }
    element.hidden = false;
    if (collapsedConversationThreads.has(binding.threadId)) {
      element.innerHTML = `<button type="button" class="collapsed" data-expand-float><strong>${escapeHtml(issue.key)}</strong><span>${escapeHtml(issue.statusName || "Jira 任务")}</span><span style="margin-left:auto">‹</span></button>`;
      element.querySelector("[data-expand-float]").addEventListener("click", () => {
        collapsedConversationThreads.delete(binding.threadId);
        renderFloat(issue, binding);
      });
      return;
    }
    const collaborators = Array.isArray(issue.collaborators) ? issue.collaborators : [];
    const attachments = Array.isArray(issue.attachments) ? issue.attachments : [];
    const bindingWorkspace = binding?.workspace && typeof binding.workspace === "object" ? binding.workspace : {};
    const projectScopes = Array.isArray(bindingWorkspace.projectScopes) && bindingWorkspace.projectScopes.length
      ? bindingWorkspace.projectScopes
      : bindingWorkspace.cwd || bindingWorkspace.projectId ? [bindingWorkspace] : [];
    const defaultProjectScopeId = String(bindingWorkspace.defaultProjectScopeId || projectScopes[0]?.id || "");
    const parent = issue.parentIssue || issue.parent || null;
    const parentUnavailable = issue.parentContext?.status === "unavailable" && !issue.parentIssue;
    const transitions = Array.isArray(state.transitions) ? state.transitions : [];
    const transitionOptions = transitions.map((transition) => {
      const label = transition.to?.name || transition.name || "未命名流转";
      return `<option value="${escapeHtml(transition.id)}" ${transition.requiresInput ? "disabled" : ""}>${escapeHtml(label)}${transition.requiresInput ? "（需在 Jira 完成）" : ""}</option>`;
    }).join("");
    element.innerHTML = `<section class="jira-float">
      <header><span>${escapeHtml(issue.typeName || (issue.type === "bug" ? "Bug" : "需求"))}</span><strong>${escapeHtml(issue.key)}</strong><button type="button" data-refresh-float title="刷新" aria-label="刷新 Jira 任务" ${state.refreshing ? "disabled" : ""}>↻</button><button type="button" data-collapse-float title="收起">−</button></header>
      <div class="body" aria-live="polite">
        ${state.error ? `<p class="error">${escapeHtml(state.error)} <button type="button" data-retry-float>立即重试</button></p>` : ""}
        ${state.refreshing && !hasIssueDetails ? '<p class="hint">正在连接 Jira，本浮窗会保持显示。</p>' : ""}
        <div class="title">${escapeHtml(issue.title)}</div><span class="status">${escapeHtml(issue.statusName || "未知状态")}</span>
        <div class="meta">
          <div><span>负责人</span><strong>${escapeHtml(issue.assignee || "未分配")}</strong></div>
          <div><span>优先级</span><strong>${escapeHtml(issue.priority || "未设置")}</strong></div>
          <div><span>项目</span><strong>${escapeHtml(issue.projectName || "未提供")}</strong></div>
          <div><span>类型</span><strong>${escapeHtml(issue.typeName || issue.type || "Jira")}</strong></div>
        </div>
        <div class="description">${escapeHtml(issue.summary || "Jira 中未填写描述。")}</div>
        ${parent?.key ? `<section class="section parent-context"><h3><span>父级需求上下文</span><a href="${escapeHtml(parent.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(parent.key)} ↗</a></h3><strong>${escapeHtml(parent.title || parent.key)}</strong><p>${escapeHtml(parentUnavailable ? issue.parentContext?.message || "父单详情暂时无法读取。" : parent.summary || "Jira 中未填写描述。")}</p><p class="hint">父子单共同提供上下文；当前操作仍只作用于 ${escapeHtml(issue.key)}。</p></section>` : ""}
        ${projectScopes.length ? `<section class="section"><h3>关联项目目录 · ${projectScopes.length}</h3><div class="chips">${projectScopes.map((scope, index) => {
          const scopeId = String(scope.id || scope.scopeId || "");
          const primary = scopeId === defaultProjectScopeId || (!defaultProjectScopeId && index === 0);
          return `<span class="chip project-chip ${primary ? "primary" : ""}" title="${escapeHtml(scope.cwd || scope.workspaceRoots?.[0] || scope.projectId || "")}">${escapeHtml(scope.projectLabel || scope.label || scope.cwd || scope.projectId || `项目 ${index + 1}`)}</span>`;
        }).join("")}</div><p class="hint">新会话使用主目录；SVN 操作会先要求选择一个明确目录。</p></section>` : ""}
        ${collaborators.length ? `<section class="section"><h3>协同处理人 · ${collaborators.length}</h3><div class="chips">${collaborators.map((person) => `<span class="chip">${escapeHtml(person.displayName || person.name || person)}</span>`).join("")}</div></section>` : ""}
        ${attachments.length ? `<section class="section"><h3>附件 · ${attachments.length}</h3><div class="chips">${attachments.slice(0, 4).map((attachment) => `<button type="button" class="chip" data-open-detail>${escapeHtml(attachment.filename || "未命名附件")}</button>`).join("")}</div><p class="hint">在任务详情中预览或下载附件。</p></section>` : ""}
        <section class="section"><h3>状态流转</h3>${state.transitionError ? `<p class="error">${escapeHtml(state.transitionError)}</p>` : transitions.length ? `<div class="transition"><select data-transition-select aria-label="选择目标状态"><option value="">选择目标状态</option>${transitionOptions}</select><button type="button" data-transition-submit ${state.transitioning ? "disabled" : ""}>${state.transitioning ? "流转中…" : "执行"}</button></div>` : `<p class="hint">${state.refreshing ? "正在读取可用流转…" : "当前没有可直接执行的状态流转。"}</p>`}</section>
        <section class="section"><h3>代码提交</h3><button type="button" data-open-svn>审核并提交 SVN</button><p class="hint">检查改动和风险；真正提交前必须人工确认。</p></section>
      </div>
      <footer><a href="${escapeHtml(issue.url || "#")}" target="_blank" rel="noreferrer">在 Jira 中打开 ↗</a><button type="button" data-open-detail>任务详情</button></footer>
    </section>`;
    element.querySelector("[data-refresh-float]").addEventListener("click", () => void loadFloatDetails(true));
    element.querySelector("[data-retry-float]")?.addEventListener("click", () => void loadFloatDetails(true));
    element.querySelector("[data-collapse-float]").addEventListener("click", () => {
      collapsedConversationThreads.add(binding.threadId);
      renderFloat(issue, binding);
    });
    element.querySelectorAll("[data-open-detail]").forEach((control) => control.addEventListener("click", () => {
      pendingOpenIssueKey = issue.key;
      openPanel();
      sendPanelMessage("open-issue", { issueKey: issue.key });
    }));
    element.querySelector("[data-open-svn]").addEventListener("click", () => void openSvnWorkbench(issue.key));
    element.querySelector("[data-transition-submit]")?.addEventListener("click", () => {
      const transitionId = element.querySelector("[data-transition-select]")?.value || "";
      void executeFloatTransition(transitionId);
    });
  }

  async function executeFloatTransition(transitionId) {
    const state = floatState;
    const transition = state?.transitions?.find((candidate) => String(candidate.id) === String(transitionId));
    if (!state || !transition || transition.requiresInput || state.transitioning) return;
    const targetStatus = transition.to?.name || transition.name || "目标状态";
    if (!window.confirm(`确认将 ${state.issueKey} 流转到“${targetStatus}”吗？\n\n提交后会立即写入 Jira。`)) return;
    state.transitioning = true;
    renderFloat(state.issue, state.binding);
    try {
      await panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}/transitions`, {
        method: "POST",
        body: { transitionId: transition.id, expectedTargetStatus: targetStatus }
      });
      await loadFloatDetails(true);
    } catch (error) {
      if (floatState !== state) return;
      state.transitioning = false;
      state.error = `状态流转失败：${error?.message || error}`;
      renderFloat(state.issue, state.binding);
    }
  }

  async function loadFloatDetails(force = false) {
    const state = floatState;
    if (!state || destroyed || active) return;
    if (state.refreshing) return;
    const requestId = ++floatRequestId;
    state.refreshing = true;
    state.error = "";
    renderFloat(state.issue, state.binding);
    const [issueResult, transitionResult] = await Promise.allSettled([
      panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}`),
      panelJson(`/api/issues/${encodeURIComponent(state.issueKey)}/transitions`)
    ]);
    if (requestId !== floatRequestId || floatState !== state) return;
    state.refreshing = false;
    state.transitioning = false;
    state.lastLoadedAt = Date.now();
    if (issueResult.status === "fulfilled" && issueResult.value?.issue) {
      state.issue = issueResult.value.issue;
      state.failureCount = 0;
      state.nextRetryAt = state.lastLoadedAt + 30_000;
    } else {
      state.failureCount = Number(state.failureCount || 0) + 1;
      const retryDelay = Math.min(120_000, 5_000 * (2 ** Math.min(state.failureCount - 1, 5)));
      state.nextRetryAt = state.lastLoadedAt + retryDelay;
      state.error = `无法读取 Jira 任务：${issueResult.reason?.message || "未知错误"}`;
    }
    if (transitionResult.status === "fulfilled") {
      state.transitions = Array.isArray(transitionResult.value?.transitions) ? transitionResult.value.transitions : [];
      state.transitionError = "";
    } else {
      state.transitionError = `暂时无法读取状态流转：${transitionResult.reason?.message || "未知错误"}`;
    }
    renderFloat(state.issue, state.binding);
  }

  function bindingForThread(threadId) {
    const normalized = normalizeCodexThreadId(threadId).toLowerCase();
    if (!normalized) return null;
    return Object.entries(bindingCache).find(([, binding]) => (
      [binding?.threadId, binding?.uiThreadId]
        .map((value) => normalizeCodexThreadId(value).toLowerCase())
        .filter(Boolean)
        .includes(normalized)
    )) || null;
  }

  async function refreshBindings() {
    const state = await panelJson("/api/bindings");
    bindingRevision = Number(state?.revision || 0);
    bindingCache = state?.bindings && typeof state.bindings === "object" ? state.bindings : {};
    lastBindingRefreshAt = Date.now();
  }

  async function refreshConversationFloat() {
    if (destroyed) return;
    if (active) {
      document.getElementById(FLOAT_ID)?.remove();
      try {
        const current = await codexCommands.currentConversation({ timeoutMs: 3_000 });
        const threadId = normalizeCodexThreadId(current?.value?.threadId || current?.threadId || "");
        if (threadId !== currentThreadId || Date.now() - lastBindingRefreshAt > 5_000) {
          currentThreadId = threadId;
          await refreshBindings();
        }
        sendPanelContext();
      } catch {}
      return;
    }
    try {
      const current = await codexCommands.currentConversation({ timeoutMs: 3_000 });
      const threadId = normalizeCodexThreadId(current?.value?.threadId || current?.threadId || "");
      if (threadId !== currentThreadId || Date.now() - lastBindingRefreshAt > 5_000) {
        currentThreadId = threadId;
        await refreshBindings();
      }
      const match = bindingForThread(threadId);
      if (!match) {
        currentIssueKey = "";
        floatState = null;
        renderFloat(null, null);
        return;
      }
      const [issueKey, binding] = match;
      if (issueKey !== currentIssueKey || !floatState) {
        currentIssueKey = issueKey;
        floatState = { issueKey, binding, issue: null, transitions: [], refreshing: false, transitioning: false, error: "", transitionError: "", lastLoadedAt: 0, nextRetryAt: 0, failureCount: 0 };
        await loadFloatDetails(true);
      } else {
        floatState.binding = binding;
        if (!document.getElementById(FLOAT_ID)) renderFloat(floatState.issue, binding);
        if (!floatState.refreshing && Date.now() >= Number(floatState.nextRetryAt || 0)) void loadFloatDetails();
      }
    } catch {
      // Window transitions and service restarts are expected; the next poll is bounded.
    }
  }

  async function migrateLegacyState() {
    let bindings = {};
    let monitor = {};
    try { bindings = JSON.parse(localStorage.getItem(BINDINGS_KEY) || "{}"); } catch {}
    try { monitor = JSON.parse(localStorage.getItem(BUG_MONITOR_STATE_KEY) || "{}"); } catch {}
    if (bindings && Object.keys(bindings).length) {
      try {
        const state = await panelJson("/api/bindings/import", { method: "PUT", body: { bindings } });
        bindingRevision = Number(state?.revision || 0);
        bindingCache = state?.bindings || {};
        localStorage.removeItem(BINDINGS_KEY);
      } catch {}
    } else {
      await refreshBindings().catch(() => {});
    }
    if (monitor && Object.keys(monitor).length) {
      try {
        await panelJson("/api/automation/monitor/import", { method: "PUT", body: monitor });
        localStorage.removeItem(BUG_MONITOR_STATE_KEY);
      } catch {}
    }
  }

  async function pollDesktopCommand() {
    if (desktopBusy || destroyed) return;
    desktopBusy = true;
    try {
      const { command } = await panelJson(`/api/desktop/commands/next?clientId=${encodeURIComponent(DESKTOP_CLIENT_ID)}`);
      if (!command?.id) return;
      let ok = false;
      let result = null;
      let error = null;
      try {
        if (command.type === "open-thread") {
          await codexCommands.openConversation(command.payload?.threadId);
          result = { threadId: command.payload?.threadId };
          ok = true;
        } else if (command.type === "create-analysis") {
          const started = await codexCommands.createAnalysisConversation(command.payload?.message, {
            desktopOwned: true,
            cwd: command.payload?.cwd || "",
            workspaceRoots: Array.isArray(command.payload?.workspaceRoots)
              ? command.payload.workspaceRoots
              : command.payload?.cwd ? [command.payload.cwd] : [],
            projectId: command.payload?.projectId || "",
            title: command.payload?.title || `分析 ${command.payload?.issueKey || "Jira"}`,
            attachments: Array.isArray(command.payload?.attachments) ? command.payload.attachments : [],
            referenceFiles: true,
            skills: Array.isArray(command.payload?.skills) ? command.payload.skills : []
          });
          let threadId = normalizeCodexThreadId(started?.threadId);
          for (let attempt = 0; attempt < 20 && isProvisionalCodexThreadId(threadId); attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            const resolved = await codexCommands.resolveConversationId(threadId, { timeoutMs: 3_000 }).catch(() => null);
            threadId = normalizeCodexThreadId(resolved?.value || resolved?.threadId || threadId);
          }
          if (!threadId || isProvisionalCodexThreadId(threadId)) {
            const unresolved = new Error("Codex Desktop 尚未返回正式会话 ID。");
            unresolved.code = "DESKTOP_THREAD_ID_UNRESOLVED";
            throw unresolved;
          }
          await codexCommands.openConversation(threadId, {
            knownLoadedThread: started?.knownLoadedThread === true,
            hostId: started?.hostId || "local"
          });
          result = { threadId, turnId: started?.turnId || "" };
          ok = true;
        } else {
          const unsupported = new Error(`不支持的 Desktop 操作：${command.type}`);
          unsupported.code = "DESKTOP_COMMAND_UNSUPPORTED";
          throw unsupported;
        }
      } catch (caught) {
        error = { code: caught?.code || "DESKTOP_COMMAND_FAILED", message: caught?.message || String(caught) };
      }
      const completion = await panelJson(`/api/desktop/commands/${encodeURIComponent(command.id)}/result`, {
        method: "PUT",
        body: { lease: command.lease, ok, result, error }
      });
      if (completion?.accepted !== true) {
        const late = new Error("Desktop 操作已经超过服务端等待期限，结果未被确认。请先刷新绑定状态，避免重复操作。");
        late.code = "DESKTOP_COMMAND_RESULT_NOT_ACCEPTED";
        throw late;
      }
      if (ok) await refreshBindings().catch(() => {});
    } catch {
      // The local service may be restarting; future bounded polls retry.
    } finally {
      desktopBusy = false;
    }
  }

  function onNativeNavigation(event) {
    if (event.target?.closest?.(`#${ENTRY_ID}, #${PAGE_ID}, #${SVN_OVERLAY_ID}`)) return;
    const nativeNavigation = event.target?.closest?.("aside nav[role='navigation'] button, aside nav[role='navigation'] a");
    if (active) closePanel();
    if (nativeNavigation) setTimeout(() => void refreshConversationFloat(), 100);
  }

  function sendPanelMessage(type, extra = {}) {
    frame?.contentWindow?.postMessage({ source: "jira-workbench-host", type, ...extra }, "*");
  }

  function sendPanelContext() {
    sendPanelMessage("theme", { theme: theme(), tokens: {} });
    sendPanelMessage("desktop-context", {
      currentThreadId,
      bindingsRevision: bindingRevision,
      projects: desktopProjects
    });
  }

  async function refreshDesktopProjects() {
    if (desktopProjectsRequest) return desktopProjectsRequest;
    desktopProjectsRequest = Promise.resolve(desktopHost.listProjects({ timeoutMs: 8_000 }))
      .then((projects) => {
        desktopProjects = Array.isArray(projects) ? projects : [];
        sendPanelContext();
        return desktopProjects;
      })
      .catch(() => desktopProjects)
      .finally(() => { desktopProjectsRequest = null; });
    return desktopProjectsRequest;
  }

  function closeSvnWorkbench({ restoreFocus = true } = {}) {
    const returnFocus = svnReturnFocus;
    if (svnOverlay) svnOverlay.hidden = true;
    svnFrame = null;
    svnOverlay?.remove();
    svnOverlay = null;
    svnReturnFocus = null;
    if (restoreFocus && returnFocus?.isConnected && typeof returnFocus.focus === "function") {
      window.setTimeout(() => returnFocus.focus({ preventScroll: true }), 0);
    }
    void refreshConversationFloat();
  }

  async function openSvnWorkbench(issueKey) {
    const returnFocus = svnOverlay
      ? svnReturnFocus
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeSvnWorkbench({ restoreFocus: false });
    svnReturnFocus = returnFocus;
    svnOverlay = document.createElement("div");
    svnOverlay.id = SVN_OVERLAY_ID;
    svnOverlay.setAttribute(OWNED, "true");
    svnOverlay.innerHTML = '<section class="svn-shell" role="dialog" aria-modal="true" aria-label="SVN 审核与提交"><button type="button" class="svn-overlay-close" aria-label="关闭 SVN 工作台">×</button></section>';
    svnFrame = document.createElement("iframe");
    svnFrame.title = `${issueKey} SVN 审核与提交`;
    svnFrame.referrerPolicy = "no-referrer";
    svnFrame.style.colorScheme = theme();
    svnFrame.tabIndex = 0;
    svnFrame.addEventListener("load", () => {
      if (svnFrame?.contentDocument?.documentElement?.dataset?.transport === "desktop-bridge") {
        svnOverlay?.classList.add("svn-frame-ready");
      }
    });
    svnOverlay.querySelector(".svn-shell").appendChild(svnFrame);
    svnOverlay.querySelector(".svn-overlay-close").addEventListener("click", () => closeSvnWorkbench());
    svnOverlay.addEventListener("mousedown", (event) => { if (event.target === svnOverlay) closeSvnWorkbench(); });
    document.body.appendChild(svnOverlay);
    window.requestAnimationFrame(() => svnOverlay?.querySelector(".svn-overlay-close")?.focus({ preventScroll: true }));
    svnFrame.srcdoc = `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;font:14px system-ui">正在打开 ${escapeHtml(issueKey)} 的 SVN 工作台…</body></html>`;
    await loadMcpFrame(svnFrame, { openIssueKey: issueKey, openSvn: true, activeTab: "active" });
  }

  async function onPanelMessage(event) {
    const message = event.data;
    if (frame && event.source === frame.contentWindow && message?.source === "jira-workbench") {
      if (message.type === "close" || message.type === "desktop-action-complete") closePanel();
      if (message.type === "ready") {
        sendPanelContext();
        void refreshDesktopProjects();
        if (pendingOpenIssueKey) sendPanelMessage("open-issue", { issueKey: pendingOpenIssueKey });
      }
      if (message.type === "open-issue-ack" && message.issueKey === pendingOpenIssueKey) pendingOpenIssueKey = "";
      if (message.type === "open-svn-workbench" && message.issueKey) void openSvnWorkbench(message.issueKey);
      return;
    }
    if (!svnFrame || event.source !== svnFrame.contentWindow || message?.source !== "jira-workbench-local-ui") return;
    const sourceWindow = event.source;
    const sourceFrame = svnFrame;
    if (message.jsonrpc === "2.0" && message.id !== undefined && message.method) {
      let response;
      try {
        const hostResponse = await hostFetch({
          method: "POST",
          url: new URL("mcp", PANEL_URL).href,
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: message.id, method: message.method, params: message.params })
        });
        response = JSON.parse(decodeText(hostResponse) || "{}");
      } catch (error) {
        response = { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error?.message || String(error) } };
      }
      if (svnFrame === sourceFrame && sourceFrame?.isConnected) sourceWindow?.postMessage(response, "*");
      return;
    }
    if (message.type === "save-state") {
      try { localStorage.setItem(MCP_WIDGET_STATE_KEY, JSON.stringify(message.state || {})); } catch {}
      return;
    }
    if (message.type === "close") {
      closeSvnWorkbench();
      return;
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && svnOverlay) return closeSvnWorkbench();
    if (event.key === "Tab" && svnOverlay) {
      const focusable = [svnOverlay.querySelector(".svn-overlay-close"), svnFrame]
        .filter((control) => control?.isConnected && !control.disabled);
      const first = focusable[0];
      const last = focusable.at(-1);
      const current = document.activeElement;
      if (!svnOverlay.contains(current) || (event.shiftKey && current === first) || (!event.shiftKey && current === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === "Escape" && active) closePanel();
  }

  function onFocusIn(event) {
    if (!svnOverlay || svnOverlay.contains(event.target)) return;
    svnOverlay.querySelector(".svn-overlay-close")?.focus({ preventScroll: true });
  }

  function ensure() {
    ensureEntry();
    if (active) mountPage();
    if (active) sendPanelContext();
  }

  function state() {
    return {
      version: VERSION,
      revision: INJECTION_REVISION,
      mode: "minimal-desktop-host",
      entryMounted: Boolean(document.getElementById(ENTRY_ID)),
      panelMounted: Boolean(document.getElementById(PAGE_ID)),
      conversationFloatMounted: Boolean(document.getElementById(FLOAT_ID)),
      currentThreadId,
      currentIssueKey,
      bindingRevision,
      desktopCommands: { busy: desktopBusy },
      theme: theme(),
      active
    };
  }

  function destroy() {
    destroyed = true;
    observer?.disconnect();
    if (timer) clearInterval(timer);
    document.removeEventListener("click", onNativeNavigation, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    window.removeEventListener("message", onPanelMessage);
    closePanel();
    document.getElementById(ENTRY_ID)?.remove();
    document.getElementById(PAGE_ID)?.remove();
    document.getElementById(FLOAT_ID)?.remove();
    document.getElementById(SVN_OVERLAY_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    for (const pending of bridgeRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Jira 工作台桌面宿主已卸载。"));
    }
    bridgeRequests.clear();
    delete window.__jiraWorkbenchResolveHostFetch;
    delete window.__jiraWorkbenchHostFetch;
    delete window.__jiraWorkbenchPoc;
  }

  document.addEventListener("click", onNativeNavigation, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  window.addEventListener("message", onPanelMessage);
  observer = new MutationObserver(ensure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  timer = setInterval(() => {
    void pollDesktopCommand();
    void refreshConversationFloat();
  }, 700);
  window.__jiraWorkbenchPoc = { version: VERSION, revision: INJECTION_REVISION, ensure, open: openPanel, close: closePanel, state, destroy };
  ensure();
  void refreshDesktopProjects();
  void migrateLegacyState();
  void pollDesktopCommand();
  void refreshConversationFloat();
  return state();
})();
