# jira-workbench-dsh

DeepSeek Harness 适配层：把宿主无关的 Jira/JXL/SVN 业务核（`@jira-workbench/core`）接入 DSH。

## 进程内 host 插件

本包是一个 DSH profile bundle（manifest 声明 `dsh.bundle.patch: cordis.patch.yml`），其 patch 挂载 `plugin.mjs` —— 一个纯 JS（ESM）的 Cordis function plugin（`name: jira-workbench`，`inject: ['tools']`）。插件把 core 的工具面（`buildToolDefinitions`）直接注册到 DSH 的 `ctx.tools`，**替代第一版的独立 HTTP 进程 + mcp-client**。

- 模型侧工具名就是 core 的原始工具名（`jira_list_my_tasks` 等），不再有 `mcp__jira-workbench__` 前缀。
- core 通过 ESM import 直接加载，不 import 任何 DSH 的 TypeScript 包；schema 转换用 `zod/v4` 的 `z.toJSONSchema`。

### 接入步骤

1. 把 `@jira-workbench/core` 与 `jira-workbench-dsh` 安装到 DSH 能解析的位置（`$DSH_HOME/profiles/<name>/node_modules`，或通过 `bareModuleBaseUrl` 锚定到本仓库的 `node_modules`）。

2. 用 DSH 挂载本 bundle 启动会话。DSH 侧模型可调用的 19 个工具为 8 个 Jira 只读/流转工具 + 11 个 SVN 审核工具。

### 工具面

core 独立服务暴露的 19 个工具：不暴露 Codex 会话绑定、桌面操作、自动 Bug 分析或 GitHub 更新（这些是 Codex 壳的宿主能力）。

SVN 审核使用空审查审计 provider 降级为人工审核：保留机械检查、一次性确认令牌与提交对账，无 DSH 审查 turn。

### 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `JIRA_WORKBENCH_CONFIG_FILE` | `%LOCALAPPDATA%\jira-workbench\config.json` | Jira 配置与 SVN 状态文件路径（与 Codex 适配层共享同一套数据） |

Token 存储模式是**部署级**配置：同一份 config.json 必须始终用同一个 secretStore 实现（见 [`DESIGN.md`](DESIGN.md) 决策 1）。

插件激活时若 DSH 进程提供了 `ctx.credentials`（DSH 的 credential-reference 能力），Token 与企业微信 Webhook 走 `dshCredentialSecretStore`：config.json 里只存引用名（`JIRA_WORKBENCH_TOKEN` / `JIRA_WORKBENCH_WECOM_WEBHOOK`），真值由 DSH 的 credentials provider 管理，每次操作 resolve（token 轮换下次操作生效）。若无 `ctx.credentials`，回退 core 的 DPAPI 缺省。

## 里程碑

| 里程碑 | 状态 |
|---|---|
| A 工具面从 MCP 解耦 | ✅ |
| B secretStore 接口 | ✅ |
| C 进程内 host 插件 | ✅ |
| D dshCredentialSecretStore（Token 走 `ctx.credentials`） | ✅ |
| E approvalProvider + 单阶段化（确认走 `ctx.approval`） | 待做 |
| F dshSessionAuditProvider（SVN 审查读 DSH Session） | 待做 |

核心契约（三个可注入 provider 的边界、红线与迁移顺序）见 [`DESIGN.md`](DESIGN.md)。
