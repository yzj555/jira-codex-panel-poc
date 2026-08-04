import test from "node:test";
import assert from "node:assert/strict";
import {
  findCodexRpcAsset,
  navigateCodexThread,
  normalizeCodexThreadId
} from "../lib/codex-navigation.mjs";

test("Codex 会话 ID 会移除本地主机前缀", () => {
  assert.equal(
    normalizeCodexThreadId("local:019fcbb6-c322-7250-9b19-4645a37103c9"),
    "019fcbb6-c322-7250-9b19-4645a37103c9"
  );
  assert.equal(normalizeCodexThreadId("remote-thread-id"), "remote-thread-id");
});

test("从 Codex 入口资源发现带哈希的 RPC 模块", () => {
  assert.equal(
    findCodexRpcAsset('import("./app.js"); const files=["./rpc-iron1uwk.js"];'),
    "rpc-iron1uwk.js"
  );
  assert.equal(findCodexRpcAsset("const value = 1;"), "");
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
