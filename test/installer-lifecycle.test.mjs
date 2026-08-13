import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("one lifecycle entry owns install, repair and uninstall", async () => {
  const [command, lifecycle, install, uninstall, updater, launcher, restartHelper, manifestText] = await Promise.all([
    readFile(join(root, "install.cmd"), "utf8"),
    readFile(join(root, "installer", "lifecycle.ps1"), "utf8"),
    readFile(join(root, "installer", "install.ps1"), "utf8"),
    readFile(join(root, "installer", "uninstall.ps1"), "utf8"),
    readFile(join(root, "installer", "update-bootstrap.ps1"), "utf8"),
    readFile(join(root, "scripts", "launch-codex-jira.ps1"), "utf8"),
    readFile(join(root, "scripts", "restart-codex-after-update.ps1"), "utf8"),
    readFile(join(root, "installer", "product-manifest.json"), "utf8")
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(command, /lifecycle\.ps1" -Action Auto/);
  assert.match(lifecycle, /'Install', 'Update', 'Repair', 'Uninstall', 'Purge', 'Status', 'Menu'/);
  assert.match(lifecycle, /\$PSBoundParameters\.ContainsKey\('StartAtLogon'\)/);
  assert.match(lifecycle, /if \(-not \$desktopShortcutSpecified\)/);
  assert.match(lifecycle, /function Get-LifecycleStatus/);
  assert.match(lifecycle, /function Wait-LifecycleMenu/);
  assert.match(lifecycle, /function Write-LifecycleStatusSummary/);
  assert.match(lifecycle, /按 Enter 返回维护菜单/);
  assert.match(lifecycle, /while \(\$true\)/);
  assert.match(lifecycle, /操作失败：/);
  assert.match(lifecycle, /missingRequiredComponents/);
  assert.match(lifecycle, /registryPresent/);
  assert.match(lifecycle, /plugin list --json/);
  assert.match(lifecycle, /plugin marketplace list --json/);
  assert.match(lifecycle, /codexRegistrationHealthy/);
  assert.match(install, /install-state\.json/);
  assert.match(install, /foreach \(\$component in @\(\$productManifest\.components\)\)/);
  assert.match(install, /组件路径超出产品目录/);
  assert.match(install, /npmCommand\.Source ci --omit=dev/);
  assert.match(install, /plugin marketplace add \$MarketplaceRoot/);
  assert.match(install, /plugin add \$pluginSelector/);
  assert.match(install, /plugin add \$pluginSelector --json \| Out-Null/);
  assert.match(install, /function Remove-ObsoleteManifestComponents/);
  assert.match(install, /未找到 Codex CLI，无法注册核心 Codex Plugin/);
  assert.match(install, /未能核验核心 Plugin\/Marketplace 注册/);
  assert.match(install, /Windows\\CurrentVersion\\Uninstall\\JiraCodexAssistant/);
  assert.match(install, /维护 Jira Codex 助手\.lnk/);
  assert.match(install, /-Description '修复或卸载 Jira Codex 助手' -IconLocation \$iconPath -WindowStyle 1/);
  assert.match(uninstall, /install-state\.json/);
  assert.match(uninstall, /Remove-Item -LiteralPath \$uninstallRegistryPath/);
  assert.match(uninstall, /plugin remove \$pluginSelector/);
  assert.match(uninstall, /plugin marketplace remove \$pluginMarketplaceName/);
  assert.match(uninstall, /metadata\.codexAppServerCommand/);
  assert.match(uninstall, /function Get-CodexRegistrationCleanupStatus/);
  assert.match(uninstall, /卸载未完成：无法确认核心 Plugin\/Marketplace 注册已清理/);
  assert.match(updater, /Get-FileHash -LiteralPath \$PackagePath -Algorithm SHA256/);
  assert.match(updater, /Expand-Archive -LiteralPath \$PackagePath/);
  assert.match(updater, /Backing up v\$script:previousVersion/);
  assert.match(updater, /rolling back/);
  assert.match(updater, /Stop-CodexGracefully/);
  assert.match(updater, /Installed integrity check failed/);
  assert.match(updater, /\[string\]\$OperationId/);
  assert.match(updater, /-Phase 'backing_up' -OperationProgress 45/);
  assert.match(updater, /-Phase 'completed' -OperationProgress 100/);
  assert.match(updater, /if \(-not \$RestartCodex -or -not \$codexRestarted\)/);
  assert.match(launcher, /Complete-PendingUpdateAfterRestart/);
  assert.match(launcher, /\$next\.state = 'completed'/);
  assert.match(launcher, /File\]::ReadAllText\(\$updateStatePath, \[System\.Text\.Encoding\]::UTF8\)/);
  assert.match(launcher, /File\]::WriteAllText\(\$temporary, \$json, \$utf8NoBom\)/);
  assert.match(restartHelper, /Stop-CodexForRestart/);
  assert.match(restartHelper, /JiraCodexWindowCloser/);
  assert.match(restartHelper, /RequestClose/);
  assert.match(restartHelper, /Stop-Process -Id \(\[int\]\$processInfo\.ProcessId\) -Force/);
  assert.match(restartHelper, /only[\s\S]*after the graceful window-close deadline/);
  assert.match(restartHelper, /-Phase 'restarting'/);
  assert.match(restartHelper, /launch-codex-jira\.ps1/);
  assert.match(restartHelper, /-EncodedCommand/);
  assert.match(restartHelper, /File\]::ReadAllText\(\$StatePath, \[System\.Text\.Encoding\]::UTF8\)/);
  assert.match(restartHelper, /File\]::WriteAllText\(\$temporary, \$json, \$utf8NoBom\)/);
  assert.doesNotMatch(updater, /Stop-Process[^\r\n]*ChatGPT/i);
  assert.equal(manifest.productId, "jira-codex-panel");
  assert.equal(manifest.displayName, "Jira Codex 助手");
  assert.equal(manifest.components.some((component) => component.id === "release-updater"
    && component.required && component.path === "installer/update-bootstrap.ps1"), true);
  assert.equal(manifest.components.some((component) => component.id === "release-updater-host"
    && component.required && component.path === "scripts/update-launcher.mjs"), true);
  assert.equal(manifest.components.some((component) => component.id === "release-restart-helper"
    && component.required && component.path === "scripts/restart-codex-after-update.ps1"), true);
  assert.equal(manifest.components.some((component) => component.id === "update-manager"
    && component.required && component.path === "lib/update-manager.mjs"), true);
  assert.equal(manifest.components.some((component) => component.id === "github-update-checker"
    && component.required && component.path === "lib/github-update-checker.mjs"), true);
  assert.equal(manifest.components.some((component) => (
    component.id === "official-plugin"
    && component.required
    && component.path === "plugins/jira-codex-assistant"
  )), true);
  assert.equal(manifest.components.some((component) => component.id === "plugin-marketplace" && component.required), true);
  assert.equal(manifest.components.some((component) => (
    component.id === "settings-ui"
    && component.required
    && component.path === "public"
  )), true);
  assert.equal(manifest.components.some((component) => component.id === "mcp-server" && component.required), true);
  assert.equal(manifest.components.some((component) => (
    component.id === "minimal-desktop-ui-host"
    && component.required
    && component.path === "injector.mjs"
  )), true);
  assert.equal(manifest.components.some((component) => (
    component.id === "codex-application-commands"
    && component.required
    && component.path === "lib/codex-application-commands.mjs"
  )), true);
  for (const [id, path] of [
    ["jira-workbench-service", "lib/jira-workbench-service.mjs"],
    ["codex-conversation-service", "lib/codex-conversation-service.mjs"],
    ["svn-workbench-service", "lib/svn-workbench-service.mjs"]
  ]) {
    assert.equal(manifest.components.some((component) => (
      component.id === id && component.required && component.path === path
    )), true);
  }
});

