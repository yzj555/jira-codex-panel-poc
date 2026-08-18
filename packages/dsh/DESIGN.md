# DSH 适配设计：宿主无关 core 的 provider 契约

本文定义 `@jira-workbench/core` 如何从「Codex 优先、MCP 绑定的 core」演进为「真宿主无关的 core」，以及 `jira-workbench-dsh` 适配层如何基于三个可注入 provider 接口接入 DSH。它是动手实现的契约依据，不是已完成的设计。

## 1. 目标

让 core 的 Jira/JXL/SVN 业务规则与状态被任意宿主复用，宿主能力（密钥存储、敏感操作确认、会话审查数据源）全部通过构造参数注入，core 不 import 任何宿主的文件、协议、平台或对象模型。

## 2. 红线：宿主无关的三层

| 层 | 含义 | 判定标准 |
| --- | --- | --- |
| 1. 不 import 宿主文件 | core 不 import `@jira-workbench/codex` / `@jira-workbench/dsh` | 已成立 |
| 2. 不绑定宿主协议/平台 | core 不依赖 MCP 协议、不硬编码 Windows DPAPI | 半成立（见 §3） |
| 3. 接口形状不被某宿主语义绑架 | core 的抽象用业务语义，不用某宿主的对象模型 | 有反例（见 §3） |

三条守则：

1. **core 接口只暴露业务语义**：`action` / `payload` / `reason` / `granted` / `thread` / `turn` / `touchedFiles` 这类词；不出现 `agent` / `CredentialRef` / `callId` / `ctx` / `Session.events` / `local:` 前缀。
2. **宿主特有符号封在各自适配层**：DSH 的 `ctx.*` 只在 `packages/dsh` import；Codex 的 App Server/CDP 只在 `packages/codex` import。
3. **降级语义保留**：core 不带任何 provider 时（`bin/serve.mjs`），三个接口各自有明确缺省实现，缺省不伪装可用。

适配层依赖宿主是天经地义（它本就是适配层）；core 依赖宿主才是破坏。守则 1–3 是这条边界的可执行判定。

## 3. 现状诊断

### 3.1 第 2 层半成立

- `mcp/jira-task-board-mcp.mjs` import `McpServer`（`@modelcontextprotocol/sdk`），工具定义与 MCP 协议耦合。core 一旦要进程内被 DSH 组装（DSH 工具是 `ctx.tools` 注册的 Cordis 工具，不走 MCP），此耦合必须解除。
- `config-store.mjs` 的 `protectWithDpapi` / `unprotectWithDpapi` 硬编码 Windows DPAPI（`process.platform !== "win32"` 直接抛错）。DSH 的密钥走 `ctx.credentials`，core 需要可注入的密钥存储。

### 3.2 第 3 层有反例

`createSvnReviewManager` 的 `turnReader` / `sessionReader` 返回形状是 Codex 会话形状：`threadId` 带 `local:` 前缀（core 里 `readOfficialThread` 用 `replace(/^local:/i, "")` 剥离）、turn 有 `items`（`type: "userMessage"|"agentMessage"|"fileChange"`）、touched files 从 `fileChange` item 的 `changes[].path` 提取。这是「被 Codex 这一个 Consumer 绑架」的现行痕迹——DSH 若实现此接口，就不得不把 DSH `Session.events` 硬塞进 Codex 形状。

## 4. 演进总览

```
前置重构（行为零变化，靠 215 测试锁回归）
  ├─ A. 工具面从 MCP 协议解耦
  └─ B. secretStore / approvalProvider 接口引入（先给 Codex 实现 = 现状缺省）

连通性里程碑
  └─ C. DSH 进程内 host（function plugin，替代独立 HTTP 进程）

逐项接 provider
  ├─ D. dshCredentialSecretStore（Token 走 ctx.credentials）
  ├─ E. dshApprovalProvider（确认走 ctx.approval）
  └─ F. dshSessionAuditProvider（SVN 审查读 DSH Session）
```

