import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

function issue(key = "CT-300") {
  return {
    key,
    title: "新建分析会话",
    url: `http://jira.example/browse/${key}`,
    type: "requirement",
    typeName: "需求",
    statusName: "待处理",
    summary: "需要分析父子单共同上下文。",
    attachments: [],
    collaborators: [],
    fixVersions: []
  };
}

async function fixture({
  promptResult,
  promptResults,
  beforePrompt,
  sessionIds = ["session-created"],
  imageContextService,
  configuration,
  materializedAttachments = [],
  modelSelection = { provider: "main", model: "chat" },
  modelModalities = {}
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-analysis-"));
  const issueBindings = createIssueBindingStore({ file: join(directory, "bindings.json") });
  const calls = {
    create: [],
    skills: [],
    prompt: [],
    rename: [],
    models: [],
    selectModel: [],
    defaultModelRestore: []
  };
  let currentModel = { ...modelSelection };
  const apiProxy = {
    sessions: {
      create(request) {
        calls.create.push(request.payload);
        return ok({ sessionId: sessionIds[calls.create.length - 1] || `session-created-${calls.create.length}` });
      },
      async prompt(request) {
        calls.prompt.push(request.payload);
        if (beforePrompt) await beforePrompt(issueBindings);
        return promptResults?.[calls.prompt.length - 1]
          || promptResult
          || { result: { ok: true, value: { accepted: true } } };
      },
      rename(request) {
        calls.rename.push(request.payload);
        return ok({ title: request.payload.title, seq: 3 });
      },
      models(request) {
        calls.models.push(request.payload);
        return ok({ current: { ...currentModel }, groups: [], failures: [], routable: true });
      },
      selectModel(request) {
        calls.selectModel.push(request.payload);
        currentModel = {
          provider: request.payload.provider,
          model: request.payload.model,
          ...(request.payload.reasoningEffort
            ? { reasoningEffort: request.payload.reasoningEffort }
            : {})
        };
        return ok({ selected: { ...currentModel } });
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
        if (name === "llm") {
          return {
            async resolveModelInfo(provider, model) {
              return { inputModalities: modelModalities[`${provider}/${model}`] || ["text"] };
            }
          };
        }
        if (name === "agentDefaultModel") {
          return {
            async saveSelection(selection) {
              calls.defaultModelRestore.push(selection);
            }
          };
        }
        return undefined;
      }
    },
    workbench: { async getIssue(issueKey) { return { issue: issue(issueKey) }; } },
    configStore: {
      async load() {
        if (configuration) return configuration;
        return {
          messageTemplate: "模板降级内容",
          promptTemplates: {
            requirement: { content: "需求模板不应覆盖绑定 Skill", skill: { name: "project-requirement" } },
            bug: { content: "Bug 模板", skill: null }
          }
        };
      }
    },
    taskBoardLoader: { async materializeBugMonitorAttachments() { return materializedAttachments; } },
    issueBindings,
    ...(imageContextService ? { imageContextService } : {}),
    workspaceBindings: {
      async get(issueKey) {
        return {
          issueKey,
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

test("DSH 当前模型明确不支持图片时切到配置的视觉模型并发送原图", async (t) => {
  const attachments = [];
  const { directory, service, calls } = await fixture({
    materializedAttachments: attachments,
    modelSelection: { provider: "text-provider", model: "text-model", reasoningEffort: "high" },
    modelModalities: {
      "text-provider/text-model": ["text"],
      "vision-provider/vision-model": ["text", "image"]
    },
    configuration: {
      messageTemplate: "模板降级内容",
      promptTemplates: {
        requirement: { content: "需求模板", skill: { name: "project-requirement" } },
        bug: { content: "Bug 模板", skill: null }
      },
      imageProcessing: {
        visionProvider: "vision-provider",
        visionModel: "vision-model",
        localOcrEnabled: true
      }
    }
  });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const imagePath = join(directory, "jira-evidence.png");
  await writeFile(imagePath, Buffer.from("89504e470d0a1a0a", "hex"));
  attachments.push({
    attachmentId: "image-1",
    filename: "jira-evidence.png",
    label: "jira-evidence.png",
    mimeType: "image/png",
    path: imagePath,
    sourceIssueKey: "CT-300",
    sourceLabel: "当前单子"
  });

  const result = await service.createIssueAnalysis("CT-300", "", {
    expectedRevision: 0,
    projectScopeId: "scope-alpha"
  });

  assert.equal(calls.selectModel.length, 1);
  assert.deepEqual(
    {
      sessionId: calls.selectModel[0].sessionId,
      provider: calls.selectModel[0].provider,
      model: calls.selectModel[0].model
    },
    { sessionId: "session-created", provider: "vision-provider", model: "vision-model" }
  );
  assert.equal(calls.prompt.length, 1);
  assert.equal(calls.prompt[0].content.some((part) => part.type === "image"), true);
  assert.doesNotMatch(calls.prompt[0].content[0].text, /图片附件处理结果|视觉解析|OCR 降级/);
  assert.equal(calls.defaultModelRestore.length, 1);
  assert.deepEqual(calls.defaultModelRestore[0], {
    provider: "text-provider",
    model: "text-model",
    reasoningEffort: "high"
  });
  assert.equal(result.imageAttachmentCount, 1);
  assert.equal(result.imageProcessing.mode, "native");
  assert.deepEqual(result.imageProcessing.modelRouting, {
    mode: "session-vision-model",
    provider: "vision-provider",
    model: "vision-model",
    sessionRetainsModel: true,
    defaultModelRestored: true
  });
});

test("DSH Host 拒绝原图后自动降级为文本图片说明且只发送一个有效首轮", async (t) => {
  const prepareCalls = [];
  const { directory, issueBindings, service, calls } = await fixture({
    promptResults: [
      {
        result: {
          ok: false,
          error: {
            code: "attachment-error",
            message: "Model does not support images",
            details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }
          }
        }
      },
      { result: { ok: true, value: { accepted: true } } }
    ],
    imageContextService: {
      async prepare(input) {
        prepareCalls.push(input);
        if (!input.forceFallback) {
          return {
            mode: "native",
            imageParts: [{ type: "image", mediaType: "image/png", data: "aW1hZ2U=", name: "错误截图.png" }],
            textContext: "",
            statuses: [{ attachmentId: "900", filename: "错误截图.png", mode: "native" }]
          };
        }
        return {
          mode: "fallback",
          imageParts: [],
          textContext: "## 图片附件处理结果\n\n### [OCR 降级] 错误截图.png\n登录失败",
          statuses: [{ attachmentId: "900", filename: "错误截图.png", mode: "ocr", text: "登录失败" }]
        };
      }
    }
  });
  t.after(() => rm(directory, { recursive: true, force: true }));

  const result = await service.createIssueAnalysis("CT-300", "", {
    expectedRevision: 0,
    projectScopeId: "scope-alpha"
  });

  assert.equal(calls.prompt.length, 2);
  assert.equal(calls.prompt[0].content.some((part) => part.type === "image"), true);
  assert.equal(calls.prompt[1].content.some((part) => part.type === "image"), false);
  assert.match(calls.prompt[1].content[0].text, /\[OCR 降级\]/);
  assert.deepEqual(prepareCalls.map((call) => Boolean(call.forceFallback)), [false, true]);
  assert.equal(result.imageAttachmentCount, 0);
  assert.equal(result.imageProcessing.statuses[0].mode, "ocr");
  assert.equal((await issueBindings.snapshot()).bindings["CT-300"].threadId, "session-created");
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
          "CT-300": {
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
  assert.equal(stored.bindings["CT-300"].threadId, "other-session");
});

test("DSH ignores unrelated binding revisions before and during analysis creation", async (t) => {
  const { directory, issueBindings, service } = await fixture({
    beforePrompt: async (store) => {
      const snapshot = await store.snapshot();
      await store.applyMutations({
        expectedRevision: snapshot.revision,
        upserts: {
          "CT-998": {
            threadId: "concurrent-session",
            threadTitle: "Concurrent session",
            runtimeOwner: "dsh",
            hostReference: "dsh-session"
          }
        }
      });
    }
  });
  t.after(() => rm(directory, { recursive: true, force: true }));

  await issueBindings.applyMutations({
    expectedRevision: 0,
    upserts: {
      "CT-999": {
        threadId: "previous-session",
        threadTitle: "Previous session",
        runtimeOwner: "dsh",
        hostReference: "dsh-session"
      }
    }
  });
  const result = await service.createIssueAnalysis("CT-300", "", {
    expectedRevision: 0,
    expectedThreadId: "",
    projectScopeId: "scope-alpha"
  });

  assert.equal(result.sessionId, "session-created");
  const stored = await issueBindings.snapshot();
  assert.equal(stored.bindings["CT-300"].threadId, "session-created");
  assert.equal(stored.bindings["CT-998"].threadId, "concurrent-session");
  assert.equal(stored.bindings["CT-999"].threadId, "previous-session");
});

test("DSH still blocks creation when the target Jira binding itself changed", async (t) => {
  const { directory, issueBindings, service, calls } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  await issueBindings.applyMutations({
    expectedRevision: 0,
    upserts: {
      "CT-300": {
        threadId: "newer-session",
        threadTitle: "Newer session",
        runtimeOwner: "dsh",
        hostReference: "dsh-session"
      }
    }
  });

  await assert.rejects(
    service.createIssueAnalysis("CT-300", "", {
      expectedRevision: 0,
      expectedThreadId: "",
      projectScopeId: "scope-alpha"
    }),
    (error) => error instanceof DshAnalysisServiceError
      && error.code === "ISSUE_BINDINGS_REVISION_CONFLICT"
      && error.details.stage === "before_create"
  );
  assert.equal(calls.create.length, 0);
});

test("DSH supports creating and binding analysis sessions for two Jira issues in sequence", async (t) => {
  const { directory, issueBindings, service, calls } = await fixture({
    sessionIds: ["session-for-ct-300", "session-for-ct-301"]
  });
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = await service.createIssueAnalysis("CT-300", "", {
    expectedRevision: 0,
    projectScopeId: "scope-alpha"
  });
  const second = await service.createIssueAnalysis("CT-301", "", {
    expectedRevision: first.bindingsRevision,
    projectScopeId: "scope-alpha"
  });

  assert.equal(first.sessionId, "session-for-ct-300");
  assert.equal(second.sessionId, "session-for-ct-301");
  assert.equal(second.bindingsRevision, 2);
  assert.equal(calls.create.length, 2);
  assert.equal(calls.prompt.length, 2);
  const stored = await issueBindings.snapshot();
  assert.equal(stored.bindings["CT-300"].threadId, "session-for-ct-300");
  assert.equal(stored.bindings["CT-301"].threadId, "session-for-ct-301");
});
