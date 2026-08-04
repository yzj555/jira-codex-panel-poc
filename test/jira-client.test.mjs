import test from "node:test";
import assert from "node:assert/strict";
import { createJiraClient, JiraApiError } from "../jira-client.mjs";

const cloudIssue = {
  id: "10001",
  key: "DEMO-7",
  fields: {
    summary: "真实 Jira 任务",
    description: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "来自 ADF 的描述" }] }]
    },
    issuetype: { name: "Bug" },
    priority: { name: "High" },
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    assignee: { displayName: "测试用户" },
    customfield_10600: [
      { displayName: "协同用户", name: "collaborator", active: true }
    ],
    attachment: [{
      id: "900",
      filename: "design.png",
      mimeType: "image/png",
      size: 2048,
      author: { displayName: "附件作者" },
      created: "2026-08-04T08:00:00.000+0000",
      thumbnail: "https://demo.atlassian.net/secure/thumbnail/900"
    }],
    labels: ["codex"],
    project: { key: "DEMO", name: "演示项目" },
    created: "2026-08-01T00:00:00.000+0000",
    updated: "2026-08-04T00:00:00.000+0000"
  }
};

test("Jira Cloud 使用邮箱和 API Token 调用 REST v3 增强搜索", async () => {
  let request;
  const jira = createJiraClient({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ issues: [cloudIssue], total: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await jira.fetchIssues({
    deployment: "cloud",
    baseUrl: "https://demo.atlassian.net",
    email: "user@example.com",
    token: "cloud-token",
    jql: "assignee = currentUser()",
    maxResults: 50
  });

  assert.equal(request.url, "https://demo.atlassian.net/rest/api/3/search/jql");
  assert.equal(request.options.headers.authorization, `Basic ${Buffer.from("user@example.com:cloud-token").toString("base64")}`);
  assert.deepEqual(JSON.parse(request.options.body).fields.includes("status"), true);
  assert.equal(result.issues[0].type, "bug");
  assert.equal(result.issues[0].status, "in_progress");
  assert.equal(result.issues[0].summary, "来自 ADF 的描述");
  assert.equal(result.issues[0].url, "https://demo.atlassian.net/browse/DEMO-7");
  assert.deepEqual(result.issues[0].collaborators, [{
    displayName: "协同用户",
    name: "collaborator",
    active: true
  }]);
  assert.deepEqual(result.issues[0].attachments[0], {
    id: "900",
    filename: "design.png",
    mimeType: "image/png",
    size: 2048,
    author: "附件作者",
    created: "2026-08-04T08:00:00.000+0000",
    downloadUrl: "/api/attachments/900",
    thumbnailUrl: "/api/attachments/900?thumbnail=1"
  });
  const requestedFields = JSON.parse(request.options.body).fields;
  assert.equal(requestedFields.includes("attachment"), true);
  assert.equal(requestedFields.includes("customfield_10600"), true);
});

test("Jira Data Center 使用 PAT Bearer 调用 REST v2 搜索", async () => {
  let request;
  const jira = createJiraClient({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ issues: [], total: 0 }), { status: 200 });
    }
  });

  await jira.fetchIssues({
    deployment: "data_center",
    baseUrl: "https://jira.example.com/jira",
    email: "",
    token: "dc-pat",
    jql: "project = DEMO",
    maxResults: 25
  });

  assert.equal(request.url, "https://jira.example.com/jira/rest/api/2/search");
  assert.equal(request.options.headers.authorization, "Bearer dc-pat");
  assert.equal(JSON.parse(request.options.body).startAt, 0);
});

test("Jira 认证错误不会把 Token 写入错误消息", async () => {
  const jira = createJiraClient({
    fetchImpl: async () => new Response("", { status: 401 })
  });

  await assert.rejects(
    jira.fetchIssues({
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      token: "never-show-this-token",
      jql: "project = DEMO",
      maxResults: 10
    }),
    (error) => {
      assert.ok(error instanceof JiraApiError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.message.includes("never-show-this-token"), false);
      return true;
    }
  );
});

