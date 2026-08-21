import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Release 工作流不会把已发布版本重新降为草稿", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");

  assert.match(workflow, /Create or update published GitHub Release/);
  assert.match(workflow, /gh release view \$tag --json isDraft/);
  assert.match(workflow, /if \(\$release\.isDraft\)/);
  assert.match(workflow, /gh release edit \$tag --draft=false --latest/);
  assert.match(workflow, /gh release create \$tag @assets --verify-tag --generate-notes --title \$tag --latest/);
  assert.doesNotMatch(workflow, /--draft=true/);
  assert.doesNotMatch(workflow, /gh release create[^\r\n]*--draft(?:\s|$)/);
});

test("set-version 同步全部 workspace、DSH 适配层与 Plugin cachebuster", async () => {
  const setVersion = await readFile(new URL("../scripts/set-version.mjs", import.meta.url), "utf8");
  const verifyVersion = await readFile(new URL("../scripts/verify-release-version.mjs", import.meta.url), "utf8");

  // core 独立服务的版本标记必须纳入同步与校验（否则 health 会报陈旧的 0.31.8）。
  assert.match(setVersion, /packages\/core\/bin\/serve\.mjs/);
  assert.match(setVersion, /packages\/core\/index\.mjs/);
  assert.match(verifyVersion, /packages\/core\/bin\/serve\.mjs/);
  assert.match(verifyVersion, /packages\/core\/index\.mjs/);
  assert.match(setVersion, /packages\/dsh-client\/package\.json/);
  assert.match(setVersion, /packages\/dsh\/plugin\.mjs/);
  assert.match(verifyVersion, /packages\/dsh-client\/package\.json/);
  assert.match(verifyVersion, /packages\/dsh\/plugin\.mjs/);

  // Plugin cachebuster 随版本同步到仓库，本地安装时 Codex 能识别新版本。
  assert.match(setVersion, /plugins\/jira-workbench-assistant\/\.codex-plugin\/plugin\.json/);
  assert.match(setVersion, /cachebusterPattern/);
  assert.match(setVersion, /\+codex\.v\$\{version\}/);
});

test("统一 Release 同时包含 Core、Codex 与 DSH 两侧适配包", async () => {
  const buildRelease = await readFile(new URL("../scripts/build-release.ps1", import.meta.url), "utf8");

  assert.match(buildRelease, /packages\\core/);
  assert.match(buildRelease, /packages\\codex/);
  assert.match(buildRelease, /packages\\dsh'/);
  assert.match(buildRelease, /packages\\dsh-client/);
  assert.match(buildRelease, /packages\\dsh\\plugin\.mjs/);
  assert.match(buildRelease, /packages\\dsh-client\\lib\\client\.js/);
});

test("Release 通过 Trusted Publishing 按 Core、Client、Host 顺序发布 npm 包", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
  const publishScript = await readFile(new URL("../../../scripts/publish-npm.mjs", import.meta.url), "utf8");
  const core = JSON.parse(await readFile(new URL("../../core/package.json", import.meta.url), "utf8"));
  const client = JSON.parse(await readFile(new URL("../../dsh-client/package.json", import.meta.url), "utf8"));
  const host = JSON.parse(await readFile(new URL("../../dsh/package.json", import.meta.url), "utf8"));

  assert.match(workflow, /publish-npm:/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm install --global npm@11/);
  assert.match(workflow, /release:npm:verify/);
  assert.match(workflow, /--if-missing --provenance/);
  assert.ok(publishScript.indexOf('name: "@jira-workbench/core"') < publishScript.indexOf('name: "@jira-workbench/dsh-client"'));
  assert.ok(publishScript.indexOf('name: "@jira-workbench/dsh-client"') < publishScript.indexOf('name: "@jira-workbench/dsh"'));
  assert.match(publishScript, /https:\/\/registry\.npmjs\.org\//);
  assert.match(publishScript, /mcp\/ui\/task-board\.html/);
  assert.match(publishScript, /lib\/client\.js/);
  assert.match(publishScript, /cordis\.patch\.yml/);

  for (const manifest of [core, client, host]) {
    assert.notEqual(manifest.private, true);
    assert.equal(manifest.publishConfig.access, "public");
    assert.equal(manifest.publishConfig.registry, "https://registry.npmjs.org/");
  }
  assert.equal(host.name, "@jira-workbench/dsh");
  assert.equal(host.dependencies["@jira-workbench/core"], host.version);
  assert.equal(host.dependencies["@jira-workbench/dsh-client"], host.version);
});
