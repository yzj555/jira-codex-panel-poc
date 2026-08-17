import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_APPLICATION_RUNTIME_OWNER,
  createCodexApplicationCommands,
  createCodexRuntimeSelector,
  createPanelCodexRuntimeAdapter
} from "../lib/codex-application-commands.mjs";

function runtime(id, capabilities, methods = {}) {
  return {
    id,
    getCapabilities: () => ({ runtimeOwner: id, capabilities }),
    ...methods
  };
}

function commandHarness({ app = {}, desktop = {} } = {}) {
  const calls = [];
  const appRuntime = runtime(CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER, {
    listSkills: true,
    listThreads: true,
    readThread: true,
    renameThread: true,
    resolveThreadId: true,
    createThread: true,
    startTurn: true,
    interruptTurn: true,
    attachImages: true,
    attachFiles: false,
    navigateThread: false
  }, {
    listSkills: async () => { calls.push("app:listSkills"); return [{ name: "app", path: "app.md" }]; },
    listThreads: async () => { calls.push("app:listThreads"); return { data: [] }; },
    readThread: async (threadId) => { calls.push(`app:read:${threadId}`); return { threadId }; },
    renameThread: async (threadId, name) => {
      calls.push(`app:rename:${threadId}:${name}`);
      return { threadId, name };
    },
    resolveThreadId: async (threadId) => threadId,
    startConversation: async (_prompt, options) => {
      calls.push(`app:create:${options.cwd || ""}`);
      return { threadId: "app-thread", turnId: "app-turn" };
    },
    startTurn: async (threadId) => { calls.push(`app:turn:${threadId}`); return { threadId, turnId: "app-turn" }; },
    interruptTurn: async (threadId) => { calls.push(`app:interrupt:${threadId}`); return { threadId }; },
    ...app
  });
  const desktopRuntime = runtime(CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER, {
    listSkills: true,
    listThreads: false,
    readThread: true,
    resolveThreadId: true,
    resolveConversationTarget: true,
    createThread: true,
    startTurn: true,
    interruptTurn: true,
    attachImages: true,
    attachFiles: true,
    navigateThread: true,
    renameThread: true
  }, {
    listSkills: async () => { calls.push("desktop:listSkills"); return [{ name: "desktop", path: "desktop.md" }]; },
    readThread: async (threadId) => { calls.push(`desktop:read:${threadId}`); return { threadId }; },
    resolveThreadId: async (threadId) => threadId,
    resolveConversationTarget: async (projectId) => {
      calls.push(`desktop:resolveTarget:${projectId}`);
      return { cwd: "F:\\workspace" };
    },
    startConversation: async () => { calls.push("desktop:create"); return { threadId: "desktop-thread" }; },
    startTurn: async (threadId) => { calls.push(`desktop:turn:${threadId}`); return { threadId, turnId: "desktop-turn" }; },
    interruptTurn: async (threadId) => { calls.push(`desktop:interrupt:${threadId}`); return { threadId }; },
    navigateThread: async (threadId) => { calls.push(`desktop:open:${threadId}`); return threadId; },
    renameThread: async (threadId, name) => {
      calls.push(`desktop:rename:${threadId}:${name}`);
      return { threadId, name };
    },
    ...desktop
  });
  const selector = createCodexRuntimeSelector({ runtimes: [appRuntime, desktopRuntime] });
  return {
    calls,
    selector,
    commands: createCodexApplicationCommands({ selector, desktopHost: desktopRuntime })
  };
}

test("Application Commands 默认优先使用官方 App Server", async () => {
  const harness = commandHarness();
  const result = await harness.commands.listAvailableSkills();
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER);
  assert.deepEqual(result.value, [{ name: "app", path: "app.md" }]);
  assert.deepEqual(harness.calls, ["app:listSkills"]);
});

test("只读请求失败时自动降级到 Codex Desktop App Server", async () => {
  const harness = commandHarness({
    app: { readThread: async () => { harness.calls.push("app:read:thread-1"); throw new Error("offline"); } }
  });
  const result = await harness.commands.readConversation("thread-1");
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER);
  assert.deepEqual(result.runtimeFallback, {
    from: CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER,
    to: CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER
  });
  assert.deepEqual(harness.calls, ["app:read:thread-1", "desktop:read:thread-1"]);
});

