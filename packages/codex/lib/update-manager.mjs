import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { compareVersions, normalizeVersion } from "./github-update-checker.mjs";

const PRODUCT_ID = "jira-workbench";
const UPDATER_VERSION = "1.0.0";
const UPDATE_STATE_VERSION = 1;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_UPDATER_HANDSHAKE_TIMEOUT_MS = 10_000;
const INSTALL_STALE_TIMEOUT_MS = 15 * 60 * 1_000;
const ACTIVE_STATES = new Set(["downloading", "installing"]);
const UPDATE_PHASES = new Set([
  "idle", "downloading", "verified", "launching", "waiting_for_service",
  "validating", "extracting", "backing_up", "installing", "restarting",
  "verifying", "restart_launching", "restart_required", "completed", "rolling_back", "failed"
]);

export class UpdateManagerError extends Error {
  constructor(message, { code = "UPDATE_FAILED", statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "UpdateManagerError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function safeMessage(error) {
  return String(error?.message || error || "未知错误").trim().slice(0, 1_000);
}

function parseJsonText(text) {
  return JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
}

function encodePowerShellCliValue(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

function defaultState(currentVersion) {
  return {
    schemaVersion: UPDATE_STATE_VERSION,
    state: "idle",
    currentVersion,
    targetVersion: "",
    previousVersion: "",
    releaseUrl: "",
    releaseName: "",
    downloadedBytes: 0,
    totalBytes: 0,
    progress: 0,
    message: "",
    error: "",
    restartRequired: false,
    archivePath: "",
    manifestPath: "",
    updaterProcessId: 0,
    restartProcessId: 0,
    autoInstallRequested: false,
    operationId: "",
    phase: "idle",
    operationProgress: 0,
    logPath: "",
    backupPath: "",
    updatedAt: new Date(0).toISOString()
  };
}

function normalizeState(value, currentVersion) {
  const fallback = defaultState(currentVersion);
  if (!value || typeof value !== "object") return fallback;
  const state = String(value.state || "idle");
  return {
    ...fallback,
    schemaVersion: UPDATE_STATE_VERSION,
    state: ["idle", "available", "downloading", "ready", "installing", "restart_required", "completed", "failed", "rolled_back", "cancelled"].includes(state)
      ? state
      : "failed",
    currentVersion,
    targetVersion: normalizeVersion(value.targetVersion),
    previousVersion: normalizeVersion(value.previousVersion),
    downloadedBytes: Math.max(0, Number(value.downloadedBytes || 0)),
    totalBytes: Math.max(0, Number(value.totalBytes || 0)),
    progress: Math.max(0, Math.min(100, Number(value.progress || 0))),
    updaterProcessId: Math.max(0, Number(value.updaterProcessId || 0)),
    restartProcessId: Math.max(0, Number(value.restartProcessId || 0)),
    autoInstallRequested: value.autoInstallRequested === undefined
      ? String(value.state || "") === "ready"
      : Boolean(value.autoInstallRequested),
    operationId: String(value.operationId || "").slice(0, 120),
    phase: UPDATE_PHASES.has(String(value.phase || "")) ? String(value.phase) : fallback.phase,
    operationProgress: Math.max(0, Math.min(100, Number(value.operationProgress || 0))),
    releaseUrl: String(value.releaseUrl || ""),
    releaseName: String(value.releaseName || ""),
    message: String(value.message || ""),
    error: String(value.error || ""),
    restartRequired: Boolean(value.restartRequired),
    archivePath: String(value.archivePath || ""),
    manifestPath: String(value.manifestPath || ""),
    logPath: String(value.logPath || ""),
    backupPath: String(value.backupPath || ""),
    rollbackHealthy: value.rollbackHealthy === true,
    updatedAt: String(value.updatedAt || fallback.updatedAt)
  };
}

function publicState(value, { managedInstallation, update } = {}) {
  const totalBytes = Math.max(0, Number(value.totalBytes || 0));
  const downloadedBytes = Math.max(0, Number(value.downloadedBytes || 0));
  const progress = totalBytes > 0
    ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
    : Math.max(0, Math.min(100, Number(value.progress || 0)));
  const targetMatches = Boolean(update?.latestVersion)
    && (!value.targetVersion || value.targetVersion === update.latestVersion);
  const targetAlreadyPrepared = targetMatches
    && ["ready", "restart_required", "completed"].includes(value.state);
  return {
    state: value.state,
    currentVersion: value.currentVersion,
    targetVersion: value.targetVersion || String(update?.latestVersion || ""),
    previousVersion: value.previousVersion,
    releaseUrl: value.releaseUrl || String(update?.url || ""),
    releaseName: value.releaseName || String(update?.releaseName || ""),
    downloadedBytes,
    totalBytes,
    progress,
    phase: value.phase,
    operationProgress: value.operationProgress,
    message: String(value.message || ""),
    error: String(value.error || ""),
    restartRequired: Boolean(value.restartRequired),
    updatedAt: String(value.updatedAt || ""),
    managedInstallation: Boolean(managedInstallation),
    installableRelease: Boolean(update?.updateAvailable && update?.installable && update?.source === "release"),
    installabilityReason: String(update?.installabilityReason || ""),
    canDownload: Boolean(managedInstallation && update?.updateAvailable && update?.installable
      && update?.source === "release" && !ACTIVE_STATES.has(value.state)
      && !targetAlreadyPrepared),
    canCancelDownload: value.state === "downloading",
    canRestart: Boolean(managedInstallation && value.state === "restart_required"
      && value.targetVersion === value.currentVersion
      && value.phase !== "restarting" && value.phase !== "restart_launching")
  };
}

function pathWithin(parent, candidate) {
  const base = `${resolve(parent).toLowerCase()}\\`;
  return resolve(candidate).toLowerCase().startsWith(base);
}

function validateManifest(value, expectedVersion) {
  const manifest = value && typeof value === "object" ? value : {};
  const version = normalizeVersion(manifest.version);
  const asset = manifest.asset && typeof manifest.asset === "object" ? manifest.asset : {};
  const assetName = String(asset.name || "").trim();
  const sha256 = String(asset.sha256 || "").trim().toLowerCase();
  const size = Math.max(0, Number(asset.size || 0));
  const minimumUpdaterVersion = normalizeVersion(manifest.minimumUpdaterVersion || "1.0.0");
  if (Number(manifest.schemaVersion) !== 1 || manifest.productId !== PRODUCT_ID) {
    throw new UpdateManagerError("更新清单与 Jira 工作台不匹配。", { code: "UPDATE_MANIFEST_PRODUCT_MISMATCH" });
  }
  if (!version || version !== expectedVersion) {
    throw new UpdateManagerError("更新清单版本与 GitHub Release 不一致。", { code: "UPDATE_MANIFEST_VERSION_MISMATCH" });
  }
  if (!assetName || assetName !== basename(assetName)
    || assetName.toLowerCase() !== `jira-workbench-assistant-${version}-win-x64.zip`.toLowerCase()) {
    throw new UpdateManagerError("更新清单中的安装包名称无效。", { code: "UPDATE_MANIFEST_ASSET_INVALID" });
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new UpdateManagerError("更新清单缺少有效的 SHA-256。", { code: "UPDATE_MANIFEST_HASH_INVALID" });
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) {
    throw new UpdateManagerError("更新安装包大小无效或超过安全上限。", { code: "UPDATE_MANIFEST_SIZE_INVALID" });
  }
  if (!minimumUpdaterVersion || compareVersions(minimumUpdaterVersion, UPDATER_VERSION) > 0) {
    throw new UpdateManagerError("当前更新器版本不满足该 Release 要求，请先使用安装包手动升级。", { code: "UPDATE_UPDATER_TOO_OLD" });
  }
  return {
    schemaVersion: 1,
    productId: PRODUCT_ID,
    version,
    channel: String(manifest.channel || "stable"),
    restartRequired: manifest.restartRequired !== false,
    minimumUpdaterVersion,
    asset: { name: assetName, sha256, size }
  };
}

async function responseJson(response, maximumBytes = MAX_MANIFEST_BYTES) {
  if (!response.ok) throw new UpdateManagerError(`GitHub 下载返回 HTTP ${response.status}。`, { code: "UPDATE_DOWNLOAD_HTTP_ERROR", statusCode: 502 });
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) throw new UpdateManagerError("更新清单超过安全大小限制。", { code: "UPDATE_MANIFEST_TOO_LARGE" });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new UpdateManagerError("更新清单超过安全大小限制。", { code: "UPDATE_MANIFEST_TOO_LARGE" });
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new UpdateManagerError("更新清单不是有效 JSON。", { code: "UPDATE_MANIFEST_INVALID_JSON" });
  }
}

export function createUpdateManager({
  currentVersion,
  installRoot,
  userDataRoot,
  stateFile = join(userDataRoot, "update-state.json"),
  updaterSource = join(installRoot, "installer", "update-bootstrap.ps1"),
  updaterLauncherSource = join(installRoot, "scripts", "update-launcher.mjs"),
  restartSource = join(installRoot, "scripts", "restart-codex-after-update.ps1"),
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  blockerProvider = async () => [],
  now = () => Date.now(),
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  updaterHandshakeTimeoutMs = DEFAULT_UPDATER_HANDSHAKE_TIMEOUT_MS,
  onInstallHandoff = () => {},
  powerShellPath = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
} = {}) {
  const normalizedCurrentVersion = normalizeVersion(currentVersion);
  const applicationRoot = resolve(String(installRoot || ""));
  const dataRoot = resolve(String(userDataRoot || ""));
  if (!normalizedCurrentVersion) throw new TypeError("currentVersion 必须是有效 SemVer。");
  if (!applicationRoot || !dataRoot) throw new TypeError("installRoot 和 userDataRoot 不能为空。");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数。");

  let operation = null;
  let downloadController = null;
  let downloadStarting = false;
  let installStarting = false;
  let restartStarting = false;
  let resumeInstallStarting = false;

  async function readState() {
    try {
      return normalizeState(parseJsonText(await readFile(stateFile, "utf8")), normalizedCurrentVersion);
    } catch {
      return defaultState(normalizedCurrentVersion);
    }
  }

  async function writeState(value) {
    const next = normalizeState({ ...value, updatedAt: new Date(now()).toISOString() }, normalizedCurrentVersion);
    await mkdir(dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    try {
      await rename(temporary, stateFile);
    } catch {
      await rm(stateFile, { force: true });
      await rename(temporary, stateFile);
    }
    return next;
  }

  async function installationMetadata() {
    try {
      const metadata = parseJsonText(await readFile(join(applicationRoot, "install-state.json"), "utf8"));
      const recordedRoot = resolve(String(metadata?.installRoot || ""));
      return {
        managed: metadata?.productId === PRODUCT_ID && recordedRoot.toLowerCase() === applicationRoot.toLowerCase(),
        metadata
      };
    } catch {
      return { managed: false, metadata: null };
    }
  }

  function processAlive(pid) {
    const value = Number(pid || 0);
    if (!Number.isInteger(value) || value <= 0) return false;
    try {
      process.kill(value, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function reconcileInterruptedState(value, installation) {
    if (value.state === "completed" && value.targetVersion === normalizedCurrentVersion) {
      return writeState(defaultState(normalizedCurrentVersion));
    }
    if (value.state === "downloading" && !operation && !downloadStarting) {
      return writeState({
        ...value,
        state: "failed",
        message: "更新下载因本地服务重启而中断，可以重新下载。",
        error: "下载任务未在服务重启后继续运行。"
      });
    }
    const stateAge = Math.max(0, Date.now() - Date.parse(value.updatedAt || 0));
    if (value.state === "installing" && !installStarting
      && (!processAlive(value.updaterProcessId) || stateAge > INSTALL_STALE_TIMEOUT_MS)) {
      const installedTarget = installation.metadata?.version === value.targetVersion
        || normalizedCurrentVersion === value.targetVersion;
      return writeState({
        ...value,
        state: installedTarget ? "restart_required" : "failed",
        phase: installedTarget ? "restart_required" : "failed",
        operationProgress: installedTarget ? 95 : value.operationProgress,
        message: installedTarget
          ? `v${value.targetVersion} 已落盘，但更新器回执中断；请重启 Codex 并通过维护助手检查状态。`
          : "独立更新器已停止，当前版本未确认更新成功；请通过维护助手检查或修复。",
        error: "没有检测到仍在运行的独立更新器。",
        restartRequired: installedTarget
      });
    }
    return value;
  }

  async function waitForUpdaterHandoff(child, operationId) {
    let launchError = null;
    let exitCode = null;
    child?.once?.("error", (error) => { launchError = error; });
    child?.once?.("exit", (code) => { exitCode = code; });
    const deadline = Date.now() + updaterHandshakeTimeoutMs;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      const current = await readState();
      if (current.operationId === operationId
        && current.state === "installing"
        && current.phase !== "launching"
        && current.updaterProcessId > 0) {
        return current;
      }
      if (exitCode !== null) throw new Error(`独立更新器在接管安装前退出（退出码 ${exitCode}）。`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error("独立更新器未在规定时间内确认接管安装。");
  }

  async function waitForRestartHandoff(child) {
    let launchError = null;
    let exitCode = null;
    child?.once?.("error", (error) => { launchError = error; });
    child?.once?.("exit", (code) => { exitCode = code; });
    const deadline = Date.now() + updaterHandshakeTimeoutMs;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      const current = await readState();
      if (current.state === "restart_required"
        && current.phase === "restarting"
        && current.restartProcessId > 0) {
        return current;
      }
      if (exitCode !== null) throw new Error(`重启助手在接管前退出（退出码 ${exitCode}）。`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error("重启助手未在规定时间内确认接管操作。");
  }

  async function status(update = null) {
    let [persisted, installation] = await Promise.all([readState(), installationMetadata()]);
    persisted = await reconcileInterruptedState(persisted, installation);
    resumeReadyInstall(persisted, installation);
    return publicState(persisted, { managedInstallation: installation.managed, update });
  }

  function resumeReadyInstall(value, installation) {
    if (value.state !== "ready" || !value.autoInstallRequested || !installation.managed
      || operation || installStarting || resumeInstallStarting) return;
    resumeInstallStarting = true;
    operation = Promise.resolve()
      .then(() => install({ confirmVersion: value.targetVersion }))
      .catch(async (error) => {
        const current = await readState();
        if (current.state === "installing") return;
        await writeState({
          ...current,
          state: "failed",
          phase: "failed",
          message: "更新已校验，但自动安装未能继续。",
          error: safeMessage(error)
        });
      })
      .finally(() => {
        operation = null;
        resumeInstallStarting = false;
      });
  }

  function assertRelease(update) {
    const latestVersion = normalizeVersion(update?.latestVersion);
    if (!update?.updateAvailable || !latestVersion || compareVersions(latestVersion, normalizedCurrentVersion) <= 0) {
      throw new UpdateManagerError("当前没有可安装的新版本。", { code: "UPDATE_NOT_AVAILABLE", statusCode: 409 });
    }
    if (update?.source !== "release" || !update?.installable) {
      throw new UpdateManagerError("该版本尚未发布正式安装包，只能前往 GitHub 查看。", {
        code: "UPDATE_RELEASE_NOT_INSTALLABLE",
        statusCode: 409,
        details: { reason: update?.installabilityReason || "RELEASE_NOT_PUBLISHED" }
      });
    }
    const assets = Array.isArray(update.assets) ? update.assets : [];
    const manifestAsset = assets.find((asset) => asset?.name === "update-manifest.json");
    if (!manifestAsset?.url) throw new UpdateManagerError("GitHub Release 缺少更新清单。", { code: "UPDATE_MANIFEST_MISSING", statusCode: 409 });
    return { latestVersion, assets, manifestAsset };
  }

  async function performDownload(update) {
    const { latestVersion, assets, manifestAsset } = assertRelease(update);
    const versionDirectory = join(dataRoot, "updates", latestVersion);
    await mkdir(versionDirectory, { recursive: true });
    const timer = setTimeout(() => downloadController?.abort(new Error("更新下载超时。")), downloadTimeoutMs);
    timer.unref?.();
    try {
      const manifestResponse = await fetchImpl(manifestAsset.url, {
        headers: { accept: "application/json", "user-agent": `jira-workbench/${normalizedCurrentVersion}` },
        signal: downloadController.signal
      });
      const manifest = validateManifest(await responseJson(manifestResponse), latestVersion);
      const archiveAsset = assets.find((asset) => asset?.name === manifest.asset.name);
      if (!archiveAsset?.url) {
        throw new UpdateManagerError("更新清单引用的安装包不在同一个 GitHub Release 中。", { code: "UPDATE_ARCHIVE_MISSING" });
      }
      if (archiveAsset.size && archiveAsset.size !== manifest.asset.size) {
        throw new UpdateManagerError("GitHub 安装包大小与更新清单不一致。", { code: "UPDATE_ARCHIVE_SIZE_MISMATCH" });
      }

      const archivePath = join(versionDirectory, manifest.asset.name);
      const partialPath = `${archivePath}.partial`;
      const manifestPath = join(versionDirectory, "update-manifest.json");
      await rm(partialPath, { force: true });
      const response = await fetchImpl(archiveAsset.url, {
        headers: { accept: "application/octet-stream", "user-agent": `jira-workbench/${normalizedCurrentVersion}` },
        signal: downloadController.signal
      });
      if (!response.ok || !response.body) {
        throw new UpdateManagerError(`GitHub 安装包下载返回 HTTP ${response.status}。`, { code: "UPDATE_DOWNLOAD_HTTP_ERROR", statusCode: 502 });
      }
      const responseLength = Number(response.headers.get("content-length") || 0);
      if (responseLength && responseLength !== manifest.asset.size) {
        throw new UpdateManagerError("下载响应大小与更新清单不一致。", { code: "UPDATE_ARCHIVE_SIZE_MISMATCH" });
      }

      const handle = await open(partialPath, "w");
      const hash = createHash("sha256");
      let downloadedBytes = 0;
      let lastPersistedAt = 0;
      try {
        for await (const chunkValue of response.body) {
          const chunk = Buffer.from(chunkValue);
          downloadedBytes += chunk.length;
          if (downloadedBytes > manifest.asset.size || downloadedBytes > MAX_ARCHIVE_BYTES) {
            throw new UpdateManagerError("更新安装包超过清单声明的大小。", { code: "UPDATE_ARCHIVE_TOO_LARGE" });
          }
          hash.update(chunk);
          await handle.write(chunk);
          if (now() - lastPersistedAt >= 250 || downloadedBytes === manifest.asset.size) {
            lastPersistedAt = now();
            await writeState({
              ...(await readState()),
              state: "downloading",
              targetVersion: latestVersion,
              downloadedBytes,
              totalBytes: manifest.asset.size,
              progress: Math.round((downloadedBytes / manifest.asset.size) * 100),
              phase: "downloading",
              operationProgress: Math.round((downloadedBytes / manifest.asset.size) * 22),
              message: `正在下载 v${latestVersion}…`,
              error: ""
            });
          }
        }
        await handle.sync();
      } finally {
        await handle.close();
      }

      if (downloadedBytes !== manifest.asset.size) {
        throw new UpdateManagerError("更新安装包下载不完整。", { code: "UPDATE_ARCHIVE_INCOMPLETE" });
      }
      const actualHash = hash.digest("hex");
      if (actualHash !== manifest.asset.sha256) {
        throw new UpdateManagerError("更新安装包 SHA-256 校验失败，文件已拒绝安装。", { code: "UPDATE_ARCHIVE_HASH_MISMATCH" });
      }
      await rm(archivePath, { force: true });
      await rename(partialPath, archivePath);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      return writeState({
        ...(await readState()),
        state: "ready",
        targetVersion: latestVersion,
        releaseUrl: String(update.url || ""),
        releaseName: String(update.releaseName || `v${latestVersion}`),
        downloadedBytes,
        totalBytes: manifest.asset.size,
        progress: 100,
        phase: "verified",
        operationProgress: 25,
        message: `v${latestVersion} 已下载并通过 SHA-256 校验。`,
        error: "",
        restartRequired: Boolean(manifest.restartRequired),
        archivePath,
        manifestPath
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function startDownload(update, { autoInstall = false } = {}) {
    if (downloadStarting) {
      throw new UpdateManagerError("更新下载正在启动，请稍候。", { code: "UPDATE_DOWNLOAD_STARTING", statusCode: 409 });
    }
    downloadStarting = true;
    try {
      const installation = await installationMetadata();
      if (!installation.managed) {
        throw new UpdateManagerError("当前不是由统一安装器管理的安装目录，无法执行一键更新。", {
          code: "UPDATE_INSTALLATION_UNMANAGED",
          statusCode: 409
        });
      }
      const current = await readState();
      if (current.state === "downloading") return publicState(current, { managedInstallation: true, update });
      if (current.state === "installing") {
        throw new UpdateManagerError("更新正在安装中。", { code: "UPDATE_INSTALL_IN_PROGRESS", statusCode: 409 });
      }
      const { latestVersion } = assertRelease(update);
      downloadController = new AbortController();
      await writeState({
        ...defaultState(normalizedCurrentVersion),
        state: "downloading",
        targetVersion: latestVersion,
        previousVersion: normalizedCurrentVersion,
        releaseUrl: String(update.url || ""),
        releaseName: String(update.releaseName || `v${latestVersion}`),
        phase: "downloading",
        operationProgress: 0,
        autoInstallRequested: Boolean(autoInstall),
        message: `正在准备下载 v${latestVersion}…`
      });
      operation = performDownload(update)
        .then(async (readyState) => {
          if (!autoInstall) return readyState;
          return install({ confirmVersion: readyState.targetVersion });
        })
        .catch(async (error) => {
          const cancelled = downloadController?.signal.aborted;
          const currentState = await readState();
          if (currentState.state === "installing") return;
          const packageWasPrepared = Boolean(currentState.archivePath && currentState.progress >= 100);
          await writeState({
            ...currentState,
            state: cancelled ? "cancelled" : "failed",
            phase: "failed",
            operationProgress: cancelled ? 0 : currentState.operationProgress,
            message: cancelled
              ? "更新下载已取消。"
              : packageWasPrepared ? "更新已下载，但自动安装未完成。" : "更新下载失败。",
            error: cancelled ? "" : safeMessage(error)
          });
        })
        .finally(() => {
          operation = null;
          downloadController = null;
        });
      return status(update);
    } finally {
      downloadStarting = false;
    }
  }

  async function cancelDownload(update = null) {
    const current = await readState();
    if (current.state !== "downloading" || !downloadController) {
      throw new UpdateManagerError("当前没有正在进行的更新下载。", { code: "UPDATE_DOWNLOAD_NOT_RUNNING", statusCode: 409 });
    }
    downloadController.abort(new Error("用户取消更新下载。"));
    await operation?.catch(() => {});
    return status(update);
  }

  async function install({ confirmVersion } = {}) {
    if (installStarting) {
      throw new UpdateManagerError("更新安装正在启动，请稍候。", { code: "UPDATE_INSTALL_STARTING", statusCode: 409 });
    }
    installStarting = true;
    try {
    const installation = await installationMetadata();
    if (!installation.managed) {
      throw new UpdateManagerError("当前安装目录不受统一安装器管理。", { code: "UPDATE_INSTALLATION_UNMANAGED", statusCode: 409 });
    }
    const current = await readState();
    const confirmed = normalizeVersion(confirmVersion);
    if (current.state !== "ready" || !current.targetVersion || confirmed !== current.targetVersion) {
      throw new UpdateManagerError("目标版本与当前已校验的更新包不一致，请重新检查更新。", { code: "UPDATE_TARGET_MISMATCH", statusCode: 409 });
    }
    if (compareVersions(current.targetVersion, normalizedCurrentVersion) <= 0) {
      throw new UpdateManagerError("已下载版本不高于当前版本，请重新检查更新。", { code: "UPDATE_TARGET_NOT_NEWER", statusCode: 409 });
    }
    const expectedUpdateRoot = join(dataRoot, "updates", current.targetVersion);
    if (!pathWithin(expectedUpdateRoot, current.archivePath) || !pathWithin(expectedUpdateRoot, current.manifestPath)) {
      throw new UpdateManagerError("更新缓存路径超出受管目录，请重新下载。", { code: "UPDATE_PATH_OUTSIDE_CACHE", statusCode: 409 });
    }
    for (const path of [current.archivePath, current.manifestPath, updaterSource, updaterLauncherSource]) {
      try { await stat(path); } catch {
        throw new UpdateManagerError("更新所需文件不完整，请重新下载。", { code: "UPDATE_FILES_MISSING", statusCode: 409 });
      }
    }
    const blockers = await blockerProvider();
    if (Array.isArray(blockers) && blockers.length) {
      throw new UpdateManagerError("当前仍有运行中的操作，请完成或取消后再安装更新。", {
        code: "UPDATE_BLOCKED_BY_ACTIVE_OPERATION",
        statusCode: 409,
        details: { blockers }
      });
    }

    const updaterDirectory = join(dataRoot, "updater");
    const stableUpdater = join(updaterDirectory, "update-bootstrap.ps1");
    const stableLauncher = join(updaterDirectory, "update-launcher.mjs");
    await mkdir(updaterDirectory, { recursive: true });
    await Promise.all([
      copyFile(updaterSource, stableUpdater),
      copyFile(updaterLauncherSource, stableLauncher)
    ]);
    const operationId = randomUUID();
    const launchState = await writeState({
      ...current,
      state: "installing",
      previousVersion: normalizedCurrentVersion,
      message: `正在安装 v${current.targetVersion}…`,
      error: "",
      restartRequired: true,
      updaterProcessId: 0,
      operationId,
      phase: "launching",
      operationProgress: 28
    });
    const handoffPayload = encodePowerShellCliValue(JSON.stringify(launchState));
    // Installation always completes first; restarting is a separate user action.
    const updaterArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", stableUpdater,
      "-PackagePath", current.archivePath,
      "-ManifestPath", current.manifestPath,
      "-InstallRoot", applicationRoot,
      "-UserDataRoot", dataRoot,
      "-StatePath", stateFile,
      "-HandoffPayload", handoffPayload,
      "-OperationId", operationId,
      "-ServerProcessId", String(process.pid)
    ];
    const launcherConfigPath = join(updaterDirectory, `launch-${operationId}.json`);
    await writeFile(launcherConfigPath, `${JSON.stringify({ executable: powerShellPath, args: updaterArgs }, null, 2)}\n`, "utf8");
    const child = spawnImpl(process.execPath, [stableLauncher, launcherConfigPath], {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    });
    try {
      const handedOff = await waitForUpdaterHandoff(child, operationId);
      child.unref?.();
      onInstallHandoff({ targetVersion: current.targetVersion, operationId });
      return publicState(handedOff, { managedInstallation: true, update: null });
    } catch (error) {
      try { child.kill?.(); } catch {}
      await writeState({
        ...(await readState()),
        state: "failed",
        phase: "failed",
        message: "独立更新器启动失败，现有安装没有被修改。",
        error: safeMessage(error),
        restartRequired: false
      });
      throw new UpdateManagerError("独立更新器未能启动，现有安装没有被修改。", {
        code: "UPDATE_UPDATER_HANDSHAKE_FAILED",
        statusCode: 500,
        details: { reason: safeMessage(error) }
      });
    }
    } finally {
      installStarting = false;
    }
  }

  async function restart() {
    if (restartStarting) {
      throw new UpdateManagerError("Codex 重启正在启动，请稍候。", {
        code: "UPDATE_RESTART_STARTING",
        statusCode: 409
      });
    }
    restartStarting = true;
    try {
      const installation = await installationMetadata();
      if (!installation.managed) {
        throw new UpdateManagerError("当前安装目录不受统一安装器管理。", {
          code: "UPDATE_INSTALLATION_UNMANAGED",
          statusCode: 409
        });
      }
      const current = await readState();
      if (current.state !== "restart_required"
        || !current.targetVersion
        || current.targetVersion !== normalizedCurrentVersion
        || installation.metadata?.version !== normalizedCurrentVersion) {
        throw new UpdateManagerError("当前没有等待重启生效的更新。", {
          code: "UPDATE_RESTART_NOT_REQUIRED",
          statusCode: 409
        });
      }
      for (const path of [restartSource, updaterLauncherSource]) {
        try { await stat(path); } catch {
          throw new UpdateManagerError("重启所需文件不完整，请通过维护助手修复安装。", {
            code: "UPDATE_RESTART_FILES_MISSING",
            statusCode: 409
          });
        }
      }

      const updaterDirectory = join(dataRoot, "updater");
      const stableLauncher = join(updaterDirectory, "update-launcher.mjs");
      const stableRestart = join(updaterDirectory, "restart-codex-after-update.ps1");
      await mkdir(updaterDirectory, { recursive: true });
      await Promise.all([
        copyFile(updaterLauncherSource, stableLauncher),
        copyFile(restartSource, stableRestart)
      ]);
      await writeState({
        ...current,
        phase: "restart_launching",
        operationProgress: 98,
        restartProcessId: 0,
        message: `正在准备重启 Codex，使 v${current.targetVersion} 完整生效…`,
        error: ""
      });

      const restartArgs = [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", stableRestart,
        "-InstallRoot", applicationRoot,
        "-UserDataRoot", dataRoot,
        "-StatePath", stateFile
      ];
      const operationId = randomUUID();
      const launcherConfigPath = join(updaterDirectory, `restart-${operationId}.json`);
      await writeFile(launcherConfigPath, `${JSON.stringify({ executable: powerShellPath, args: restartArgs }, null, 2)}\n`, "utf8");
      const child = spawnImpl(process.execPath, [stableLauncher, launcherConfigPath], {
        detached: true,
        windowsHide: true,
        stdio: "ignore"
      });
      try {
        const handedOff = await waitForRestartHandoff(child);
        child.unref?.();
        return publicState(handedOff, { managedInstallation: true, update: null });
      } catch (error) {
        try { child.kill?.(); } catch {}
        await writeState({
          ...(await readState()),
          state: "restart_required",
          phase: "restart_required",
          operationProgress: 97,
          restartProcessId: 0,
          message: `v${current.targetVersion} 已安装，需要重启 Codex 才能完整生效。`,
          error: safeMessage(error),
          restartRequired: true
        });
        throw new UpdateManagerError("未能启动 Codex 重启助手，请稍后重试。", {
          code: "UPDATE_RESTART_HANDSHAKE_FAILED",
          statusCode: 500,
          details: { reason: safeMessage(error) }
        });
      }
    } finally {
      restartStarting = false;
    }
  }

  return {
    status,
    startDownload,
    cancelDownload,
    install,
    restart,
    waitForIdle: async () => operation?.catch(() => {}),
    stateFile,
    installRoot: applicationRoot,
    userDataRoot: dataRoot
  };
}
