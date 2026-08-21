# @jira-workbench/dsh

DeepSeek Harness（DSH）Host 适配层。它在 DSH 进程内组装 `@jira-workbench/core`，把 Jira/JXL/SVN 工具注册到 Cordis，并把 DSH 的 credentials、approval、项目目录、会话目录和会话创建能力注入业务核。它不启动第二个 Jira HTTP 业务进程，也不使用 `dsh-mcp-client` 转接工具。

> 当前 Jira Workbench 版本：`0.33.5`<br>
> 当前验证的 DSH 版本：`0.1.0-rc.7`<br>
> 详细安装、升级、卸载与故障排查：[INSTALL.md](INSTALL.md)

## 组成与职责

| 组件 | 职责 |
| --- | --- |
| `plugin.mjs` | 组装 Core，注册工具、设置、凭据、审批、工作台路由和会话关联接口 |
| `cordis.patch.yml` | 同时挂载 Host 插件和 `@jira-workbench/dsh-client` 浏览器插件 |
| `lib/dsh-credential-secret-store.mjs` | 把 Jira PAT 和企业微信 Webhook 保存为 DSH credentials 引用 |
| `lib/dsh-approval-provider.mjs` | 把 Jira 流转和 SVN 最终提交接入 DSH approval |
| `lib/dsh-conversation-service.mjs` | 读取 DSH 会话、创建分析会话、发送首条只读分析消息并完成绑定 |
| `lib/dsh-analysis-service.mjs` | 组合父子 Jira 上下文、附件、模板和项目 Skill |
| `@jira-workbench/dsh-client` | 插件设置卡片、侧边栏入口、中心任务工作区和会话 Jira 浮窗 |
| `$DSH_HOME/jira-workbench` | DSH 独立数据根；不与 Codex 的 `%LOCALAPPDATA%\jira-workbench` 混写 |

## 安装概览

普通用户只需完成以下三步，不需要下载或解压 Jira Workbench：

1. 确认 `dsh web` 和 `pnpm` 可以正常运行。
2. 在 PowerShell 运行下面这一段命令。
3. 启动后填写 Jira 地址和 PAT，从侧边栏打开“Jira 工作台”。

```powershell
dsh plugin --profile web add @jira-workbench/dsh
dsh web
```

安装完成后应同时看到：设置中的“Jira 工作台”、侧边栏入口，以及打开已关联会话后的 Jira 摘要入口。安装过程不需要手工安装另外两个包、编辑 profile、复制 bundle patch 或创建 junction。

`@jira-workbench/dsh` 通过精确版本依赖自动带上 `@jira-workbench/core` 和 `@jira-workbench/dsh-client`。源码开发、离线安装、升级、回滚、卸载及故障排查见 [INSTALL.md](INSTALL.md)。维护者的 npm 发版流程见 [PUBLISHING.md](PUBLISHING.md)。

> 从 DSH 源码运行时，请按 [INSTALL.md](INSTALL.md#从-dsh-源码运行) 使用 `pnpm dsh`；普通用户忽略该说明。

## 用户界面与配置入口

DSH Client 提供四个原生接入点：

1. “设置 → 插件 → Jira 工作台”只配置 Jira 根地址和 PAT 状态。
2. 侧边栏“Jira 工作台”打开中心主工作区，不嵌套第二层 DSH Modal。
3. 工作台内的“设置”负责需求/Bug 面板来源、消息模板与 DSH Skill。
4. 已关联会话在摘要栏右侧显示 Jira 入口，展开紧凑浮窗；任务详情和 SVN 审核进入中心主工作区。

工作台首页、Jira Sheets、处理历史、Issue 详情、附件、项目/会话关联和 SVN 页面都由 Host 提供同源数据。浏览器端不持有 Jira PAT，也不是绑定或审核状态的数据源。

## 能力与降级

Core 在 DSH 中提供 27 个工具：13 个只读工具和 14 个受审批写工具。

- 没有 `ctx.approval` 时严格 fail closed，只注册 13 个只读工具，不回退为自动许可。
- 项目目录直接读取 `ctx.workspaceRegistry`；一个 Jira 可绑定多个项目，并指定当前 SVN 主目录。
- 会话目录直接读取 `ctx.sessionQuery`；会话关联和项目目录绑定是两个独立数据源。
- “新建并绑定”通过 DSH Host `apiProxy` 创建正式会话，按所选项目解析 Skill，发送只读首条分析消息；消息被 Host 接受后才用 revision CAS 保存关联并跳转。
- 需求和 Bug 可分别使用内置 JQL、自定义 JQL 或 Jira Filter，并分别绑定首条消息模板和 DSH Skill。
- Skill 可用时以 Skill 中的工具、流程、证据和安全约束为准，模板只补充 Skill 未覆盖的 Jira 上下文；Skill 不可用时自动降级到模板。
- Jira 流转先经过 DSH approval，再签发一次性 grant；提交前会重新验证当前 transition。
- SVN 最终人工确认把文件清单、提交信息和风险确认送入 DSH approval；批准后才签发短时一次性提交令牌。
- DSH 初版没有会话语义审查 provider，因此 Codex 辅助审查降级为人工审核；机械检查、快照复检、显式路径提交和 SVN 日志对账保持有效。
- DSH 初版不挂载 Codex 专属的自动 Bug 后台调度器、GitHub 自动更新和桌面 CDP 能力。

## 凭据与数据

| 内容 | 默认位置或方式 |
| --- | --- |
| 数据根 | `$DSH_HOME/jira-workbench`；未设置 `DSH_HOME` 时为 `%USERPROFILE%\.dsh\jira-workbench` |
| Jira 公开配置 | `config.json`，只保存 credentials 引用，不保存 PAT 明文 |
| Jira PAT | DSH credentials 的 `JIRA_WORKBENCH_TOKEN` |
| 企业微信 Webhook | DSH credentials 的 `JIRA_WORKBENCH_WECOM_WEBHOOK` |
| 项目绑定 | `issue-workspaces.json`；Jira → 一个或多个 DSH 项目目录，不含会话 ID |
| 会话绑定 | `issue-bindings.json`；Jira → 一个 DSH 原生会话，与项目绑定分离 |
| 附件、SVN 状态 | 数据根下的附件缓存、SVN baseline 和审核记录 |

`JIRA_WORKBENCH_CONFIG_FILE` 只覆盖配置文件。其他文件可用 Core 支持的 `JIRA_WORKBENCH_*_FILE` 环境变量分别覆盖；同一数据文件不能在 DPAPI 密文和 DSH credential-reference 两种模式间混用。

## 开发与验证

修改 `packages/dsh-client/src/client/*` 后重新构建浏览器产物：

```powershell
npm run build --workspace @jira-workbench/dsh-client
```

仓库根运行完整验证：

```powershell
npm test
```

该命令覆盖 Core、Codex、DSH Host 的 Node 测试，并对 DSH Client 执行 TypeScript 检查与构建。提交前还应从干净 Release ZIP 按 [INSTALL.md](INSTALL.md#5-安装后验收) 完成一次 DSH Web 烟雾检查。

当前 provider 边界、工具注册和已知限制见 [DESIGN.md](DESIGN.md)。
