import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  apply,
  inject,
  name,
  dshConfigFile,
  dshDataRoot,
  createDshWorkspaceCatalog,
  createDshConnectionConfigHandler,
  createDshConfigOptionsHandler,
  createDshSessionContextHandler,
  approveDshMutation
} from "../plugin.mjs";

function responseRecorder() {
  const result = { statusCode: 0, headers: {}, body: "" };
  return {
    result,
    response: {
      writeHead(statusCode, headers = {}) {
        result.statusCode = statusCode;
        result.headers = headers;
      },
      end(body = "") {
        result.body += String(body || "");
      }
    }
  };
}

test("DSH Client 设置卡片同时兼容旧 list 与新 keyed 插槽标识", async () => {
  const bundle = await readFile(
    join(import.meta.dirname, "..", "..", "dsh-client", "lib", "client.js"),
    "utf8"
  );
  assert.match(bundle, /const settingsPluginIdentity = \{ id: JIRA_WORKBENCH_NS \};/);
  assert.match(
    bundle,
    /name: "settings\.plugin\.item",\s*key: JIRA_WORKBENCH_NS,\s*\.\.\.settingsPluginIdentity/
  );
});

// 最小 ctx mock：只提供 apply 用到的 get("tools")、effect、inject（可选服务注入）。
function mockCtx({ credentials, approval, workspaceRegistry, sessionQuery, apiProxy, settings } = {}) {
  const registered = [];
  const effects = [];
  const emitted = [];
  const tools = {
    register(definition) {
      registered.push(definition);
      return () => {
        const index = registered.indexOf(definition);
        if (index >= 0) registered.splice(index, 1);
      };
    }
  };
  const ctx = {
    get(serviceName) {
      if (serviceName === "tools") return tools;
      if (serviceName === "credentials") return credentials;
      if (serviceName === "approval") return approval;
      if (serviceName === "settings") return settings;
      if (serviceName === "workspaceRegistry") return workspaceRegistry || {
        list() {
          return [{ id: "workspace-1", path: "F:\\repo", title: "repo" }];
        }
      };
      if (serviceName === "sessionQuery") return sessionQuery || {
        async listSessions() {
          return [{
            header: { id: "session-1", cwd: "F:\\repo", createdAt: 1 },
            live: true,
            persisted: true
          }];
        },
        async readTitleSnapshots() {
          return [{ status: "fulfilled", value: { title: { title: "DSH 会话", updatedAt: 2 } } }];
        }
      };
      if (serviceName === "apiProxy") return apiProxy || {
        sessions: {
          async create() { return { result: { ok: true, value: { sessionId: "session-created" } } }; },
          async prompt() { return { result: { ok: true, value: { accepted: true } } }; }
        },
        skills: {
          async list() { return { result: { ok: true, value: { skills: [] } } }; }
        }
      };
      return undefined;
    },
    effect(fn, label) {
      const disposer = fn();
      effects.push({ label, disposer });
      return disposer;
    },
    emit(name, ...args) {
      emitted.push([name, ...args]);
    },
    // Cordis 的可选注入：服务存在时调用 fn，缺失时跳过（返回 no-op disposer）。
    inject(services, fn) {
      const names = Array.isArray(services) ? services : [services];
      if (names.some((name) => ctx.get(name) === undefined)) return () => {};
      const disposer = fn(ctx);
      return () => {
        if (typeof disposer === "function") disposer();
      };
    }
  };
  if (settings) ctx.settings = settings;
  return { ctx, registered, effects, emitted };
}

test("DSH settings namespace 注册后主动刷新插件配置目录", async () => {
  const settings = {
    register(namespace) {
      assert.equal(namespace, "jira-workbench");
      return {
        get: () => ({ baseUrl: "" }),
        update: async () => {},
        watch: () => () => {}
      };
    }
  };
  const { ctx, emitted } = mockCtx({ settings });
  await apply(ctx, { version: "0.33.1" });

  assert.ok(emitted.some(([name, namespace]) =>
    name === "settings/document-updated" && namespace === "jira-workbench"));
});

