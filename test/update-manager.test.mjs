import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createUpdateManager } from "../lib/update-manager.mjs";

function releaseUpdate(version, bytes) {
  const archiveName = `jira-codex-assistant-${version}-win-x64.zip`;
  return {
    enabled: true,
    checked: true,
    currentVersion: "0.31.2",
    latestVersion: version,
    updateAvailable: true,
    source: "release",
    installable: true,
    url: `https://github.com/example/project/releases/tag/v${version}`,
    releaseName: `v${version}`,
    assets: [
      { name: "update-manifest.json", size: 0, url: "https://github.com/example/project/releases/download/v/update-manifest.json" },
      { name: archiveName, size: bytes.length, url: `https://github.com/example/project/releases/download/v/${archiveName}` }
    ]
  };
}

async function fixture({ corruptHash = false, blockers = [], acknowledgeUpdater = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jira-update-manager-"));
  const installRoot = join(root, "app");
  const userDataRoot = join(root, "data");
  const updaterSource = join(installRoot, "installer", "update-bootstrap.ps1");
  const updaterLauncherSource = join(installRoot, "scripts", "update-launcher.mjs");
  const restartSource = join(installRoot, "scripts", "restart-codex-after-update.ps1");
  await mkdir(join(installRoot, "installer"), { recursive: true });
  await mkdir(join(installRoot, "scripts"), { recursive: true });
  await mkdir(userDataRoot, { recursive: true });
  await writeFile(join(installRoot, "install-state.json"), `\uFEFF${JSON.stringify({
    productId: "jira-codex-panel",
    installRoot: resolve(installRoot),
    version: "0.31.2"
  })}`, "utf8");
  await writeFile(updaterSource, "# updater", "utf8");
  await writeFile(updaterLauncherSource, "// launcher", "utf8");
  await writeFile(restartSource, "# restart helper", "utf8");
  const archive = Buffer.from("safe-release-archive");
  const version = "0.32.0";
  const update = releaseUpdate(version, archive);
  const manifest = {
    schemaVersion: 1,
    productId: "jira-codex-panel",
    version,
    restartRequired: true,
    asset: {
      name: update.assets[1].name,
      size: archive.length,
      sha256: corruptHash ? "0".repeat(64) : createHash("sha256").update(archive).digest("hex")
    }
  };
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(String(url));
    return String(url).endsWith("update-manifest.json")
      ? new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(archive, { status: 200, headers: { "content-length": String(archive.length) } });
  };
  const spawned = [];
  const installHandoffs = [];
  const manager = createUpdateManager({
    currentVersion: "0.31.2",
    installRoot,
    userDataRoot,
    updaterSource,
    updaterLauncherSource,
    restartSource,
    fetchImpl,
    blockerProvider: async () => blockers,
    onInstallHandoff: (value) => installHandoffs.push(value),
    updaterHandshakeTimeoutMs: 250,
    spawnImpl: (command, args, options) => {
      spawned.push({ command, args, options });
      if (acknowledgeUpdater) {
        queueMicrotask(async () => {
          const stateFile = join(userDataRoot, "update-state.json");
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
          const current = JSON.parse(await readFile(stateFile, "utf8"));
          const launchConfig = JSON.parse(await readFile(args[1], "utf8"));
          const operationIndex = launchConfig.args.indexOf("-OperationId");
          const restartHelper = launchConfig.args.some((value) => /restart-codex-after-update\.ps1$/i.test(String(value)));
          await writeFile(stateFile, JSON.stringify(restartHelper ? {
            ...current,
            state: "restart_required",
            restartProcessId: process.pid,
            phase: "restarting",
            operationProgress: 99,
            updatedAt: new Date().toISOString()
          } : {
            ...current,
            state: "installing",
            updaterProcessId: process.pid,
            operationId: launchConfig.args[operationIndex + 1],
            phase: "waiting_for_service",
            operationProgress: 30,
            updatedAt: new Date().toISOString()
          }), "utf8");
        });
      }
      return { pid: 4242, once() {}, unref() {}, kill() {} };
    }
  });
  return { root, installRoot, userDataRoot, updaterSource, restartSource, archive, update, manager, spawned, fetchCalls, installHandoffs };
}

