# @jira-workbench/dsh-client

Jira Workbench 的 DeepSeek Harness 浏览器适配层。它不实现 Jira/SVN 规则，也不保存 PAT、绑定或审核状态；全部业务事实由 `@jira-workbench/dsh` Host 和 `@jira-workbench/core` 提供。

> 普通用户不要单独安装本包；请安装 `@jira-workbench/dsh`，它会带上严格同版本的 Client 与 Core。完整步骤见 [`packages/dsh/INSTALL.md`](../dsh/INSTALL.md)。

## 浏览器接入点

| DSH slot | 用户界面 | 行为 |
| --- | --- | --- |
| `settings.plugin.item` | “设置 → 插件 → Jira 工作台” | 只配置 Jira 根地址和 PAT 状态；Token 经 DSH credentials 写入，不进入 settings 值 |
| `sidebar.footer.action` | 侧边栏“Jira 工作台” | 打开或切回中心任务工作区 |
| `shell.overlay` | 中心任务工作区 | 承载任务首页、Jira Sheets、历史、Issue 详情、设置、关联管理和 SVN 审核 |
| `conversation.session.header.utilities` | 会话摘要栏右侧 Jira 入口 | 当前会话存在 Jira 关联时显示；从入口附近展开紧凑浮窗 |

插件设置卡片只保留连接必需项。需求/Bug 面板来源、首条消息模板和 DSH Skill 位于任务工作台自己的“设置”中，避免在较窄的 DSH 插件设置区重复承载完整配置。

## 状态与导航

- Client 通过 Host 的同源接口读取工作台数据和会话摘要，Jira PAT 不会下发浏览器。
- 主工作区覆盖 DSH 中心内容区并保留原生侧栏；打开已关联会话时使用 DSH 原生 `sessions.open()`，工作台随后关闭。
- 项目候选由 Host 从 DSH workspace registry 返回；会话候选来自 session query，Client 不从会话标题猜测项目。
- 会话 Jira 入口只在当前会话存在有效绑定时渲染。切换会话会取消旧请求并丢弃迟到结果。
- 浮窗展示当前 Issue、父级上下文和项目目录；任务详情与 SVN 审核切入中心工作区，浮窗不复制完整业务页面。
- 所有写操作携带服务端 revision；并发冲突会重新读取状态，不会用旧浏览器状态覆盖新绑定。

## 构建

浏览器代码位于 `src/client/*`，由 esbuild 打包成 DSH lazy-CJS 模块 `lib/client.js`：

```powershell
npm run typecheck --workspace @jira-workbench/dsh-client
npm run build --workspace @jira-workbench/dsh-client
```

GitHub Release 必须包含已经构建的 `lib/client.js`。修改 Client 后如果只重启 DSH 仍显示旧界面，先确认产物已重新构建，再关闭旧页面并使用 `Ctrl+F5` 加载。

## 兼容性与限制

- 当前验证的 DSH 版本为 `0.1.0-rc.7`，peer dependencies 也锁定该 RC 系列。
- DSH 的 client bundle 构建预设尚未作为独立 npm 包发布；`scripts/build-client.mjs` 复刻其 banner、footer、externals 与 CSS 注入格式。DSH 更改浏览器模块协议时，本包必须同步更新并重新构建。
- 任务内容由 Host 提供的同源页面承载，`shell.overlay` 只负责 DSH 原生布局和导航。Codex 专属能力会根据 Host 工具能力隐藏，不会显示不可执行入口。
