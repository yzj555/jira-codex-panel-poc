import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

async function fixture({ corruptHash = false, blockers = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jira-update-manager-"));
  const installRoot = join(root, "app");
  const userDataRoot = join(root, "data");
  const updaterSource = join(installRoot, "installer", "update-bootstrap.ps1");
  await mkdir(join(installRoot, "installer"), { recursive: true });
  await mkdir(userDataRoot, { recursive: true });
  await writeFile(join(installRoot, "install-state.json"), `\uFEFF${JSON.stringify({
    productId: "jira-codex-panel",
    installRoot: resolve(installRoot),
    version: "0.31.2"
  })}`, "utf8");
  await writeFile(updaterSource, "# updater", "utf8");
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
  const manager = createUpdateManager({
    currentVersion: "0.31.2",
    installRoot,
    userDataRoot,
    updaterSource,
    fetchImpl,
    blockerProvider: async () => blockers,
    spawnImpl: (command, args, options) => {
      spawned.push({ command, args, options });
      return { pid: 4242, unref() {} };
    }
  });
  return { root, installRoot, userDataRoot, updaterSource, archive, update, manager, spawned, fetchCalls };
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
  assert.equal(status.canInstall, true);
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
  assert.equal(status.canInstall, false);
});

test("安装必须精确确认版本，活动操作会阻止更新器启动", async (t) => {
  const value = await fixture({ blockers: [{ kind: "svn_commit", message: "CT-1 正在提交 SVN" }] });
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  await assert.rejects(
    value.manager.install({ confirmVersion: "0.33.0" }),
    (error) => error.code === "UPDATE_CONFIRMATION_REQUIRED"
  );
  await assert.rejects(
    value.manager.install({ confirmVersion: "0.32.0" }),
    (error) => error.code === "UPDATE_BLOCKED_BY_ACTIVE_OPERATION" && error.details.blockers.length === 1
  );
  assert.equal(value.spawned.length, 0);
});

test("人工确认后只启动用户数据目录中的独立更新器", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  const status = await value.manager.install({ confirmVersion: "0.32.0", restartCodex: true });
  assert.equal(status.state, "installing");
  assert.equal(value.spawned.length, 1);
  assert.equal(value.spawned[0].options.detached, true);
  assert.ok(value.spawned[0].args.includes("-RestartCodex"));
  const updaterIndex = value.spawned[0].args.indexOf("-File") + 1;
  assert.match(value.spawned[0].args[updaterIndex], /data[\\/]updater[\\/]update-bootstrap\.ps1$/i);
});

test("选择稍后手动重启时会持续保留重启要求", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  await value.manager.startDownload(value.update);
  await value.manager.waitForIdle();
  const status = await value.manager.install({ confirmVersion: "0.32.0", restartCodex: false });
  assert.equal(status.state, "installing");
  assert.equal(status.restartRequired, true);
  assert.equal(value.spawned[0].args.includes("-RestartCodex"), false);
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
  assert.equal(status.canReset, true);
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
  assert.equal(status.canReset, true);
});
