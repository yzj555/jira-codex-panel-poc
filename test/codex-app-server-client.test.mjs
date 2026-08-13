import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  buildCodexAnalysisInput,
  createCodexAppServerClient,
  discoverCodexAppServerCommand
} from "../lib/codex-app-server-client.mjs";

class FakeAppServerProcess extends EventEmitter {
  constructor(handleMessage, { spawnError } = {}) {
    super();
    this.pid = 4242;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.exitCode = null;
    this.messages = [];
    let buffer = "";
    this.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        this.messages.push(message);
        handleMessage?.(message, this);
      }
    });
    this.stdin.on("finish", () => queueMicrotask(() => this.finishExit(0, null)));
    queueMicrotask(() => {
      if (spawnError) this.emit("error", spawnError);
      else this.emit("spawn");
    });
  }

  reply(id, result) {
    this.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }

  fail(id, code, message) {
    this.stdout.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  }

  notify(method, params) {
    this.stdout.write(`${JSON.stringify({ method, params })}\n`);
  }

  finishExit(code = 0, signal = null) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit("exit", code, signal);
  }

  kill() {
    if (this.killed) return false;
    this.killed = true;
    queueMicrotask(() => this.finishExit(0, null));
    return true;
  }
}

function createFakeClient(onRequest) {
  let process;
  const client = createCodexAppServerClient({
    command: "fake-codex",
    clientInfo: { name: "test", title: "Test", version: "1.0.0" },
    requestTimeoutMs: 1_000,
    startTimeoutMs: 1_000,
    spawnFn: () => {
      process = new FakeAppServerProcess((message, child) => {
        if (message.method === "initialize") {
          child.reply(message.id, { userAgent: "fake-codex/1.0" });
          return;
        }
        onRequest?.(message, child);
      });
      return process;
    }
  });
  return { client, process: () => process };
}

test("App Server 客户端完成 initialize 握手并按 ID 关联请求", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method === "thread/list") {
      child.reply(message.id, { data: [{ id: "thread-1" }], nextCursor: null });
    }
  });

  const result = await harness.client.listThreads({ limit: 10 });
  assert.deepEqual(result.data, [{ id: "thread-1" }]);
  assert.deepEqual(harness.process().messages.map((message) => message.method), [
    "initialize",
    "initialized",
    "thread/list"
  ]);
  assert.equal(harness.client.snapshot().state, "ready");
  await harness.client.close();
});

