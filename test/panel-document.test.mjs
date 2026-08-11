import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmbeddedPanelDocument } from "../lib/panel-document.mjs";

test("内嵌面板移除外部资源，并安装受限 fetch 桥接", () => {
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
  assert.match(document, /body \{ color: red; \}/);
  assert.match(document, /const value = 42/);
  assert.match(document, /const helper = 8/);
  assert.doesNotMatch(document, /<script type="module">/);
});

test("实际内嵌面板脚本可以在同一作用域中编译", async () => {
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

  assert.equal(scripts.length, 2);
  scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
});

test("设置面板包含六个分组和可持久化的数据同步控件", async () => {
  const [html, styles, configSource, appSource] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../config-store.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8")
  ]);
  for (const section of ["jira", "codex", "sync", "automation", "templates", "advanced"]) {
    assert.match(html, new RegExp(`data-settings-section-tab="${section}"`));
    assert.match(html, new RegExp(`data-settings-section="${section}"`));
  }
  for (const id of ["sync-tasks-enabled", "sync-task-interval", "sync-on-panel-return", "sync-sheets-interval"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(styles, /\.settings-dialog form \{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\) auto auto/);
  assert.match(styles, /\.form-grid \{[^}]*overflow: auto/);
  assert.match(styles, /\.settings-actions \{[^}]*min-height: 62px/);
  assert.match(appSource, /syncOnPanelReturn/);
  assert.match(appSource, /scheduleSyncTimers/);
  assert.match(configSource, /DEFAULT_SYNC_SETTINGS/);
});

test("首页需求和 Bug 面板支持独立的状态筛选", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);
  assert.match(appSource, /inboxStatusFilters: \{ requirement: \[\], bug: \[\] \}/);
  assert.match(appSource, /function issueStatusName\(issue\)/);
  assert.match(appSource, /function createLaneStatusFilter\(type, issues, selectedStatuses\)/);
  assert.match(appSource, /showStatusFilter: !history/);
  assert.match(appSource, /state\.inboxStatusFilters\[type\] = Array\.from\(next\)/);
  assert.match(appSource, /状态筛选（可多选）/);
  assert.match(appSource, /selectedStatuses\.includes\(issueStatusName\(issue\)\)/);
  assert.match(styles, /\.lane-status-filter/);
  assert.match(styles, /\.lane-status-button\.active/);
});

