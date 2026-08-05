import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodexSessionReader,
  parseCodexConversationContext,
  parseCodexReviewTurn,
  parseCodexSessionContext,
  parseCodexTouchedFiles
} from "../lib/codex-session-reader.mjs";

test("Codex 会话上下文优先使用最新 turn_context 的项目目录", () => {
  const content = [
    JSON.stringify({
      timestamp: "2026-08-05T01:00:00.000Z",
      type: "session_meta",
      payload: { cwd: "C:\\initial", workspace_roots: ["C:\\initial"] }
    }),
    "not-json",
    JSON.stringify({
      timestamp: "2026-08-05T02:00:00.000Z",
      type: "turn_context",
      payload: {
        cwd: "F:\\football\\server_v3",
        workspace_roots: ["F:\\football\\server_v3", "F:\\football"]
      }
    })
  ].join("\n");

  assert.deepEqual(parseCodexSessionContext(content), {
    cwd: "F:\\football\\server_v3",
    workspaceRoots: ["F:\\football\\server_v3", "F:\\football"],
    observedAt: "2026-08-05T02:00:00.000Z"
  });
});

test("Codex 会话文件操作证据只统计基线后的成功补丁", () => {
  const content = [
    JSON.stringify({
      timestamp: "2026-08-05T01:00:00.000Z",
      type: "turn_context",
      payload: { cwd: "F:\\football\\server_v3" }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T01:30:00.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        success: true,
        changes: { "src\\old.go": { type: "update" } }
      }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T02:30:00.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        success: false,
        changes: { "src\\failed.go": { type: "update" } }
      }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T03:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        success: true,
        changes: {
          "src\\player.go": { type: "update" },
          "F:\\football\\server_v3\\test\\player.test.go": { type: "add" }
        }
      }
    })
  ].join("\n");

  assert.deepEqual(
    parseCodexTouchedFiles(content, { after: Date.parse("2026-08-05T02:00:00.000Z") })
      .map(({ path, type }) => ({ path, type })),
    [
      { path: "F:\\football\\server_v3\\src\\player.go", type: "update" },
      { path: "F:\\football\\server_v3\\test\\player.test.go", type: "add" }
    ]
  );
});

test("当前会话审查必须观察到匹配的请求消息和真实 turnId", () => {
  const reviewId = "99f6a204-e7bb-4bca-8ed2-419826623857";
  const snapshotHash = "abc123";
  const content = [
    JSON.stringify({
      timestamp: "2026-08-05T03:59:59.000Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-review-1" }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T04:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `SVN_REVIEW_REQUEST_V2\nreviewId=${reviewId}\nsnapshotHash=${snapshotHash}` }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn-review-1" }
      }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T04:00:02.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "another-turn", last_agent_message: "不能误收" }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T04:00:03.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "turn-review-1", last_agent_message: "审核完成" }
    })
  ].join("\n");

  assert.deepEqual(parseCodexReviewTurn(content, { reviewId, snapshotHash }), {
    status: "completed",
    completedAt: "2026-08-05T04:00:03.000Z",
    result: "审核完成",
    turnId: "turn-review-1",
    requestObserved: true,
    requestObservedAt: "2026-08-05T04:00:00.000Z",
    startedAt: "2026-08-05T03:59:59.000Z"
  });
  assert.equal(parseCodexReviewTurn(content, { reviewId: "wrong", snapshotHash }), null);
});

test("可按绑定会话、审核 ID 与快照哈希找回审查 turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-session-review-"));
  try {
    const dayDirectory = join(directory, "2026", "08", "05");
    await mkdir(dayDirectory, { recursive: true });
    const threadId = "019fd152-40fd-7f10-aad0-5adf8131e1a9";
    const reviewId = "99f6a204-e7bb-4bca-8ed2-419826623857";
    const snapshotHash = "a".repeat(64);
    const content = [
      JSON.stringify({
        timestamp: "2026-08-05T04:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-recovered" }
      }),
      JSON.stringify({
        timestamp: "2026-08-05T04:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `SVN_REVIEW_REQUEST_V2\nreviewId=${reviewId}\nsnapshotHash=${snapshotHash}` }],
          internal_chat_message_metadata_passthrough: { turn_id: "turn-recovered" }
        }
      }),
      JSON.stringify({
        timestamp: "2026-08-05T04:03:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-recovered", last_agent_message: "审核完成" }
      })
    ].join("\n");
    await writeFile(join(dayDirectory, `rollout-${threadId}.jsonl`), content, "utf8");
    const reader = createCodexSessionReader({ sessionsRoot: directory });
    const recovered = await reader.findReviewTurn({ reviewId, snapshotHash, threadId });
    assert.equal(recovered.threadId, threadId);
    assert.equal(recovered.turnId, "turn-recovered");
    assert.equal(recovered.status, "completed");
    assert.equal(await reader.findReviewTurn({
      reviewId,
      snapshotHash,
      threadId: "019fd152-40fd-7f10-aad0-5adf8131e1aa"
    }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("审核上下文优先保留用户需求并去除重复消息", () => {
  const duplicate = "需求：状态改变后必须刷新列表。";
  const content = [
    JSON.stringify({
      timestamp: "2026-08-05T01:00:00.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: duplicate }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T01:00:00.100Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: duplicate }] }
    }),
    JSON.stringify({
      timestamp: "2026-08-05T01:01:00.000Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "已经理解需求。" }
    })
  ].join("\n");
  const context = parseCodexConversationContext(content);
  assert.equal(context.total, 2);
  assert.match(context.markdown, /状态改变后必须刷新列表/);
  assert.match(context.markdown, /已经理解需求/);
});
