import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersions,
  createGitHubUpdateChecker,
  normalizeVersion
} from "../lib/github-update-checker.mjs";

test("版本比较遵循 SemVer，并接受常见的 v 前缀", () => {
  assert.equal(normalizeVersion("v0.31.2"), "0.31.2");
  assert.equal(compareVersions("0.31.2", "0.31.1"), 1);
  assert.equal(compareVersions("0.31.1", "0.31.1"), 0);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
});

test("优先使用 GitHub Release 判断新版本", async () => {
  const calls = [];
  const checker = createGitHubUpdateChecker({
    currentVersion: "0.31.1",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        tag_name: "v0.32.0",
        name: "0.32.0",
        html_url: "https://github.com/yzj555/jira-codex-panel-poc/releases/tag/v0.32.0",
        published_at: "2026-08-13T00:00:00Z",
        assets: [
          { id: 1, name: "update-manifest.json", size: 300, browser_download_url: "https://github.com/yzj555/jira-codex-panel-poc/releases/download/v0.32.0/update-manifest.json" },
          { id: 2, name: "jira-codex-assistant-0.32.0-win-x64.zip", size: 1000, browser_download_url: "https://github.com/yzj555/jira-codex-panel-poc/releases/download/v0.32.0/jira-codex-assistant-0.32.0-win-x64.zip" }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const status = await checker.check();
  assert.equal(status.checked, true);
  assert.equal(status.source, "release");
  assert.equal(status.currentVersion, "0.31.1");
  assert.equal(status.latestVersion, "0.32.0");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.installable, true);
  assert.equal(status.assets.length, 2);
  assert.equal(calls.length, 1);
});

test("没有 Release 时回退到远端 main 的 package.json", async () => {
  const calls = [];
  const checker = createGitHubUpdateChecker({
    currentVersion: "0.31.1",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("releases/latest")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ version: "0.31.1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const status = await checker.check();
  assert.equal(status.checked, true);
  assert.equal(status.source, "repository");
  assert.equal(status.latestVersion, "0.31.1");
  assert.equal(status.updateAvailable, false);
  assert.equal(status.installable, false);
  assert.equal(status.installabilityReason, "RELEASE_NOT_PUBLISHED");
  assert.equal(calls.length, 3);
});

test("GitHub API 限流时使用公开 Release 更新清单继续提供安装", async () => {
  const calls = [];
  const checker = createGitHubUpdateChecker({
    currentVersion: "0.31.2",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("https://api.github.com/")) {
        return new Response("rate limited", { status: 403 });
      }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        productId: "jira-codex-panel",
        version: "0.31.3",
        asset: {
          name: "jira-codex-assistant-0.31.3-win-x64.zip",
          size: 123,
          sha256: "a".repeat(64)
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const status = await checker.check({ force: true });
  assert.equal(status.source, "release");
  assert.equal(status.latestVersion, "0.31.3");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.installable, true);
  assert.equal(status.assets.length, 2);
  assert.equal(calls.length, 2);
});

test("关闭自动检查时不访问 GitHub，手动强制检查仍可使用", async () => {
  let calls = 0;
  const checker = createGitHubUpdateChecker({
    currentVersion: "0.31.1",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ tag_name: "v0.31.2" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const disabled = await checker.check({ enabled: false });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.checked, false);
  assert.equal(calls, 0);

  const manual = await checker.check({ enabled: false, force: true });
  assert.equal(manual.enabled, false);
  assert.equal(manual.checked, true);
  assert.equal(manual.updateAvailable, true);
  assert.equal(calls, 1);
});

test("成功结果会缓存，手动检查会绕过缓存", async () => {
  let calls = 0;
  let clock = 1_000;
  const checker = createGitHubUpdateChecker({
    currentVersion: "0.31.1",
    now: () => clock,
    cacheTtlMs: 60_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ tag_name: "v0.31.1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await checker.check();
  clock += 10_000;
  await checker.check();
  assert.equal(calls, 1);
  await checker.check({ force: true });
  assert.equal(calls, 2);
});

test("GitHub 暂时不可用只返回非阻塞状态", async () => {
  const checker = createGitHubUpdateChecker({
    currentVersion: "0.31.1",
    fetchImpl: async () => new Response("unavailable", { status: 503 })
  });
  const status = await checker.check();
  assert.equal(status.checked, false);
  assert.equal(status.updateAvailable, false);
  assert.match(status.error, /无法从 GitHub 读取版本/);
});
