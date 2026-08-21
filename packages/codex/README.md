# jira-workbench-codex

Codex Desktop 适配层：把宿主无关的 `@jira-workbench/core` 接入 Windows Codex Desktop。适配方式是官方 Plugin + MCP Apps UI（承载 Jira/SVN 能力）+ CDP UI 注入（承载官方 Desktop API 尚不提供的侧栏入口、会话浮窗与桌面跳转），并附带 installer 与 skills。

## 适配方式

| 能力 | 承载方式 |
| --- | --- |
| Jira 待办、历史、Sheets、详情、状态流转 | 官方 Plugin + MCP Apps UI，共用 `jira-workbench-service` |
| 会话列表、读取、关联与解除 | 官方 MCP 工具 + `codex-conversation-service`，revision 并发校验 |
| SVN 状态、差异、审核、确认、提交 | 官方 MCP 工具 + `svn-workbench-service` |
| Skill、会话读取/命名、turn、中断、结构化审查结果 | 官方 App Server 协议 |
| 侧栏入口、会话浮窗、桌面跳转、当前窗口 App Server 适配 | 最小 CDP 注入层；公开协议暂无等价 Desktop API |

Plugin、MCP、本地服务、App Server Adapter 和最小 CDP 适配层都属于同一个"Jira 工作台"，统一生命周期入口负责安装、覆盖升级、修复、状态检查和卸载。

## 官方 Plugin 工作台

- Plugin 清单：`plugins/jira-workbench-assistant/.codex-plugin/plugin.json`。
- 本地 Marketplace：`.agents/plugins/marketplace.json`。
- MCP 地址：`http://127.0.0.1:47823/mcp`，使用 Streamable HTTP。
- 只读工具：任务首页/历史、Issue 详情、JXL Sheets、可用状态流转、App Server 会话列表、SVN 状态/差异/审核结果和提交回执核对。
- 本地写工具：会话关联、解除关联、创建/取消/确认/放弃审核草稿；不修改 Jira、Codex 对话正文或 SVN 工作副本。
- 外部写工具：执行 Jira 状态流转与 SVN commit；与只读工具分开声明权限、安全注解和人工确认边界。
- UI Resource：`ui://jira-workbench-assistant/workbench-v3.html`，使用 MCP Apps 的 `_meta.ui.resourceUri`、`ui/*` bridge、`tools/call`、私有组件状态和空外联 CSP。

这些工具复用本地服务已经保存的 Jira 地址、PAT、协同处理人字段、面板查询配置和服务端会话绑定；Plugin 本身不保存 Token。即使宿主不渲染 UI，工具仍返回结构化结果和简短回退说明。

官方工作台通过 `jira-workbench-service`、`codex-conversation-service` 和 `svn-workbench-service` 访问统一业务边界，不形成两套 Jira、绑定或 SVN 规则。注入层只保留四项官方 Desktop API 尚不能替代的能力：侧栏启动入口、当前会话轻量 Jira 浮窗、桌面会话跳转，以及当前窗口 App Server 命令适配。

## 页面说明

桌面任务工作台、官方 MCP Apps 工作台和会话右侧 Jira 浮窗都会跟随 Codex 的浅色/深色主题。设置默认在任务工作台内部打开；独立 `#settings` 页面只作为维护回退入口。

工作台顶部包含三个页面级页签：

| 页面 | 数据来源 | 主要用途 |
| --- | --- | --- |
| 待我处理 | `CT仪表盘-需要我完成的事宜` 和 `CT-BUG-需要我修复的` | 左侧显示需求，右侧显示 Bug；支持查看详情、状态流转、开始处理和自动分析新 Bug |
| Jira Sheets | 当前用户在 JXL Directory 中有权限查看的 Sheet | 选择真实 JXL Sheet，以表格查看、排序和筛选 Issue |
| 处理历史 | 已完成且负责人或协同处理人包含当前用户的 Issue | 分栏查看已完成的需求与 Bug |

页面顶部的全局搜索作用于当前页签，搜索范围包括 Issue Key、标题、状态、负责人和协同处理人。

### 待我处理

首页固定分为两栏（左侧需求、右侧 Bug）。任务卡片显示 Issue Key、标题、Jira 原始状态、优先级、负责人、附件数量和可用的父级 Issue Key。点击任务使用居中的详情窗口展示完整信息。两栏分别提供独立的多选状态筛选；筛选只改变当前面板展示，不修改 Jira 查询或任务状态。

### Jira Sheets

从 `/secure/JXLDirectory.jspa` 读取当前用户有权限的 Sheet，支持下拉切换、按 Jira 地址记住上次选择、表头排序与筛选、页面全局搜索叠加、"重置表头"清除列筛选与排序。长列表滚动时固定排序表头和筛选行。

### 处理历史

已完成的需求和 Bug 分成左右两栏，独立滚动区域。历史任务可查看描述、状态、人员和附件，但不能触发"开始处理"；如果 Jira 工作流提供"重新打开"等操作，仍可从详情执行状态流转。

