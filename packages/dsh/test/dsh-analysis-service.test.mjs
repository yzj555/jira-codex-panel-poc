import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createIssueBindingStore } from "@jira-workbench/core/lib/issue-binding-store.mjs";
import {
  createDshAnalysisService,
  DshAnalysisServiceError
} from "../lib/dsh-analysis-service.mjs";

function ok(value) {
  return Promise.resolve({ result: { ok: true, value } });
}

function issue() {
  return {
    key: "CT-300",
    title: "新建分析会话",
    url: "http://jira.example/browse/CT-300",
    type: "requirement",
    typeName: "需求",
    statusName: "待处理",
    summary: "需要分析父子单共同上下文。",
    attachments: [],
    collaborators: [],
    fixVersions: []
  };
}

async function fixture({ promptResult, beforePrompt } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-analysis-"));
  const issueBindings = createIssueBindingStore({ file: join(directory, "bindings.json") });
  const calls = { create: [], skills: [], prompt: [], rename: [] };
  const apiProxy = {
    sessions: {
      create(request) {
        calls.create.push(request.payload);
        return ok({ sessionId: "session-created" });
      },
      async prompt(request) {
        calls.prompt.push(request.payload);
        if (beforePrompt) await beforePrompt(issueBindings);
        return promptResult || { result: { ok: true, value: { accepted: true } } };
      },
      rename(request) {
        calls.rename.push(request.payload);
        return ok({ title: request.payload.title, seq: 3 });
      }
    },
    skills: {
      list(request) {
        calls.skills.push(request.payload);
        return ok({
          skills: [
            { name: "project-requirement", description: "项目需求分析", modelInvocable: true },
            { name: "jira-first-turn-analysis", description: "Jira 降级分析", modelInvocable: true }
          ]
        });
      }
    }
  };
  const service = createDshAnalysisService({
    ctx: {
      get(name) {
        if (name === "apiProxy") return apiProxy;
        if (name === "workspaceRegistry") {
          return { list: () => [{ id: "workspace-alpha", path: "F:\\work\\alpha", title: "Alpha" }] };
        }
        return undefined;
      }
    },
    workbench: { async getIssue() { return { issue: issue() }; } },
    configStore: {
      async load() {
        return {
          messageTemplate: "模板降级内容",
          promptTemplates: {
            requirement: { content: "需求模板不应覆盖绑定 Skill", skill: { name: "project-requirement" } },
            bug: { content: "Bug 模板", skill: null }
          }
        };
      }
    },
    taskBoardLoader: { async materializeBugMonitorAttachments() { return []; } },
    issueBindings,
    workspaceBindings: {
      async get() {
        return {
          issueKey: "CT-300",
          revision: 1,
          binding: {
            workspace: {
              defaultProjectScopeId: "scope-alpha",
              projectScopes: [{
                id: "scope-alpha",
                cwd: "F:\\work\\alpha",
                projectId: "workspace-alpha",
                projectLabel: "Alpha"
              }]
            }
          }
        };
      }
    }
  });
  return { directory, issueBindings, service, calls };
}

test("DSH 新建分析会话在指定项目发送只读首条消息后再保存关联", async (t) => {
  const { directory, issueBindings, service, calls } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const result = await service.createIssueAnalysis("ct-300", "补充业务边界", {
    expectedRevision: 0,
    projectScopeId: "scope-alpha"
  });

  assert.deepEqual(calls.create, [{ workspaceId: "workspace-alpha" }]);
  assert.equal(calls.skills[0].sessionId, "session-created");
  assert.equal(calls.prompt[0].sessionId, "session-created");
  assert.equal(calls.prompt[0].mode, "queue");
  assert.match(calls.prompt[0].content[0].text, /^\/project-requirement\n\n【首轮约束】/);
  assert.match(calls.prompt[0].content[0].text, /补充业务边界/);
  assert.doesNotMatch(calls.prompt[0].content[0].text, /需求模板不应覆盖绑定 Skill/);
  assert.equal(result.sessionId, "session-created");
  assert.equal(result.selectedSkill.name, "project-requirement");
  const stored = await issueBindings.snapshot();
  assert.equal(stored.bindings["CT-300"].threadId, "session-created");
  assert.equal(stored.bindings["CT-300"].runtimeOwner, "dsh");
});

test("DSH 首条消息被 Host 拒绝时不保存 Jira 关联", async (t) => {
  const { directory, issueBindings, service } = await fixture({
    promptResult: {
      result: {
        ok: false,
        error: { code: "model-unavailable", message: "模型不可用", details: {} }
      }
    }
  });
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    service.createIssueAnalysis("CT-300", "", { expectedRevision: 0, projectScopeId: "scope-alpha" }),
    (error) => error instanceof DshAnalysisServiceError && error.code === "MODEL_UNAVAILABLE"
  );
  assert.deepEqual((await issueBindings.snapshot()).bindings, {});
});

test("DSH 会话创建后若 revision 冲突则保留会话但不覆盖新绑定", async (t) => {
  const { directory, issueBindings, service } = await fixture({
    beforePrompt: async (store) => {
      await store.applyMutations({
        expectedRevision: 0,
        upserts: {
          "CT-999": {
            threadId: "other-session",
            threadTitle: "并发会话",
            runtimeOwner: "dsh",
            hostReference: "dsh-session"
          }
        }
      });
    }
  });
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    service.createIssueAnalysis("CT-300", "", { expectedRevision: 0, projectScopeId: "scope-alpha" }),
    (error) => error instanceof DshAnalysisServiceError
      && error.code === "ISSUE_ANALYSIS_CREATED_UNBOUND"
      && error.details.sessionId === "session-created"
  );
  const stored = await issueBindings.snapshot();
  assert.equal(stored.bindings["CT-300"], undefined);
  assert.equal(stored.bindings["CT-999"].threadId, "other-session");
});
