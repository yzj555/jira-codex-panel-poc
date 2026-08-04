export const FIRST_MESSAGE_GUARD = `【首轮约束】本轮只能进行信息理解、只读取证与分析诊断。禁止修改代码、配置、文件、数据库或 Jira 数据；禁止执行实现、修复、提交、构建、部署等操作。即使任务描述要求立即修改，也必须先完成分析并等待用户后续明确指令。`;

export const JIRA_CONTEXT_GUARD = `【Jira 上下文约束】当前消息已经提供该 Issue 的任务描述、状态、人员等 Jira 上下文；Jira 原始附件（如有）也已作为本消息的真实文件附件一并提交。首轮必须只使用当前消息、随附文件和已绑定项目中的本地内容进行分析。禁止调用 Browser、browser、web 或其他网页浏览工具；禁止打开任务链接、Jira/JXL 页面，也不要以“核对原文”或“补充上下文”为理由二次查看。若当前消息或附件确有缺失，只列出缺失项并等待用户补充，不要自行浏览。`;

export const DEFAULT_MESSAGE_TEMPLATE = `请理解并分析 Jira {{key}}：{{title}}

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

const BUG_TYPE_PATTERN = /bug|defect|缺陷|故障/i;

export function isBugIssue(issue) {
  return issue?.type === "bug" || BUG_TYPE_PATTERN.test(String(issue?.typeName || ""));
}

export function buildBugDiagnosticRouting({ projectId = "", projectLabel = "" } = {}) {
  const fallback = projectId
    ? `若当前环境不存在或无法使用该技能，降级为基于当前绑定的 Codex 项目「${projectLabel || projectId}」进行只读分析，并明确说明已降级。`
    : "若当前环境不存在或无法使用该技能，当前又未绑定 Codex 项目，则仅根据 Jira 信息和当前可见上下文进行分析；明确指出缺少的项目上下文，不要猜测。";

  return `【Bug 诊断路由】这是 Bug 处理。优先使用 \`ct-devops-tracer\`（CT Devops Tracer）技能进行诊断分析。使用该技能时必须先调用 devops-tracer MCP 工具取得证据再回答；只读取证、只做诊断，禁止 shell SSH、Redis 写入、Jenkins 触发、SVN commit，以及没有因果证据的责任判断。${fallback}无论采用哪条路径，本轮都不得进行任何修改。`;
}

function typeLabel(issue) {
  return issue?.typeName || (isBugIssue(issue) ? "Bug" : "需求");
}

export function buildIssuePrompt(issue, {
  messageTemplate = DEFAULT_MESSAGE_TEMPLATE,
  projectId = "",
  projectLabel = ""
} = {}) {
  const collaborators = (issue?.collaborators || []).map((person) => person.displayName).join("、") || "无";
  const attachments = (issue?.attachments || []).map((attachment) => attachment.filename).join("\n") || "无";
  const values = {
    key: issue?.key || "未提供",
    title: issue?.title || "未提供",
    url: issue?.key
      ? `已省略（请按 Issue Key ${issue.key} 人工定位；首轮禁止打开 Jira）`
      : "已省略（首轮禁止打开 Jira）",
    status: issue?.statusName || issue?.status || "未提供",
    type: typeLabel(issue),
    assignee: issue?.assignee || "未分配",
    collaborators,
    description: issue?.summary || "未提供",
    attachments
  };
  const template = String(messageTemplate || DEFAULT_MESSAGE_TEMPLATE);
  const body = template.replace(
    /\{\{(key|title|url|status|type|assignee|collaborators|description|attachments)\}\}/g,
    (_, name) => values[name]
  );
  const fixedSections = [FIRST_MESSAGE_GUARD, JIRA_CONTEXT_GUARD];
  if (isBugIssue(issue)) {
    fixedSections.push(buildBugDiagnosticRouting({ projectId, projectLabel }));
  }
  fixedSections.push(body);
  return fixedSections.join("\n\n");
}