test("App Server 只读分析会创建会话、绑定 Skill 并发送真实图片", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method === "thread/start") {
      child.reply(message.id, { thread: { id: "thread-jira" } });
    } else if (message.method === "thread/name/set") {
      child.reply(message.id, {});
    } else if (message.method === "turn/start") {
      child.reply(message.id, { turn: { id: "turn-analysis", status: "inProgress" } });
    } else if (message.method === "thread/unsubscribe") {
      child.reply(message.id, {});
    }
  });

  const result = await harness.client.startReadOnlyAnalysis({
    message: "分析 CT-13349，仅分析，不允许修改。",
    title: "CT-13349 护具优化",
    cwd: "F:\\repo",
    skills: [
      { name: "ct-devops-tracer", path: "C:\\skills\\ct-devops-tracer\\SKILL.md" },
      { name: "jira-first-turn-analysis", path: "C:\\skills\\jira-first-turn-analysis\\SKILL.md" }
    ],
    attachments: [
      { path: "C:\\jira\\design.png", mimeType: "image/png" },
      { path: "C:\\jira\\rules.pdf", mimeType: "application/pdf" }
    ]
  });

  assert.equal(result.threadId, "thread-jira");
  assert.equal(result.turnId, "turn-analysis");
  assert.equal(result.completionTracking, "app-server");
  assert.deepEqual(result.unsupportedAttachments, ["C:\\jira\\rules.pdf"]);
  const thread = harness.process().messages.find((message) => message.method === "thread/start");
  assert.equal(thread.params.sandbox, "read-only");
  const turn = harness.process().messages.find((message) => message.method === "turn/start");
  assert.equal(turn.params.input[0].text, "分析 CT-13349，仅分析，不允许修改。");
  assert.deepEqual(turn.params.input[1], {
    type: "skill",
    name: "ct-devops-tracer",
    path: "C:\\skills\\ct-devops-tracer\\SKILL.md"
  });
  assert.deepEqual(turn.params.input[2], {
    type: "skill",
    name: "jira-first-turn-analysis",
    path: "C:\\skills\\jira-first-turn-analysis\\SKILL.md"
  });
  assert.deepEqual(turn.params.input[3], { type: "localImage", path: "C:\\jira\\design.png" });
  assert.deepEqual(turn.params.sandboxPolicy, {
    type: "readOnly",
    access: { type: "fullAccess" }
  });
  assert.equal(turn.params.approvalPolicy, "never");
  assert.equal(harness.process().messages.some((message) => message.method === "thread/unsubscribe"), false);
  harness.process().notify("item/completed", {
    threadId: "thread-jira",
    turnId: "turn-analysis",
    item: { id: "message-1", type: "agentMessage", text: "analysis result", phase: "final_answer" },
    completedAtMs: Date.now()
  });
  harness.process().notify("turn/completed", {
    threadId: "thread-jira",
    turn: {
      id: "turn-analysis",
      status: "completed",
      items: [],
      startedAt: 1_786_000_000,
      completedAt: 1_786_000_001,
      error: null
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  const completion = await harness.client.readTurnResult("thread-jira", "turn-analysis");
  assert.equal(completion.status, "completed");
  assert.equal(completion.result, "analysis result");
  assert.equal(completion.source, "app-server-notification");
  const unsubscribe = harness.process().messages.find((message) => message.method === "thread/unsubscribe");
  assert.deepEqual(unsubscribe.params, { threadId: "thread-jira" });
  await harness.client.close();
});

test("thread/start prefers the current sandbox enum and only falls back on an explicit legacy enum error", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method !== "thread/start") return;
    if (message.params.sandbox === "read-only") {
      child.fail(
        message.id,
        -32602,
        "Invalid request: unknown variant 'read-only', expected one of 'readOnly', 'workspaceWrite', 'dangerFullAccess'"
      );
      return;
    }
    child.reply(message.id, { thread: { id: "thread-legacy" } });
  });

  const result = await harness.client.startThread({ sandbox: "readOnly" });
  assert.equal(result.thread.id, "thread-legacy");
  const starts = harness.process().messages.filter((message) => message.method === "thread/start");
  assert.deepEqual(starts.map((message) => message.params.sandbox), ["read-only", "readOnly"]);
  await harness.client.close();
});

test("thread/start does not replay the request after an unrelated RPC error", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method === "thread/start") {
      child.fail(message.id, -32000, "workspace is unavailable");
    }
  });

  await assert.rejects(
    harness.client.startThread({ sandbox: "readOnly" }),
    (error) => error.code === "CODEX_APP_SERVER_RPC_ERROR" && error.rpcCode === -32000
  );
  const starts = harness.process().messages.filter((message) => message.method === "thread/start");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].params.sandbox, "read-only");
  await harness.client.close();
});

test("Windows 优先发现 npm 独立 CLI，而不是依赖 Store 应用别名", () => {
  const expected = "D:\\node-global\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe";
  const discovered = discoverCodexAppServerCommand({
    env: { PATH: "C:\\Windows\\System32;D:\\node-global" },
    platform: "win32",
    existsFn: (candidate) => candidate === expected
  });
  assert.equal(discovered.command, expected);
  assert.equal(discovered.source, "npm-vendor");
});

test("显式 App Server 命令优先于自动发现", () => {
  const discovered = discoverCodexAppServerCommand({
    command: "D:\\portable-codex\\codex.exe",
    env: { PATH: "D:\\node-global" },
    platform: "win32",
    existsFn: () => true
  });
  assert.equal(discovered.command, "D:\\portable-codex\\codex.exe");
  assert.equal(discovered.source, "option");
});

test("非图片附件不会伪装成已发送给 App Server", () => {
  const prepared = buildCodexAnalysisInput({
    message: "分析问题",
    attachments: [{ path: "C:\\jira\\trace.log", mimeType: "text/plain" }]
  });
  assert.deepEqual(prepared.input, [{ type: "text", text: "分析问题" }]);
  assert.deepEqual(prepared.unsupportedAttachments, ["C:\\jira\\trace.log"]);
});

