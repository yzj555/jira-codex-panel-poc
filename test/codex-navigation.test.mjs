import test from "node:test";
import assert from "node:assert/strict";
import {
  findCodexAppInitialAsset,
  findCodexRpcAsset,
  interruptCodexThreadTurn,
  isProvisionalCodexThreadId,
  listCodexSkills,
  navigateCodexThread,
  normalizeCodexThreadId,
  readCodexThreadState,
  resolveCodexThreadId,
  resolveCodexThreadIdFromSummary,
  startCodexConversation,
  startCodexThreadTurn
} from "../lib/codex-navigation.mjs";

function createBridgeHarness({
  turnStatus = "completed",
  canAcceptDirectInput = true,
  sidebarThreadId = ""
} = {}) {
  const calls = [];
  const threadId = "019fcbb6-c322-7250-9b19-4645a37103c9";
  const sendRequest = async (type, payload) => {
    calls.push({ channel: "request", type, payload });
    if (payload?.method === "thread/read") {
      return {
        thread: {
          id: threadId,
          canAcceptDirectInput,
          turns: [{ id: "turn-current", status: turnStatus }]
        }
      };
    }
    if (payload?.method === "skills/list") {
      return {
        data: [{
          cwd: "C:\\repo",
          errors: [],
          skills: [{
            name: "ct-devops-tracer",
            path: "C:\\skills\\ct-devops-tracer\\SKILL.md",
            scope: "user",
            enabled: true,
            description: "只读诊断"
          }]
        }]
      };
    }
    if (type === "start-conversation") return threadId;
    if (type === "start-turn-for-host") return { turn: { id: "turn-review" } };
    if (payload?.method === "turn/interrupt") return { ok: true };
    throw new Error(`unexpected request: ${type}`);
  };
  function tp(type, payload) {
    return sendRequest(type, payload);
  }
  async function vp(type, payload) {
    calls.push({ channel: "host", type, payload });
    if (type === "get-global-state" && payload?.params?.key === "local-projects") {
      return {
        value: {
          "local-project": {
            id: "local-project",
            name: "captain_tsubasa_server",
            rootPaths: ["F:\\football\\server_v3\\server\\captain_tsubasa_server"]
          }
        }
      };
    }
    if (type === "projectless-thread-cwd") {
      return {
        cwd: "C:\\Users\\tester\\Documents\\Codex\\jira-task",
        workspaceRoot: "C:\\Users\\tester\\Documents\\Codex\\jira-task",
        outputDirectory: "C:\\Users\\tester\\Documents\\Codex\\jira-task\\outputs"
      };
    }
    throw new Error(`unexpected host request: ${type}`);
  }
  const options = {
    documentRef: { scripts: [{ src: "app://-/assets/index-hash.js" }] },
    fetchFn: async (url) => ({
      ok: true,
      text: async () => url.endsWith("index-hash.js")
        ? 'import("./rpc-hash.js");'
        : 'import("./app-initial-hash.js");'
    }),
    importModule: async (url) => {
      if (url.endsWith("rpc-hash.js")) {
        return {
          appServices: {
            appActions: {
              runInPrimaryWindow: async (request) => {
                calls.push({ channel: "action", request });
                return {
                  window: {
                    thread: { id: threadId, hostId: "local" },
                    sidebar: {
                      rows: sidebarThreadId ? [{
                        type: "thread",
                        active: true,
                        hostId: "local",
                        id: sidebarThreadId
                      }] : []
                    }
                  }
                };
              }
            }
          }
        };
      }
      if (url.endsWith("app-initial-hash.js")) {
        const hostileProxy = function hostileProxy() {};
        hostileProxy.toString = () => { throw new Error("proxy cannot be stringified"); };
        return { A0: hostileProxy, Mht: vp, Xht: tp };
      }
      throw new Error(`unexpected module: ${url}`);
    }
  };
  return { calls, options, threadId };
}

test("Codex 会话 ID 会移除本地主机前缀", () => {
  assert.equal(
    normalizeCodexThreadId("local:019fcbb6-c322-7250-9b19-4645a37103c9"),
    "019fcbb6-c322-7250-9b19-4645a37103c9"
  );
  assert.equal(normalizeCodexThreadId("remote-thread-id"), "remote-thread-id");
  assert.equal(isProvisionalCodexThreadId("local:client-new-thread:temporary-id"), true);
  assert.equal(isProvisionalCodexThreadId("local:019fcbb6-c322-7250-9b19-4645a37103c9"), false);
});

