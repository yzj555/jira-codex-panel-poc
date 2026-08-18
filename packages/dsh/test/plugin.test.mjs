import test from "node:test";
import assert from "node:assert/strict";
import { apply, inject, name } from "../plugin.mjs";

// 最小 ctx mock：只提供 apply 用到的 get("tools") 与 effect。
function mockCtx({ credentials } = {}) {
  const registered = [];
  const effects = [];
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
      return undefined;
    },
    effect(fn, label) {
      const disposer = fn();
      effects.push({ label, disposer });
      return disposer;
    }
  };
  return { ctx, registered, effects };
}

test("jira-workbench plugin 注册 19 个 core 工具（无 Codex 宿主能力）", async () => {
  assert.equal(name, "jira-workbench");
  assert.deepEqual(inject, ["tools"]);

  const { ctx, registered } = mockCtx();
  await apply(ctx, { version: "0.32.3" });

  // core 独立服务暴露的 19 个工具：8 Jira + 11 SVN
  assert.equal(registered.length, 19);
  const names = registered.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "jira_execute_transition",
    "jira_get_issue",
    "jira_get_sheet_issues",
    "jira_list_my_tasks",
    "jira_list_sheets",
    "jira_list_transitions",
    "jira_prepare_transition",
    "jira_preview_issue_attachment",
    "svn_abandon_issue_review",
    "svn_cancel_issue_review",
    "svn_commit_issue_review",
    "svn_confirm_issue_committed",
    "svn_confirm_issue_review",
    "svn_create_issue_review",
    "svn_get_issue_review",
    "svn_inspect_issue_changes",
    "svn_open_issue_external_diff",
    "svn_preview_issue_diff",
    "svn_reconcile_issue_commit"
  ].sort());

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

  assert.equal(registered.length, 19);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].label, "jira-workbench.tools");

  // 触发 disposer
  effects[0].disposer();
  assert.equal(registered.length, 0);
});

test("有 credentials 服务时插件正常激活并注册 19 个工具（credential-ref 分支）", async () => {
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

  assert.equal(registered.length, 19);
});
