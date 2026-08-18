import test from "node:test";
import assert from "node:assert/strict";
import { createNeutralTurnReader } from "../lib/codex-neutral-turn-reader.mjs";

// mock codexRuntime 返回 App Server 原始形状（thread.turns[].items[]）。
function mockRuntime(readThreadImpl, readTurnResultImpl) {
  return {
    readThread: readThreadImpl || (async () => null),
    readTurnResult: readTurnResultImpl || (async () => null)
  };
}

const APP_SERVER_THREAD = {
  thread: {
    id: "local:thread-1",
    cwd: "F:\\repo",
    turns: [
      {
        id: "turn-1",
        startedAt: 1000,
        completedAt: 2000,
        items: [
          { type: "userMessage", content: [{ type: "text", text: "  用户需求  " }] },
          { type: "agentMessage", text: "  Codex 分析  " },
          { type: "fileChange", changes: [{ path: "src/a.go" }, { path: "src/b.go", kind: "add" }] },
          { type: "file_change", changes: [{ path: "docs/readme.md" }] }
        ]
      },      {
        id: "turn-2",
        startedAt: 3000,
        items: [
          { type: "userMessage", text: "" },  // 空文本不产生消息
          { type: "unknownType", text: "忽略" }
        ]
      }
    ]
  }
};

test("readThread 把 App Server 原始形状映射成中性形状", async () => {
  const runtime = mockRuntime(async (threadId) => {
    assert.equal(threadId, "thread-1"); // 适配层剥离了 local: 前缀
    return APP_SERVER_THREAD;
  });
  const reader = createNeutralTurnReader(runtime);

  const thread = await reader.readThread("local:thread-1", { includeTurns: true });

  assert.equal(thread.id, "thread-1");
  assert.equal(thread.cwd, "F:\\repo");
  assert.equal(thread.turns.length, 2);

  const turn1 = thread.turns[0];
  assert.equal(turn1.turnId, "turn-1");
  assert.equal(turn1.startedAt, 1000);
  assert.equal(turn1.completedAt, 2000);
  assert.deepEqual(turn1.messages, [
    { role: "用户", text: "用户需求" },
    { role: "Codex", text: "Codex 分析" }
  ]);
  // fileChanges 合并 fileChange + file_change，path 原样保留
  assert.deepEqual(turn1.fileChanges.map((change) => change.path), ["src/a.go", "src/b.go", "docs/readme.md"]);
  // observedAt 来自 turn.completedAt（秒 → ISO）
  assert.equal(turn1.fileChanges[0].observedAt, "1970-01-01T00:33:20.000Z");

  const turn2 = thread.turns[1];
  assert.deepEqual(turn2.messages, []);  // 空文本被过滤
  assert.deepEqual(turn2.fileChanges, []); // 非 fileChange item 被忽略
});

test("readTurnResult 归一化 threadId 并透传字段", async () => {
  const runtime = mockRuntime(null, async (threadId, turnId) => {
    assert.equal(threadId, "thread-1");
    assert.equal(turnId, "turn-1");
    return {
      threadId: "local:thread-1",
      turnId: "turn-1",
      status: "completed",
      startedAt: "2026-08-12T08:00:00.000Z",
      completedAt: "2026-08-12T08:05:00.000Z",
      result: "review result",
      error: "",
      source: "app-server"
    };
  });
  const reader = createNeutralTurnReader(runtime);

  const result = await reader.readTurnResult("local:thread-1", "turn-1");
  assert.equal(result.threadId, "thread-1");
  assert.equal(result.status, "completed");
  assert.equal(result.result, "review result");
});

test("缺少 readThread 时构造报错", () => {
  assert.throws(
    () => createNeutralTurnReader({}),
    /需要 codexRuntime.readThread/
  );
});