## 会话浮窗

进入已绑定的 Codex 会话后，消息区右侧自动显示当前 Issue 的最小浮窗：固定在宿主层，展示 Issue 类型、Key、标题、原始状态和摘要，提供"在 Jira 中打开"、任务详情、状态流转和 SVN 审核入口。切换到未绑定会话、新对话或其他原生页面时自动移除；打开"Jira 任务"启动页时暂时隐藏，返回绑定会话后恢复。浮窗按 Issue Key 通过本机服务读取最新摘要，Jira PAT 不会进入 Codex 页面。

## 首条消息与分析 Skill

需求和 Bug 使用独立的精简模板，Jira 当前执行单及可用的父级需求上下文由程序按来源生成且只出现一次。每种模板可绑定一个额外 Codex Skill；所选 Skill 不存在或被禁用时自动降级到分析模板、内置 `jira-first-turn-analysis` 和已有 Jira/项目上下文。技能列表来自当前 Codex 已加载的 Skill。

## 安装、升级与卸载

### 安装

双击 `packages\codex\install.cmd`，或在 PowerShell 执行 `& .\packages\codex\installer\lifecycle.ps1 -Action Auto`。安装器会：

- 将运行文件复制到 `%LOCALAPPDATA%\Programs\JiraWorkbench`。
- 创建桌面和开始菜单"Codex"快捷方式，为 Codex 配置本机 CDP 端口和隔离用户目录。
- 检测并默认安装官方 npm Codex CLI，保存独立 App Server 命令路径；不会尝试直接执行 Store 包内部受保护的 `codex.exe`。
- 启动仅监听回环地址的面板服务和注入器。
- 默认不创建登录自启；写入 `install-state.json` 组件清单，并在 Windows"已安装的应用"中登记一个"Jira 工作台"。
- 创建开始菜单"维护 Jira 工作台"入口，统一提供修复、普通卸载和完全清除。

安装器默认执行一次 `npm install -g @openai/codex@latest`（已有独立 CLI 时不会重复安装）。该 CLI 只作为本地 App Server 控制面使用，不替换 Microsoft Store 桌面应用；缺少它会使会话、Skill、后台 turn 和审查等 App Server 能力不可用，但不会让本地 Jira 配置或只读服务丢失。不安装可传 `-InstallCodexCli:$false`。

### 升级

普通用户优先在"设置 → 版本更新"中下载正式 GitHub Release；下载校验通过后自动安装，安装验证完成后再由用户确认重启。也可以在新版本项目目录中重新运行 `packages\codex\install.cmd`。

修复当前安装：

~~~powershell
& "$env:LOCALAPPDATA\Programs\JiraWorkbench\packages\codex\installer\lifecycle.ps1" -Action Repair
~~~

### 卸载

从 Windows"已安装的应用"中的"Jira 工作台"卸载，或打开开始菜单"维护 Jira 工作台"。普通卸载删除所有程序组件、快捷方式和注册项，但保留 PAT、绑定与个人配置。彻底删除用户数据用 `-Action Purge`。卸载不会删除已创建的 Codex 对话，也不会卸载全局 `@openai/codex` CLI。

## 发布 GitHub Release

维护者先把版本改动合入 `main`，然后在本目录执行 `npm run version:set -- <版本>`，确认根 `package.json`、锁文件、各 workspace 包的 `package.json`、`server.mjs`、`inject/client.js` 和仓库根 README 已同步。仓库根 `npm test` 与本目录 `npm run release:verify -- v<版本>` 通过后，提交并推送 `main`，再创建并推送同名 tag。

tag 会触发 `.github/workflows/release.yml`：在 Windows runner 重跑全量测试、构建 DSH 浏览器端、为 Release 包刷新 Plugin cachebuster，再生成统一 ZIP / `update-manifest.json` / `SHA256SUMS.txt`，并为 ZIP 生成 artifact attestation。统一 ZIP 同时包含 Core、Codex、DSH Host 与 DSH 浏览器适配层；Codex 自动更新仍只安装自己的受管组件，DSH 用户按 [`packages/dsh/INSTALL.md`](../dsh/INSTALL.md) 把同一 ZIP 中的三个匹配包安装到目标 profile。流水线创建并直接发布 GitHub Release（若已存在同名 Draft Release 则上传资产并改为发布）；维护者应在发布后核对版本、变更说明、三个资产和 attestation。

## 开发运行

### 启动 / 停止

~~~powershell
cd packages\codex
powershell -ExecutionPolicy Bypass -File .\scripts\start-poc.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\stop-poc.ps1
~~~

开发模式使用本目录下的 `.cdp-profile`，不会复用安装版的 Codex 隔离目录。停止脚本只停止 Node 服务和注入器，不会关闭 Codex 窗口。

### 测试与探测

仓库根 `npm test` 覆盖 core 与 codex 两包测试。本目录的只读探测：

