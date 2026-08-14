import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmbeddedPanelDocument } from "../lib/panel-document.mjs";

test("内嵌完整面板移除外部资源，并安装受限 fetch 与资源桥接", () => {
  const document = createEmbeddedPanelDocument({
    html: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><script type="module" src="/app.js"></script></body></html>',
    styles: "body { color: red; }",
    appSource: 'import { value } from "/prompt-builder.js";\nimport { helper } from "/issue-views.js";\nwindow.result = value + helper;',
    promptBuilderSource: "export const value = 42;",
    issueViewsSource: "export const helper = 8;",
    panelUrl: "http://127.0.0.1:47823/"
  });

  assert.doesNotMatch(document, /href="\/styles\.css"/);
  assert.doesNotMatch(document, /src="\/app\.js"/);
  assert.doesNotMatch(document, /import\s+\{/);
  assert.doesNotMatch(document, /export const/);
  assert.match(document, /window\.__JIRA_CODEX_EMBEDDED__ = true/);
  assert.match(document, /window\.parent\.__jiraCodexHostFetch/);
  assert.match(document, /window\.__jiraCodexAssetUrl/);
  assert.match(document, /body \{ color: red; \}/);
  assert.match(document, /const value = 42/);
  assert.match(document, /const helper = 8/);
  assert.doesNotMatch(document, /<script type="module">/);
});

test("实际完整工作台脚本可以在同一 srcdoc 作用域中编译", async () => {
  const [html, styles, appSource, promptBuilderSource, issueViewsSource] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/prompt-builder.js", import.meta.url), "utf8"),
    readFile(new URL("../public/issue-views.js", import.meta.url), "utf8")
  ]);
  const document = createEmbeddedPanelDocument({
    html,
    styles,
    appSource,
    promptBuilderSource,
    issueViewsSource,
    panelUrl: "http://127.0.0.1:47823/"
  });
  const scripts = Array.from(document.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);

  assert.ok(scripts.length >= 2);
  scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
});

