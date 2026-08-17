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