test("更新包下载后必须通过大小和 SHA-256 校验才能进入 ready", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const started = await value.manager.startDownload(value.update);
  assert.equal(started.state, "downloading");
  await value.manager.waitForIdle();
  const status = await value.manager.status(value.update);
  assert.equal(status.state, "ready");
  assert.equal(status.progress, 100);
  assert.equal("canReset" in status, false);
  const state = JSON.parse(await readFile(value.manager.stateFile, "utf8"));
  assert.equal(await readFile(state.archivePath, "utf8"), value.archive.toString());
});

test("SHA-256 不匹配时拒绝安装并保存可见失败状态", async (t) => {
  const value = await fixture({ corruptHash: true });
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  const status = await value.manager.status(value.update);
  assert.equal(status.state, "failed");
  assert.match(status.error, /SHA-256/);
  assert.equal("canReset" in status, false);
});

test("安装必须精确确认版本，活动操作会阻止更新器启动", async (t) => {
  const value = await fixture({ blockers: [{ kind: "svn_commit", message: "CT-1 正在提交 SVN" }] });
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  await assert.rejects(
    value.manager.install({ confirmVersion: "0.33.0" }),
    (error) => error.code === "UPDATE_TARGET_MISMATCH"
  );
  await assert.rejects(
    value.manager.install({ confirmVersion: "0.32.0" }),
    (error) => error.code === "UPDATE_BLOCKED_BY_ACTIVE_OPERATION" && error.details.blockers.length === 1
  );
  assert.equal(value.spawned.length, 0);
});

test("安装始终先交给独立更新器，且不会在安装阶段重启 Codex", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  const status = await value.manager.install({ confirmVersion: "0.32.0" });
  assert.equal(status.state, "installing");
  assert.equal(value.spawned.length, 1);
  assert.equal(value.spawned[0].options.detached, true);
  assert.match(value.spawned[0].args[0], /data[\\/]updater[\\/]update-launcher\.mjs$/i);
  const launchConfig = JSON.parse(await readFile(value.spawned[0].args[1], "utf8"));
  assert.equal(launchConfig.args.includes("-RestartCodex"), false);
  const updaterIndex = launchConfig.args.indexOf("-File") + 1;
  assert.match(launchConfig.args[updaterIndex], /data[\\/]updater[\\/]update-bootstrap\.ps1$/i);
});

test("点击下载后会自动校验并进入安装，无需第二次人工操作", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update, { autoInstall: true });
  await value.manager.waitForIdle();
  const status = await value.manager.status(value.update);
  assert.equal(status.state, "installing");
  assert.equal(status.restartRequired, true);
  assert.equal(value.spawned.length, 1);
  assert.equal(value.installHandoffs.length, 1);
  const launchConfig = JSON.parse(await readFile(value.spawned[0].args[1], "utf8"));
  assert.equal(launchConfig.args.includes("-RestartCodex"), false);
});

test("服务恰好在校验后重启时会继续自动安装，不会停在 ready", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  const ready = JSON.parse(await readFile(value.manager.stateFile, "utf8"));
  await writeFile(value.manager.stateFile, JSON.stringify({ ...ready, autoInstallRequested: true }), "utf8");

  const observed = await value.manager.status(value.update);
  assert.equal(observed.state, "ready");
  await value.manager.waitForIdle();
  const resumed = await value.manager.status(value.update);
  assert.equal(resumed.state, "installing");
  assert.equal(value.spawned.length, 1);
});

test("并发下载和并发安装都只能启动一个实际操作", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  const downloadResults = await Promise.allSettled([
    value.manager.startDownload(value.update),
    value.manager.startDownload(value.update)
  ]);
  assert.equal(downloadResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(downloadResults.filter((result) => result.status === "rejected").length, 1);
  await value.manager.waitForIdle();
  assert.equal(value.fetchCalls.length, 2, "只能请求一次 manifest 和一次 archive");

  const installResults = await Promise.allSettled([
    value.manager.install({ confirmVersion: "0.32.0" }),
    value.manager.install({ confirmVersion: "0.32.0" })
  ]);
  assert.equal(installResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(installResults.filter((result) => result.status === "rejected").length, 1);
  assert.equal(value.spawned.length, 1, "只能派生一个独立更新器");
});

test("服务重启后会把孤立下载恢复为可人工重试的失败状态", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await writeFile(value.manager.stateFile, JSON.stringify({
    schemaVersion: 1,
    state: "downloading",
    currentVersion: "0.31.2",
    targetVersion: "0.32.0",
    downloadedBytes: 7,
    totalBytes: 100
  }), "utf8");

  const status = await value.manager.status(value.update);
  assert.equal(status.state, "failed");
  assert.equal("canReset" in status, false);
  assert.match(status.message, /重新下载/);
});

