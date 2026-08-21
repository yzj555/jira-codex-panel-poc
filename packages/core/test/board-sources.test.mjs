import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBoardQueries,
  normalizeBoardSources
} from "../config-store.mjs";
import { createJiraClient } from "../jira-client.mjs";

test("需求和 Bug 面板可以分别使用内置 JQL、自定义 JQL 与 Filter", () => {
  const sources = normalizeBoardSources({
    projectKey: "real",
    requirement: { mode: "custom", jql: "project = REAL ORDER BY updated DESC" },
    bug: { mode: "filter", filterIds: ["101", 102, "101"] }
  });
  const queries = buildBoardQueries(sources);

  assert.equal(sources.projectKey, "REAL");
  assert.deepEqual(sources.bug.filterIds, ["101", "102"]);
  assert.match(queries.activeJql, /\(project = REAL\) AND statusCategory != Done/);
  assert.match(queries.activeJql, /filter = 101 OR filter = 102/);
  assert.match(queries.completedJql, /statusCategory = Done/);
  assert.doesNotMatch(queries.completedJql, /filter = 101|filter = 102/);
  assert.match(queries.completedJql, /project = REAL/);
  assert.doesNotMatch(queries.activeJql, /ORDER BY updated DESC.*ORDER BY/);
  const typed = buildBoardQueries({
    projectKey: "REAL",
    requirement: { mode: "builtin" },
    bug: { mode: "builtin" }
  }, { bugTypeNames: ["缺陷", "Bug"] });
  assert.match(typed.activeJql, /issuetype in \("缺陷", "Bug"\)/);
  assert.match(typed.activeJql, /issuetype not in \("缺陷", "Bug"\)/);
});

test("旧版单一 JQL 会自动迁移为两个自定义面板来源", () => {
  const sources = normalizeBoardSources(undefined, undefined, "project = REAL");
  assert.equal(sources.legacy, true);
  assert.equal(sources.requirement.mode, "custom");
  assert.equal(sources.bug.jql, "project = REAL");
});

test("Jira Filter 合并当前用户可访问来源，并以项目相关性排序而不误删", async () => {
  const calls = [];
  const jira = createJiraClient({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/filter/search")) {
        return new Response(JSON.stringify({ values: [
          { id: "1", name: "当前项目需求", owner: { displayName: "我" } },
          { id: "2", name: "其他项目", jql: "project = OTHER" },
          { id: "4", name: "按项目名称", jql: "project = \"Real Project\"" },
          { id: "5", name: "按项目 ID", jql: "project in (10101)" },
          { id: "6", name: "动态项目范围", jql: "project in projectsWhereUserHasPermission()" }
        ] }), { status: 200 });
      }
      if (String(url).endsWith("/filter/my")) {
        return new Response(JSON.stringify([{ id: "1", name: "重复项", jql: "project = REAL" }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ id: "3", name: "全局收藏", jql: "assignee = currentUser()", favourite: true }]), { status: 200 });
    }
  });

  const result = await jira.fetchFilters({
    deployment: "data_center",
    baseUrl: "https://jira.example.com",
    token: "pat"
  }, { projectKey: "REAL", projectId: "10101", projectName: "Real Project" });

  assert.equal(calls.length, 3);
  assert.deepEqual(new Set(result.filters.map((filter) => filter.id)), new Set(["1", "2", "3", "4", "5", "6"]));
  assert.equal(result.filters.find((filter) => filter.id === "1").owner, "我");
  assert.equal(result.filters.find((filter) => filter.id === "1").jql, "project = REAL");
  assert.equal(result.filters.find((filter) => filter.id === "2").projectMatch, "other");
  assert.equal(result.filters.find((filter) => filter.id === "4").projectMatch, "match");
  assert.equal(result.filters.find((filter) => filter.id === "5").projectMatch, "match");
  assert.equal(result.filters.find((filter) => filter.id === "6").projectMatch, "unknown");
  assert.ok(result.filters.findIndex((filter) => filter.id === "2") > result.filters.findIndex((filter) => filter.id === "3"));
});

test("内置 JQL 使用稳定的协同字段 ID，并可读取可访问项目", async () => {
  const sources = normalizeBoardSources({
    projectKey: "REAL",
    collaboratorFieldId: "customfield_12345",
    requirement: { mode: "builtin" },
    bug: { mode: "builtin" }
  });
  const queries = buildBoardQueries(sources);
  assert.match(queries.activeJql, /cf\[12345\] = currentUser\(\)/);
  assert.doesNotMatch(queries.activeJql, /customfield_12345 = currentUser/);

  const jira = createJiraClient({
    fetchImpl: async (url) => {
      assert.match(String(url), /\/rest\/api\/2\/project$/);
      return new Response(JSON.stringify([
        { id: "1", key: "real", name: "Real Project" },
        { id: "2", key: "ARCH", name: "Archived", archived: true }
      ]), { status: 200 });
    }
  });
  const result = await jira.fetchProjects({
    deployment: "data_center",
    baseUrl: "https://jira.example.com",
    token: "pat"
  });
  assert.deepEqual(result.projects.map((project) => project.key), ["REAL"]);
});

test("匿名 Jira JQL 错误会明确提示 Token 认证失败", async () => {
  const jira = createJiraClient({
    fetchImpl: async () => new Response(JSON.stringify({
      errorMessages: ["域 assignee 不存在或这个域不允许匿名用户查看。"]
    }), { status: 400 })
  });
  await assert.rejects(
    jira.fetchIssues({
      deployment: "data_center",
      baseUrl: "https://jira.example.com",
      token: "pat",
      jql: "project = REAL"
    }),
    (error) => error.code === "JIRA_AUTH_FAILED" && error.statusCode === 401
  );
});
