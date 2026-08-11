import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("one lifecycle entry owns install, repair and uninstall", async () => {
  const [command, lifecycle, install, uninstall, manifestText] = await Promise.all([
    readFile(join(root, "install.cmd"), "utf8"),
    readFile(join(root, "installer", "lifecycle.ps1"), "utf8"),
    readFile(join(root, "installer", "install.ps1"), "utf8"),
    readFile(join(root, "installer", "uninstall.ps1"), "utf8"),
    readFile(join(root, "installer", "product-manifest.json"), "utf8")
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(command, /lifecycle\.ps1" -Action Auto/);
  assert.match(lifecycle, /'Install', 'Update', 'Repair', 'Uninstall', 'Purge', 'Status', 'Menu'/);
  assert.match(lifecycle, /\$PSBoundParameters\.ContainsKey\('StartAtLogon'\)/);
  assert.match(lifecycle, /if \(-not \$desktopShortcutSpecified\)/);
  assert.match(lifecycle, /function Get-LifecycleStatus/);
  assert.match(lifecycle, /missingRequiredComponents/);
  assert.match(lifecycle, /registryPresent/);
  assert.match(install, /install-state\.json/);
  assert.match(install, /foreach \(\$component in @\(\$productManifest\.components\)\)/);
  assert.match(install, /组件路径超出产品目录/);
  assert.match(install, /Windows\\CurrentVersion\\Uninstall\\JiraCodexAssistant/);
  assert.match(install, /维护 Jira Codex 助手\.lnk/);
  assert.match(uninstall, /install-state\.json/);
  assert.match(uninstall, /Remove-Item -LiteralPath \$uninstallRegistryPath/);
  assert.equal(manifest.productId, "jira-codex-panel");
  assert.equal(manifest.displayName, "Jira Codex 助手");
  assert.equal(manifest.components.some((component) => (
    component.id === "official-plugin"
    && !component.required
    && component.path === ".codex-plugin/plugin.json"
  )), true);
  assert.equal(manifest.components.some((component) => component.id === "mcp-server" && !component.required), true);
  assert.equal(manifest.components.some((component) => (
    component.id === "codex-application-commands"
    && component.required
    && component.path === "lib/codex-application-commands.mjs"
  )), true);
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
    assert.equal(status.healthy, false);
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});
