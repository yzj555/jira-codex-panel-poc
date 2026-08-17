# @jira-codex/core

宿主无关的 Jira/JXL/SVN 业务核，由 Codex 适配层（`jira-codex-panel-codex`）与 DSH 适配层（`jira-codex-panel-dsh`）共享。

## 定位

业务核沉淀 Jira/JXL/SVN 的全部规则与状态，不 import 任何宿主的文件。宿主能力（App Server、会话读取、桌面操作、审查）全部通过构造参数注入；没有注入真实宿主能力时，相应能力会明确降级或缺失，不会伪装可用。

## 结构

- `config-store.mjs` / `jira-client.mjs` / `jxl-client.mjs` — 配置、Jira、JXL 客户端
- `lib/jira-workbench-service.mjs` — 任务工作台、JXL、附件和状态流转服务边界
- `lib/svn-workbench-service.mjs` — SVN 状态、差异、审核、确认和提交服务边界
- `lib/svn-review-manager.mjs` — SVN 审核状态机（机械检查、一次性确认、提交对账）
- `lib/task-board-loader.mjs` — 任务看板数据装配（查询、协同字段解析、Filter 校验、附件物化）
- `lib/action-confirmation-store.mjs` — 短时、一次性人工确认凭据
- `lib/issue-binding-store.mjs` — 会话绑定唯一存储，负责 revision 并发校验
- `lib/null-review-audit-provider.mjs` — 无宿主审查能力时的降级 reader
- `mcp/jira-task-board-mcp.mjs` — MCP 工具与 HTTP handler（依赖条件注册）

## 独立服务入口

`bin/serve.mjs` 组装一个只读 Jira 工作台 + SVN 人工审核的 MCP 服务（无任何宿主能力）：

```sh
node bin/serve.mjs        # 默认 127.0.0.1:47823
```

- `GET /api/health` — 健康检查
- `POST /mcp` — MCP 端点（streamable-http）
- `GET /mcp-app.html` — 工作台 UI 预览