test("程序处理前的业务状态映射为待处理，程序处理及后续映射为处理中", async () => {
  const makeIssue = (key, statusName, categoryKey) => ({
    id: key,
    key,
    fields: {
      summary: key,
      issuetype: { name: "优化" },
      status: { name: statusName, statusCategory: { key: categoryKey } }
    }
  });
  const jira = createJiraClient({
    fetchImpl: async () => new Response(JSON.stringify({
      issues: [
        makeIssue("CT-1", "方案设计中", "indeterminate"),
        makeIssue("CT-2", "程序处理", "indeterminate"),
        makeIssue("CT-3", "策划配置+验收", "indeterminate"),
        makeIssue("CT-4", "完成", "done")
      ],
      total: 4
    }), { status: 200 })
  });

  const result = await jira.fetchIssues({
    deployment: "data_center",
    baseUrl: "https://jira.example.com",
    token: "pat",
    jql: "filter = 10103",
    maxResults: 10
  });

  assert.deepEqual(result.issues.map((issue) => issue.status), [
    "todo",
    "in_progress",
    "in_progress",
    "done"
  ]);
});

test("看板按分区上限分别保留活动任务与完成任务", async () => {
  const calls = [];
  const makeIssue = (key, statusName, categoryKey) => ({
    id: key,
    key,
    fields: {
      summary: key,
      issuetype: { name: "优化" },
      status: { name: statusName, statusCategory: { key: categoryKey } }
    }
  });
  const jira = createJiraClient({
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.jql);
      const active = request.jql === "filter = 10103";
      return new Response(JSON.stringify(active
        ? {
          issues: [
            makeIssue("CT-A1", "方案设计中", "indeterminate"),
            makeIssue("CT-A2", "程序处理", "indeterminate")
          ],
          total: 2
        }
        : {
          issues: [
            makeIssue("CT-D1", "完成", "done"),
            makeIssue("CT-D2", "完成", "done"),
            makeIssue("CT-D3", "完成", "done")
          ],
          total: 3
        }), { status: 200 });
    }
  });

  const result = await jira.fetchTaskBoardIssues({
    deployment: "data_center",
    baseUrl: "https://jira.example.com",
    token: "pat",
    jql: "combined",
    maxResults: 3
  }, {
    activeJql: "filter = 10103",
    completedJql: "statusCategory = Done",
    maxResults: 3
  });

  assert.deepEqual(calls, ["filter = 10103", "statusCategory = Done"]);
  assert.deepEqual(result.issues.map((issue) => issue.key), ["CT-A1", "CT-A2", "CT-D1", "CT-D2", "CT-D3"]);
  assert.deepEqual(result.activeIssues.map((issue) => issue.key), ["CT-A1", "CT-A2"]);
  assert.deepEqual(result.completedIssues.map((issue) => issue.key), ["CT-D1", "CT-D2", "CT-D3"]);
  assert.equal(result.total, 5);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.sources.active, {
    total: 2,
    returned: 2,
    jql: "filter = 10103"
  });
});

test("附件代理只向同一 Jira 实例转发凭据并支持缩略图", async () => {
  const calls = [];
  const jira = createJiraClient({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), authorization: options.headers.authorization });
      if (String(url).endsWith("/rest/api/2/attachment/900")) {
        return new Response(JSON.stringify({
          id: "900",
          filename: "design.png",
          mimeType: "image/png",
          content: "https://jira.example.com/secure/attachment/900/design.png",
          thumbnail: "https://jira.example.com/secure/thumbnail/900/design.png"
        }), { status: 200 });
      }
      return new Response(Buffer.from("thumbnail-bytes"), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "15" }
      });
    }
  });

  const attachment = await jira.fetchAttachment({
    deployment: "data_center",
    baseUrl: "https://jira.example.com",
    token: "pat"
  }, "900", { thumbnail: true });

  assert.deepEqual(calls, [
    {
      url: "https://jira.example.com/rest/api/2/attachment/900",
      authorization: "Bearer pat"
    },
    {
      url: "https://jira.example.com/secure/thumbnail/900/design.png",
      authorization: "Bearer pat"
    }
  ]);
  assert.equal(attachment.filename, "design.png");
  assert.equal(attachment.contentType, "image/png");
  assert.equal(attachment.thumbnail, true);
  assert.equal(Buffer.from(await new Response(attachment.body).arrayBuffer()).toString("utf8"), "thumbnail-bytes");
});

test("附件代理拒绝向其他来源转发 Jira Token", async () => {
  let calls = 0;
  const jira = createJiraClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        id: "900",
        filename: "unsafe.txt",
        content: "https://example.org/unsafe.txt"
      }), { status: 200 });
    }
  });

  await assert.rejects(
    jira.fetchAttachment({
      deployment: "data_center",
      baseUrl: "https://jira.example.com",
      token: "never-forward"
    }, "900"),
    (error) => error instanceof JiraApiError && error.code === "JIRA_ATTACHMENT_ORIGIN_MISMATCH"
  );
  assert.equal(calls, 1);
});
