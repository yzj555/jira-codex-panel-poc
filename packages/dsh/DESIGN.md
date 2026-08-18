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

core 现在有两处「两阶段确认」：Jira 流转走 MCP 层的 `createActionConfirmationStore`（`issue` → 返回 `confirmationId` → `consume`），SVN commit 走 `svn-review-manager` 内部 `confirmations` Map（`confirmReview` 生成 token → `commitReview` 校验）。两者本质相同：先签发一次性凭据，用户确认后 consume 执行。

DSH 的 `ctx.approval.request()` 是**单阶段**：直接问 → `allowed-once` / `rejected`。两种折中：

- **方案 i（不动 core 确认路径）**：DSH 实现里 `issue` 时同步 `await ctx.approval.request(...)`，通过则生成短期 grant 存内存，`consume` 只校验。缺点：`issue` 与 `consume` 间隔两次 tool 调用，grant 要跨调用存活，且审批时刻偏早（prepare 阶段，用户尚未看到 execute 最终参数）。
- **方案 ii（core 确认抽象单阶段化）**：core 把确认抽象改为单阶段 `request({ action, payload, reason }) → { granted, deniedReason? }`，DSH 直接映射；Codex 侧在 MCP Apps UI 把单阶段再包装回两阶段。缺点：动 `jira-workbench-service` / `svn-workbench-service` 的确认路径，工作量大于 i。

**倾向方案 ii**：它让 core 抽象更接近「审批」本质（DSH、Codex 各自的确认 UI 都只是 answerer），且避免跨 tool 调用的 grant 存活问题。此为**决策点 2**，未定稿前 A 阶段不动确认路径。

目标签名骨架：

```
approvalProvider = {
  request({ action, payload, reason }) → Promise<{ granted: boolean, deniedReason?: string }>
}
```

红线：`action` 是业务动作名（如 `jira-transition` / `svn-commit`），`payload` 是纯 JSON 业务参数（issueKey、transitionId、selectedPaths），`reason` 是人类可读的解释 —— 不含 DSH 的 `agent` / `callId` / `toolName`。DSH 实现在 `packages/dsh` 里把这些 DSH 符号组装成 `reason`，再调 core 的 `request`。

### 5.3 `sessionAuditProvider` — 会话审查数据源

core 的 `createSvnReviewManager` 已接受 `turnReader` / `sessionReader` 注入（§3.2），无需改契约签名，只需把返回形状中立化。B 阶段要做的是：去掉 `local:` 前缀、去掉 Codex turn 的 `items` / `fileChange` 专属结构，换成中性「会话审查」形状。

目标形状草案（精确字段在 F 阶段定稿）：

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

- Codex 实现：现有 `codex-session-reader` / `codex-runtime-gateway`，把 Codex 会话映射成中性形状。
- DSH 实现：`dshSessionAuditProvider`，把 `Session.events`（turn/start、tool 调用结果、touched files）映射成中性形状。
- 缺省：`createNullReviewAuditProvider`（现状，全返回空，SVN 审核降级人工）。

红线：中性形状里 `threadId` 不带 `local:` 前缀（剥离逻辑下放到 Codex 适配层）；`fileChanges` 的 path 是绝对路径（DSH 侧自行 resolve 相对路径）。

## 6. 关键差异与约束

### 6.1 schema 库

core 用 `zod/v4`（`import * as z from "zod/v4"`），DSH 用 `@deepseek-ai/schemastery`。工具面解耦（A 阶段）时须定死「schema 归属库」：建议 core 工具面继续用 zod（Codex 的 MCP 层零改动），DSH 适配层写一个 `zod → schemastery` 薄转换。避免两边各写一份 schema。

### 6.2 缺省实现的完整性

`bin/serve.mjs`（core 独立服务）不带任何宿主 provider 时：`secretStore` 用 DPAPI、`approvalProvider` 用本地令牌（`createActionConfirmationStore` 等价物）、`sessionAuditProvider` 用 `createNullReviewAuditProvider`。缺省不伪装可用 —— 审查降级人工、确认仍走一次性令牌、密钥仍 DPAPI。这正是「宿主无关」的验证基准：core 独立服务跑得起来，行为与今天一致。

## 7. 迁移里程碑（每步可独立验证、可独立提交）

1. **A（工具面解耦）**：把 19 个工具从 `McpServer.registerTool` 抽成 host-agnostic 结构（`名称 → { title, description, inputSchema, handler }`）；Codex 侧遍历回 MCP server。215 测试锁住行为零回归。**无新功能，纯重构。**
2. **B（secretStore 接口引入）**：`secretStore` 接口（`{ mode, credentialStorage, protect, unprotect }`），Codex 实现 = `dpapiSecretStore`（现状缺省），`createConfigStore` 兼容旧的裸 `protect`/`unprotect` 参数。approvalProvider（E）与 sessionAuditProvider 中立化（F）都推迟到各自 Consumer 落地的阶段，避免「改接口形状却没有第二个 Consumer 验证」。
3. **C（DSH 进程内 host）**：`packages/dsh` 写 function plugin，`inject` DSH 服务，`apply` 里组装 core，工具注册到 `ctx.tools`。验证点：工具名不再有 `mcp__jira-workbench__` 前缀，DSH 侧能列出 19 个工具。
4. **D（dshCredentialSecretStore）**：Token 走 `ctx.credentials`。
5. **E（approvalProvider + 单阶段化）**：core 确认路径单阶段化（决策 2 方案 ii），引入 `approvalProvider` 接口，Codex 侧把单阶段包装回两阶段，DSH 侧映射 `ctx.approval`。
6. **F（dshSessionAuditProvider）**：SVN 审查读 DSH Session，替代人工降级。

## 8. 已决策项

1. **token 共享数据文件**（§5.1）：token 存储模式是**部署级**配置 —— 同一份 `config.json` 必须始终用同一个 `secretStore` 实现，不允许 Codex（DPAPI）与 DSH（credential-ref）混写同一文件。DSH 如需独立数据目录，用 `JIRA_WORKBENCH_CONFIG_FILE` 覆盖到独立路径，而不是在同一文件里切换存储形态。
2. **approvalProvider 方案 ii**（§5.2）：core 的确认抽象单阶段化为 `request({ action, payload, reason }) → { granted, deniedReason? }`；Codex 侧在 MCP Apps UI 把单阶段再包装回两阶段（`issue` 一个 UI 确认，用户点了才真正 call）。此决策在 E 阶段落地。
3. **schema 归属库**（§6.1）：core 工具面继续用 `zod/v4`（Codex MCP 层零改动）；DSH 适配层写一个 `zod → schemastery` 薄转换，不双写 schema。
4. **工作台 UI（方向 C，未排入里程碑）**：先薄封装（Slot 里 iframe 加载 `task-board.html`，数据仍走 MCP 工具），后视需要 React 重写。依赖 1–3 落地后另行评估。