顺序约束：A 是 C/D/E/F 的前置（不解除 MCP 耦合，DSH 进程内无法注册 core 工具）；C 是 D/E 的前置（DSH 服务只在 DSH 进程内存在）；F 依赖 B 阶段把 `turnReader`/`sessionReader` 中立化。

## 5. provider 契约

三个接口的签名骨架与职责边界。精确字段在各自实现里程碑定稿；本节锁定的是边界、语义与红线。

### 5.1 `secretStore` — 密钥存储

```
secretStore = {
  mode: "dpapi" | "credential-ref",        // 配置 UI 展示用，core 不据此分支行为
  protect(plaintext) → Promise<string>,    // 存储形态：dpapi 是 base64 密文；credential-ref 是引用名
  unprotect(stored) → Promise<string>      // 还原明文；credential-ref 每次调用 resolve 真值
}
```

- Codex 实现（缺省）：`dpapiSecretStore`，现状 `protectWithDpapi` / `unprotectWithDpapi` 原样搬入。
- DSH 实现：`dshCredentialSecretStore`，`protect` 存 `CredentialRef`（环境变量名），`unprotect` 调 `ctx.credentials.resolve(ref)`。

语义要点：

- `unprotect` 每次调用都 resolve，不跨操作缓存 —— 与 DSH credentials 的 per-operation 语义一致，token 轮换下次操作生效。
- config.json 里 token 字段的存储形态由 `mode` 决定：`dpapi` 存密文，`credential-ref` 存引用名。

**共享数据文件的约束（决策点 1）**：core 与 Codex 共享 `%LOCALAPPDATA%\jira-workbench\config.json`。若 DSH 把 token 写成 credential ref，Codex 壳读同一份文件会拿到「引用而非密文」→ 读侧 `secretStore` 也必须一致。因此 token 存储模式是**部署级**而非**宿主级**：同一份数据文件必须始终用同一个 `secretStore` 实现。DSH 若需独立数据目录，用 `JIRA_WORKBENCH_CONFIG_FILE` 覆盖，而非在同一文件里混用两种存储形态。

### 5.2 `approvalProvider` — 敏感操作确认

core 现有两处「两阶段确认」：Jira 流转在 MCP 工具层走 `createActionConfirmationStore`（`issue` → 返回 `confirmationId` → `consume`），SVN commit 在 `svn-review-manager` 内部 `confirmations` Map（`confirmReview` 生成 token → `commitReview` 校验）——后者已内建在服务层，无需抽象。

**已定稿（决策点 2，方案 B）**：`approvalProvider` 采用**两阶段 `issue`/`consume`**（形状同现有 `createActionConfirmationStore`），而非单阶段 `request`。理由：

- `prepare`/`confirm` 工具本身就是「最终参数复核」（issueKey、transitionId、expectedTargetStatus 均已确定），所以「issue 时审批」审批的正是最终参数——方案 i 的「审批时刻偏早」缺点实际不存在。
- 「grant 跨 tool 调用存活」封装在各宿主 `approvalProvider` 实现内部（DSH 侧本地 grant store + ALS 传 agent），不污染 core。
- core 独立服务缺省实现（`createLocalApprovalProvider` = `createActionConfirmationStore`）行为零变化，Codex 侧 216+ 测试不动。

```
approvalProvider = {
  issue(action, payload)  → Promise<{ confirmationId, action, expiresAt }>,
  consume(confirmationId, action) → Promise<payload>,   // 无效/过期抛 ActionConfirmationError
  revoke(confirmationId) → boolean
}
```

- `action` 是业务动作名（如 `jira-transition`），`payload` 是纯 JSON 业务参数 —— 不含 DSH 的 `agent`/`callId`/`toolName` 符号。
- DSH 实现（`dshApprovalProvider`）：`issue` 里从 AsyncLocalStorage 读 agent，`await ctx.approval.request({ agent, toolName, reason })`，`allowed-once` 才委托本地 grant store 签发；`consume`/`revoke` 只委托本地 store。审批发生在「复核」工具调用内（open turn 内），满足 `ctx.approval.request` 的 turn-enclosed 前置。
- Codex 实现：`createLocalApprovalProvider`（现状缺省），两阶段确认仍在 MCP Apps UI 驱动。