test("工作台设置导航不受后台数据请求 busy 状态阻塞", async () => {
  const document = await readFile(
    join(import.meta.dirname, "..", "..", "core", "mcp", "ui", "task-board.html"),
    "utf8"
  );
  assert.match(document, /if \(event\.target\.closest\("#settings"\)\) \{/);
  assert.doesNotMatch(document, /closest\("#settings"\) && !busy/);
});

test("Jira 配置卡片以插件配置服务为准，不因 DSH settings 尚未就绪而隐藏", async () => {
  const source = await readFile(
    join(import.meta.dirname, "..", "..", "dsh-client", "src", "client", "jira-config-card-controller.ts"),
    "utf8"
  );
  const component = await readFile(
    join(import.meta.dirname, "..", "..", "dsh-client", "src", "client", "JiraConfigCard.tsx"),
    "utf8"
  );
  assert.match(source, /available: true,/);
  assert.match(source, /writable: this\.configuration !== null,/);
  assert.match(source, /private async syncSettingsBaseUrl/);
  assert.doesNotMatch(component, /if \(!state\.available\) return null/);
});

test("无 DSH 审批服务时只注册 13 个只读工具", async () => {
  assert.equal(name, "jira-workbench");
  assert.deepEqual(inject, ["tools", "workspaceRegistry", "sessionQuery", "apiProxy"]);

  const { ctx, registered } = mockCtx();
  await apply(ctx, { version: "0.32.3" });

  assert.equal(registered.length, 13);
  const names = registered.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "jira_get_issue",
    "jira_get_issue_workspaces",
    "jira_get_sheet_issues",
    "jira_list_available_workspaces",
    "jira_list_my_tasks",
    "jira_list_sheets",
    "jira_list_transitions",
    "jira_preview_issue_attachment",
    "codex_list_bindable_threads",
    "svn_get_issue_review",
    "svn_inspect_issue_changes",
    "svn_open_issue_external_diff",
    "svn_preview_issue_diff"
  ].sort());

  const listWorkspaces = registered.find((tool) => tool.name === "jira_list_available_workspaces");
  const workspaceResult = await listWorkspaces.execute({}, {});
  assert.equal(workspaceResult.structuredContent.view, "availableWorkspaces");
  assert.deepEqual(workspaceResult.structuredContent.workspaces, [{
    id: "workspace-1",
    cwd: "F:\\repo",
    projectId: "workspace-1",
    projectLabel: "repo",
    source: "dsh-workspace-registry"
  }]);

  const listThreads = registered.find((tool) => tool.name === "codex_list_bindable_threads");
  const threadResult = await listThreads.execute({}, {});
  assert.equal(threadResult.structuredContent.runtimeOwner, "dsh");
  assert.equal(threadResult.structuredContent.threads[0].title, "DSH 会话");

  // 每个工具都有 JSON Schema parameters + output.render + execute
  for (const tool of registered) {
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.parameters, "object");
    assert.equal(typeof tool.output?.render, "function");
    assert.equal(typeof tool.execute, "function");
  }
});

test("工具 definitions 不带 mcp__ 前缀，且 inputSchema 转成合法 JSON Schema", async () => {
  const { ctx, registered } = mockCtx();
  await apply(ctx, { version: "0.32.3" });

  for (const tool of registered) {
    assert.doesNotMatch(tool.name, /^mcp__/);
    // parameters 是 JSON Schema object，含 type/properties/required 等
    assert.equal(typeof tool.parameters.type, "string");
    assert.equal(tool.parameters.type, "object");
    assert.equal(typeof tool.parameters.properties, "object");
  }

  // 抽查一个已知 schema：jira_get_issue 需要 issueKey（regex 约束）
  const getIssue = registered.find((tool) => tool.name === "jira_get_issue");
  assert.ok(getIssue);
  assert.equal(getIssue.parameters.properties.issueKey.type, "string");
  assert.match(getIssue.parameters.properties.issueKey.pattern, /^\^\[A-Za-z\]/);
  assert.deepEqual(getIssue.parameters.required, ["issueKey"]);
});

