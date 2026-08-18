import test from "node:test";
import assert from "node:assert/strict";
import { createDshApprovalProvider, runWithAgent } from "../lib/dsh-approval-provider.mjs";

function mockApproval(outcomes) {
  const calls = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      const outcome = typeof outcomes === "function" ? outcomes(req) : outcomes;
      return outcome;
    }
  };
}

function agent() {
  return { session: { events: [] } };
}

test("issue 审批通过后签发 grant，consume 返回 payload", async () => {
  const approval = mockApproval("allowed-once");
  const provider = createDshApprovalProvider(approval);

  const grant = await runWithAgent(agent(), () => provider.issue("jira-transition", {
    issueKey: "CT-1",
    transitionId: "4",
    expectedTargetStatus: "已解决"
  }));

  assert.match(grant.confirmationId, /^[0-9a-f-]{36}$/);
  assert.equal(grant.action, "jira-transition");
  assert.equal(approval.calls.length, 1);
  assert.equal(approval.calls[0].toolName, "jira_prepare_transition");
  assert.match(approval.calls[0].reason, /Jira 状态流转/);

  const payload = await provider.consume(grant.confirmationId, "jira-transition");
  assert.deepEqual(payload, { issueKey: "CT-1", transitionId: "4", expectedTargetStatus: "已解决" });
});

test("issue 审批拒绝抛 APPROVAL_DENIED，不签发 grant", async () => {
  const approval = mockApproval("rejected");
  const provider = createDshApprovalProvider(approval);

  await assert.rejects(
    () => runWithAgent(agent(), () => provider.issue("jira-transition", { issueKey: "CT-1" })),
    (error) => error.code === "APPROVAL_DENIED"
  );
});

test("issue 缺少 agent 时抛审批上下文错误", async () => {
  const approval = mockApproval("allowed-once");
  const provider = createDshApprovalProvider(approval);

  await assert.rejects(
    () => provider.issue("jira-transition", { issueKey: "CT-1" }),
    /审批上下文不可用/
  );
  // 未调用 approval.request
  assert.equal(approval.calls.length, 0);
});

test("consume 一次性：第二次消费抛 ACTION_CONFIRMATION_INVALID", async () => {
  const approval = mockApproval("allowed-once");
  const provider = createDshApprovalProvider(approval);

  const grant = await runWithAgent(agent(), () => provider.issue("jira-transition", { issueKey: "CT-1" }));
  await provider.consume(grant.confirmationId, "jira-transition");
  await assert.rejects(
    () => provider.consume(grant.confirmationId, "jira-transition"),
    (error) => error.code === "ACTION_CONFIRMATION_INVALID"
  );
});

test("approval 服务缺失时构造报错", () => {
  assert.throws(
    () => createDshApprovalProvider(undefined),
    /需要 DSH 的 approval 服务/
  );
});
