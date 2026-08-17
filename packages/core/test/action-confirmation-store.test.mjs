import assert from "node:assert/strict";
import { test } from "node:test";
import { createActionConfirmationStore } from "../lib/action-confirmation-store.mjs";

test("操作确认只能使用一次且严格绑定动作类型", () => {
  const store = createActionConfirmationStore();
  const grant = store.issue("jira-transition", { issueKey: "CT-1", transitionId: "4" });
  assert.throws(() => store.consume(grant.confirmationId, "svn-commit"), (error) => error.code === "ACTION_CONFIRMATION_INVALID");
  assert.deepEqual(store.consume(grant.confirmationId, "jira-transition"), { issueKey: "CT-1", transitionId: "4" });
  assert.throws(() => store.consume(grant.confirmationId, "jira-transition"), (error) => error.code === "ACTION_CONFIRMATION_INVALID");
});

test("操作确认过期后不会执行外部写操作", () => {
  let current = 1_000;
  const store = createActionConfirmationStore({ ttlMs: 5_000, now: () => current });
  const grant = store.issue("jira-transition", { issueKey: "CT-1" });
  current += 5_001;
  assert.throws(() => store.consume(grant.confirmationId, "jira-transition"), (error) => ["ACTION_CONFIRMATION_EXPIRED", "ACTION_CONFIRMATION_INVALID"].includes(error.code));
});