test("服务重启后会核对孤立安装器，不会无限卡在安装中", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await writeFile(value.manager.stateFile, JSON.stringify({
    schemaVersion: 1,
    state: "installing",
    currentVersion: "0.31.2",
    targetVersion: "0.31.2",
    previousVersion: "0.31.1",
    updaterProcessId: 2147483647
  }), "utf8");

  const status = await value.manager.status(value.update);
  assert.equal(status.state, "restart_required");
  assert.equal(status.restartRequired, true);
  assert.equal("canReset" in status, false);
});

test("独立更新器未确认接管时不会永久卡在 installing", async (t) => {
  const value = await fixture({ acknowledgeUpdater: false });
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  await assert.rejects(
    value.manager.install({ confirmVersion: "0.32.0" }),
    (error) => error.code === "UPDATE_UPDATER_HANDSHAKE_FAILED"
  );
  const status = await value.manager.status(value.update);
  assert.equal(status.state, "failed");
  assert.equal(status.phase, "failed");
  assert.equal("canReset" in status, false);
});

test("安装完成后只允许显式重启，重启助手接管后返回可观察状态", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await writeFile(value.manager.stateFile, JSON.stringify({
    schemaVersion: 1,
    state: "restart_required",
    currentVersion: "0.31.2",
    targetVersion: "0.31.2",
    previousVersion: "0.31.1",
    phase: "restart_required",
    operationProgress: 97,
    restartRequired: true,
    updatedAt: new Date().toISOString()
  }), "utf8");

  const before = await value.manager.status(value.update);
  assert.equal(before.canRestart, true);
  const restarting = await value.manager.restart();
  assert.equal(restarting.phase, "restarting");
  assert.equal(restarting.restartProcessId, undefined);
  assert.equal(value.spawned.length, 1);
  const launchConfig = JSON.parse(await readFile(value.spawned[0].args[1], "utf8"));
  assert.ok(launchConfig.args.some((entry) => /restart-codex-after-update\.ps1$/i.test(String(entry))));
});

test("重启成功留下的 completed 状态会在新服务首次读取时自动清理", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await writeFile(value.manager.stateFile, JSON.stringify({
    schemaVersion: 1,
    state: "completed",
    currentVersion: "0.31.2",
    targetVersion: "0.31.2",
    previousVersion: "0.31.1",
    phase: "completed",
    operationProgress: 100,
    restartRequired: false,
    updatedAt: new Date().toISOString()
  }), "utf8");

  const status = await value.manager.status(value.update);
  assert.equal(status.state, "idle");
  assert.equal(status.targetVersion, value.update.latestVersion);
  const persisted = JSON.parse(await readFile(value.manager.stateFile, "utf8"));
  assert.equal(persisted.state, "idle");
  assert.equal(persisted.targetVersion, "");
});

test("Windows 重启助手按 UTF-8 读取无 BOM 的中文状态文件", {
  skip: process.platform !== "win32"
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jira-restart-helper-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installRoot = join(root, "app");
  const userDataRoot = join(root, "data");
  const statePath = join(userDataRoot, "update-state.json");
  const scriptPath = join(installRoot, "scripts", "restart-codex-after-update.ps1");
  await mkdir(join(installRoot, "scripts"), { recursive: true });
  await mkdir(userDataRoot, { recursive: true });
  await copyFile(new URL("../scripts/restart-codex-after-update.ps1", import.meta.url), scriptPath);
  await writeFile(join(installRoot, "package.json"), JSON.stringify({ version: "0.31.5" }), "utf8");
  await writeFile(join(installRoot, "scripts", "launch-codex-jira.ps1"), "exit 0\n", "utf8");
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 1,
    state: "restart_required",
    currentVersion: "0.31.5",
    targetVersion: "0.31.4",
    message: "中文状态用于验证无 BOM UTF-8。",
    error: "",
    phase: "restart_required",
    operationProgress: 97,
    restartRequired: true
  }, null, 2), "utf8");

  const powerShell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(powerShell, [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-InstallRoot", installRoot,
    "-UserDataRoot", userDataRoot,
    "-StatePath", statePath
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.phase, "restart_required");
  assert.match(persisted.error, /pending update does not match/i);
  assert.equal(persisted.restartProcessId, 0);
});