test("新建会话侧栏临时 ID 会解析为 Codex 当前正式会话 UUID", async () => {
  const provisionalThreadId = "local:client-new-thread:e16fd846-8f20-4a83-b3ef-47bfff98010c";
  const harness = createBridgeHarness({ sidebarThreadId: provisionalThreadId });
  const summary = {
    window: {
      thread: { id: harness.threadId, hostId: "local" },
      sidebar: { rows: [{ type: "thread", active: true, id: provisionalThreadId }] }
    }
  };
  assert.equal(
    resolveCodexThreadIdFromSummary(summary, provisionalThreadId),
    harness.threadId
  );
  assert.equal(
    await resolveCodexThreadId(provisionalThreadId, harness.options),
    harness.threadId
  );
  const state = await readCodexThreadState(provisionalThreadId, harness.options);
  assert.equal(state.threadId, harness.threadId);
  const readCall = harness.calls.find((call) => call.payload?.method === "thread/read");
  assert.equal(readCall.payload.params.threadId, harness.threadId);
});

test("从 Codex 入口资源发现带哈希的 RPC 模块", () => {
  assert.equal(
    findCodexRpcAsset('import("./app.js"); const files=["./rpc-iron1uwk.js"];'),
    "rpc-iron1uwk.js"
  );
  assert.equal(findCodexRpcAsset("const value = 1;"), "");
  assert.equal(
    findCodexAppInitialAsset('import("./app-initial-Gl25w_2b.js");'),
    "app-initial-Gl25w_2b.js"
  );
});

test("Codex 当前会话桥接可读取状态并启动真实审查 turn", async () => {
  const harness = createBridgeHarness();
  const state = await readCodexThreadState(`local:${harness.threadId}`, harness.options);
  assert.equal(state.busy, false);
  assert.equal(state.hostId, "local");

  const started = await startCodexThreadTurn(harness.threadId, "review prompt", {
    ...harness.options,
    attachments: [{ name: "02-svn-changes.diff", path: "C:\\review\\02-svn-changes.diff" }],
    skills: [{ name: "jira-first-turn-analysis", path: "C:\\app\\skills\\jira-first-turn-analysis\\SKILL.md" }]
  });
  assert.equal(started.turnId, "turn-review");
  const startCall = harness.calls.find((call) => call.type === "start-turn-for-host");
  assert.equal(startCall.payload.conversationId, harness.threadId);
  assert.deepEqual(startCall.payload.params.input[0], {
    type: "skill",
    name: "jira-first-turn-analysis",
    path: "C:\\app\\skills\\jira-first-turn-analysis\\SKILL.md"
  });
  assert.equal(startCall.payload.params.input[1].text, "review prompt");
  assert.deepEqual(startCall.payload.params.attachments, [{
    label: "02-svn-changes.diff",
    path: "C:\\review\\02-svn-changes.diff",
    fsPath: "C:\\review\\02-svn-changes.diff"
  }]);
});

test("Codex 技能列表通过 app-server 获取并规范化", async () => {
  const harness = createBridgeHarness();
  const skills = await listCodexSkills(harness.options);
  assert.equal(skills.length, 1);
  assert.deepEqual(skills[0], {
    name: "ct-devops-tracer",
    path: "C:\\skills\\ct-devops-tracer\\SKILL.md",
    scope: "user",
    enabled: true,
    description: "只读诊断",
    shortDescription: ""
  });
  const listCall = harness.calls.find((call) => call.payload?.method === "skills/list");
  assert.deepEqual(listCall.payload.params, { forceReload: false });
});

test("新对话临时 ID 可直接发送结构化首条消息", async () => {
  const provisional = "local:client-new-thread:temporary-id";
  const harness = createBridgeHarness({ sidebarThreadId: provisional });
  const started = await startCodexThreadTurn(provisional, "分析 Jira", {
    ...harness.options,
    allowProvisional: true,
    skills: [{ name: "jira-first-turn-analysis", path: "C:\\app\\skill\\SKILL.md" }]
  });
  assert.equal(started.threadId, "client-new-thread:temporary-id");
  assert.equal(harness.calls.some((call) => call.payload?.method === "thread/read"), false);
  const startCall = harness.calls.find((call) => call.type === "start-turn-for-host");
  assert.equal(startCall.payload.conversationId, "client-new-thread:temporary-id");
});