test("parameters 是干净 plain object（无 zod ~standard 非枚举属性，DSH snapshotJsonValue 兼容）", async () => {
  const { ctx, registered } = mockCtx();
  await apply(ctx, { version: "0.32.3" });

  for (const tool of registered) {
    // DSH 的 snapshotJsonValue 拒绝带 non-enumerable 属性的对象；zod v4 的
    // toJSONSchema 输出根对象带 `~standard` 品牌标记，必须被 JSON round-trip 剥掉。
    // 这里断言：所有 own key 都是 enumerable string（即 plain JSON 对象）。
    const keys = Reflect.ownKeys(tool.parameters);
    for (const key of keys) {
      assert.equal(typeof key, "string");
      assert.equal(Object.prototype.propertyIsEnumerable.call(tool.parameters, key), true);
    }
    assert.equal(keys.includes("~standard"), false);
  }
});

test("disposer 移除全部已注册工具", async () => {
  const { ctx, registered, effects } = mockCtx();
  await apply(ctx, { version: "0.32.3" });

  assert.equal(registered.length, 13);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].label, "jira-workbench.tools");

  // 触发 disposer
  effects[0].disposer();
  assert.equal(registered.length, 0);
});

test("有 credentials 但无 approval 时仍只暴露只读工具", async () => {
  const credentials = {
    async resolve(ref) {
      return { value: "stored-value", source: "file" };
    },
    async set(_ref, _value) {},
    async describe(_ref) {
      return { configured: true, writable: true };
    },
    async unset(_ref) {}
  };
  const { ctx, registered } = mockCtx({ credentials });
  await apply(ctx, { version: "0.32.3" });

  assert.equal(registered.length, 13);
});

test("DSH approval 服务就绪后动态补齐全部 27 个工具并保留 annotations", async () => {
  const approval = { async request() { return "allowed-once"; } };
  const { ctx, registered } = mockCtx({ approval });
  await apply(ctx, { version: "0.32.3" });

  assert.equal(registered.length, 27);
  assert.ok(registered.some((tool) => tool.name === "codex_create_and_bind_issue_analysis"));
  for (const tool of registered) {
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean");
  }
});

test("DSH 项目目录直接来自 workspaceRegistry，而不是会话扫描", async () => {
  const catalog = createDshWorkspaceCatalog({
    get(serviceName) {
      assert.equal(serviceName, "workspaceRegistry");
      return {
        list() {
          return [
            { id: "workspace-a", path: "F:\\work\\alpha", title: "Alpha" },
            { id: "workspace-b", path: "F:\\work\\beta", title: "Beta" }
          ];
        }
      };
    }
  });

  assert.deepEqual(await catalog.list(), {
    host: "dsh",
    available: true,
    workspaces: [
      { id: "workspace-a", workspaceId: "workspace-a", path: "F:\\work\\alpha", title: "Alpha", source: "dsh-workspace-registry" },
      { id: "workspace-b", workspaceId: "workspace-b", path: "F:\\work\\beta", title: "Beta", source: "dsh-workspace-registry" }
    ]
  });
});

test("SVN 最终确认会把实际文件和提交信息送入 DSH 人工审批", async () => {
  const approvals = [];
  await approveDshMutation({ name: "svn_confirm_issue_review" }, {
    issueKey: "CT-200",
    reviewId: "00000000-0000-4000-8000-000000000001",
    riskAcknowledged: true,
    overlapAcknowledged: false
  }, {
    approvalProvider: {
      async approve(action, payload, options) { approvals.push({ action, payload, options }); }
    },
    svn: {
      async getReview() {
        return { selectedPaths: ["src/main.go"], commitMessage: "CT-200 修复" };
      }
    }
  });

  assert.deepEqual(approvals, [{
    action: "svn-confirm-review",
    payload: {
      issueKey: "CT-200",
      reviewId: "00000000-0000-4000-8000-000000000001",
      selectedPaths: ["src/main.go"],
      commitMessage: "CT-200 修复",
      riskAcknowledged: true,
      overlapAcknowledged: false
    },
    options: { toolName: "svn_confirm_issue_review" }
  }]);
});