~~~powershell
npm run codex:probe          # 只读检测 App Server，不创建任务或发送消息
npm run codex:probe:http     # 验证 Runtime Adapter、本地 HTTP API、会话读取和 App Server 完整只读链路
npm run mcp:probe            # 探测 MCP 端点
npm run capture              # 截图 → packages/codex/artifacts/windows-codex-jira-panel-poc.png
~~~

开发验证 Plugin：

~~~powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" .\plugins\jira-workbench-assistant
codex plugin marketplace add .
codex plugin add jira-workbench-assistant@jira-workbench-local
~~~

安装或更新 Plugin 后，需要新建 Codex 对话，才能稳定加载新的工具与 UI 资源。

## 主要文件

| 文件或目录 | 职责 |
| --- | --- |
| `server.mjs` | 本地 Jira/SVN/MCP/桌面命令服务，仅监听 `127.0.0.1` |
| `injector.mjs` | 编译完整桌面工作台文档并安装最小 CDP UI 宿主 |
| `inject/client.js` | 侧栏工作台容器、会话浮窗、SVN MCP Apps 弹层、桌面跳转和当前窗口 App Server 命令适配 |
| `public/` | Codex 内的完整桌面任务工作台及面板内设置 |
| `skills/jira-first-turn-analysis/` | 首轮只读分析边界和输出要求 |
| `lib/codex-conversation-service.mjs` | App Server 会话发现、存在性验证和带 revision 的 Jira 绑定服务边界 |
| `lib/codex-navigation.mjs` | 当前 Codex Desktop 会话适配器与原生导航 |
| `lib/codex-app-server-client.mjs` | App Server JSON-RPC 客户端、npm CLI 自动发现、只读能力探测及降级状态 |
| `lib/codex-runtime-gateway.mjs` | 面向面板业务的稳定 Runtime 能力接口 |
| `lib/codex-application-commands.mjs` | Application Commands、浏览器 App Server Adapter、Runtime 能力选择 |
| Core `issue-binding-store.mjs` | 服务端会话绑定唯一存储，revision 并发校验和旧 `localStorage` 一次性迁移 |
| Core `issue-workspace-store.mjs` | 独立的 Jira→项目目录绑定；SVN 不再要求会话存在 |
| `lib/codex-session-reader.mjs` | 兼容读取迁移前的本地会话目录、文件操作证据和旧审核 turn |
| `lib/bug-monitor-service.mjs` | 服务端 Bug 发现、去重队列、App Server 分析调度和重启恢复 |
| `lib/automation-manager.mjs` | 自动分析任务状态、结果跟踪和企业微信推送 |
| `lib/github-update-checker.mjs`、`lib/update-manager.mjs` | GitHub Release 版本发现、受管下载、SHA-256 校验和持久更新状态机 |
| `installer/lifecycle.ps1` | 唯一生命周期入口：安装、覆盖升级、修复、状态检查、卸载和完全清除 |
| `installer/update-bootstrap.ps1`、`scripts/restart-codex-after-update.ps1` | 安装目录外运行的独立更新器与重启助手 |
| `installer/product-manifest.json` | Plugin、MCP、本地服务与最小桌面适配层共用的产品组件清单 |
| `installer/install.ps1`、`installer/uninstall.ps1` | 由统一入口调用的底层安装与清理执行器 |
| `scripts/build-release.ps1` | 可重复 Windows 发布包 |

## 常见问题

### 侧栏没有"Jira 任务"

确认使用安装器创建的"Codex"快捷方式，而不是 Microsoft Store 原始入口。可检查面板健康状态 `http://127.0.0.1:47823/api/health`、Codex CDP 状态 `http://127.0.0.1:47824/json/version`、启动日志 `%LOCALAPPDATA%\Programs\JiraWorkbench\packages\codex\.runtime`。

### 启动后出现两个 Codex

完全退出所有 Codex 窗口，只使用安装器创建的快捷方式；若任务栏固定的是商店版原入口，先取消固定。

### 点击 Jira 任务后没有打开工作台

先查看 `.runtime` 中的 `server.stderr.log` 和 `injector.stderr.log`，再通过维护助手核对 Plugin 和服务状态。注入器异常只影响 UI 入口、浮窗和桌面跳转，不会产生第二份任务或绑定数据。

### App Server 显示不可用

先执行 `npm run codex:probe`。若错误指向 `WindowsApps`、`EPERM` 或 `EACCES`，说明解析到了 Store 包内部受保护的程序；重新运行安装器，或手工执行 `npm install -g @openai/codex@latest`。

### 没有显示 JXL Sheet / 自动分析没有创建对话

JXL Sheet 需确认当前用户拥有对应项目和 Sheet 的访问权限，且 Sheet 使用 JQL 范围。自动分析需确认 Jira 配置连接正常、开关开启、Bug 位于当前列表、本地服务仍在运行、该 Bug 未进入监控记录或正在分析。
