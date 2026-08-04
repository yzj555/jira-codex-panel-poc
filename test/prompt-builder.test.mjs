import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIssuePrompt,
  DEFAULT_MESSAGE_TEMPLATE,
  FIRST_MESSAGE_GUARD,
  JIRA_CONTEXT_GUARD
} from "../public/prompt-builder.js";

const baseIssue = {
  key: "CT-100",
  title: "示例任务",
  url: "https://jira.example/browse/CT-100",
  status: "todo",
  statusName: "待处理",
  assignee: "张三",
  collaborators: [{ displayName: "李四" }],
  attachments: [{ filename: "error.log" }],
  summary: "复现步骤"
};

test("需求首条消息只添加不可移除的分析约束", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "requirement", typeName: "需求" }, {
    messageTemplate: "分析 {{key}} {{type}} {{collaborators}} {{attachments}}"
  });

  assert.equal(prompt.startsWith(FIRST_MESSAGE_GUARD), true);
  assert.match(prompt, new RegExp(JIRA_CONTEXT_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(prompt, /真实文件附件/);
  assert.match(prompt, /禁止调用 Browser、browser、web/);
  assert.match(prompt, /不要自行浏览/);
  assert.match(prompt, /分析 CT-100 需求 李四 error\.log/);
  assert.doesNotMatch(prompt, /https:\/\/jira\.example/);
  assert.doesNotMatch(prompt, /ct-devops-tracer/);
});

test("Bug 首条消息优先使用 ct-devops-tracer，并以绑定项目作为降级路径", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "bug", typeName: "Bug" }, {
    messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
    projectId: "local-project-1",
    projectLabel: "captain_tsubasa_server"
  });

  assert.equal(prompt.startsWith(FIRST_MESSAGE_GUARD), true);
  assert.match(prompt, /优先使用 `ct-devops-tracer`/);
  assert.match(prompt, /必须先调用 devops-tracer MCP 工具取得证据再回答/);
  assert.match(prompt, /只读取证、只做诊断/);
  assert.match(prompt, /项目「captain_tsubasa_server」/);
  assert.match(prompt, /本轮都不得进行任何修改/);
});

test("Bug 未绑定项目时明确限制无技能降级范围", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "bug", typeName: "缺陷" });

  assert.match(prompt, /当前又未绑定 Codex 项目/);
  assert.match(prompt, /明确指出缺少的项目上下文，不要猜测/);
});
