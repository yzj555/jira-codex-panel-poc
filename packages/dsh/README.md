# jira-workbench-dsh

DeepSeek Harness 适配层：把宿主无关的 Jira/JXL/SVN 业务核（`@jira-workbench/core`）接入 DSH。

## 第一版（零代码 mcp-client 配置）

本包是一个 DSH profile bundle（manifest 声明 `dsh.bundle.patch: cordis.patch.yml`）。patch 挂载一个 `@deepseek-ai/dsh-mcp-client` 行，通过 `streamable-http` 连接到 core 独立服务。

### 接入步骤

1. 启动 core 独立服务（默认 `127.0.0.1:47823`）：

   ```sh
   node packages/core/bin/serve.mjs
   ```

   core 服务复用 `%LOCALAPPDATA%\jira-workbench\` 下的 Jira 配置与 SVN 状态文件，与 Codex 适配层共享同一套数据；若 Codex 适配层正在运行则需改用其他端口并设置 `JIRA_WORKBENCH_CORE_URL`。

2. 用 DSH 挂载本 bundle 启动会话。DSH 侧模型可调用的工具名为 `mcp__jira-workbench__<rawName>`。

### 工具面

core 独立服务暴露 19 个工具：8 个 Jira 只读/流转工具 + 11 个 SVN 审核工具。不暴露 Codex 会话绑定、桌面操作、自动 Bug 分析或 GitHub 更新（这些是 Codex 壳的宿主能力）。

SVN 审核使用空审查审计 provider 降级为人工审核：保留机械检查、一次性确认令牌与提交对账，无 Codex 审查 turn。

### 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `JIRA_WORKBENCH_CORE_URL` | `http://127.0.0.1:47823/mcp` | mcp-client 连接的 core 服务地址 |
| `JIRA_WORKBENCH_HOST` / `JIRA_WORKBENCH_PORT` | `127.0.0.1` / `47823` | core 独立服务绑定地址/端口 |

## 后续（第二版）

- 宿主内服务（`ctx.agents` / Slot UI）替代独立 HTTP 进程；
- 通过 `ctx.credentials` 注入 Jira Token，接入 DSH 的审批/确认栈；
- SVN 审查接入 DSH 的 agent-loop 作为真实审查 provider。