test("官方 MCP Apps 工作台覆盖任务、详情、状态、附件、会话与 SVN", async () => {
  const ui = await readFile(new URL("../mcp/ui/task-board.html", import.meta.url), "utf8");
  for (const label of ["待我处理", "Jira Sheets", "处理历史", "状态流转", "Codex 会话", "SVN 审核与提交"]) {
    assert.match(ui, new RegExp(label));
  }
  assert.match(ui, /requirement-status-filters/);
  assert.match(ui, /bug-status-filters/);
  assert.match(ui, /statusFilters/);
  assert.match(ui, /selectedSheet/);
  assert.match(ui, /jira_preview_issue_attachment/);
  assert.match(ui, /data-preview-attachment/);
  assert.match(ui, /previewableAttachments/);
  assert.match(ui, /父级关联单 · 需求上下文/);
  assert.match(ui, /父子单共同提供需求上下文/);
  assert.match(ui, /aria-label="上一张图片"/);
  assert.match(ui, /aria-label="下一张图片"/);
  assert.match(ui, /svn-tree-dir/);
  assert.match(ui, /body\.svn-mode #svn-view/);
  assert.match(ui, /body\.svn-mode #loading \{ top: 57px; \}/);
  assert.match(ui, /\.svn-workbench-actions button[^}]*-webkit-app-region: no-drag/);
  assert.match(ui, /svn-workbench-header/);
  assert.match(ui, /svn-workbench-grid/);
  assert.match(ui, /svn-project-scope-picker/);
  assert.match(ui, /data-svn-project-scope/);
  assert.match(ui, /projectScopeId: activeSvnProjectScopeId/);
  assert.match(ui, /这个 Jira 关联了 \$\{scopes\.length\} 个项目目录/);
  assert.match(ui, /data-svn-category/);
  assert.match(ui, /人工审核（默认）/);
  assert.match(ui, /Codex 辅助审查/);
  assert.match(ui, /svn_open_issue_external_diff/);
  assert.match(ui, /TortoiseSVN 比较/);
  assert.match(ui, /dblclick/);
  assert.match(ui, /\.svn-file\[data-svn-external-diff\]/);
  assert.match(ui, /data-svn-preview-row/);
  assert.match(ui, /svn-file\.preview-active/);
  assert.match(ui, /needsSvnPreview/);
  assert.doesNotMatch(ui, /class="svn-file-diff"/);
  assert.doesNotMatch(ui, /button\[data-svn-preview\]/);
  assert.match(ui, /createSvnFileInteraction/);
  assert.match(ui, /svnFileInteraction\.click\(event\)/);
  assert.match(ui, /svnFileInteraction\.doubleClick\(event\)/);
  assert.match(ui, /event\.target\.closest\("input, button"\)/);
  assert.match(ui, /event\.target\.closest\("#back-from-svn"\) \|\| event\.target\.closest\("#close-svn-workbench"\)/);
  assert.doesNotMatch(ui, /close-svn-workbench"\)\) && !busy/);
  assert.match(ui, /function svnDraftCommitMessage/);
  assert.match(ui, /id="svn-summary" type="text" maxlength="500"/);
  assert.match(ui, /id="svn-message-preview"/);
  assert.match(ui, /svn-commit-message-card/);
  assert.match(ui, /syncSvnCommitMessagePreview/);
  assert.match(ui, /\.svn-message \{ background: var\(--panel\); color: var\(--text\); \}/);
  assert.match(ui, /data-svn-scroll="workbench"/);
  assert.match(ui, /document\.body\.classList\.add\("svn-mode"\)/);
  assert.match(ui, /codex_create_and_bind_issue_analysis/);
  assert.match(ui, /codex_open_bound_issue_thread/);
  assert.match(ui, /jira_get_bug_monitor_status/);
  assert.match(ui, /jira_set_bug_monitor_enabled/);
  assert.match(ui, /jira_get_update_status/);
  assert.match(ui, /id="version-status"/);
  assert.match(ui, /__JIRA_CODEX_VERSION__/);
  assert.match(ui, /ui\/initialize/);
  assert.match(ui, /tools\/call/);
  assert.match(ui, /ui\/open-link/);
  assert.match(ui, /LOCAL_TRANSPORT/);
  assert.match(ui, /new URL\("\/mcp", window\.location\.origin\)/);
  assert.match(ui, /jira-codex-local-ui/);
  assert.doesNotThrow(() => new Function(ui.match(/<script>([\s\S]*?)<\/script>/)?.[1] || ""));
});

test("SVN 文件行区分单击预览与双击 TortoiseSVN，且交互控件不会误触发", async () => {
  const ui = await readFile(new URL("../mcp/ui/task-board.html", import.meta.url), "utf8");
  const start = ui.indexOf("function createSvnFileInteraction");
  const end = ui.indexOf("/* SVN_FILE_INTERACTION_END */");
  assert.ok(start >= 0 && end > start);
  const createInteraction = new Function(`${ui.slice(start, end)}\nreturn createSvnFileInteraction;`)();

  let nextTimer = 0;
  const timers = new Map();
  const previews = [];
  const externals = [];
  const selections = [];
  let loadedPath = "";
  const interaction = createInteraction({
    delay: 260,
    setTimer(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
    canRun: () => true,
    select: (path) => selections.push(path),
    needsPreview: (path) => loadedPath !== path,
    preview: (path) => { loadedPath = path; previews.push(path); },
    external: (path) => externals.push(path)
  });
  const row = { dataset: { svnPreviewRow: "src/example.go", svnExternalDiff: "src/example.go" } };
  const target = {
    closest(selector) {
      if (selector === "input, button") return null;
      if (selector === ".svn-file[data-svn-preview-row], .svn-selected-row[data-svn-preview-row]") return row;
      if (selector === ".svn-file[data-svn-external-diff], .svn-selected-row[data-svn-external-diff], .svn-diff[data-svn-external-diff]") return row;
      return null;
    }
  };
  const event = () => ({ target, prevented: false, preventDefault() { this.prevented = true; } });

  assert.equal(interaction.click(event()), true);
  assert.equal(interaction.hasPendingPreview(), true);
  assert.deepEqual(previews, []);
  assert.equal(interaction.click(event()), true);
  assert.equal(timers.size, 1, "双击产生的第二次 click 应替换首次预览计时器");
  assert.equal(interaction.doubleClick(event()), true);
  assert.equal(interaction.hasPendingPreview(), false);
  assert.equal(timers.size, 0, "dblclick 必须先取消内置预览，避免 busy 竞态");
  assert.deepEqual(previews, []);
  assert.deepEqual(externals, ["src/example.go"]);

  assert.equal(interaction.click(event()), true);
  const [singleClickTimer] = timers.values();
  timers.clear();
  singleClickTimer();
  assert.deepEqual(previews, ["src/example.go"], "没有后续双击时应加载内置差异");

  assert.equal(interaction.click(event()), true);
  assert.equal(timers.size, 0, "重复点击已加载的同一文件不应再次调度差异请求");
  assert.deepEqual(previews, ["src/example.go"]);
  assert.ok(selections.length >= 3, "单击和双击均应立即更新文件行选中状态");

  const buttonTarget = { closest: (selector) => selector === "input, button" ? {} : row };
  assert.equal(interaction.click({ target: buttonTarget, preventDefault() {} }), false);
  assert.equal(interaction.doubleClick({ target: buttonTarget, preventDefault() {} }), false);
  assert.equal(timers.size, 0, "checkbox 和差异按钮不应进入文件行延迟逻辑");
  assert.match(ui, /preview: \(path\) => void loadSvnPreview\(path\)/);
  assert.match(ui, /busyScope: "svn-preview"/);
  assert.match(ui, /function syncSvnPreviewLoading/);
  assert.match(ui, /\.svn-preview-loading \{ position: absolute; inset: 0/);
  assert.match(ui, /if \(!localBusy\) setBusy\(true, busyText\)/);
});

test("设置面板保留七个独立分组和数据同步配置", async () => {
  const [html, styles, configSource, appSource] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../config-store.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8")
  ]);
  for (const section of ["jira", "codex", "sync", "update", "automation", "templates", "advanced"]) {
    assert.match(html, new RegExp(`data-settings-section-tab="${section}"`));
    assert.match(html, new RegExp(`data-settings-section="${section}"`));
  }
  for (const id of ["sync-tasks-enabled", "sync-task-interval", "sync-on-panel-return", "sync-sheets-interval"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-settings-section-tab="update"[^>]*>[\s\S]*?<span>版本更新<\/span>/);
  assert.match(html, /class="update-settings-card field-wide" data-settings-section="update"/);
  assert.doesNotMatch(html, /class="update-settings-card field-wide" data-settings-section="sync"/);
  const settingsTabOrder = Array.from(html.matchAll(/data-settings-section-tab="([^"]+)"/g), (match) => match[1]);
  assert.equal(settingsTabOrder.at(-1), "update");
  assert.match(styles, /\.settings-dialog form/);
  assert.match(html, /dataset\.view = "settings-only"/);
  assert.match(styles, /:root\[data-view="settings-only"\] \.app-shell/);
  assert.match(styles, /:root\[data-view="settings-only"\] \.settings-dialog \{ inset: 0; width: 100%; height: 100%/);
  assert.match(appSource, /scheduleSyncTimers/);
  assert.match(appSource, /openSettingsFromLocation/);
  assert.match(appSource, /loadCodexPanelContext/);
  assert.match(appSource, /expectedRevision: revisionBeforeRequest/);
  assert.match(appSource, /error\?\.details\?\.stage === "created_unbound"/);
  assert.doesNotMatch(appSource, /recreateAnalysis && state\.bindings\[key\]/);
  assert.match(appSource, /if \(SETTINGS_ONLY_VIEW\)/);
  assert.match(configSource, /DEFAULT_SYNC_SETTINGS/);
});

test("桌面注入以完整 public 工作台为主 UI，官方 MCP Apps 仍作为插件能力保留", async () => {
  const [client, navigation, commands, injector, pluginManifest, mcpUi] = await Promise.all([
    readFile(new URL("../inject/client.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/codex-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/codex-application-commands.mjs", import.meta.url), "utf8"),
    readFile(new URL("../injector.mjs", import.meta.url), "utf8"),
    readFile(new URL("../plugins/jira-codex-assistant/.codex-plugin/plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../mcp/ui/task-board.html", import.meta.url), "utf8")
  ]);
  const stripExports = (source) => source.replace(/\bexport\s+(?=(?:const|function|class|async\s+function)\b)/g, "");
  const compiled = client
    .replace("/*__JIRA_CODEX_NAVIGATION_HELPERS__*/", stripExports(navigation))
    .replace("/*__JIRA_CODEX_APPLICATION_COMMANDS__*/", stripExports(commands));
  assert.doesNotThrow(() => new Function(compiled));
  assert.match(client, /mode: "minimal-desktop-host"/);
  assert.match(client, /jira-codex-conversation-float/);
  assert.doesNotMatch(client, /data-open-thread/);
  assert.doesNotMatch(client, /openConversation\(binding\.threadId\)/);
  assert.match(client, /PANEL_DOCUMENT/);
  assert.match(client, /(?:target|frame)\.srcdoc\s*=\s*PANEL_DOCUMENT/);
  assert.match(client, /#\$\{PAGE_ID\} \{ position: absolute/);
  assert.match(client, /function findPageMount\(/);
  assert.match(client, /surface\.setAttribute\(HOST/);
  assert.doesNotMatch(client, /codex:\/\/plugins\/jira-codex-assistant/);
  assert.match(client, /\/api\/desktop\/commands\/next/);
  assert.match(client, /command\.type === "open-thread"/);
  assert.match(client, /command\.type === "create-analysis"/);
  assert.match(client, /codexCommands\.currentConversation/);
  assert.match(client, /desktopHost\.listProjects/);
  assert.match(client, /projects: desktopProjects/);
  assert.match(client, /\/api\/bindings\/import/);
  assert.match(client, /\/api\/automation\/monitor\/import/);
  assert.doesNotMatch(client, /threadRows|projectWorkspaceFromRow|runBugMonitor/);
  assert.doesNotMatch(client, /localStorage\.setItem\(BINDINGS_KEY/);
  assert.doesNotMatch(client, /data-app-action-sidebar-thread-id|data-app-action-sidebar-project-id|__reactProps\$/);
  assert.match(injector, /createEmbeddedPanelDocument/);
  assert.match(injector, /readFile\(join\(root, "public", "index\.html"\), "utf8"\)/);
  assert.match(injector, /readFile\(join\(root, "public", "styles\.css"\), "utf8"\)/);
  assert.match(injector, /readFile\(join\(root, "public", "app\.js"\), "utf8"\)/);
  assert.match(injector, /readFile\(join\(root, "public", "prompt-builder\.js"\), "utf8"\)/);
  assert.match(injector, /readFile\(join\(root, "public", "issue-views\.js"\), "utf8"\)/);
  assert.match(injector, /const panelDocument = createEmbeddedPanelDocument/);
  assert.match(injector, /__JIRA_CODEX_POC_PANEL_DOCUMENT__/);
  assert.ok((injector.match(/window\.__JIRA_CODEX_BRIDGE_TOKEN__\s*=/g) || []).length >= 2,
    "injector restart must refresh the live page bridge token even when the UI revision is current");
  assert.match(injector, /new Set\(\["GET", "POST", "PUT", "DELETE"\]\)/);
  assert.match(pluginManifest, /"mcpServers"\s*:\s*"\.\/\.mcp\.json"/);
  assert.match(mcpUi, /ui\/initialize/);
  assert.match(mcpUi, /tools\/call/);
});

test("服务端持有监控、绑定、项目目录与 SVN 新流程的数据源", async () => {
  const [server, bindings, conversations, monitor, svn] = await Promise.all([
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/issue-binding-store.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/codex-conversation-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/bug-monitor-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/svn-review-manager.mjs", import.meta.url), "utf8")
  ]);
  assert.match(bindings, /legacyImportCompletedAt/);
  assert.match(bindings, /ISSUE_BINDINGS_REVISION_CONFLICT/);
  assert.match(bindings, /normalizeBindingWorkspace/);
  assert.doesNotMatch(conversations, /listWorkspaces|resolveWorkspace/);
  assert.match(conversations, /codex\.listThreads/);
  assert.match(monitor, /Persistent, page-independent Bug monitor/);
  assert.match(monitor, /runtime\.startReadOnlyAnalysis/);
  assert.match(server, /bugMonitor\.start\(\)/);
  assert.match(server, /desktopCommands\.request\("create-analysis"/);
  assert.match(server, /expectedRevision: baselineRevision/);
  assert.match(server, /code: "ISSUE_ANALYSIS_CREATED_UNBOUND"/);
  assert.match(server, /stage: "created_unbound"/);
  assert.match(server, /config\.codexProjectPath/);
  assert.doesNotMatch(server, /\/api\/codex\/workspaces/);
  assert.match(server, /scheduleIssueBaselines/);
  assert.match(server, /svnWorkbench\.recordBaselines/);
  assert.doesNotMatch(server, /buildIssueDetailSnapshot\(await jiraWorkbench\.getIssue/);
  assert.match(svn, /bindingWorkspace|turnReader/);
  assert.match(svn, /sessionReader/); // 只保留旧记录恢复兼容。
});

test("完整本地设置 UI 本身仍支持深浅主题和首页状态筛选", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);
  assert.match(appSource, /inboxStatusFilters: \{ requirement: \[\], bug: \[\] \}/);
  assert.match(appSource, /createLaneStatusFilter/);
  assert.match(styles, /:root\[data-theme="dark"\]/);
  assert.match(styles, /\.lane-status-button\.active/);
});

test("完整面板支持一个 Jira 关联多个项目目录并指定主目录", async () => {
  const [html, appSource, styles, inject] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../inject/client.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="rebind-project-options"/);
  assert.match(html, /id="rebind-project-count"/);
  assert.match(appSource, /function selectedRebindWorkspace/);
  assert.match(appSource, /projectScopes,/);
  assert.match(appSource, /defaultProjectScopeId: primary\.id/);
  assert.match(appSource, /workspaceSelection: workspace \? "explicit" : "none"/);
  assert.match(appSource, /workspaceSelection: workspace \? "explicit" : "thread"/);
  assert.match(styles, /\.rebind-project-option\.selected/);
  assert.match(styles, /\.binding-project-chip\.primary/);
  assert.match(inject, /关联项目目录 · \$\{projectScopes\.length\}/);
  assert.match(inject, /SVN 操作会先要求选择一个明确目录/);
});

test("完整面板的图片附件支持画廊切换，文档附件下载后再本地打开", async () => {
  const [html, appSource, styles, server] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="previous-preview-image"/);
  assert.match(html, /id="next-preview-image"/);
  assert.match(appSource, /attachmentPreviewGallery/);
  assert.match(html, /id="parent-context-section"/);
  assert.match(html, /id="detail-parent-attachments"/);
  assert.match(appSource, /issueContextAttachments/);
  assert.match(appSource, /renderParentContext/);
  assert.match(appSource, /loadIssueDetailContext/);
  assert.match(styles, /\.parent-context-section/);
  assert.match(appSource, /navigateAttachmentPreview\(-1\)/);
  assert.match(appSource, /navigateAttachmentPreview\(1\)/);
  assert.match(appSource, /event\.key === "ArrowLeft"/);
  assert.match(appSource, /event\.key === "ArrowRight"/);
  assert.match(appSource, /attachmentCanOpenLocally/);
  assert.match(appSource, /\/materialize/);
  assert.match(appSource, /\/open/);
  assert.match(appSource, /已下载，再次点击即可打开/);
  assert.match(styles, /\.attachment-preview-nav\.previous/);
  assert.match(styles, /\.attachment-card\.locally-cached/);
  assert.match(server, /ATTACHMENT_NOT_MATERIALIZED/);
  assert.match(server, /ATTACHMENT_LOCAL_OPEN_NOT_ALLOWED/);
});

test("完整面板提供默认开启的 GitHub 更新检查与顶部版本提示", async () => {
  const [html, appSource, styles, server] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="version-badge"/);
  assert.match(html, /id="update-check-enabled"/);
  assert.match(html, /id="check-updates-now"/);
  assert.match(html, /id="download-update"/);
  assert.match(html, /id="restart-update"/);
  assert.doesNotMatch(html, /id="reset-update-state"/);
  assert.match(html, /id="update-operation"/);
  assert.match(html, /data-update-step="prepare"/);
  assert.match(html, /data-update-step="install"/);
  assert.match(html, /data-update-step="restart"/);
  assert.doesNotMatch(html, /id="update-operation-(?:indicator|progress)"/);
  assert.match(appSource, /updateCheckEnabled: true/);
  assert.match(appSource, /\/api\/update-status/);
  assert.match(appSource, /\/api\/update\/download/);
  assert.match(appSource, /\/api\/update\/restart/);
  assert.doesNotMatch(appSource, /\/api\/update\/reset/);
  assert.match(appSource, /重启助手会先正常关闭所有 Codex 窗口/);
  assert.match(appSource, /若窗口关闭后仍残留后台进程/);
  assert.match(appSource, /localizedUpdateError/);
  assert.match(appSource, /localizedUpdateMessage/);
  assert.match(appSource, /重新打开后会自动确认更新并清理临时状态/);
  assert.match(appSource, /waiting_for_service/);
  assert.match(appSource, /renderUpdateOperation/);
  assert.match(appSource, /可更新 v/);
  assert.match(styles, /\.version-badge\.update-available/);
  assert.match(styles, /\.update-settings-card/);
  assert.match(styles, /\.update-operation-steps/);
  assert.match(styles, /\.update-operation\.needs-restart/);
  assert.match(styles, /\.update-check-detail::before/);
  assert.match(styles, /\.update-operation-steps li:not\(:last-child\)::after/);
  assert.match(styles, /"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI"/);
  assert.doesNotMatch(styles, /font-family:\s*Inter/);
  assert.doesNotMatch(styles, /font-size:\s*(?:9|10)px/);
  assert.doesNotMatch(styles, /font-weight:\s*(?:450|620|650|680|750)/);
  assert.doesNotMatch(styles, /\.update-operation-progress/);
  assert.match(server, /createGitHubUpdateChecker/);
  assert.match(server, /createUpdateManager/);
  assert.match(server, /UPDATE_BLOCKED_BY_ACTIVE_OPERATION|blockerProvider/);
  assert.match(server, /autoInstall: true/);
  assert.match(server, /url\.pathname === "\/api\/update\/restart"/);
  assert.doesNotMatch(server, /url\.pathname === "\/api\/update\/(?:install|reset)"/);
  assert.match(server, /url\.pathname === "\/api\/update-status"/);
});

test("完整面板优先加载 Jira，并渐进补齐 App Server 上下文", async () => {
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const bootSource = appSource.slice(appSource.indexOf("async function boot()"), appSource.indexOf("function openSettingsFromLocation"));
  assert.ok(bootSource.indexOf('api("/api/config")') < bootSource.indexOf("loadCodexPanelContext"));
  assert.match(bootSource, /void loadCodexPanelContext\(\{ quiet: true \}\)/);
  assert.ok(bootSource.indexOf("await loadIssues()") < bootSource.indexOf("loadJxlSheets"));
  assert.match(appSource, /const bindingTask = api\("\/api\/bindings"\)/);
  assert.match(appSource, /const conversationTask = api\("\/api\/codex\/conversations\?limit=200"\)/);
  assert.doesNotMatch(appSource, /\/api\/codex\/workspaces/);
  assert.match(appSource, /Array\.isArray\(message\.projects\)/);
  assert.match(appSource, /loadCodexSkillsForConfiguredProject/);
});

test("会话浮窗在 Jira 短暂失败时保留占位并自动退避恢复，SVN 浮层管理焦点", async () => {
  const client = await readFile(new URL("../inject/client.js", import.meta.url), "utf8");
  assert.match(client, /暂时无法读取任务详情/);
  assert.match(client, /任务关联仍然有效；本地服务恢复后会自动重新读取详情/);
  assert.match(client, /data-retry-float/);
  assert.match(client, /Math\.min\(120_000, 5_000 \* \(2 \*\*/);
  assert.match(client, /Date\.now\(\) >= Number\(floatState\.nextRetryAt/);
  assert.match(client, /svnReturnFocus/);
  assert.match(client, /svn-frame-ready/);
  assert.match(client, /dataset\?\.transport === "desktop-bridge"/);
  assert.match(client, /-webkit-app-region: no-drag !important/);
  assert.match(client, /function onFocusIn/);
  assert.match(client, /event\.key === "Tab" && svnOverlay/);
  assert.match(client, /\.svn-overlay-close"\)\?\.focus/);
  assert.match(client, /bounds\?\.width > 320 && bounds\?\.height > 280/);
  assert.match(client, /surface\.querySelectorAll\("webview"\)/);
  assert.match(client, /hideNativeHeader\(surface\)/);
});