test("非图片附件按能力直接路由到 Desktop App Server，不先调用 App Server", async () => {
  const harness = commandHarness();
  const result = await harness.commands.createAnalysisConversation("review", {
    projectId: "project-1",
    attachments: [{ path: "F:\\review.diff", mimeType: "text/plain" }]
  });
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER);
  assert.deepEqual(harness.calls, ["desktop:resolveTarget:project-1", "desktop:create"]);
});

test("显式只读路径模式允许非图片文件走 App Server", async () => {
  const harness = commandHarness();
  const result = await harness.commands.createAnalysisConversation("review", {
    projectId: "project-1",
    referenceFiles: true,
    attachments: [{ path: "F:\\review.diff", mimeType: "text/plain" }]
  });
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER);
  assert.deepEqual(harness.calls, ["desktop:resolveTarget:project-1", "app:create:F:\\workspace"]);
});

test("项目绑定的新会话解析 cwd 后优先交给 App Server", async () => {
  const harness = commandHarness();
  const result = await harness.commands.createAnalysisConversation("analyze", { projectId: "project-1" });
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER);
  assert.deepEqual(harness.calls, ["desktop:resolveTarget:project-1", "app:create:F:\\workspace"]);
});

test("人工新建和重新绑定由当前 Codex Desktop 原子创建并发送首条消息", async () => {
  const harness = commandHarness();
  const result = await harness.commands.createAnalysisConversation("analyze", {
    projectId: "project-1",
    desktopOwned: true,
    attachments: [{ path: "F:\\review.diff", mimeType: "text/plain" }]
  });
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER);
  assert.deepEqual(harness.calls, ["desktop:resolveTarget:project-1", "desktop:create"]);
});

test("无项目的新会话也由 App Server 创建且不伪造项目目录", async () => {
  const harness = commandHarness();
  const result = await harness.commands.createAnalysisConversation("analyze");
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER);
  assert.deepEqual(harness.calls, ["app:create:"]);
});

test("创建请求在 App Server 启动前失败时允许安全降级", async () => {
  const unavailable = Object.assign(new Error("not installed"), { code: "CODEX_APP_SERVER_UNAVAILABLE" });
  const harness = commandHarness({
    app: { startConversation: async () => { harness.calls.push("app:create:failed"); throw unavailable; } }
  });
  const result = await harness.commands.createAnalysisConversation("analyze", { projectId: "project-1" });
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER);
  assert.deepEqual(harness.calls, ["desktop:resolveTarget:project-1", "app:create:failed", "desktop:create"]);
});

test("结果不确定的首条消息失败不会降级，防止重复会话", async () => {
  const ambiguous = Object.assign(new Error("thread exists but turn failed"), { code: "CODEX_TURN_START_FAILED" });
  const harness = commandHarness({
    app: { startConversation: async () => { harness.calls.push("app:create:ambiguous"); throw ambiguous; } }
  });
  await assert.rejects(
    harness.commands.createAnalysisConversation("analyze", { projectId: "project-1" }),
    (error) => error === ambiguous
  );
  assert.deepEqual(harness.calls, ["desktop:resolveTarget:project-1", "app:create:ambiguous"]);
});

test("已有绑定优先使用保存的 runtimeOwner，导航始终由 Desktop App Server 执行", async () => {
  const harness = commandHarness();
  const state = await harness.commands.readConversation("thread-1", {
    runtimeOwner: CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER
  });
  const opened = await harness.commands.openConversation("thread-1");
  assert.equal(state.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER);
  assert.equal(opened.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER);
  assert.deepEqual(harness.calls, ["desktop:read:thread-1", "desktop:open:thread-1"]);
});

test("会话标题更新默认走官方 App Server", async () => {
  const harness = commandHarness();
  const renamed = await harness.commands.renameConversation("thread-1", "分析 CT-1");
  assert.equal(renamed.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER);
  assert.deepEqual(harness.calls, ["app:rename:thread-1:分析 CT-1"]);
});

test("旧绑定在 Desktop App Server 发送前预检失败时可切换到 App Server", async () => {
  const preflightError = Object.assign(new Error("desktop bridge unavailable"), {
    code: "CODEX_DESKTOP_HOST_UNAVAILABLE"
  });
  const harness = commandHarness({
    desktop: {
      startTurn: async () => {
        harness.calls.push("desktop:turn:failed");
        throw preflightError;
      }
    }
  });
  const result = await harness.commands.sendAnalysisMessage("thread-1", "analyze", {
    runtimeOwner: CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER
  });
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER);
  assert.deepEqual(harness.calls, ["desktop:turn:failed", "app:turn:thread-1"]);
});