### 5.3 `sessionAuditProvider` — 会话审查数据源

core 的 `createSvnReviewManager` 已接受 `turnReader` / `sessionReader` 注入（§3.2），无需改契约签名，只需把返回形状中立化。中立化做的是：去掉 `local:` 前缀、去掉 Codex turn 的 `items` / `fileChange` 专属结构，换成中性「会话审查」形状。

目标形状（F 阶段定稿）：

```
sessionAuditProvider = {
  readThread(threadId, { includeTurns }) → thread | null,
    // thread.turns[]: { turnId, startedAt, completedAt, messages: [{ role, text }], fileChanges: [{ path, observedAt }] }
  readTurnResult(threadId, turnId) → turnResult | null,
  readContext(threadId) → context | null,
  readReviewTurn(threadId, options) → reviewTurn | null,
  findReviewTurn({ ...lookupOptions, threadId }) → reviewTurn | null,
  readConversationContext(threadId) → conversation | null,
  readTouchedFiles(threadId, { after, cwd }) → [{ path, observedAt }]
}
```

- Codex 实现：`codex-session-reader`（读 `.jsonl`，已中性）+ `codex-neutral-turn-reader`（F 阶段新增，把 App Server `thread/read` 原始形状映射成中性形状，`local:` 剥离在此下放）。
- DSH 实现：`dshSessionAuditProvider`，把 `Session.events`（turn/start、tool 调用结果、touched files）映射成中性形状。**推迟**：DSH 侧 SVN 审查当前走人工审核（`createCoreService` 用 null provider，`codexReviewEnabled` 缺省 false），「DSH agent 跑审查」需要 subagent 编排，尚无 Consumer——按「require a current owner and need」不提前写映射。
- 缺省：`createNullReviewAuditProvider`（现状，全返回空，SVN 审核降级人工）。

红线：中性形状里 `threadId` 不带 `local:` 前缀（剥离逻辑下放到 Codex 适配层，core 只保留「比较两边 threadId 时归一化」的防御）；`fileChanges` 的 path 是绝对路径（DSH 侧自行 resolve 相对路径）。

## 6. 关键差异与约束

### 6.1 schema 库

core 用 `zod/v4`（`import * as z from "zod/v4"`），DSH 用 `@deepseek-ai/schemastery`。工具面解耦（A 阶段）时须定死「schema 归属库」：建议 core 工具面继续用 zod（Codex 的 MCP 层零改动），DSH 适配层写一个 `zod → schemastery` 薄转换。避免两边各写一份 schema。

### 6.2 缺省实现的完整性

`bin/serve.mjs`（core 独立服务）不带任何宿主 provider 时：`secretStore` 用 DPAPI、`approvalProvider` 用本地令牌（`createActionConfirmationStore` 等价物）、`sessionAuditProvider` 用 `createNullReviewAuditProvider`。缺省不伪装可用 —— 审查降级人工、确认仍走一次性令牌、密钥仍 DPAPI。这正是「宿主无关」的验证基准：core 独立服务跑得起来，行为与今天一致。

## 7. 迁移里程碑（每步可独立验证、可独立提交）

