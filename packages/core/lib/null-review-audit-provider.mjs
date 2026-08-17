/**
 * 无宿主审查能力的降级审查审计 provider。
 *
 * SVN 审核管理器通过构造参数注入会话读取器（turnReader / sessionReader），
 * 并在缺少任一读取能力时拒绝启动。当 core 以独立服务运行（没有 Codex App
 * Server 与 Codex 会话目录）时，用本工厂提供一个「全部返回空」的读取器，
 * 让审核管理器保留人工审核、机械检查、一次性令牌与提交对账，而 Codex 审查
 * 相关的能力自然降级为不可用。
 */
export function createNullReviewAuditProvider() {
  const turnReader = {
    readThread: async () => null,
    readTurnResult: async () => null
  };
  const sessionReader = {
    readContext: async () => null,
    readReviewTurn: async () => null,
    findReviewTurn: async () => null,
    readConversationContext: async () => null,
    readTouchedFiles: async () => []
  };
  return { turnReader, sessionReader };
}
