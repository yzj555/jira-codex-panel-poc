import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createIssueBindingStore } from "@jira-workbench/core/lib/issue-binding-store.mjs";
import {
  createDshConversationService,
  DshConversationServiceError
} from "../lib/dsh-conversation-service.mjs";

function sessionQuery() {
  const records = [
    { header: { id: "session-alpha", cwd: "F:\\work\\alpha", createdAt: 3 }, live: true, persisted: true },
    { header: { id: "session-beta", cwd: "F:\\work\\beta", createdAt: 2 }, live: false, persisted: true },
    { header: { id: "session-child", cwd: "F:\\work\\alpha", createdAt: 1, origin: "subagent" }, live: false, persisted: true }
  ];
  const titles = new Map([
    ["session-alpha", "处理 Alpha 需求"],
    ["session-beta", "修复 Beta Bug"],
    ["session-child", "内部子任务"]
  ]);
  return {
    async listSessions() { return structuredClone(records); },
    async readTitleSnapshots(ids) {
      return ids.map((id) => ({
        status: "fulfilled",
        value: { title: { title: titles.get(id), updatedAt: 10 } }
      }));
    }
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-session-"));
  const issueBindings = createIssueBindingStore({ file: join(directory, "bindings.json") });
  const query = sessionQuery();
  const service = createDshConversationService({
    ctx: { get(name) { return name === "sessionQuery" ? query : undefined; } },
    issueBindings
  });
  return { directory, issueBindings, service };
}

test("DSH 会话目录列出主会话并支持标题、目录搜索", async (t) => {
  const { directory, service } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const listed = await service.listThreads({ limit: 100 });
  assert.equal(listed.runtimeOwner, "dsh");
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.threads.map((thread) => thread.id), ["session-alpha", "session-beta"]);
  assert.equal(listed.threads[0].title, "处理 Alpha 需求");

  const searched = await service.listThreads({ searchTerm: "beta" });
  assert.deepEqual(searched.threads.map((thread) => thread.id), ["session-beta"]);
  const scoped = await service.listThreads({ cwd: "F:\\work\\alpha" });
  assert.deepEqual(scoped.threads.map((thread) => thread.id), ["session-alpha"]);
});

test("DSH Jira 会话关联使用 revision CAS，支持重绑和解除", async (t) => {
  const { directory, service } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bound = await service.bindIssue({
    issueKey: "ct-100",
    threadId: "session-alpha",
    expectedRevision: 0
  });
  assert.equal(bound.binding.runtimeOwner, "dsh");
  assert.equal(bound.binding.hostReference, "dsh-session");
  assert.equal(bound.binding.threadTitle, "处理 Alpha 需求");

  await assert.rejects(
    service.bindIssue({ issueKey: "CT-101", threadId: "session-alpha", expectedRevision: 1 }),
    (error) => error instanceof DshConversationServiceError && error.code === "DSH_SESSION_ALREADY_BOUND"
  );

  const rebound = await service.bindIssue({
    issueKey: "CT-101",
    threadId: "session-alpha",
    expectedRevision: 1,
    replaceExistingThreadBinding: true
  });
  assert.deepEqual(rebound.replacedIssueKeys, ["CT-100"]);
  const listed = await service.listThreads();
  assert.deepEqual(listed.threads[0].boundIssueKeys, ["CT-101"]);

  const cleared = await service.clearBinding({ issueKey: "CT-101", expectedRevision: 2 });
  assert.equal(cleared.revision, 3);
  assert.equal(cleared.binding, null);
});
