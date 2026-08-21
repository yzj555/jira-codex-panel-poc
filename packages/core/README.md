# @jira-workbench/core

宿主无关的 Jira/JXL/SVN 业务核，由 Codex 适配层（`jira-workbench-codex`）与 DSH 适配层（`@jira-workbench/dsh`）共享。

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
- `lib/issue-workspace-store.mjs` / `issue-workspace-service.mjs` — Jira 与一个或多个项目目录的宿主无关绑定，不要求会话 ID
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

组装逻辑收敛在 `index.mjs` 的 `createCoreService`。`dataRoot` 由宿主注入：Codex 默认 `%LOCALAPPDATA%\jira-workbench\`，DSH 默认 `$DSH_HOME/jira-workbench/`。可用 `JIRA_WORKBENCH_CONFIG_FILE`、`JIRA_WORKBENCH_BINDINGS_FILE`、`JIRA_WORKBENCH_WORKSPACES_FILE` 等环境变量逐项覆盖。

独立服务暴露 22 个工具：Jira/JXL、独立项目目录绑定和 11 个 SVN 审核工具，不暴露宿主专属的会话列表、桌面操作、自动 Bug 分析或 GitHub 更新。DSH 正式适配不连接该独立服务，而是在 DSH 进程内调用 `createCoreService` 并注册 13 个只读工具；DSH approval 可用时再补齐 14 个写工具。

## 依赖注入约定

所有宿主能力都通过构造参数注入。Codex 注入 DPAPI、App Server、桌面导航和真实会话审查 reader；DSH 注入 credentials、approval、workspace registry、session query 和原生会话创建。审查审计使用 `createNullReviewAuditProvider()` 时，SVN 审核降级为人工审核；DSH 初版使用该安全降级。

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

### 会话与项目目录绑定

会话绑定和项目目录绑定是两个数据源：会话绑定属于宿主适配层；项目目录绑定属于 Core。一个 Jira 可绑定多个目录并指定默认范围，SVN 只依赖项目目录。旧会话记录中的 workspace 会一次性迁移或作为兼容读取源，解除会话不会删除项目目录绑定。

绑定保存使用 revision 并发校验，不依赖浏览器 `localStorage`；升级后只读取一次旧 `localStorage` 绑定并导入服务端，成功后立即删除旧值。每位 Windows 用户彼此独立。

### SVN 审核与提交

每个提交草稿固定关联一个 Jira Issue 和一个明确选择的 SVN 工作副本；Codex 审查启用时才额外关联审查会话。同一 Jira 可以多次提交；提交成功只保存一条 revision 历史，不会结束会话，也不会自动流转 Jira 状态。核心规则：

1. 候选集由绑定时的 dirty 基线、结构化文件改动和当前 SVN 状态生成；最终选择始终以人工判断为准。绑定前改动、未纳管文件、目录和冲突等阻断项不会进入初始勾选。
2. 只读检查 `svn info`、`svn status --xml` 与所选路径的 `svn diff`，覆盖冲突、缺失、阻塞、switched、混合版本、属性改动、未纳管文件、二进制差异及项目范围中的其他改动。
3. 生成不可变审核快照、规范提交信息和三份本地审核材料；`svn diff` 是改动事实的主证据。
4. 审查默认人工审核，宿主辅助审查需主动开启；审查仅提供建议，永远不会触发 commit。机械检查或宿主审查结果为"阻断"时不能提交。
5. 提交前勾选一次合并确认，重新校验 Jira 信息、本地状态、差异和远端更新状态；快照一致时才用 `svn` 命令对显式路径执行 commit。
6. 提交后读取 `svn log --xml` 核对 revision 与提交说明；自动核对失败时，可在人工查看 SVN 日志后登记实际 revision，不会再次执行 commit。

人工确认产生的一次性令牌只保存在内存中，有效期 90 秒，调用一次后立即作废；服务重启后必须重新人工确认。若 commit 退出状态、输出或服务重启导致结果不明确，记录进入"提交结果待核对"，禁止自动重试。

未纳管文件不会被自动 `svn add`；只接受具体文件路径，不处理冲突、switched/external 路径或合并多个工作副本。超过 50 MB 的单个文件会被阻断。审核记录原子写入 `svn-reviews.json`，服务重启后恢复未过期审核与提交历史。

### 自动 Bug 监控（当前由 Codex 适配层挂载）

自动分析开关默认关闭。开启后：当前待修复/处理中的 Bug 加入队列，后续新 Bug 被周期检测，串行创建分析并挂载附件、发送只读诊断消息；每个 Bug 在当前监控记录中只处理一次。分析结果可通过企业微信群机器人 Webhook 推送。关闭开关后不再创建新的自动分析任务。

后台调度器属于宿主生命周期能力，不是 Core 独立服务的默认组件。Codex 当前提供该调度器；DSH 初版不挂载，避免在 DSH 进程内引入第二套后台任务与更新生命周期。

### 配置

配置保存在宿主数据目录。缺省 Windows 独立服务使用 DPAPI；宿主也可注入 credential-reference secretStore。公开配置接口不会返回 Jira PAT 或企业微信 Webhook。数据同步只读取 Jira，请求重叠时跳过后续请求，失败保留上一次成功数据。

## 数据文件

| 内容 | 独立服务/Codex 默认位置（DSH 使用 `$DSH_HOME/jira-workbench` 下的同名文件） |
| --- | --- |
| 用户配置 | `%LOCALAPPDATA%\jira-workbench\config.json` |
| 会话绑定 | `%LOCALAPPDATA%\jira-workbench\issue-bindings.json` |
| 项目目录绑定 | `%LOCALAPPDATA%\jira-workbench\issue-workspaces.json` |
| Jira 附件缓存 | `%LOCALAPPDATA%\jira-workbench\attachments` |
| SVN 基线与审核状态 | `%LOCALAPPDATA%\jira-workbench\svn-baselines.json`、`svn-reviews.json` |
