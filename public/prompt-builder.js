// Compatibility export for older callers. First-turn boundaries are now supplied
// by the bound Skill, or by jira-first-turn-analysis when no bound Skill covers them.
export const FIRST_MESSAGE_GUARD = "";

// Kept as a compatibility export for older injected clients. Detailed constraints now
// live in the bundled jira-first-turn-analysis skill instead of the visible message.
export const JIRA_CONTEXT_GUARD = "";

export const DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE = `请基于 Jira 信息、附件和项目证据分析当前需求。结论优先，不重复原文；明确区分事实、推断和建议。

1. 需求结论：说明目标、核心规则，以及当前属于“可实现 / 待澄清 / 信息不足”。
2. 需求拆解：按“场景或条件—应有行为—边界例外—验收标准”整理。
3. 影响分析：说明可能涉及的项目、模块、数据、调用链和回归风险，并注明依据及确定程度。
4. 待确认与建议：只列出影响实现或验收的问题，再给出简要实现方向和验证重点。`;

export const DEFAULT_BUG_MESSAGE_TEMPLATE = `请基于 Jira 信息、附件、日志和项目证据对当前 Bug 进行完整诊断。结论优先，不重复原文；明确区分事实、推断和建议。

1. 诊断结论：说明“已定位 / 高概率 / 待验证 / 信息不足”、核心原因、置信度和影响范围。
2. 事实与证据：整理实际与预期行为、环境、复现条件、频率和关键证据；注明来源及验证状态。
3. 根因分析：给出完整因果链；尚未定位时，列出有效假设、支持与反对证据、缺口和验证方式。
4. 影响与修复：有证据时说明涉及的项目、模块、数据和调用链，并给出最小修复方向及潜在风险。
5. 验证与缺失信息：覆盖原问题、边界条件、相邻逻辑和兼容性，并列出仍需补充的信息及用途。`;

// Defaults shipped before Jira context and analysis instructions were separated.
// They are kept so configuration migration can recognize managed legacy values.
export const PREVIOUS_REQUIREMENT_MESSAGE_TEMPLATE = `Jira 需求 {{key}}：{{title}}

当前状态：{{status}}
负责人：{{assignee}}
协同处理人：{{collaborators}}

需求描述：
{{description}}

附件：
{{attachments}}`;

export const PREVIOUS_BUG_MESSAGE_TEMPLATE = `Jira Bug {{key}}：{{title}}

当前状态：{{status}}
负责人：{{assignee}}
协同处理人：{{collaborators}}

问题描述与已知现象：
{{description}}

附件与诊断材料：
{{attachments}}`;

export const LEGACY_DEFAULT_MESSAGE_TEMPLATE = `请理解并分析 Jira {{key}}：{{title}}

任务标识：{{key}}（需要时请在 Jira 面板中由用户手动打开）
当前状态：{{status}}
负责人：{{assignee}}
协同处理人：{{collaborators}}

任务描述：
{{description}}

附件：
{{attachments}}

请仅输出：
1. 你对需求目标和业务背景的理解。
2. 可验证的验收标准。
3. 可能涉及的代码项目、模块、数据和影响范围。
4. 当前信息中的歧义、缺失项与风险。
5. 建议的处理步骤，但不要执行这些步骤。`;

export const HISTORICAL_DEFAULT_MESSAGE_TEMPLATE = `请理解并分析 Jira {{key}}：{{title}}

任务链接：{{url}}

任务描述：
{{description}}

附件：
{{attachments}}

请仅输出：
1. 你对需求目标和业务背景的理解。
2. 可验证的验收标准。
3. 可能涉及的代码项目、模块、数据和影响范围。
4. 当前信息中的歧义、缺失项与风险。
5. 建议的处理步骤，但不要执行这些步骤。`;

// Compatibility alias for configuration records created before templates were split.
export const DEFAULT_MESSAGE_TEMPLATE = DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE;

const BUG_TYPE_PATTERN = /bug|defect|缺陷|故障/i;
const TEMPLATE_VARIABLE_PATTERN = /\{\{(key|title|url|status|type|priority|project|fixVersions|assignee|collaborators|description|attachments)\}\}/g;
const LEGACY_CONTEXT_VARIABLE_PATTERN = /\{\{(?:description|attachments)\}\}/;

