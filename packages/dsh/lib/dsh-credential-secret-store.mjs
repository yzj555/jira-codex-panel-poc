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
//
// 构造时接受一个 credentials **getter**（`() => ctx.get("credentials")`）而非
// 立即绑定的服务对象：DSH 里 credentials 是可选服务，且其 provider 可能在
// jira-workbench 的 apply 之后才进入 ACTIVE 状态，apply 时同步 ctx.get 会因
// 时序竞态拿到 undefined 而误回退 DPAPI。getter 把「取服务」推迟到真正
// protect/unprotect 的时刻（用户读配置 / 提交卡片），此时服务已就绪。

export const CREDENTIAL_REFS = Object.freeze({
  token: "JIRA_WORKBENCH_TOKEN",
  wecomWebhook: "JIRA_WORKBENCH_WECOM_WEBHOOK"
});

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 把构造入参归一成 credentials getter：直接传服务对象或传 getter 皆可。
 * @param credentialsOrGetter - DSH 的 ctx.credentials，或返回它的 getter。
 */
function resolveCredentialsGetter(credentialsOrGetter) {
  const getter = typeof credentialsOrGetter === "function"
    ? credentialsOrGetter
    : () => credentialsOrGetter;
  return async function credentials() {
    const credentials = await getter();
    if (!credentials || typeof credentials.resolve !== "function" || typeof credentials.set !== "function") {
      throw new TypeError("dshCredentialSecretStore 需要 DSH 的 credentials 服务（resolve/set）。");
    }
    return credentials;
  };
}

/**
 * 构造 DSH 侧的 secretStore。
 * @param credentialsOrGetter - DSH 的 ctx.credentials，或返回它的 getter。
 *   延迟取服务以避开 apply 时 credentials 未就绪的时序竞态。
 * @param refs - 可选覆盖引用名；缺省用 CREDENTIAL_REFS。
 */
export function createDshCredentialSecretStore(credentialsOrGetter, refs = CREDENTIAL_REFS) {
  const getCredentials = resolveCredentialsGetter(credentialsOrGetter);
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
      const credentials = await getCredentials();
      const ref = refFor(key);
      // credentials.set 在 read-only 源遮蔽时 reject（写会看似成功却读不到），
      // 直接向上抛，让 config-store 的 TOKEN_ENCRYPT_FAILED 包装。
      await credentials.set(ref, plaintext);
      return ref;
    },
    async unprotect(stored, key) {
      const credentials = await getCredentials();
      // stored 是 protect 返回的引用名（字符串）；resolve 返回 { value, source }。
      const ref = typeof stored === "string" && REF_PATTERN.test(stored) ? stored : refFor(key);
      const resolved = await credentials.resolve(ref);
      if (!resolved) return "";
      return resolved.value;
    }
  };
}