test("非图片文件可作为明确的只读路径上下文交给 App Server", () => {
  const prepared = buildCodexAnalysisInput({
    message: "审核 SVN 差异",
    referenceFiles: true,
    attachments: [{ path: "C:\\review\\02-svn-changes.diff", mimeType: "text/plain" }]
  });
  assert.deepEqual(prepared.unsupportedAttachments, []);
  assert.deepEqual(prepared.referencedAttachments, ["C:\\review\\02-svn-changes.diff"]);
  assert.match(prepared.input.at(-1).text, /不是原生附件/);
  assert.match(prepared.input.at(-1).text, /02-svn-changes\.diff/);
});

test("turn/start 透传仅对当前 turn 生效的 outputSchema", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method === "thread/resume") child.reply(message.id, { thread: { id: "thread-review" } });
    else if (message.method === "turn/start") {
      child.reply(message.id, { turn: { id: "turn-review", status: "inProgress" } });
    } else if (message.method === "thread/unsubscribe") child.reply(message.id, { status: "unsubscribed" });
  });
  const outputSchema = {
    type: "object",
    properties: { verdict: { type: "string" } },
    required: ["verdict"],
    additionalProperties: false
  };
  await harness.client.startReadOnlyTurn("thread-review", {
    message: "只读审核",
    outputSchema
  });
  const turn = harness.process().messages.find((message) => message.method === "turn/start");
  assert.deepEqual(turn.params.outputSchema, outputSchema);
  await harness.client.close();
});

test("无法启动 App Server 时返回可降级的明确状态", async () => {
  const denied = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
  const client = createCodexAppServerClient({
    command: "C:\\Program Files\\WindowsApps\\codex.exe",
    startTimeoutMs: 500,
    spawnFn: () => new FakeAppServerProcess(null, { spawnError: denied })
  });
  const probe = await client.probe();
  assert.equal(probe.ok, false);
  assert.equal(probe.error.code, "CODEX_APP_SERVER_UNAVAILABLE");
  assert.match(probe.error.message, /EACCES/);
  assert.equal(probe.runtime.state, "failed");
  await client.close();
});

test("App Server RPC 错误保留服务端错误码", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method === "thread/read") child.fail(message.id, -32602, "invalid thread id");
  });
  await assert.rejects(
    harness.client.readThread("missing"),
    (error) => error.code === "CODEX_APP_SERVER_RPC_ERROR" && error.rpcCode === -32602
  );
  await harness.client.close();
});

test("会话由桌面持有时 resume 返回可安全降级的明确错误", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method === "thread/resume") {
      child.fail(message.id, -32000, "This task is running in another app. Close it there first.");
    }
  });
  await assert.rejects(
    harness.client.resumeThread("thread-desktop"),
    (error) => error.code === "CODEX_THREAD_OWNED_ELSEWHERE"
  );
  await harness.client.close();
});

test("App Server restart recovery reads a completed turn through thread/read", async () => {
  const harness = createFakeClient((message, child) => {
    if (message.method !== "thread/read") return;
    child.reply(message.id, {
      thread: {
        id: "thread-recovered",
        turns: [{
          id: "turn-recovered",
          status: "completed",
          startedAt: 1_786_000_000,
          completedAt: 1_786_000_002,
          error: null,
          items: [
            { id: "user-1", type: "userMessage", content: [{ type: "text", text: "request" }] },
            { id: "agent-1", type: "agentMessage", text: "recovered result", phase: "final_answer" }
          ]
        }]
      }
    });
  });

  const completion = await harness.client.readTurnResult("local:thread-recovered", "turn-recovered");
  assert.equal(completion.status, "completed");
  assert.equal(completion.result, "recovered result");
  assert.equal(completion.source, "app-server-thread-read");
  const read = harness.process().messages.find((message) => message.method === "thread/read");
  assert.deepEqual(read.params, { threadId: "thread-recovered", includeTurns: true });
  await harness.client.close();
});
