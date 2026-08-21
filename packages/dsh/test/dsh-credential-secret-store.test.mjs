import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore } from "@jira-workbench/core/config-store.mjs";
import { createDshCredentialSecretStore, CREDENTIAL_REFS } from "../lib/dsh-credential-secret-store.mjs";

// 内存 credentials mock：resolve/set/describe/unset，模拟 DSH 的 CredentialProvider。
function mockCredentials(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async resolve(ref) {
      const value = store.get(String(ref));
      return value === undefined ? undefined : { value, source: "file" };
    },
    async set(ref, value) {
      store.set(String(ref), String(value));
    },
    async describe(ref) {
      const configured = store.has(String(ref));
      return { configured, writable: true, ...(configured ? { source: "file" } : {}) };
    },
    async unset(ref) {
      store.delete(String(ref));
    },
    _store: store
  };
}

test("dshCredentialSecretStore protect 写入 credentials 并返回引用名", async () => {
  const credentials = mockCredentials();
  const secretStore = createDshCredentialSecretStore(credentials);

  const ref = await secretStore.protect("secret-token", "token");
  assert.equal(ref, CREDENTIAL_REFS.token);
  assert.equal(credentials._store.get(CREDENTIAL_REFS.token), "secret-token");
});

test("dshCredentialSecretStore unprotect 每次 resolve，不缓存", async () => {
  const credentials = mockCredentials({ [CREDENTIAL_REFS.token]: "token-v1" });
  const secretStore = createDshCredentialSecretStore(credentials);

  assert.equal(await secretStore.unprotect(CREDENTIAL_REFS.token, "token"), "token-v1");

  // 轮换：resolve 每次读新值，unprotect 不缓存旧值
  credentials._store.set(CREDENTIAL_REFS.token, "token-v2");
  assert.equal(await secretStore.unprotect(CREDENTIAL_REFS.token, "token"), "token-v2");
});

test("config.json 用 credential-ref 存储时只存引用名，不含明文/密文", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-cred-"));
  const configFile = join(directory, "config.json");
  const credentials = mockCredentials();
  const secretStore = createDshCredentialSecretStore(credentials);
  const store = createConfigStore({ configFile, secretStore });

  try {
    await store.save(await store.prepare({
      baseUrl: "http://jira.example:8080",
      token: "super-secret-token"
    }));

    const raw = await readFile(configFile, "utf8");
    assert.equal(raw.includes("super-secret-token"), false);
    // tokenProtected 存的是引用名，不是 base64 密文
    assert.equal(raw.includes(CREDENTIAL_REFS.token), true);

    // load 能通过 resolve 还原 token
    const loaded = await store.load();
    assert.equal(loaded.token, "super-secret-token");

    // 公开配置标记 credentialStorage 为 DSH credentials 引用
    const publicConfig = await store.getPublic();
    assert.match(publicConfig.credentialStorage, /DSH credentials/);
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("DSH 首次配置会验证凭据引用并原子关联 Jira 地址", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-link-"));
  const configFile = join(directory, "config.json");
  const credentials = mockCredentials({ [CREDENTIAL_REFS.token]: "linked-token" });
  const store = createConfigStore({
    configFile,
    secretStore: createDshCredentialSecretStore(credentials)
  });

  try {
    const result = await store.updateCredentialReference({
      baseUrl: "http://jira.example:8080/",
      tokenReference: CREDENTIAL_REFS.token
    });
    assert.equal(result.configured, true);
    assert.equal(result.baseUrl, "http://jira.example:8080");

    const raw = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(raw.tokenProtected, CREDENTIAL_REFS.token);
    assert.equal(JSON.stringify(raw).includes("linked-token"), false);
    assert.equal((await store.load()).token, "linked-token");
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("DSH 首次配置在 Token 引用不存在时拒绝落盘", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-missing-link-"));
  const configFile = join(directory, "config.json");
  const store = createConfigStore({
    configFile,
    secretStore: createDshCredentialSecretStore(mockCredentials())
  });

  try {
    await assert.rejects(
      () => store.updateCredentialReference({
        baseUrl: "http://jira.example:8080",
        tokenReference: CREDENTIAL_REFS.token
      }),
      (error) => error?.code === "TOKEN_REFERENCE_UNAVAILABLE" && error?.statusCode === 428
    );
    await assert.rejects(() => readFile(configFile, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("缺少 credentials 服务时 protect/unprotect 抛错（延迟取服务）", async () => {
  // 构造接受 getter 或 undefined：apply 时 credentials 可能还没就绪，构造不
  // 立即抛错，改为真正读写凭据时（protect/unprotect）才校验。
  const secretStore = createDshCredentialSecretStore(() => undefined);
  await assert.rejects(
    () => secretStore.unprotect(CREDENTIAL_REFS.token, "token"),
    /需要 DSH 的 credentials 服务/
  );
  await assert.rejects(
    () => secretStore.protect("value", "token"),
    /需要 DSH 的 credentials 服务/
  );
});

test("credentials 后置就绪：getter 在读写时解析，避开 apply 时序竞态", async () => {
  // 模拟 credentials 在 apply 后才 ACTIVE：构造时 getter 返回 undefined，
  // 稍后服务就绪，protect/unprotect 就能正常工作。
  let ready = false;
  const credentials = mockCredentials({ [CREDENTIAL_REFS.token]: "late-token" });
  const secretStore = createDshCredentialSecretStore(() => (ready ? credentials : undefined));

  // 未就绪：读写都抛
  await assert.rejects(() => secretStore.unprotect(CREDENTIAL_REFS.token, "token"), /需要 DSH 的 credentials 服务/);

  // 就绪后：正常
  ready = true;
  assert.equal(await secretStore.unprotect(CREDENTIAL_REFS.token, "token"), "late-token");
  assert.equal(await secretStore.protect("new-token", "token"), CREDENTIAL_REFS.token);
  assert.equal(credentials._store.get(CREDENTIAL_REFS.token), "new-token");
});

test("无效引用名在 protect 时抛错", async () => {
  const credentials = mockCredentials();
  const secretStore = createDshCredentialSecretStore(credentials, { token: "bad name!" });
  await assert.rejects(
    () => secretStore.protect("value", "token"),
    /引用名/
  );
});
