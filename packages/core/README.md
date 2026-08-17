# @jira-codex/core

宿主无关的 Jira/JXL/SVN 业务核，由 Codex 壳（`jira-codex-panel-codex`）与 DSH 壳（`jira-codex-panel-dsh`）共享。

## 结构

- `config-store.mjs` / `jira-client.mjs` / `jxl-client.mjs` — 配置、Jira、JXL 客户端
- `lib/jira-workbench-service.mjs` / `lib/svn-workbench-service.mjs` — 任务工作台与 SVN 审核服务边界
- `lib/svn-review-manager.mjs` — SVN 审核状态机（机械检查、一次性确认、提交对账）
- `lib/task-board-loader.mjs` — 任务看板数据装配（查询、协同字段解析、Filter 校验、附件物化）
- `lib/null-review-audit-provider.mjs` — 无宿主审查能力的降级 reader
- `mcp/jira-task-board-mcp.mjs` — MCP 工具与 HTTP handler（依赖条件注册）

## 独立服务入口

`bin/serve.mjs` 组装一个只读 Jira 工作台 + SVN 人工审核的 MCP 服务（无 Codex 宿主能力）：

```sh
node bin/serve.mjs        # 默认 127.0.0.1:47823
```

- `GET /api/health` — 健康检查
- `POST /mcp` — MCP 端点（streamable-http）
- `GET /mcp-app.html` — 工作台 UI 预览

组装逻辑收敛在 `index.mjs` 的 `createCoreService`：数据文件默认复用 `%LOCALAPPDATA%\jira-codex-panel-poc\`（与 Codex 壳共享），可用 `JIRA_CODEX_CONFIG_FILE` / `JIRA_CODEX_BINDINGS_FILE` 等环境变量覆盖。

## 依赖注入约定

所有宿主能力（Codex App Server、会话读取、桌面操作）都通过构造参数注入，core 自身不 import 任何 Codex 壳文件。审查审计使用 `createNullReviewAuditProvider()` 时，SVN 审核降级为人工审核；Codex 壳注入真实 `turnReader`/`sessionReader`/`runtime` 获得完整 Codex 审查。