test("lifecycle status works without an installed product", {
  skip: process.platform !== "win32"
}, () => {
  const output = execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", join(root, "installer", "lifecycle.ps1"),
    "-Action", "Status",
    "-InstallRoot", join(root, ".installer-test", "status-only")
  ], { encoding: "utf8", windowsHide: true });
  const status = JSON.parse(output);
  assert.equal(status.installed, false);
});

test("lifecycle status detects missing installed components from the live filesystem", {
  skip: process.platform !== "win32"
}, async () => {
  const installRoot = await mkdtemp(join(tmpdir(), "jira-codex-lifecycle-status-"));
  try {
    await mkdir(join(installRoot, "installer"), { recursive: true });
    await writeFile(join(installRoot, "installer", "product-manifest.json"), JSON.stringify({
      productId: "jira-codex-panel",
      components: [
        { id: "local-service", required: true, path: "server.mjs" },
        { id: "panel-ui", required: true, path: "public" },
        { id: "official-plugin", required: false, path: ".codex-plugin/plugin.json" }
      ]
    }), "utf8");
    await writeFile(join(installRoot, "install-state.json"), JSON.stringify({
      productId: "jira-codex-panel",
      version: "0.27.0",
      shortcuts: [],
      uninstallRegistryPath: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\JiraCodexAssistantStatusTest"
    }), "utf8");
    await writeFile(join(installRoot, "server.mjs"), "", "utf8");

    const output = execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", join(root, "installer", "lifecycle.ps1"),
      "-Action", "Status",
      "-InstallRoot", installRoot
    ], { encoding: "utf8", windowsHide: true });
    const status = JSON.parse(output);
    assert.equal(status.installed, true);
    assert.equal(status.manifestAvailable, true);
    assert.deepEqual(status.missingRequiredComponents, ["panel-ui"]);
    assert.equal(status.components.find((component) => component.id === "local-service").installed, true);
    assert.equal(status.components.find((component) => component.id === "official-plugin").installed, false);
    assert.equal(status.codexRegistrationHealthy, false);
    assert.equal(status.healthy, false);
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});