export function isBugIssue(issue) {
  return issue?.type === "bug" || BUG_TYPE_PATTERN.test(String(issue?.typeName || ""));
}

export function defaultMessageTemplateForIssue(issue) {
  return isBugIssue(issue) ? DEFAULT_BUG_MESSAGE_TEMPLATE : DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE;
}

// Compatibility helper. Skill selection and fallback are now resolved by the host so
// the verbose routing rules do not appear in the user's visible first message.
export function buildBugDiagnosticRouting({ projectId = "", projectLabel = "" } = {}) {
  if (projectId) {
    return `技能不可用时，降级为基于绑定项目「${projectLabel || projectId}」的只读分析。`;
  }
  return "技能不可用且未绑定项目时，仅根据 Jira 上下文进行只读分析。";
}

function typeLabel(issue) {
  return issue?.typeName || (isBugIssue(issue) ? "Bug" : "需求");
}

function attachmentLabel(attachment) {
  const filename = String(attachment?.filename || attachment?.name || "未命名附件").trim();
  const size = Number(attachment?.size || 0);
  return size > 0 ? `${filename}（${size} bytes）` : filename;
}

export function templateValuesForIssue(issue) {
  return {
    key: issue?.key || "未提供",
    title: issue?.title || "未提供",
    url: issue?.url || "未提供",
    status: issue?.statusName || issue?.status || "未提供",
    type: typeLabel(issue),
    priority: issue?.priority || "未设置",
    project: issue?.projectName || "未提供",
    fixVersions: (issue?.fixVersions || []).join("、") || "无",
    assignee: issue?.assignee || "未分配",
    collaborators: (issue?.collaborators || []).map((person) => person.displayName).join("、") || "无",
    description: issue?.summary || "未提供",
    attachments: (issue?.attachments || []).map(attachmentLabel).join("\n") || "无"
  };
}

export function buildIssueContext(issue, { automated = false } = {}) {
  const values = templateValuesForIssue(issue);
  const attachments = (issue?.attachments || []).map((attachment) => `- ${attachmentLabel(attachment)}`).join("\n") || "无";
  return `# Jira ${values.type}

- 单号：${values.key}
- 标题：${values.title}
- Jira 链接：${values.url}${automated ? "\n- 触发方式：Jira Bug 自动监控" : ""}

## Jira 描述

${values.description}

## Jira 附件

${attachments}`;
}

export function buildIssuePrompt(issue, {
  messageTemplate = "",
  requirementMessageTemplate = DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE,
  bugMessageTemplate = DEFAULT_BUG_MESSAGE_TEMPLATE,
  fallbackNotice = "",
  supplementalDescription = "",
  automated = false
} = {}) {
  const selectedDefault = defaultMessageTemplateForIssue(issue);
  const selectedTemplate = messageTemplate || (isBugIssue(issue)
    ? bugMessageTemplate
    : requirementMessageTemplate) || selectedDefault;
  const values = templateValuesForIssue(issue);
  const body = String(selectedTemplate).replace(TEMPLATE_VARIABLE_PATTERN, (_, name) => values[name]).trim();
  const supplement = String(supplementalDescription || "").trim();
  const supplementSection = supplement ? `## 用户补充说明\n\n${supplement}` : "";
  const fallback = String(fallbackNotice || "").trim();

  // Preserve custom templates created before context and instructions were split.
  // A template that explicitly renders description or attachments still owns its
  // Jira layout; newer instruction-only templates always receive the fixed context.
  if (LEGACY_CONTEXT_VARIABLE_PATTERN.test(String(selectedTemplate))) {
    const automationNotice = automated ? "触发方式：Jira Bug 自动监控。" : "";
    return [body, supplementSection, fallback, automationNotice].filter(Boolean).join("\n\n");
  }

  const instructionSection = body ? `## 分析要求\n\n${body}` : "";
  return [
    buildIssueContext(issue, { automated }),
    supplementSection,
    instructionSection,
    fallback
  ].filter(Boolean).join("\n\n");
}
