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

test("set-version 同步 core 独立服务版本与 Plugin cachebuster", async () => {
  const setVersion = await readFile(new URL("../scripts/set-version.mjs", import.meta.url), "utf8");
  const verifyVersion = await readFile(new URL("../scripts/verify-release-version.mjs", import.meta.url), "utf8");

  // core 独立服务的版本标记必须纳入同步与校验（否则 health 会报陈旧的 0.31.8）。
  assert.match(setVersion, /packages\/core\/bin\/serve\.mjs/);
  assert.match(setVersion, /packages\/core\/index\.mjs/);
  assert.match(verifyVersion, /packages\/core\/bin\/serve\.mjs/);
  assert.match(verifyVersion, /packages\/core\/index\.mjs/);

  // Plugin cachebuster 随版本同步到仓库，本地安装时 Codex 能识别新版本。
  assert.match(setVersion, /plugins\/jira-workbench-assistant\/\.codex-plugin\/plugin\.json/);
  assert.match(setVersion, /cachebusterPattern/);
  assert.match(setVersion, /\+codex\.v\$\{version\}/);
});