test("uninstall preserves program files when Codex registration cleanup cannot be verified", {
  skip: process.platform !== "win32"
}, async () => {
  const installRoot = await mkdtemp(join(tmpdir(), "jira-codex-uninstall-plugin-guard-"));
  try {
    const fakeCodex = join(installRoot, "fake-codex.cmd");
    const pluginJson = JSON.stringify({
      installed: [{ pluginId: "jira-codex-assistant@jira-codex-local", installed: true, enabled: true }]
    });
    const marketplaceJson = JSON.stringify({
      marketplaces: [{ name: "jira-codex-local", root: installRoot }]
    });
    await writeFile(fakeCodex, [
      "@echo off",
      `if \"%*\"==\"plugin list --json\" (echo ${pluginJson}& exit /b 0)`,
      `if \"%*\"==\"plugin marketplace list --json\" (echo ${marketplaceJson}& exit /b 0)`,
      "exit /b 0"
    ].join("\r\n"), "utf8");
    await writeFile(join(installRoot, "install-state.json"), JSON.stringify({
      productId: "jira-codex-panel",
      userDataRoot: join(installRoot, "user-data-not-owned"),
      shortcuts: [],
      codexAppServerCommand: fakeCodex,
      codexPluginSelector: "jira-codex-assistant@jira-codex-local",
      codexPluginMarketplace: "jira-codex-local",
      codexPluginRegistered: true
    }), "utf8");

    assert.throws(() => execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", join(root, "installer", "uninstall.ps1"),
      "-InstallRoot", installRoot,
      "-Force"
    ], { encoding: "utf8", windowsHide: true, stdio: "pipe" }));
    const preservedState = JSON.parse(await readFile(join(installRoot, "install-state.json"), "utf8"));
    assert.equal(preservedState.productId, "jira-codex-panel");
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});

test("lifecycle status verifies live Codex plugin and marketplace registration", {
  skip: process.platform !== "win32"
}, async () => {
  const installRoot = await mkdtemp(join(tmpdir(), "jira-codex-lifecycle-plugin-status-"));
  try {
    const manifest = {
      productId: "jira-codex-panel",
      components: [
        { id: "official-plugin", required: true, path: "plugins/jira-codex-assistant" },
        { id: "plugin-marketplace", required: true, path: ".agents/plugins/marketplace.json" }
      ]
    };
    const fakeCodex = join(installRoot, "fake-codex.cmd");
    const pluginJson = JSON.stringify({
      installed: [{
        pluginId: "jira-codex-assistant@jira-codex-local",
        installed: true,
        enabled: true
      }]
    });
    const marketplaceJson = JSON.stringify({
      marketplaces: [{ name: "jira-codex-local", root: installRoot }]
    });
    await mkdir(join(installRoot, "installer"), { recursive: true });
    await mkdir(join(installRoot, "plugins", "jira-codex-assistant"), { recursive: true });
    await mkdir(join(installRoot, ".agents", "plugins"), { recursive: true });
    await writeFile(join(installRoot, "installer", "product-manifest.json"), JSON.stringify(manifest), "utf8");
    await writeFile(join(installRoot, ".agents", "plugins", "marketplace.json"), "{}", "utf8");
    await writeFile(fakeCodex, [
      "@echo off",
      `if \"%*\"==\"plugin list --json\" (echo ${pluginJson}& exit /b 0)`,
      `if \"%*\"==\"plugin marketplace list --json\" (echo ${marketplaceJson}& exit /b 0)`,
      "exit /b 1"
    ].join("\r\n"), "utf8");
    await writeFile(join(installRoot, "install-state.json"), JSON.stringify({
      productId: "jira-codex-panel",
      version: "0.27.0",
      shortcuts: [],
      codexAppServerCommand: fakeCodex,
      codexPluginSelector: "jira-codex-assistant@jira-codex-local",
      codexPluginMarketplace: "jira-codex-local",
      uninstallRegistryPath: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\JiraCodexAssistantPluginStatusTest"
    }), "utf8");

    const output = execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", join(root, "installer", "lifecycle.ps1"),
      "-Action", "Status",
      "-InstallRoot", installRoot
    ], { encoding: "utf8", windowsHide: true });
    const status = JSON.parse(output);
    assert.equal(status.codexRegistration.probeAvailable, true);
    assert.equal(status.codexRegistration.pluginRegistered, true);
    assert.equal(status.codexRegistration.pluginEnabled, true);
    assert.equal(status.codexRegistration.marketplaceRegistered, true);
    assert.equal(status.codexRegistration.marketplaceRootMatches, true);
    assert.equal(status.codexRegistrationHealthy, true);
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});