test("dshConfigFile 解析 DSH home 独立配置路径", () => {
  // DSH_HOME 优先
  assert.equal(
    dshConfigFile({ DSH_HOME: "C:/Users/me/.dsh" }, "/home/me"),
    join("C:/Users/me/.dsh", "jira-workbench", "config.json")
  );
  // 无 DSH_HOME 时 fallback ~/.dsh
  assert.equal(
    dshConfigFile({}, "/home/me"),
    join("/home/me", ".dsh", "jira-workbench", "config.json")
  );
  // JIRA_WORKBENCH_CONFIG_FILE 覆盖最高优先级
  assert.equal(
    dshConfigFile({ DSH_HOME: "C:/Users/me/.dsh", JIRA_WORKBENCH_CONFIG_FILE: "D:/override/config.json" }, "/home/me"),
    "D:/override/config.json"
  );
});

test("dshDataRoot 隔离 DSH 的绑定、SVN 基线与审核状态", () => {
  assert.equal(
    dshDataRoot({ DSH_HOME: "C:/Users/me/.dsh" }, "/home/me"),
    join("C:/Users/me/.dsh", "jira-workbench")
  );
  assert.equal(
    dshDataRoot({}, "/home/me"),
    join("/home/me", ".dsh", "jira-workbench")
  );
});

test("DSH 配置路由把地址与固定 Token 引用提交给 Core 并返回回执", async () => {
  const calls = [];
  const handler = createDshConnectionConfigHandler({
    async updateCredentialReference(input) {
      calls.push(input);
      return { configured: true, baseUrl: input.baseUrl };
    }
  });
  const request = Readable.from([JSON.stringify({ baseUrl: "http://jira.example:8080" })]);
  request.method = "PUT";
  request.headers = {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    "content-type": "application/json"
  };
  const { response, result } = responseRecorder();

  await handler(request, response);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, [{
    baseUrl: "http://jira.example:8080",
    tokenReference: "JIRA_WORKBENCH_TOKEN"
  }]);
  assert.equal(JSON.parse(result.body).configuration.configured, true);
});

test("DSH 配置路由把任务来源和模板 Skill 一并写入 Core", async () => {
  const calls = [];
  const handler = createDshConnectionConfigHandler({
    async updateCredentialReference(input) {
      calls.push(input);
      return { configured: true, baseUrl: input.baseUrl, boardSources: input.boardSources };
    }
  });
  const request = Readable.from([JSON.stringify({
    baseUrl: "http://jira.example:8080",
    boardSources: {
      projectKey: "GAME",
      requirement: { mode: "custom", jql: "project = GAME" },
      bug: { mode: "filter", filterIds: ["42"] }
    },
    promptTemplates: {
      requirement: { customized: false, content: "default", skill: null },
      bug: { customized: true, content: "诊断 {{key}}", skill: { name: "bug-tracer", path: "", scope: "dsh" } }
    },
    imageProcessing: {
      visionProvider: "openai",
      visionModel: "gpt-4.1",
      localOcrEnabled: true
    }
  })]);
  request.method = "PUT";
  request.headers = {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    "content-type": "application/json"
  };
  const { response, result } = responseRecorder();

  await handler(request, response);

  assert.equal(result.statusCode, 200);
  assert.equal(calls[0].tokenReference, "JIRA_WORKBENCH_TOKEN");
  assert.equal(calls[0].boardSources.projectKey, "GAME");
  assert.equal(calls[0].promptTemplates.bug.skill.name, "bug-tracer");
  assert.equal(calls[0].imageProcessing.visionModel, "gpt-4.1");
});