test("Codex 宿主注入脚本包含会话 Jira 浮窗并可编译", async () => {
  const [clientSource, navigationSource, applicationCommandsSource, promptBuilderSource, injectorSource] = await Promise.all([
    readFile(new URL("../inject/client.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/codex-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/codex-application-commands.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/prompt-builder.js", import.meta.url), "utf8"),
    readFile(new URL("../injector.mjs", import.meta.url), "utf8")
  ]);
  const stripExports = (source) => source.replace(
    /\bexport\s+(?=(?:const|function|class|async\s+function)\b)/g,
    ""
  );
  const compiled = clientSource
    .replace("/*__JIRA_CODEX_NAVIGATION_HELPERS__*/", stripExports(navigationSource))
    .replace("/*__JIRA_CODEX_APPLICATION_COMMANDS__*/", stripExports(applicationCommandsSource))
    .replace("/*__JIRA_CODEX_PROMPT_HELPERS__*/", stripExports(promptBuilderSource));

  assert.doesNotThrow(() => new Function(compiled));
  assert.match(clientSource, /jira-codex-conversation-float/);
  assert.match(clientSource, /jira-codex-svn-modal/);
  assert.match(clientSource, /\[\$\{HOST_ATTRIBUTE\}="true"\][\s\S]*?pointer-events: auto !important;/);
  assert.match(clientSource, /\/api\/svn\/reviews/);
  assert.match(clientSource, /确认提交到 SVN/);
  assert.match(clientSource, /我已完成本次改动审核/);
  assert.match(clientSource, /理解上述风险/);
  assert.doesNotMatch(clientSource, /我理解上述风险并仍要提交/);
  assert.match(clientSource, /本次提交方式/);
  assert.match(clientSource, /人工审核（默认）/);
  assert.match(clientSource, /Codex 辅助审查/);
  assert.match(clientSource, /可能耗时较长/);
  assert.match(clientSource, /必须等待审查完成，或主动取消并降级为人工审核/);
  assert.match(clientSource, /jira-codex-svn-mode-options/);
  assert.match(clientSource, /codexReviewEnabled: false/);
  assert.match(clientSource, /const preserveBodyScroll = state\.renderedViewKey === nextViewKey/);
  assert.match(clientSource, /state\.bodyScrollTop = body\.scrollTop/);
  assert.match(clientSource, /nextTree\.scrollTop = treeScrollTop/);
  assert.match(clientSource, /nextPreview\.scrollLeft = previewScrollLeft/);
  assert.match(clientSource, /function reconcileIssueBinding/);
  assert.match(clientSource, /createLegacyCodexHostAdapter\(\)/);
  assert.match(clientSource, /createPanelCodexRuntimeAdapter\(\{ request: panelJson \}\)/);
  assert.match(clientSource, /createCodexRuntimeSelector/);
  assert.match(clientSource, /createCodexApplicationCommands/);
  assert.match(clientSource, /codexRuntime: codexCommands\.snapshot\(\)/);
  assert.match(clientSource, /\/api\/bindings\/import/);
  assert.match(clientSource, /\/api\/bindings\/mutations/);
  assert.match(clientSource, /runtimeOwner: started\.runtimeOwner/);
  assert.match(clientSource, /desktopHandoff: !automated/);
  assert.match(clientSource, /waitForAppServerHandoff\(normalizedThreadId\)/);
  assert.match(clientSource, /allowRuntimeFallback: false/);
  assert.match(clientSource, /updateBindingRuntimeOwner/);
  assert.match(clientSource, /uiThreadId: provisionalThreadId/);
  assert.match(clientSource, /codexCommands\.resolveConversationId\(provisionalThreadId/);
  assert.match(clientSource, /bindingMatchesThread\(binding, row\.getAttribute/);
  assert.match(clientSource, /manual_review/);
  assert.match(clientSource, /conversationBindingForThread/);
  assert.match(clientSource, /async function bindIssueToThread/);
  assert.match(clientSource, /codexCommands\.readConversation\(normalizedThreadId/);
  assert.doesNotMatch(clientSource, /codexHost\./);
  assert.match(clientSource, /function retryIssuePrompt/);
  assert.match(clientSource, /firstMessageStatus: "pending"/);
  assert.match(clientSource, /\/api\/issues\/\$\{encodeURIComponent\(state\.issueKey\)\}/);
  assert.match(injectorSource, /new Set\(\["GET", "POST", "PUT", "DELETE"\]\)/);
});

test("任务详情可解除持久化会话绑定且不删除任务或对话", async () => {
  const [html, appSource, clientSource] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../inject/client.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="clear-binding-action"/);
  assert.match(html, /id="clear-binding-dialog"/);
  assert.match(html, /只清除关联记录/);
  assert.match(html, /不会删除或归档 Codex 对话/);
  assert.match(appSource, /type: "clear-task-binding"/);
  assert.match(appSource, /message\.type === "binding-cleared"/);
  assert.match(clientSource, /async function clearIssueBinding/);
  assert.match(clientSource, /body: \{ upserts: \{\}, deletes: \[normalizedIssueKey\] \}/);
  assert.match(clientSource, /writeStoredObject\(BINDINGS_KEY, bindings, \{ persist: false \}\)/);
  assert.match(clientSource, /removeConversationIssueFloat\(\)/);

  const clearStart = clientSource.indexOf("  async function clearIssueBinding");
  const clearEnd = clientSource.indexOf("  async function retryIssuePrompt", clearStart);
  const clearSource = clientSource.slice(clearStart, clearEnd);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  assert.doesNotMatch(clearSource, /archiveConversation|deleteConversation|\/api\/issues|\/api\/svn/);
});

test("完整面板和会话浮窗跟随 Codex 深浅主题", async () => {
  const [clientSource, appSource, styles] = await Promise.all([
    readFile(new URL("../inject/client.js", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(clientSource, /electron-dark/);
  assert.match(clientSource, /--color-token-main-surface-primary/);
  assert.match(clientSource, /sendPanelMessage\("theme", snapshot\)/);
  assert.match(clientSource, /attributeFilter: \["class", "style"\]/);
  assert.match(clientSource, /normalizeCodexThemeTokens/);
  assert.match(clientSource, /surfaceMatchesTheme/);
  assert.match(clientSource, /buttonContrast < 4\.5/);
  assert.match(clientSource, /tokenSource: "fallback"/);
  assert.match(appSource, /message\.type === "theme"/);
  assert.match(appSource, /--codex-theme-\$\{key\}/);
  assert.match(styles, /:root\[data-theme="dark"\]/);
  assert.match(styles, /--panel-bg: var\(--codex-theme-bg/);
  assert.match(styles, /Codex host theme bridge/);
  assert.match(styles, /\.issue-action-group \{[^}]*margin-left: auto;/);
  assert.match(styles, /\.top-actions \.icon-button \{[^}]*width: 40px; height: 40px; min-width: 40px;/);
  assert.doesNotMatch(styles, /\.top-actions \.icon-button::after/);
  assert.match(appSource, /topActions\.addEventListener\("click"/);
});

test("SVN 选择器按项目构建文件树、分类变更并加载单文件差异", async () => {
  const clientSource = await readFile(new URL("../inject/client.js", import.meta.url), "utf8");
  const helperStart = clientSource.indexOf("  function svnChangeSelectable");
  const helperEnd = clientSource.indexOf("  function svnVerdictLabel");
  const helperSource = clientSource.slice(helperStart, helperEnd);
  const helpers = new Function(`${helperSource}\nreturn { svnChangeSelectable, svnChangeCategory, buildSvnChangeTree };`)();
  const context = { workingCopy: { scopePath: "server/project", scopeName: "project" } };
  const changes = [
    { path: "server/project/src/player.go", item: "modified", kind: "file", recommended: true },
    { path: "server/project/conf/club.json", item: "modified", kind: "file", preExisting: true },
    { path: "server/project/tmp/output.log", item: "unversioned", kind: "unknown" }
  ];
  const tree = helpers.buildSvnChangeTree(changes, context);

  assert.equal(helpers.svnChangeSelectable(changes[0]), true);
  assert.equal(helpers.svnChangeCategory(changes[0]), "reviewable");
  assert.equal(helpers.svnChangeCategory(changes[1]), "blocked");
  assert.equal(helpers.svnChangeCategory(changes[2]), "unmanaged");
  assert.equal(tree.name, "project");
  assert.deepEqual(tree.children.map((node) => node.name), ["conf", "src", "tmp"]);
  assert.deepEqual(tree.selectablePaths, ["server/project/src/player.go"]);
  assert.match(clientSource, /\/api\/svn\/diff\?threadId=/);
  assert.match(clientSource, /系统已推荐并初选/);
  assert.match(clientSource, /jira-codex-svn-change-browser/);
});

test("新版 Codex 项目行可为 App Server 提供本地工作目录", async () => {
  const clientSource = await readFile(new URL("../inject/client.js", import.meta.url), "utf8");
  const helperStart = clientSource.indexOf("  function projectWorkspaceFromRow");
  const helperEnd = clientSource.indexOf("  function availableProjects");
  const helperSource = clientSource.slice(helperStart, helperEnd);
  const resolveWorkspace = new Function(`${helperSource}\nreturn projectWorkspaceFromRow;`)();
  const row = {};
  row["__reactProps$test"] = {
    children: [{ props: { group: {
      projectId: "project-1",
      path: "F:\\workspace",
      rootPaths: ["F:\\workspace"]
    } } }]
  };
  assert.deepEqual(resolveWorkspace(row, "project-1"), {
    projectPath: "F:\\workspace",
    rootPaths: ["F:\\workspace"]
  });
  assert.match(clientSource, /cwd: projectWorkspace\?\.projectPath \|\| ""/);
});

test("SVN 语义审查在当前绑定会话启动真实 turn 并支持人工取消降级", async () => {
  const clientSource = await readFile(new URL("../inject/client.js", import.meta.url), "utf8");
  assert.match(clientSource, /function dispatchCurrentConversationSvnReview/);
  assert.match(clientSource, /\/api\/svn\/reviews\/\$\{encodeURIComponent\(review\.id\)\}\/dispatch/);
  assert.match(clientSource, /codexCommands\.sendAnalysisMessage/);
  assert.match(clientSource, /attachments: \(review\.artifacts \|\| \[\]\)/);
  assert.match(clientSource, /codexCommands\.interruptAnalysis/);
  assert.match(clientSource, /auditTurnId/);
  assert.match(clientSource, /function cancelSvnCodexReview/);
  assert.match(clientSource, /返回文件选择并重新扫描/);
  assert.match(clientSource, /function restartSvnReviewFromLatest/);
  assert.match(clientSource, /resetSvnSelectionForReload/);
  assert.doesNotMatch(clientSource, /function dispatchIndependentSvnAudit/);
  assert.doesNotMatch(clientSource, /attachLocalFilesToComposer\(composerInput, artifacts\)/);
});

test("旧版分步创建的桌面会话可识别首个 turn 状态和失效创建窗口", async () => {
  const clientSource = await readFile(new URL("../inject/client.js", import.meta.url), "utf8");
  assert.match(clientSource, /function bindingNeedsInitialDesktopTurn/);
  assert.match(clientSource, /function bindingHasUnavailableCreationWindow/);
  assert.match(clientSource, /not materialized yet\|no rollout found/);
  assert.match(clientSource, /knownLoadedThread: true/);
  assert.match(clientSource, /freshDesktopThread: status === "sent" \? false : bindingNeedsInitialDesktopTurn/);

  const directStart = clientSource.indexOf("        if (freshDesktopThread) {");
  const directEnd = clientSource.indexOf(
    "        try {\n          if (started.runtimeOwner === CODEX_APPLICATION_RUNTIME_OWNER.APP_SERVER",
    directStart
  );
  const directSource = clientSource.slice(directStart, directEnd);
  assert.ok(directStart >= 0 && directEnd > directStart);
  assert.ok(
    directSource.indexOf("submitStructuredIssuePrompt")
      < directSource.indexOf("codexCommands.openConversation")
  );
  assert.doesNotMatch(directSource, /waitForLegacyConversationReady/);

  const helperStart = clientSource.indexOf("  function bindingNeedsInitialDesktopTurn");
  const helperEnd = clientSource.indexOf("  function composerAttachmentCount", helperStart);
  const needsInitialTurn = new Function(
    `${clientSource.slice(helperStart, helperEnd)}\nreturn bindingNeedsInitialDesktopTurn;`
  )();
  assert.equal(needsInitialTurn({ freshDesktopThread: true }), true);
  assert.equal(needsInitialTurn({
    firstMessageStatus: "failed",
    firstMessageError: "thread is not materialized yet; includeTurns is unavailable before first user message"
  }), true);
  assert.equal(needsInitialTurn({ firstMessageStatus: "sent" }), false);

  const hasUnavailableCreationWindow = new Function(
    `${clientSource.slice(helperStart, helperEnd)}\nreturn bindingHasUnavailableCreationWindow;`
  )();
  assert.equal(hasUnavailableCreationWindow({
    firstMessageStatus: "failed",
    firstMessageError: "Please continue this conversation on the window where it was started."
  }), true);
  assert.equal(hasUnavailableCreationWindow({ firstMessageStatus: "sent" }), false);
  assert.match(clientSource, /更改关联 → 新建并绑定/);
});

test("原子创建的新会话直接显示已加载线程，不读取尚未落盘的 rollout", async () => {
  const clientSource = await readFile(new URL("../inject/client.js", import.meta.url), "utf8");
  assert.match(
    clientSource,
    /const knownLoadedThread = started\.knownLoadedThread === true[\s\S]*CODEX_APPLICATION_RUNTIME_OWNER\.LEGACY_DESKTOP/
  );
  assert.match(
    clientSource,
    /codexCommands\.openConversation\(normalizedThreadId, knownLoadedThread \? \{[\s\S]*knownLoadedThread: true,[\s\S]*hostId: started\.hostId \|\| "local"/
  );
  assert.match(clientSource, /if \(knownLoadedThread\) \{[\s\S]*补充显示请求失败/);
});

test("主题桥接拒绝与深浅模式冲突或低对比度的宿主令牌", async () => {
  const clientSource = await readFile(new URL("../inject/client.js", import.meta.url), "utf8");
  const helperStart = clientSource.indexOf("  function themeTokenRgb");
  const helperEnd = clientSource.indexOf("  function readCodexThemeSnapshot");
  const helperSource = clientSource.slice(helperStart, helperEnd);
  const normalize = new Function(`${helperSource}\nreturn normalizeCodexThemeTokens;`)();

  assert.deepEqual(
    normalize("dark", { surface: "#ffffff", text: "#1a1c1f", button: "#1a1c1f", "on-button": "#ffffff" }),
    { tokens: {}, tokenSource: "fallback" }
  );

  const lowContrast = normalize("dark", {
    surface: "#202123",
    text: "#f2f3f5",
    button: "rgb(242, 243, 245)",
    "on-button": "#ffffff"
  });
  assert.equal(lowContrast.tokenSource, "host-with-button-fallback");
  assert.equal(lowContrast.tokens.text, "#f2f3f5");
  assert.equal(lowContrast.tokens.button, undefined);
  assert.equal(lowContrast.tokens["on-button"], undefined);

  assert.equal(normalize("light", {
    surface: "#ffffff",
    button: "#1a1c1f",
    "on-button": "#ffffff"
  }).tokenSource, "host");
});
