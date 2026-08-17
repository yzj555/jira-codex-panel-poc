# Jira 工作台

> 当前版本：`0.32.0`<br>
> 运行环境：Windows Codex Desktop + Jira Data Center<br>
> 使用方式：个人本地运行，每位用户配置自己的 Jira PAT，数据和会话绑定彼此独立

Jira 工作台把 Jira 待办、JXL Sheets、Codex 对话和 SVN 提交连接到同一个本地工作台。它通过本机服务读取 Jira，并只在用户明确确认时提交状态流转或已审核的 SVN 改动，适合个人工作环境使用。

这不是部署在 Jira 服务器上的插件，而是一个"固定业务核 + 多宿主适配"的工具：Jira/JXL/SVN 的全部业务规则沉淀在宿主无关的 `@jira-workbench/core`，Codex 与 DeepSeek Harness 只是当前两个接入方式，各自以自己的原生扩展机制适配。

## 核心功能

- **Jira 工作台**：待我处理（需求/Bug 分栏）、处理历史、JXL Sheets 表格查看与筛选。
- **Issue 详情与附件**：父子单上下文、状态流转（实时 transitions + 一次性确认）、图片/PDF/Office 附件本地预览。
- **会话绑定**：Jira Issue 与 Codex 会话一对一关联，多项目范围 + revision 并发校验。
- **SVN 审核与提交**：人工选择显式路径、不可变快照、可选 Codex 审查、一次性确认令牌、提交后 log 对账。
- **自动 Bug 监控**：周期检测新 Bug、串行创建只读分析、可选企业微信推送。
- **本地配置**：Jira PAT 与企业微信 Webhook 用 Windows DPAPI 加密，不进入浏览器或日志。

详细的能力规则、数据模型与安全边界见各包 README（下方索引）。

## 总体架构

固定业务核 + 按宿主实现的适配层。业务核稳定不变，每个宿主以自己的方式接入，互不影响；新增宿主时只加一个新的适配包，不改动业务核。

| 包 | 目录 | 角色 | 适配方式 |
| --- | --- | --- | --- |
| `@jira-workbench/core` | [`packages/core/`](packages/core/README.md) | 固定业务核：Jira/JXL/SVN 全部规则与状态，宿主能力全部构造参数注入 | 独立 MCP 服务 + `createCoreService` 组装 |
| `jira-workbench-codex` | [`packages/codex/`](packages/codex/README.md) | Codex 适配层 | 官方 Plugin/MCP Apps UI + CDP UI 注入 + installer |
| `jira-workbench-dsh` | [`packages/dsh/`](packages/dsh/README.md) | DeepSeek Harness 适配层 | 插件 bundle（`dsh-mcp-client`） |

```mermaid
flowchart TB
    subgraph Core["packages/core — 宿主无关业务核"]
        Server["本地 Jira / SVN 服务<br/>127.0.0.1:47823"]
        Server --> Jira["Jira Data Center / JXL"]
        Server --> UserData["DPAPI 配置 / 附件缓存 / 自动任务状态"]
        Server -->|人工确认后显式路径提交| SVN["SVN 工作副本 / 仓库"]
        Server -->|可选| WeCom["企业微信群机器人"]
    end

    subgraph CodexShell["packages/codex — Codex 适配层"]
        Codex["Windows Codex Desktop"] --> Plugin["官方 Plugin + MCP Apps UI"]
        Plugin <-->|Streamable HTTP| Server
        Server <-->|JSON-RPC / stdio| AppServer["Codex App Server"]
        Injector["最小 UI 注入层"] <--> Codex
        Injector --> Sidebar["侧栏工作台 / 会话浮窗 / 桌面跳转"]
        Sidebar --> Commands["Application Commands"]
        Commands <-->|受限本机 API| Server
    end

    subgraph DSHShell["packages/dsh — DeepSeek Harness 适配层"]
        DSH["DeepSeek Harness<br/>dsh-mcp-client bundle"]
        DSH <-->|Streamable HTTP| Server
    end
```

适配层只负责"把核接到某个宿主"，不承载业务规则：

- **Codex** 用 UI 注入（侧栏工作台、会话浮窗）+ 官方 Plugin/MCP Apps 承载 Jira/SVN 能力。
- **DeepSeek Harness** 用插件方式（cordis bundle patch）挂载 MCP 客户端接入同一份核。
- **其他工具**按各自的原生扩展机制接入：有 MCP 能力的直接连独立服务入口，有插件体系的写对应适配包，业务核与数据文件保持不变。