test("创建 Jira 新会话不依赖侧栏 ID，并一次提交项目、技能和附件", async () => {
  const harness = createBridgeHarness();
  const started = await startCodexConversation("分析 Jira CT-13350", {
    ...harness.options,
    projectId: "local-project",
    title: "分析 CT-13350 收藏票优化",
    attachments: [
      { name: "design.png", path: "C:\\jira\\design.png", mimeType: "image/png" },
      { name: "rules.pdf", path: "C:\\jira\\rules.pdf", mimeType: "application/pdf" }
    ],
    skills: [{ name: "jira-first-turn-analysis", path: "C:\\skills\\jira-first-turn-analysis\\SKILL.md" }]
  });
  assert.equal(started.threadId, harness.threadId);
  assert.equal(harness.calls.some((call) => call.channel === "action"), false);
  const startCall = harness.calls.find((call) => call.type === "start-conversation");
  assert.equal(startCall.payload.cwd, "F:\\football\\server_v3\\server\\captain_tsubasa_server");
  assert.equal(startCall.payload.workspaceKind, "project");
  assert.deepEqual(startCall.payload.projectAssignment, {
    projectKind: "local",
    projectId: "local-project",
    cwd: "F:\\football\\server_v3\\server\\captain_tsubasa_server",
    pendingCoreUpdate: false
  });
  assert.deepEqual(startCall.payload.input[0], {
    type: "skill",
    name: "jira-first-turn-analysis",
    path: "C:\\skills\\jira-first-turn-analysis\\SKILL.md"
  });
  assert.equal(startCall.payload.input[1].text, "分析 Jira CT-13350");
  assert.deepEqual(startCall.payload.input[2], {
    type: "localImage",
    path: "C:\\jira\\design.png"
  });
  assert.deepEqual(startCall.payload.attachments, [{
    label: "rules.pdf",
    path: "C:\\jira\\rules.pdf",
    fsPath: "C:\\jira\\rules.pdf"
  }]);
  assert.equal(startCall.payload.initialTitle, "分析 CT-13350 收藏票优化");
});

test("已有会话中的图片同样按 Codex 原生视觉输入发送", async () => {
  const harness = createBridgeHarness();
  await startCodexThreadTurn(harness.threadId, "识别截图", {
    ...harness.options,
    attachments: [
      { name: "screen.PNG", path: "C:\\jira\\screen.PNG" },
      { name: "trace.log", path: "C:\\jira\\trace.log" }
    ]
  });
  const startCall = harness.calls.find((call) => call.type === "start-turn-for-host");
  assert.deepEqual(startCall.payload.params.input.at(-1), {
    type: "localImage",
    path: "C:\\jira\\screen.PNG"
  });
  assert.deepEqual(startCall.payload.params.attachments, [{
    label: "trace.log",
    path: "C:\\jira\\trace.log",
    fsPath: "C:\\jira\\trace.log"
  }]);
});

test("未绑定项目时由 Codex 创建独立会话目录后发送首条消息", async () => {
  const harness = createBridgeHarness();
  await startCodexConversation("分析 Jira CT-10000", harness.options);
  const workspaceCall = harness.calls.find((call) => call.type === "projectless-thread-cwd");
  assert.equal(workspaceCall.payload.params.prompt, "分析 Jira CT-10000");
  const startCall = harness.calls.find((call) => call.type === "start-conversation");
  assert.equal(startCall.payload.workspaceKind, "projectless");
  assert.equal(
    startCall.payload.projectlessOutputDirectory,
    "C:\\Users\\tester\\Documents\\Codex\\jira-task\\outputs"
  );
  assert.equal("projectAssignment" in startCall.payload, false);
});

test("Codex 当前会话忙碌时快速失败，运行中的审查可按真实 turnId 中断", async () => {
  const busyHarness = createBridgeHarness({ turnStatus: "inProgress" });
  await assert.rejects(
    startCodexThreadTurn(busyHarness.threadId, "review prompt", busyHarness.options),
    (error) => error.code === "CODEX_THREAD_BUSY" && error.turnId === "turn-current"
  );

  const idleHarness = createBridgeHarness();
  const interrupted = await interruptCodexThreadTurn(
    idleHarness.threadId,
    "turn-review",
    idleHarness.options
  );
  assert.equal(interrupted.turnId, "turn-review");
  const interruptCall = idleHarness.calls.find((call) => call.payload?.method === "turn/interrupt");
  assert.deepEqual(interruptCall.payload.params, {
    threadId: idleHarness.threadId,
    turnId: "turn-review"
  });
});

test("侧栏未渲染目标时可通过 Codex 原生服务按会话 ID 导航", async () => {
  const calls = [];
  const normalizedThreadId = await navigateCodexThread(
    "local:019fcbb6-c322-7250-9b19-4645a37103c9",
    {
      documentRef: {
        scripts: [{ src: "app://-/assets/index-DhkQKCd_.js" }]
      },
      fetchFn: async (url) => {
        assert.equal(url, "app://-/assets/index-DhkQKCd_.js");
        return {
          ok: true,
          text: async () => 'import("./rpc-iron1uwk.js");'
        };
      },
      importModule: async (url) => {
        assert.equal(url, "app://-/assets/rpc-iron1uwk.js");
        return {
          appServices: {
            appActions: {
              runInPrimaryWindow: async (request) => calls.push(request)
            }
          }
        };
      }
    }
  );

  assert.equal(normalizedThreadId, "019fcbb6-c322-7250-9b19-4645a37103c9");
  assert.deepEqual(calls, [{
    action: {
      kind: "codex",
      type: "windows.show_thread",
      windowId: "current",
      threadId: "019fcbb6-c322-7250-9b19-4645a37103c9"
    }
  }]);
});
