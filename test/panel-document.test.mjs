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

test("Codex 宿主注入脚本包含会话 Jira 浮窗并可编译", async () => {
  const [clientSource, navigationSource, promptBuilderSource, injectorSource] = await Promise.all([
    readFile(new URL("../inject/client.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/codex-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/prompt-builder.js", import.meta.url), "utf8"),
    readFile(new URL("../injector.mjs", import.meta.url), "utf8")
  ]);
  const stripExports = (source) => source.replace(
    /\bexport\s+(?=(?:const|function|class|async\s+function)\b)/g,
    ""
  );
  const compiled = clientSource
    .replace("/*__JIRA_CODEX_NAVIGATION_HELPERS__*/", stripExports(navigationSource))
    .replace("/*__JIRA_CODEX_PROMPT_HELPERS__*/", stripExports(promptBuilderSource));

  assert.doesNotThrow(() => new Function(compiled));
  assert.match(clientSource, /jira-codex-conversation-float/);
  assert.match(clientSource, /conversationBindingForThread/);
  assert.match(clientSource, /\/api\/issues\/\$\{encodeURIComponent\(state\.issueKey\)\}/);
  assert.match(injectorSource, /new Set\(\["GET", "POST", "PUT", "DELETE"\]\)/);
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