当前仓库只有一个 npm workspace 根（单一版本号），下面放一个 core 包和若干适配包；新增宿主适配时在 `packages/` 下加包即可。

## 快速开始

### 环境要求

- Windows 版 Codex（Microsoft Store 包名 `OpenAI.Codex`）。
- Windows PowerShell 5 或更高版本。
- Node.js 22 或更高版本。
- npm（通常随 Node.js 安装）。
- SVN 命令行客户端 1.8 或更高版本，并已通过当前 Windows 用户的 SVN 凭据缓存取得目标仓库权限。
- TortoiseSVN 为可选项；未安装时仍可使用内置差异预览。
- Jira Data Center 地址及当前用户的 Personal Access Token（PAT）。

### 安装

双击 `packages\codex\install.cmd`，或在 PowerShell 中执行：

~~~powershell
git clone https://github.com/yzj555/jira-workbench.git
cd jira-workbench
& .\packages\codex\installer\lifecycle.ps1 -Action Auto
~~~

安装完成后从桌面或开始菜单打开安装器创建的"Codex"快捷方式，在左侧栏点击"Jira 任务"，首次使用时在面板内填写 Jira 地址和 PAT 后保存连接。

> 安装器创建的"Codex"快捷方式已包含面板需要的启动参数；Microsoft Store 原始入口无法被安全修改，从原始入口启动的普通 Codex 不会加载 Jira 面板。

详细的安装、升级、卸载与发布流程见 [`packages/codex/README.md`](packages/codex/README.md)。

## 本地数据与端口

| 内容 | 默认位置或地址 |
| --- | --- |
| 安装目录 | `%LOCALAPPDATA%\Programs\JiraWorkbench` |
| 用户数据目录 | `%LOCALAPPDATA%\jira-workbench\`（配置、绑定、附件缓存、SVN 状态） |
| 面板服务 | `http://127.0.0.1:47823` |
| Codex CDP | `http://127.0.0.1:47824` |

Jira PAT 和企业微信 Webhook 使用 Windows DPAPI 加密后保存，只能由写入它们的 Windows 用户解密。数据文件在 core 与各适配层之间共享，每位 Windows 用户彼此独立。

## 开发与测试

仓库根执行全量测试（覆盖 `packages/core` 与 `packages/codex` 两包）：

~~~powershell
npm test
~~~

core 独立服务（宿主无关，供 DSH 或其他 MCP 客户端接入）：

~~~powershell
node packages/core/bin/serve.mjs        # 默认 127.0.0.1:47823
~~~

各包的开发命令、探测与发布流程见各自 README。

## 各包文档

- [`packages/core/README.md`](packages/core/README.md) — 业务核的结构、独立服务、依赖注入约定与核心业务能力（Jira 工作台、状态流转、会话绑定、SVN 审核、自动 Bug 监控）。
- [`packages/codex/README.md`](packages/codex/README.md) — Codex 适配层：官方 Plugin 工作台、页面说明、会话浮窗、安装/升级/卸载、发布、开发运行与常见问题。
- [`packages/dsh/README.md`](packages/dsh/README.md) — DeepSeek Harness 适配层：mcp-client bundle 接入步骤、工具面与配置。

## 安全与已知限制

- Jira 写操作仅限用户二次确认的状态流转；没有修改摘要、描述、评论或附件的接口。
- SVN 是直接写入远端仓库的操作：只有审核未阻断、快照仍一致且用户人工勾选确认后才可执行；Codex 审查 turn 本身永远不会触发 commit。
- SVN commit 只接收审核快照中的显式相对路径，不会以整个工作副本 `.` 作为提交目标，也不会保存 SVN 凭据。
- 提交命令结束不等于成功：优先通过 SVN 日志唯一确认 revision，结果不明确时禁止自动重试。
- CDP 没有面向其他本机进程的身份认证，只应在可信设备上使用，不要将 `47823` 或 `47824` 转发到局域网或公网。
- 当前产品配置固定为 Jira Data Center，不提供 Jira Cloud 切换。
- 不要把 Jira PAT 或企业微信 Webhook 粘贴到聊天、日志或仓库中。