test("DSH 配置选项路由从 Jira 和 DSH Skill 注册表读取候选项", async () => {
  let requestedFilterProject;
  const handler = createDshConfigOptionsHandler({
    configStore: {
      async load() {
        return { configured: true, baseUrl: "http://jira.example:8080", token: "pat", deployment: "data_center" };
      }
    },
    jira: {
      async fetchProjects() {
        return { projects: [{ id: "1", key: "GAME", name: "Game" }] };
      },
      async fetchFilters(_config, project) {
        requestedFilterProject = project;
        const { projectKey } = project;
        return { filters: [{ id: "42", name: `${projectKey} Bug`, owner: "我" }] };
      }
    },
    workspaceCatalog: {
      async list() {
        return { workspaces: [{ cwd: "F:\\repo", projectLabel: "repo" }] };
      }
    },
    getSkills: () => ({
      async list({ cwd } = {}) {
        return [{
          name: cwd ? "project-skill" : "global-skill",
          description: "只读分析",
          source: cwd ? "project-dsh" : "user-dsh",
          invocation: { userInvocable: true, modelInvocable: true }
        }];
      }
    }),
    getLlm: () => ({
      listProviders() {
        return [{ id: "openai", name: "OpenAI" }, { id: "text", name: "Text only" }];
      },
      async listModels(provider) {
        return provider === "openai"
          ? [{ provider, id: "gpt-4.1", name: "GPT-4.1", inputModalities: ["text", "image"] }]
          : [{ provider, id: "text-1", name: "Text", inputModalities: ["text"] }];
      }
    })
  });

  const invoke = async (url) => {
    const request = Readable.from([]);
    request.method = "GET";
    request.url = url;
    request.headers = { host: "127.0.0.1:3000" };
    const { response, result } = responseRecorder();
    await handler(request, response);
    return { ...result, json: JSON.parse(result.body) };
  };

  const projects = await invoke("/jira-workbench/config-options?resource=projects");
  assert.equal(projects.statusCode, 200);
  assert.equal(projects.json.projects[0].key, "GAME");
  const filters = await invoke("/jira-workbench/config-options?resource=filters&projectKey=GAME&projectId=1&projectName=Game");
  assert.equal(filters.json.filters[0].id, "42");
  assert.deepEqual(requestedFilterProject, { projectKey: "GAME", projectId: "1", projectName: "Game" });
  const skills = await invoke("/jira-workbench/config-options?resource=skills");
  assert.deepEqual(skills.json.skills.map((skill) => skill.name), ["global-skill", "project-skill"]);
  assert.deepEqual(skills.json.skills.find((skill) => skill.name === "project-skill").scopes, ["repo"]);
  const visionModels = await invoke("/jira-workbench/config-options?resource=vision-models");
  assert.deepEqual(visionModels.json.models, [{
    provider: "openai",
    providerName: "OpenAI",
    id: "gpt-4.1",
    name: "GPT-4.1"
  }]);
});

test("DSH 配置选项通过 apiProxy 读取 preset realm 内的真实 Skill", async () => {
  const handler = createDshConfigOptionsHandler({
    configStore: {
      async load() {
        return { configured: true, baseUrl: "http://jira.example:8080", token: "pat" };
      }
    },
    jira: {
      async fetchProjects() { return { projects: [] }; },
      async fetchFilters() { return { filters: [] }; }
    },
    workspaceCatalog: {
      async list() {
        return { workspaces: [{ path: "F:\\repo", title: "game-server" }] };
      }
    },
    getSkills: () => undefined,
    getAgents: () => undefined,
    async listThreads() {
      return { threads: [{ id: "session-1", cwd: "F:\\repo", status: "live" }] };
    },
    getApiProxy: () => ({
      skills: {
        async list(request) {
          assert.equal(request.payload.sessionId, "session-1");
          return {
            rpcId: request.rpcId,
            result: {
              ok: true,
              value: {
                skills: [{ name: "task-type", description: "任务类型实现", modelInvocable: true }]
              }
            }
          };
        }
      }
    })
  });
  const request = Readable.from([]);
  request.method = "GET";
  request.url = "/jira-workbench/config-options?resource=skills";
  request.headers = { host: "127.0.0.1:3000" };
  const { response, result } = responseRecorder();

  await handler(request, response);

  const payload = JSON.parse(result.body);
  assert.equal(result.statusCode, 200);
  assert.equal(payload.available, true);
  assert.deepEqual(payload.skills.map((skill) => skill.name), ["task-type"]);
  assert.deepEqual(payload.skills[0].scopes, ["game-server"]);
});