组装逻辑收敛在 `index.mjs` 的 `createCoreService`。数据文件默认复用 `%LOCALAPPDATA%\jira-codex-panel-poc\`（与 Codex 适配层共享同一份数据），可用 `JIRA_CODEX_CONFIG_FILE` / `JIRA_CODEX_BINDINGS_FILE` 等环境变量覆盖。

独立服务暴露 19 个工具：8 个 Jira 只读/流转工具 + 11 个 SVN 审核工具，不暴露任何宿主专属能力（会话列表、桌面操作、自动 Bug 分析、GitHub 更新）。

## 依赖注入约定

所有宿主能力都通过构造参数注入。审查审计使用 `createNullReviewAuditProvider()` 时，SVN 审核降级为人工审核；Codex 适配层注入真实 `turnReader` / `sessionReader` / `runtime` 获得完整 Codex 审查。

## 核心业务能力

### Jira 工作台数据

- **待处理**：`CT仪表盘-需要我完成的事宜` 与 `CT-BUG-需要我修复的` 两个查询源，分别对应需求与 Bug。
- **处理历史**：已完成且负责人或协同处理人包含当前用户的 Issue。
- **JXL Sheets**：从 JXL Directory 读取当前用户有权限的 Sheet，兼容 gzip 与多分块数据，并按 JXL 用户/用户组访问规则过滤；只有 JQL 范围的 Sheet 可直接加载。

首页任务来源支持三种方式：内置通用 JQL、自定义 JQL、已有 Jira Filter。协同处理人字段优先从 Jira 字段元数据自动识别，识别不到时降级为仅按经办人查询。

### Issue 类型与状态分类

Issue 类型名称包含 `Bug`、`Defect`、`缺陷` 或 `故障` 时归为 Bug，其余归为需求。状态分组：

| 面板分组 | Jira 条件或状态 |
| --- | --- |
| 待处理 | 规划中、方案设计中、待宣讲、制作中、美术处理、待处理、待PO分转、待修复、搁置等未进入处理阶段的状态 |
| 处理中 | Jira `statusCategory=indeterminate` |
| 已完成 | Jira `statusCategory=done` |

无论哪个分组，都同时保留 Jira 原始状态。

### Issue 详情与父子单

当前分配给个人的子单是执行单，也是会话绑定、状态流转、SVN 提交和历史记录的唯一操作对象。父单与子单的描述和附件按来源分区展示，共同组成需求上下文；系统不用父单字段覆盖子单，也不静默继承父单版本。父单无权限或暂时不可读不会阻断子单处理，只保留父单标识并明确显示上下文缺口。

### 附件代理

附件内容由本地服务按附件 ID 代理，浏览器不会获得 Jira PAT，本地服务也不会向当前 Jira 地址以外的来源转发凭据。Office 等文档附件下载到本地附件缓存后复用，文本预览最多显示前 50 万字符。

### Jira 状态流转

状态流转不依赖面板内置状态枚举，而是实时读取 Jira 当前 transitions：

1. 读取 Jira 当前允许到达的目标状态。
2. 用户确认后签发短时一次性凭据。
3. 提交前重新读取一次 transitions，避免执行已经过期的流转。
4. 凭据一经使用立即失效；需要额外字段（如解决结果）的流转不在本地执行。

业务核没有修改摘要、描述、评论或附件的接口。

### 会话绑定

每个 Jira Issue 保存一个会话绑定。一个绑定可包含多个项目目录并指定一个主目录；主目录用于新建会话的初始工作目录，全部已选目录共同构成该任务允许使用的项目范围。旧版本只绑定一个项目的记录自动迁移成单项目范围。

绑定保存使用 revision 并发校验，不依赖浏览器 `localStorage`；升级后只读取一次旧 `localStorage` 绑定并导入服务端，成功后立即删除旧值。每位 Windows 用户彼此独立。

### SVN 审核与提交

每个提交草稿固定关联一个 Jira Issue、一个会话和一个 SVN 工作副本。同一 Jira 可以多次提交；提交成功只保存一条 revision 历史，不会结束会话，也不会自动流转 Jira 状态。核心规则：

1. 候选集由绑定时的 dirty 基线、结构化文件改动和当前 SVN 状态生成；最终选择始终以人工判断为准。绑定前改动、未纳管文件、目录和冲突等阻断项不会进入初始勾选。
2. 只读检查 `svn info`、`svn status --xml` 与所选路径的 `svn diff`，覆盖冲突、缺失、阻塞、switched、混合版本、属性改动、未纳管文件、二进制差异及项目范围中的其他改动。
3. 生成不可变审核快照、规范提交信息和三份本地审核材料；`svn diff` 是改动事实的主证据。
4. 审查默认人工审核，宿主辅助审查需主动开启；审查仅提供建议，永远不会触发 commit。机械检查或宿主审查结果为"阻断"时不能提交。
5. 提交前勾选一次合并确认，重新校验 Jira 信息、本地状态、差异和远端更新状态；快照一致时才用 `svn` 命令对显式路径执行 commit。
6. 提交后读取 `svn log --xml` 核对 revision 与提交说明；自动核对失败时，可在人工查看 SVN 日志后登记实际 revision，不会再次执行 commit。

人工确认产生的一次性令牌只保存在内存中，有效期 90 秒，调用一次后立即作废；服务重启后必须重新人工确认。若 commit 退出状态、输出或服务重启导致结果不明确，记录进入"提交结果待核对"，禁止自动重试。

未纳管文件不会被自动 `svn add`；只接受具体文件路径，不处理冲突、switched/external 路径或合并多个工作副本。超过 50 MB 的单个文件会被阻断。审核记录原子写入 `svn-reviews.json`，服务重启后恢复未过期审核与提交历史。

### 自动 Bug 监控

自动分析开关默认关闭。开启后：当前待修复/处理中的 Bug 加入队列，后续新 Bug 被周期检测，串行创建分析并挂载附件、发送只读诊断消息；每个 Bug 在当前监控记录中只处理一次。分析结果可通过企业微信群机器人 Webhook 推送。关闭开关后不再创建新的自动分析任务。

### 配置

配置保存在本地数据目录，Jira PAT 与企业微信 Webhook 使用 Windows DPAPI 加密，公开配置接口不会返回这两个密钥。数据同步（自动同步、返回时同步、Sheets 同步）只读取 Jira 数据，请求重叠时跳过后续请求，失败保留上一次成功数据。

## 数据文件

| 内容 | 默认位置 |
| --- | --- |
| 用户配置 | `%LOCALAPPDATA%\jira-codex-panel-poc\config.json` |
| 会话绑定 | `%LOCALAPPDATA%\jira-codex-panel-poc\issue-bindings.json` |
| Jira 附件缓存 | `%LOCALAPPDATA%\jira-codex-panel-poc\attachments` |
| SVN 基线与审核状态 | `%LOCALAPPDATA%\jira-codex-panel-poc\svn-baselines.json`、`svn-reviews.json` |
