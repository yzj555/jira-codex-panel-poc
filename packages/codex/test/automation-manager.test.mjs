import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutomationManager, buildWecomAnalysisMessage } from "../lib/automation-manager.mjs";
import { createCodexSessionReader, parseCodexTaskCompletion } from "../lib/codex-session-reader.mjs";

test("new automation jobs use App Server turn results before the legacy rollout fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-appserver-automation-"));
  try {
    const calls = [];
    const manager = createAutomationManager({
      stateFile: join(directory, "automation.json"),
      configStore: { load: async () => ({ wecomWebhook: "" }) },
      turnReader: {
        readTurnResult: async (threadId, turnId) => {
          calls.push({ threadId, turnId });
          return {
            threadId,
            turnId,
            status: "completed",
            completedAt: "2026-08-12T10:00:00.000Z",
            result: "official App Server result",
            source: "app-server-thread-read"
          };
        }
      },
      sessionReader: {
        readCompletion: async () => { throw new Error("legacy reader must not be used"); }
      },
      pollIntervalMs: 60_000
    });
    await manager.register({
      issue: { key: "CT-456", title: "App Server tracking" },
      threadId: "local:thread-456",
      turnId: "turn-456",
      startedAt: Date.parse("2026-08-12T09:59:00.000Z")
    });
    await manager.poll();
    const status = await manager.getStatus();
    assert.deepEqual(calls, [{ threadId: "local:thread-456", turnId: "turn-456" }]);
    assert.equal(status.recentJobs[0].status, "completed");
    assert.equal(status.recentJobs[0].turnId, "turn-456");
    assert.equal(status.recentJobs[0].completionSource, "app-server-thread-read");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex 会话日志只读取真实 task_complete 事件", () => {
  const content = [
    JSON.stringify({ timestamp: "2026-08-04T10:00:00.000Z", type: "response_item", payload: { text: "task_complete" } }),
    JSON.stringify({ timestamp: "2026-08-04T10:00:01.000Z", type: "event_msg", payload: { type: "task_complete", last_agent_message: "诊断结论", turn_id: "turn-1" } })
  ].join("\n");
  assert.deepEqual(parseCodexTaskCompletion(content, { after: Date.parse("2026-08-04T10:00:00.500Z") }), {
    status: "completed",
    completedAt: "2026-08-04T10:00:01.000Z",
    result: "诊断结论",
    turnId: "turn-1"
  });
  assert.equal(parseCodexTaskCompletion(content, { after: Date.parse("2026-08-04T10:00:02.000Z") }), null);
});

test("自动分析完成后读取结果并推送企业微信机器人", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-automation-"));
  const sessionsRoot = join(directory, "sessions");
  const sessionDirectory = join(sessionsRoot, "2026", "08", "04");
  const threadId = "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4";
  const stateFile = join(directory, "automation.json");
  const requests = [];
  const webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=11111111-2222-3333-4444-555555555555";
  const configStore = { load: async () => ({ wecomWebhook: webhook }) };
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, `rollout-2026-08-04T18-00-00-${threadId}.jsonl`), [
      JSON.stringify({ timestamp: "2026-08-04T10:00:00.000Z", type: "event_msg", payload: { type: "task_started" } }),
      JSON.stringify({ timestamp: "2026-08-04T10:00:05.000Z", type: "event_msg", payload: { type: "task_complete", last_agent_message: "只读诊断结果", turn_id: "turn-2" } })
    ].join("\n"), "utf8");
    const manager = createAutomationManager({
      stateFile,
      configStore,
      sessionReader: createCodexSessionReader({ sessionsRoot }),
      fetchImpl,
      pollIntervalMs: 60_000
    });
    await manager.register({
      issue: { key: "CT-123", title: "登录报错", url: "http://jira.example/browse/CT-123" },
      threadId: `local:${threadId}`,
      startedAt: Date.parse("2026-08-04T09:59:59.000Z")
    });
    await manager.poll();

    const status = await manager.getStatus();
    assert.equal(status.busy, false);
    assert.equal(status.recentJobs[0].status, "completed");
    assert.equal(status.recentJobs[0].pushStatus, "sent");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, webhook);
    assert.equal(requests[0].body.msgtype, "markdown");
    assert.match(requests[0].body.markdown.content, /CT-123/);
    assert.match(requests[0].body.markdown.content, /只读诊断结果/);
    assert.doesNotMatch(await readFile(stateFile, "utf8"), /qyapi\.weixin\.qq\.com/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("企业微信消息按 UTF-8 字节安全截断", () => {
  const content = buildWecomAnalysisMessage({
    issueKey: "CT-9",
    issueTitle: "超长结果",
    result: "诊".repeat(5_000)
  });
  assert.ok(Buffer.byteLength(content, "utf8") <= 3_800);
  assert.match(content, /…$/);
});
