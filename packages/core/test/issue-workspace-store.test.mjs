import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueBindingStore } from "../lib/issue-binding-store.mjs";
import { createIssueWorkspaceStore } from "../lib/issue-workspace-store.mjs";
import { createIssueWorkspaceService } from "../lib/issue-workspace-service.mjs";
import { createSvnWorkbenchService } from "../lib/svn-workbench-service.mjs";

test("项目绑定与会话绑定分离，并支持同一 Jira 的多个目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-workspaces-"));
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  await mkdir(projectA);
  await mkdir(projectB);
  const store = createIssueWorkspaceStore({ file: join(root, "issue-workspaces.json") });
  const service = createIssueWorkspaceService({ store });

  try {
    let result = await service.bind({
      issueKey: "CT-100",
      cwd: projectA,
      expectedRevision: 0
    });
    assert.equal(result.revision, 1);
    result = await service.bind({
      issueKey: "ct-100",
      cwd: projectB,
      makeDefault: false,
      expectedRevision: 1
    });
    assert.equal(result.binding.workspace.projectScopes.length, 2);
    assert.equal(result.binding.workspace.defaultProjectScopeId, result.binding.workspace.projectScopes[0].id);
    assert.equal(Object.hasOwn(result.binding, "threadId"), false);

    const removedId = result.binding.workspace.projectScopes[0].id;
    result = await service.unbind({ issueKey: "CT-100", projectScopeId: removedId, expectedRevision: 2 });
    assert.equal(result.binding.workspace.projectScopes.length, 1);
    assert.notEqual(result.binding.workspace.defaultProjectScopeId, removedId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("项目绑定使用 revision CAS，陈旧页面不能覆盖新状态", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-workspaces-cas-"));
  const store = createIssueWorkspaceStore({ file: join(root, "issue-workspaces.json") });
  const service = createIssueWorkspaceService({ store });
  try {
    await service.bind({ issueKey: "CT-101", cwd: root, expectedRevision: 0 });
    await assert.rejects(
      () => service.bind({ issueKey: "CT-102", cwd: root, expectedRevision: 0 }),
      (error) => error?.code === "ISSUE_WORKSPACES_REVISION_CONFLICT" && error?.statusCode === 409
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("宿主项目目录列表按绝对路径规范化并去重", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-workspace-catalog-"));
  const store = createIssueWorkspaceStore({ file: join(root, "issue-workspaces.json") });
  const service = createIssueWorkspaceService({
    store,
    catalog: {
      async list() {
        return {
          host: "dsh",
          workspaces: [
            { workspaceId: "workspace-a", path: root, title: "DSH 项目" },
            { workspaceId: "workspace-duplicate", path: root, title: "重复项" },
            { workspaceId: "workspace-relative", path: "relative/project", title: "无效项" }
          ]
        };
      }
    }
  });

  try {
    assert.deepEqual(await service.listAvailable(), {
      host: "dsh",
      available: true,
      workspaces: [{
        id: "workspace-a",
        cwd: root,
        projectId: "workspace-a",
        projectLabel: "DSH 项目",
        source: "dsh"
      }]
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SVN 可仅凭 Jira 项目绑定工作，不要求 Codex 会话", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-workspaces-svn-"));
  const canonicalRoot = await realpath(root);
  const bindingStore = createIssueBindingStore({ file: join(root, "issue-bindings.json") });
  const workspaceStore = createIssueWorkspaceStore({ file: join(root, "issue-workspaces.json") });
  const workspaceService = createIssueWorkspaceService({ store: workspaceStore });
  await workspaceService.bind({ issueKey: "CT-102", cwd: root, expectedRevision: 0 });
  const calls = [];
  const svn = createSvnWorkbenchService({
    loadConfig: async () => ({ configured: true, token: "token" }),
    jira: { async fetchIssue(_config, key) { return { key, title: "任务" }; } },
    issueBindings: bindingStore,
    issueWorkspaces: workspaceStore,
    reviews: {
      async inspect(input) { calls.push(input); return { workingCopy: { root } }; },
      listCommitHistory() { return []; },
      findLatestReview() { return null; }
    },
    buildCommitMessage: (issue) => issue.key
  });

  try {
    const result = await svn.context({ issueKey: "CT-102" });
    assert.equal(result.scopeSelectionRequired, false);
    assert.equal(calls[0].threadId, "workspace:CT-102");
    assert.equal(calls[0].workspaceContext.cwd, canonicalRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