test("App Server 确认会话由桌面持有时安全降级到桌面通道", async () => {
  const ownedElsewhere = Object.assign(new Error("running in another app"), {
    code: "CODEX_THREAD_OWNED_ELSEWHERE"
  });
  const harness = commandHarness({
    app: {
      startTurn: async () => {
        harness.calls.push("app:turn:owned");
        throw ownedElsewhere;
      }
    }
  });
  const result = await harness.commands.sendAnalysisMessage("thread-1", "review", {
    runtimeOwner: CODEX_APPLICATION_RUNTIME_OWNER.STANDALONE_APP_SERVER
  });
  assert.equal(result.runtimeOwner, CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER);
  assert.deepEqual(harness.calls, ["app:turn:owned", "desktop:turn:thread-1"]);
});

test("Desktop App Server 已投递后超时仍不切换 Runtime", async () => {
  const timeout = Object.assign(new Error("turn result timeout"), { code: "CODEX_APP_SERVER_TIMEOUT" });
  const harness = commandHarness({
    desktop: {
      startTurn: async () => {
        harness.calls.push("desktop:turn:timeout");
        throw timeout;
      }
    }
  });
  await assert.rejects(
    harness.commands.sendAnalysisMessage("thread-1", "analyze", {
      runtimeOwner: CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER
    }),
    (error) => error === timeout
  );
  assert.deepEqual(harness.calls, ["desktop:turn:timeout"]);
});

test("desktop-owned turn can disable mutation fallback", async () => {
  const preflightError = Object.assign(new Error("desktop thread is not ready"), {
    code: "CODEX_DESKTOP_PREFLIGHT_FAILED"
  });
  const harness = commandHarness({
    desktop: {
      startTurn: async () => {
        harness.calls.push("desktop:turn:not-ready");
        throw preflightError;
      }
    }
  });

  await assert.rejects(
    harness.commands.sendAnalysisMessage("thread-1", "analyze", {
      runtimeOwner: CODEX_APPLICATION_RUNTIME_OWNER.DESKTOP_APP_SERVER,
      allowFallback: false
    }),
    (error) => error === preflightError
  );
  assert.deepEqual(harness.calls, ["desktop:turn:not-ready"]);
});

test("浏览器 App Server Adapter 归一化 HTTP 数据和会话忙碌状态", async () => {
  const requests = [];
  const adapter = createPanelCodexRuntimeAdapter({
    request: async (path, options) => {
      requests.push({ path, options });
      if (path.startsWith("/api/codex/app-server/skills")) {
        return { skills: [{ name: "skill", path: "skill.md" }] };
      }
      if (path === "/api/codex/app-server/thread-state") {
        if (options.body.threadId === "thread-idle") {
          return {
            result: {
              thread: {
                id: "thread-idle",
                status: { type: "notLoaded" },
                turns: [{ id: "turn-idle", status: "completed" }]
              }
            }
          };
        }
        return {
          result: {
            thread: { id: "thread-1", turns: [{ id: "turn-1", status: "inProgress" }] }
          }
        };
      }
      if (path === "/api/codex/app-server/analysis") {
        return { result: { threadId: "thread-new" } };
      }
      return { result: {} };
    }
  });
  assert.deepEqual(await adapter.listSkills({ forceReload: true }), [{ name: "skill", path: "skill.md" }]);
  const state = await adapter.readThread("local:thread-1");
  assert.equal(state.threadId, "thread-1");
  assert.equal(state.busy, true);
  assert.equal(state.activeTurnId, "turn-1");
  assert.equal(state.desktopAdoptable, false);
  const idle = await adapter.readThread("thread-idle");
  assert.equal(idle.busy, false);
  assert.equal(idle.desktopAdoptable, true);
  const created = await adapter.startConversation("analyze", { cwd: "F:\\repo" });
  assert.equal(created.threadId, "thread-new");
  assert.match(requests[0].path, /forceReload=true/);
  assert.deepEqual(requests[1].options.body, { threadId: "thread-1" });
  const analysisRequest = requests.find((request) => request.path === "/api/codex/app-server/analysis");
  assert.equal(Object.hasOwn(analysisRequest.options.body, "desktopOwned"), false);
});
