// dshApprovalProvider：DSH 侧的两阶段审批 provider 实现。
//
// core 工具面（tools.mjs）在「复核 → 执行」之间用 approvalProvider 签发/消费
// 一次性 grant。DSH 实现把「签发」（issue）映射到 ctx.approval.request(...)：
// 用户通过 DSH 审批栈允许后，才委托本地 grant store 签发 confirmationId；
// 「消费」（consume）只校验本地 grant，不再次问审批。
//
// 审批发生在「复核」工具调用内（open turn 内），因此 ctx.approval.request 的
// turn-enclosed 前置条件天然满足。grant 跨 tool 调用存活在本地 store 内
// （封装在本实现中，不污染 core）。
//
// agent 通过 AsyncLocalStorage 从 tool 执行上下文传入：core 的 handler 签名是
// 单参数 (args)，无法直接拿到 DSH 的 exec.agent，plugin 在 execute(args, exec)
// 里把 exec.agent 存入 ALS，issue 从这里读取。

import { AsyncLocalStorage } from "node:async_hooks";
import { createLocalApprovalProvider } from "@jira-workbench/core/lib/approval-provider.mjs";

const agentStorage = new AsyncLocalStorage();

/**
 * 在一次 tool 执行上下文中运行 fn，期间 issue 能从 ALS 读到 agent。
 * @param agent - DSH 的 Agent（含 .session）；可为 undefined（无 agent 时 issue 直接失败）。
 * @param fn - 工具 handler 本体。
 */
export function runWithAgent(agent, fn) {
  return agentStorage.run(agent, fn);
}

function humanReason(action, payload) {
  const detail = payload && typeof payload === "object"
    ? Object.entries(payload)
      .filter(([key]) => !/token|confirmationId/i.test(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ")
    : String(payload ?? "");
  const labels = {
    "jira-transition": "Jira 状态流转",
    "jira-bind-session": "关联 Jira 与 DSH 会话",
    "jira-unbind-session": "解除 Jira 会话关联",
    "jira-bind-workspace": "绑定 Jira 项目目录",
    "jira-unbind-workspace": "解除 Jira 项目目录绑定",
    "svn-create-review": "创建 SVN 审核快照",
    "svn-cancel-review": "取消 Codex SVN 审查",
    "svn-confirm-review": "确认 SVN 人工审核并签发提交许可",
    "svn-reconcile-commit": "核对并更新 SVN 提交状态",
    "svn-confirm-committed": "人工登记 SVN 提交结果",
    "svn-abandon-review": "放弃 SVN 审核草稿"
  };
  const label = labels[action] || String(action);
  return `${label}：${detail}`;
}

/**
 * 构造 DSH 侧 approvalProvider。
 * @param approval - DSH 的 ctx.approval（含 request(req) → outcome）。
 * @param options - 本地 grant store 参数（ttlMs / maxEntries / now）。
 */
export function createDshApprovalProvider(approval, options = {}) {
  if (!approval || typeof approval.request !== "function") {
    throw new TypeError("dshApprovalProvider 需要 DSH 的 approval 服务（request）。");
  }
  const local = createLocalApprovalProvider(options);

  async function approve(action, payload, { toolName = String(action || "jira-workbench") } = {}) {
    const agent = agentStorage.getStore();
    if (!agent || !agent.session) {
      const error = new Error("审批上下文不可用：tool 执行缺少 agent，写操作已拒绝。");
      error.code = "APPROVAL_CONTEXT_UNAVAILABLE";
      error.statusCode = 409;
      throw error;
    }
    const outcome = await approval.request({
      agent,
      toolName,
      reason: humanReason(action, payload)
    });
    if (outcome !== "allowed-once") {
      const error = new Error(outcome === "rejected"
        ? "用户未批准该操作。"
        : outcome === "cancelled" ? "审批已取消。" : "审批服务不可用，操作被拒绝。");
      error.code = "APPROVAL_DENIED";
      error.statusCode = 409;
      throw error;
    }
  }

  return {
    approve,
    async issue(action, payload) {
      await approve(action, payload, { toolName: "jira_prepare_transition" });
      return local.issue(action, payload);
    },
    async consume(confirmationId, action) {
      return local.consume(confirmationId, action);
    },
    revoke(confirmationId) {
      return local.revoke(confirmationId);
    }
  };
}
