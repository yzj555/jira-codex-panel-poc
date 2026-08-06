import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIssuePrompt,
  DEFAULT_BUG_MESSAGE_TEMPLATE,
  DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE
} from "../public/prompt-builder.js";

const baseIssue = {
  key: "CT-100",
  title: "示例任务",
  url: "https://jira.example/browse/CT-100",
  status: "todo",
  statusName: "待处理",
  assignee: "张三",
  collaborators: [{ displayName: "李四" }],
  attachments: [{ filename: "error.log", size: 42 }],
  summary: "复现步骤"
};

test("需求首条消息把 Jira 事实与精简分析模板分开", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "requirement", typeName: "需求" }, {
    requirementMessageTemplate: "分析 {{key}} {{type}}"
  });

  assert.match(prompt, /^# Jira 需求/);
  assert.match(prompt, /- 单号：CT-100/);
  assert.match(prompt, /- Jira 链接：https:\/\/jira\.example\/browse\/CT-100/);
  assert.match(prompt, /## Jira 描述\n\n复现步骤/);
  assert.match(prompt, /## Jira 附件\n\n- error\.log（42 bytes）/);
  assert.match(prompt, /## 分析要求\n\n分析 CT-100 需求/);
  assert.doesNotMatch(prompt, /- 状态：|- 优先级：|- 项目：|- 修复版本：|- 负责人：|- 协同处理人：/);
  assert.doesNotMatch(prompt, /禁止调用 Browser|Jira 上下文约束|ct-devops-tracer/);
});

test("Bug 首条消息使用 Bug 独立默认模板", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "bug", typeName: "Bug" }, {
    requirementMessageTemplate: DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE,
    bugMessageTemplate: DEFAULT_BUG_MESSAGE_TEMPLATE
  });

  assert.match(prompt, /^# Jira Bug/);
  assert.match(prompt, /## Jira 描述/);
  assert.match(prompt, /诊断结论/);
  assert.match(prompt, /根因分析/);
  assert.doesNotMatch(prompt, /需求结论/);
  assert.doesNotMatch(prompt, /ct-devops-tracer/);
});

test("运行时技能不可用时只追加简短降级提示", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "bug" }, {
    fallbackNotice: "附加技能当前不可用，已降级为项目只读分析。"
  });

  assert.match(prompt, /附加技能当前不可用/);
  assert.equal(prompt.endsWith("附加技能当前不可用，已降级为项目只读分析。"), true);
});

test("自动 Bug 监控会在上下文中标记触发方式", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "bug" }, { automated: true });
  assert.match(prompt, /触发方式：Jira Bug 自动监控/);
});

test("新建会话补充说明独立呈现且 Jira 描述不重复", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "requirement" }, {
    supplementalDescription: "仅在海外服弱网环境出现。"
  });

  assert.match(prompt, /## 用户补充说明\n\n仅在海外服弱网环境出现。/);
  assert.equal(prompt.match(/复现步骤/g)?.length, 1);
});

test("旧版自定义完整模板保持原有 Jira 布局", () => {
  const prompt = buildIssuePrompt({ ...baseIssue, type: "requirement" }, {
    messageTemplate: "旧模板 {{key}}\n{{description}}\n{{attachments}}",
    supplementalDescription: "额外背景"
  });

  assert.match(prompt, /^旧模板 CT-100/);
  assert.doesNotMatch(prompt, /# Jira 需求/);
  assert.match(prompt, /## 用户补充说明\n\n额外背景/);
});