1. **A（工具面解耦）**：把 19 个工具从 `McpServer.registerTool` 抽成 host-agnostic 结构（`名称 → { title, description, inputSchema, handler }`）；Codex 侧遍历回 MCP server。215 测试锁住行为零回归。**无新功能，纯重构。**
2. **B（secretStore 接口引入）**：`secretStore` 接口（`{ mode, credentialStorage, protect, unprotect }`），Codex 实现 = `dpapiSecretStore`（现状缺省），`createConfigStore` 兼容旧的裸 `protect`/`unprotect` 参数。approvalProvider（E）与 sessionAuditProvider 中立化（F）都推迟到各自 Consumer 落地的阶段，避免「改接口形状却没有第二个 Consumer 验证」。
3. **C（DSH 进程内 host）**：`packages/dsh` 写纯 JS function plugin（`plugin.mjs`，`name: jira-workbench`、`inject: ['tools']`），`apply` 里组装 core 服务、遍历 `buildToolDefinitions` 用 `ctx.tools.register` 注册，工具名无 `mcp__` 前缀。✅ 已实现（220 测试全绿，含 3 个 plugin 测试）。**部署接线待验证**：`@jira-workbench/core` 与 `jira-workbench-dsh` 需安装到 DSH 可解析位置（`$DSH_HOME/profiles/<name>/node_modules` 或 `bareModuleBaseUrl`）。
4. **D（dshCredentialSecretStore）**：`packages/dsh/lib/dsh-credential-secret-store.mjs` 提供 `createDshCredentialSecretStore(credentials)`，`protect` 调 `ctx.credentials.set(ref, value)` 存真值、返回引用名；`unprotect` 每次 `ctx.credentials.resolve(ref)`。`config-store.mjs` 的 `protect/unprotect` 增加第二个 key 参数（`"token"` / `"wecomWebhook"`），DPAPI 忽略、credential-ref 用它派生引用名；`createCoreService` 透传 `secretStore`。✅ 已实现（226 测试全绿）。
5. **E（approvalProvider 两阶段化）**：Jira 流转确认抽象为 `approvalProvider`（`issue`/`consume`/`revoke`，决策点 2 方案 B），core 独立服务缺省 `createLocalApprovalProvider`（= 现有 `createActionConfirmationStore`，行为零变化）；DSH 实现 `dshApprovalProvider` 在 `issue` 里 `await ctx.approval.request(...)`（通过 ALS 传 agent），`consume` 只校验本地 grant。SVN commit 确认已内建服务层，不动。✅ 已实现（231 测试全绿）。
6. **F（sessionAuditProvider 中立化）**：core 的 `svn-review-manager` 改为消费中性形状（`turns[].messages` / `turns[].fileChanges`，去掉 `items` / `fileChange` / `userMessage` / `agentMessage` 解析，入参 `local:` strip 下放到适配层）；Codex 适配层新增 `codex-neutral-turn-reader` 把 App Server `thread/read` 原始形状映射成中性形状。✅ 中立化已完成（234 测试全绿）。**`dshSessionAuditProvider` 推迟**：DSH 侧 SVN 审查当前走人工审核（null provider），「DSH agent 跑审查」需要 subagent 编排，尚无 Consumer。

## 8. 已决策项

1. **token 共享数据文件**（§5.1）：token 存储模式是**部署级**配置 —— 同一份 `config.json` 必须始终用同一个 `secretStore` 实现，不允许 Codex（DPAPI）与 DSH（credential-ref）混写同一文件。DSH 如需独立数据目录，用 `JIRA_WORKBENCH_CONFIG_FILE` 覆盖到独立路径，而不是在同一文件里切换存储形态。
2. **approvalProvider 方案 B**（§5.2）：两阶段 `issue`/`consume`/`revoke`，形状同现有 `createActionConfirmationStore`；`issue` 由宿主审批栈（DSH 的 `ctx.approval`，或 Codex 的 MCP Apps UI）在签发前把关，`consume` 只校验本地 grant。DSH 实现通过 ALS 把 `exec.agent` 传入 `issue`。此决策在 E 阶段落地。
3. **schema 归属库**（§6.1）：core 工具面继续用 `zod/v4`（Codex MCP 层零改动）；DSH 适配层写一个 `zod → schemastery` 薄转换，不双写 schema。
4. **工作台 UI（方向 C，未排入里程碑）**：先薄封装（Slot 里 iframe 加载 `task-board.html`，数据仍走 MCP 工具），后视需要 React 重写。依赖 1–3 落地后另行评估。
