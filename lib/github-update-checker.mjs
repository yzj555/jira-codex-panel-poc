const DEFAULT_REPOSITORY = "yzj555/jira-codex-panel-poc";
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_FAILURE_CACHE_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 8_000;

function parseVersion(value) {
  const normalized = String(value || "").trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    text: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ? `-${match[4]}` : ""}`,
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : []
  };
}

export function normalizeVersion(value) {
  return parseVersion(value)?.text || "";
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new TypeError("版本号必须使用 SemVer 格式，例如 0.31.1。");
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumeric = /^\d+$/.test(a.prerelease[index]);
    const bNumeric = /^\d+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) return Number(a.prerelease[index]) > Number(b.prerelease[index]) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.prerelease[index].localeCompare(b.prerelease[index], "en") > 0 ? 1 : -1;
  }
  return 0;
}

function errorMessage(error) {
  const message = String(error?.message || error || "未知错误").trim();
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

export function createGitHubUpdateChecker({
  currentVersion,
  repository = DEFAULT_REPOSITORY,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  failureCacheTtlMs = DEFAULT_FAILURE_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  releaseUrl = `https://api.github.com/repos/${repository}/releases/latest`,
  packageUrl = `https://raw.githubusercontent.com/${repository}/main/package.json`,
  repositoryUrl = `https://github.com/${repository}`
} = {}) {
  const normalizedCurrentVersion = normalizeVersion(currentVersion);
  if (!normalizedCurrentVersion) throw new TypeError("currentVersion 必须是有效的 SemVer 版本号。");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数。");

  let cached = null;
  let inFlight = null;

  async function requestJson(url) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json, application/json",
        "user-agent": `jira-codex-panel/${normalizedCurrentVersion}`
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const error = new Error(`GitHub 返回 HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return response.json();
  }

  async function readLatestVersion() {
    let releaseFailure = null;
    try {
      const release = await requestJson(releaseUrl);
      const latestVersion = normalizeVersion(release?.tag_name);
      if (latestVersion) {
        return {
          latestVersion,
          source: "release",
          sourceLabel: "GitHub Release",
          url: String(release?.html_url || `${repositoryUrl}/releases`),
          releaseName: String(release?.name || release?.tag_name || `v${latestVersion}`),
          publishedAt: release?.published_at ? String(release.published_at) : null
        };
      }
      releaseFailure = new Error("GitHub 最新 Release 没有有效版本号");
    } catch (error) {
      releaseFailure = error;
    }

    try {
      const remotePackage = await requestJson(packageUrl);
      const latestVersion = normalizeVersion(remotePackage?.version);
      if (!latestVersion) throw new Error("远端 package.json 没有有效版本号");
      return {
        latestVersion,
        source: "repository",
        sourceLabel: "GitHub main",
        url: repositoryUrl,
        releaseName: `v${latestVersion}`,
        publishedAt: null
      };
    } catch (packageError) {
      throw new Error(`无法从 GitHub 读取版本：${errorMessage(releaseFailure)}；${errorMessage(packageError)}`);
    }
  }

  async function performCheck(enabled) {
    const checkedAt = new Date(now()).toISOString();
    try {
      const latest = await readLatestVersion();
      return {
        enabled,
        checked: true,
        currentVersion: normalizedCurrentVersion,
        ...latest,
        updateAvailable: compareVersions(latest.latestVersion, normalizedCurrentVersion) > 0,
        checkedAt,
        error: ""
      };
    } catch (error) {
      return {
        enabled,
        checked: false,
        currentVersion: normalizedCurrentVersion,
        latestVersion: "",
        updateAvailable: false,
        source: "github",
        sourceLabel: "GitHub",
        url: repositoryUrl,
        releaseName: "",
        publishedAt: null,
        checkedAt,
        error: errorMessage(error)
      };
    }
  }

  async function check({ enabled = true, force = false } = {}) {
    const automaticCheckEnabled = Boolean(enabled);
    if (!automaticCheckEnabled && !force) {
      return {
        enabled: false,
        checked: false,
        currentVersion: normalizedCurrentVersion,
        latestVersion: "",
        updateAvailable: false,
        source: "disabled",
        sourceLabel: "已关闭",
        url: repositoryUrl,
        releaseName: "",
        publishedAt: null,
        checkedAt: null,
        error: ""
      };
    }

    const age = cached ? now() - cached.cachedAt : Number.POSITIVE_INFINITY;
    const ttl = cached?.status?.checked ? cacheTtlMs : failureCacheTtlMs;
    if (!force && cached && age >= 0 && age < ttl) {
      return { ...cached.status, enabled: automaticCheckEnabled };
    }
    if (inFlight) return inFlight;

    inFlight = performCheck(automaticCheckEnabled)
      .then((status) => {
        cached = { cachedAt: now(), status };
        return status;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    check,
    clearCache() { cached = null; },
    currentVersion: normalizedCurrentVersion,
    repository,
    repositoryUrl
  };
}