test("DSH 配置路由拒绝跨站写入", async () => {
  let called = false;
  const handler = createDshConnectionConfigHandler({
    async updateCredentialReference() {
      called = true;
    }
  });
  const request = Readable.from(["{}"]);
  request.method = "PUT";
  request.headers = {
    host: "127.0.0.1:3000",
    origin: "https://evil.example",
    "content-type": "application/json"
  };
  const { response, result } = responseRecorder();

  await handler(request, response);

  assert.equal(result.statusCode, 403);
  assert.equal(called, false);
  assert.equal(JSON.parse(result.body).error.code, "WRITE_ORIGIN_FORBIDDEN");
});

test("DSH 会话关联路由返回当前会话的 Jira 摘要和项目目录", async () => {
  const handler = createDshSessionContextHandler({
    workbench: {
      async getIssue(issueKey) {
        return {
          bindingsRevision: 7,
          binding: { threadId: "session-1", runtimeOwner: "dsh" },
          issue: {
            key: issueKey,
            title: "修复登录异常",
            type: "bug",
            status: "in_progress",
            statusName: "处理中",
            priority: "High",
            assignee: "张三",
            summary: "弱网环境下登录失败",
            url: "http://jira.example/browse/CT-100"
          }
        };
      }
    },
    conversations: { async clearBinding() { throw new Error("not called"); } },
    issueBindings: {
      async snapshot() {
        return {
          revision: 7,
          bindings: {
            "CT-100": { threadId: "session-1", issueTitle: "修复登录异常", runtimeOwner: "dsh" }
          }
        };
      }
    },
    workspaceBindings: {
      async get(issueKey) {
        return {
          revision: 3,
          issueKey,
          binding: {
            workspace: {
              defaultProjectScopeId: "workspace-1",
              projectScopes: [{ id: "workspace-1", cwd: "F:\\repo", projectLabel: "server" }]
            }
          }
        };
      }
    }
  });
  const request = Readable.from([]);
  request.method = "GET";
  request.url = "/jira-workbench/session-context?sessionId=session-1";
  request.headers = { host: "127.0.0.1:3080" };
  const { response, result } = responseRecorder();

  await handler(request, response);

  assert.equal(result.statusCode, 200);
  const payload = JSON.parse(result.body);
  assert.equal(payload.revision, 7);
  assert.equal(payload.context.issueKey, "CT-100");
  assert.equal(payload.context.issue.title, "修复登录异常");
  assert.equal(payload.context.issue.statusName, "处理中");
  assert.equal(payload.context.workspace.workspace.projectScopes[0].cwd, "F:\\repo");
});

test("DSH 会话关联路由只解除仍属于当前会话的绑定", async () => {
  const calls = [];
  const handler = createDshSessionContextHandler({
    workbench: { async getIssue() { throw new Error("not called"); } },
    conversations: {
      async clearBinding(input) {
        calls.push(input);
        return { issueKey: input.issueKey, binding: null, revision: 12 };
      }
    },
    issueBindings: {
      async snapshot() {
        return { revision: 11, bindings: { "CT-101": { threadId: "session-2" } } };
      }
    },
    workspaceBindings: { async get() { throw new Error("not called"); } }
  });
  const request = Readable.from([JSON.stringify({
    sessionId: "session-2",
    issueKey: "ct-101",
    expectedRevision: 11
  })]);
  request.method = "DELETE";
  request.url = "/jira-workbench/session-context";
  request.headers = {
    host: "127.0.0.1:3080",
    origin: "http://127.0.0.1:3080",
    "content-type": "application/json"
  };
  const { response, result } = responseRecorder();

  await handler(request, response);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, [{ issueKey: "CT-101", expectedRevision: 11 }]);
  assert.equal(JSON.parse(result.body).revision, 12);
});
