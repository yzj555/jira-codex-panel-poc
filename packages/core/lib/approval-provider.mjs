import { createActionConfirmationStore } from "./action-confirmation-store.mjs";

export { ActionConfirmationError } from "./action-confirmation-store.mjs";

/**
 * 两阶段审批 provider：签发一次性 grant（issue），消费 grant 才真写（consume）。
 *
 * 接口形状（DESIGN.md 决策点 2，方案 B）：
 *   approvalProvider = {
 *     issue(action, payload)  → Promise<{ confirmationId, action, expiresAt }>,
 *     consume(confirmationId, action) → Promise<payload>,   // 无效/过期抛 ActionConfirmationError
 *     revoke(confirmationId) → boolean
 *   }
 *
 * `action` 是业务动作名（"jira-transition"），`payload` 是纯 JSON 业务参数。
 * 实现可以：
 *   - 本地签发（缺省）：core 独立服务无宿主审批栈，issue 直接签发短时 grant，
 *     consume 校验一次性 + 动作匹配 + 未过期。与现状 createActionConfirmationStore 等价。
 *   - 宿主审批：DSH 实现 issue 时先 await ctx.approval.request(...)，通过才签发
 *     本地 grant；consume 只校验 grant。
 */
export function createLocalApprovalProvider(options = {}) {
  return createActionConfirmationStore(options);
}
