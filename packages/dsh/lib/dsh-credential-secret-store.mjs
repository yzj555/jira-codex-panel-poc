// dshCredentialSecretStore：DSH 侧的 secretStore 实现。
//
// 把 Jira Token 与企业微信 Webhook 存进 DSH 的 ctx.credentials（引用名 →
// 真值），config.json 里只存引用名，不存密文或明文。unprotect 每次调用
// resolve，token 轮换下次操作生效（与 DSH credentials 的 per-operation 语义
// 一致，不跨操作缓存）。
//
// 引用名是部署级常量：config.json 里的 tokenProtected / wecomWebhookProtected
// 字段存的就是这些名字，必须稳定以便回读。与 DPAPI 模式的关键区别是——
// 同一份 config.json 要么永远 DPAPI、要么永远 credential-ref，不能混写
// （DESIGN.md 决策 1），DSH 若需独立数据目录用 JIRA_WORKBENCH_CONFIG_FILE
// 覆盖。

export const CREDENTIAL_REFS = Object.freeze({
  token: "JIRA_WORKBENCH_TOKEN",
  wecomWebhook: "JIRA_WORKBENCH_WECOM_WEBHOOK"
});

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 构造 DSH 侧的 secretStore。
 * @param credentials - DSH 的 ctx.credentials（含 resolve / set / describe / unset）。
 * @param refs - 可选覆盖引用名；缺省用 CREDENTIAL_REFS。
 */
export function createDshCredentialSecretStore(credentials, refs = CREDENTIAL_REFS) {
  if (!credentials || typeof credentials.resolve !== "function" || typeof credentials.set !== "function") {
    throw new TypeError("dshCredentialSecretStore 需要 DSH 的 credentials 服务（resolve/set）。");
  }
  const refFor = (key) => {
    const ref = refs[key];
    if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
      throw new TypeError(`dshCredentialSecretStore: 引用名 ${JSON.stringify(ref)} 无效（须匹配 ${String(REF_PATTERN)}）。`);
    }
    return ref;
  };

  return {
    mode: "credential-ref",
    credentialStorage: "DSH credentials 引用（每次操作 resolve）",
    async protect(plaintext, key) {
      const ref = refFor(key);
      // credentials.set 在 read-only 源遮蔽时 reject（写会看似成功却读不到），
      // 直接向上抛，让 config-store 的 TOKEN_ENCRYPT_FAILED 包装。
      await credentials.set(ref, plaintext);
      return ref;
    },
    async unprotect(stored, key) {
      // stored 是 protect 返回的引用名（字符串）；resolve 返回 { value, source }。
      const ref = typeof stored === "string" && REF_PATTERN.test(stored) ? stored : refFor(key);
      const resolved = await credentials.resolve(ref);
      if (!resolved) return "";
      return resolved.value;
    }
  };
}
