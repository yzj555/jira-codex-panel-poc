import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueBindingStore } from "../lib/issue-binding-store.mjs";

test("issue bindings migrate from renderer storage and persist runtime ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-bindings-"));
  const file = join(directory, "issue-bindings.json");
  try {
    const store = createIssueBindingStore({ file });
    const imported = await store.importBindings({
      "ct-13349": {
        threadId: "thread-legacy",
        threadTitle: "legacy task",
        boundAt: "2026-08-01T00:00:00.000Z"
      },
      invalid: { threadId: "ignored" }
    });
    assert.deepEqual(Object.keys(imported.bindings), ["CT-13349"]);
    assert.equal(imported.bindings["CT-13349"].runtimeOwner, "legacy-desktop");
    assert.ok(imported.bindings["CT-13349"].importedAt);

    await store.importBindings({
      "CT-13349": { threadId: "stale-browser-copy" },
      "CT-13404": { threadId: "thread-new", runtimeOwner: "standalone-appserver" }
    });
    const migrated = await store.snapshot();
    assert.equal(migrated.bindings["CT-13349"].threadId, "thread-legacy");
    assert.equal(migrated.bindings["CT-13404"].runtimeOwner, "standalone-appserver");

    await store.applyMutations({
      deletes: ["CT-13349"],
      upserts: {
        "CT-13404": { threadId: "thread-rebound", runtimeOwner: "legacy-desktop" }
      }
    });
    const reopened = createIssueBindingStore({ file });
    const persisted = await reopened.snapshot();
    assert.equal(persisted.bindings["CT-13349"], undefined);
    assert.equal(persisted.bindings["CT-13404"].threadId, "thread-rebound");
    assert.ok(persisted.revision >= 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
