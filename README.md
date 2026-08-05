# Jira Codex 任务面板

> 当前版本：`0.24.6`<br>
> 运行环境：Windows Codex Desktop + Jira Data Center<br>
> 使用方式：个人本地运行，每位用户配置自己的 Jira PAT，数据和会话绑定彼此独立

Jira Codex 任务面板把 Jira 待办、JXL Sheets 和 Codex 对话连接到同一个本地工作台。用户可以在 Codex 侧栏打开“Jira 任务”，查看与自己有关的需求和 Bug、阅读详情及附件，并把 Jira Issue 绑定到对应的 Codex 对话。

这不是部署在 Jira 服务器上的插件。它通过本机服务读取 Jira，并只在用户明确确认时提交状态流转或已审核的 SVN 改动；面板通过 CDP 注入 Windows Codex 客户端，适合个人工作环境使用。

## 快速开始

### 环境要求

- Windows 版 Codex（Microsoft Store 包名 `OpenAI.Codex`）。
- Windows PowerShell 5 或更高版本。
- Node.js 22 或更高版本。
- SVN 命令行客户端 1.8 或更高版本，并已通过当前 Windows 用户的 SVN 凭据缓存取得目标仓库权限。
- TortoiseSVN 为可选项；安装后可以从文件树双击打开原生差异窗口，未安装时仍可使用内置差异预览。
- Jira Data Center 地址及当前用户的 Personal Access Token（PAT）。
- Jira 用户需要浏览项目权限；执行状态流转还需要对应项目的 `Transition Issues` 权限。

### 安装

双击项目根目录的 `install.cmd`，或在 PowerShell 中执行：

~~~powershell
git clone https://github.com/yzj555/jira-codex-panel-poc.git
cd jira-codex-panel-poc
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1
~~~

安装完成后：

1. 从桌面或开始菜单打开安装器创建的“Codex”快捷方式。
2. 在 Codex 左侧栏点击“Jira 任务”。
3. 首次打开时填写 Jira 地址和 PAT。
4. 点击“保存并连接”，开始读取当前用户的 Jira 任务。

> 安装器创建的“Codex”快捷方式已经包含面板需要的启动参数。Microsoft Store 原始入口无法被安全修改；从原始入口启动的普通 Codex 不会加载 Jira 面板。

## 页面说明

### 主题适配

完整 Jira 面板和会话右侧 Jira 浮窗都会实时跟随 Codex 的浅色/深色主题。主题切换时无需刷新面板或重启 Codex；面板会复用 Codex 当前的背景、文字、边框、强调色和状态色。仅在浏览器中单独打开本地面板时，才会按系统主题作为回退。

工作台顶部包含三个页面级页签。

| 页面 | 数据来源 | 主要用途 |
| --- | --- | --- |
| 待我处理 | `CT仪表盘-需要我完成的事宜` 和 `CT-BUG-需要我修复的` | 左侧显示需求，右侧显示 Bug；支持查看详情、状态流转、开始处理和自动分析新 Bug |
| Jira Sheets | 当前用户在 JXL Directory 中有权限查看的 Sheet | 选择真实 JXL Sheet，以表格查看、排序和筛选 Issue |
| 处理历史 | 已完成且负责人或协同处理人包含当前用户的 Issue | 分栏查看已完成的需求与 Bug |

页面顶部的全局搜索作用于当前页签，搜索范围包括 Issue Key、标题、状态、负责人和协同处理人。

### 待我处理

首页固定分为两栏：

- 左侧：`CT仪表盘-需要我完成的事宜`。
- 右侧：`CT-BUG-需要我修复的`。

任务卡片会显示 Issue Key、标题、Jira 原始状态、优先级、负责人和附件数量。点击任务后使用居中的详情窗口展示完整信息，不会挤压 Codex 侧边区域。

待处理和处理中的任务都可以进入 Codex 对话；已完成任务只允许查看。

### Jira Sheets

Jira Sheets 从以下 JXL Directory 读取当前用户有权限访问的 Sheet：

`/secure/JXLDirectory.jspa`

功能包括：

- 从下拉框切换 Sheet。
- 按 Jira 地址记住上次选择的 Sheet，下次打开自动恢复。
- 展示 Issue、类型、标题、状态、优先级、负责人、协同处理人、附件和更新时间。
- 点击表头循环切换“升序 → 降序 → Jira 原顺序”。
- 在每列表头下独立筛选；类型、状态和附件使用下拉选择，其余列使用文本匹配。
- 表头筛选可以和页面全局搜索叠加。
- 使用“重置表头”一次清除列筛选和排序。
- 长列表滚动时固定排序表头和筛选行。

面板会读取 JXL 的项目属性，兼容 gzip 和多分块数据，并按照 JXL 的用户、用户组访问规则过滤 Sheet。当前只有 JQL 范围的 Sheet 可以直接加载；其他范围仍可通过“在 JXL 中打开”进入原页面。

所有排序和表头筛选都作用于当前已经加载的 Sheet 记录，不会修改 Sheet 或 Jira。

### 处理历史

处理历史把已完成的需求和 Bug 分成左右两栏，两栏拥有独立滚动区域。历史任务可以查看描述、状态、人员和附件，但不能再触发“开始处理”；如果 Jira 工作流向当前用户提供“重新打开”等操作，仍可从详情中执行状态流转。

## Issue 详情与附件

Issue 详情包括：

- Jira 原始状态、类型、优先级和项目。
- 当前用户在 Jira 工作流中可执行的状态流转。
- 完整描述、负责人、协同处理人和标签。
- 更新时间和 Jira 原页面入口。
- 附件名称、大小、作者、时间和缩略图。
- 当前绑定的 Codex 对话及重新绑定入口。

图片、PDF、文本、音频和视频可以在面板内只读预览，也可以下载原文件；其他格式直接下载。文本预览最多显示前 50 万字符。

附件内容由本地服务根据附件 ID 代理。浏览器不会获得 Jira PAT，本地服务也不会向当前 Jira 地址以外的来源转发凭据。

### 状态流转

打开 Issue 详情后，右侧“状态流转”会实时读取 Jira 当前返回的 transitions，不依赖面板内置状态枚举：

1. 选择 Jira 当前允许到达的目标状态。
2. 面板显示当前状态、目标状态和工作流操作，并要求二次确认。
3. 本地服务在提交前重新读取一次 transitions，避免执行已经过期的流转。
4. Jira 接受流转后，面板关闭详情并刷新当前任务页。

如果流转要求填写解决结果等额外字段，面板会禁用该选项并提示在 Jira 原页面完成，避免提交不完整数据。面板没有修改摘要、描述、评论或附件的接口。

## Jira Issue 与 Codex 对话

每个 Jira Issue 可以保存一个 Codex 会话绑定。

### 未绑定的任务

点击“开始处理”后，面板会：

1. 根据设置创建普通 Codex 对话，或创建到指定 Codex 项目下。
2. 从 Jira 下载当前 Issue 的原始附件。
3. 将附件通过 Codex 原生文件输入真实挂载到新对话。
4. 自动发送包含完整 Jira 上下文的首条分析消息。
5. 获取新会话 ID，并保存 Issue 与会话的绑定。Codex 侧栏若短暂返回 `client-new-thread` 临时 ID，面板会通过原生窗口摘要解析正式会话 UUID 后再登记自动分析和 SVN 基线；已有临时绑定在打开对应会话时也会自动修复。

如果任一附件没有成功挂载，首条消息不会发送，避免对话在缺少附件的情况下开始分析。

### 已绑定的任务

点击“打开已绑定的 Codex 对话”时：

- 如果目标会话已经显示在侧栏，直接点击对应会话。
- 如果目标会话不在当前侧栏，通过 Codex 原生任务导航按会话 ID 打开。
- 不会再次发送首条消息。

### 会话右侧 Jira 浮窗

进入已绑定的 Codex 会话后，消息区右侧会自动显示当前 Issue 的轻量浮窗：

- 浮窗固定在宿主层，不改变或挤压 Codex 消息区宽度。
- 展示 Jira 原始状态、标题、负责人、优先级、项目、描述、协同处理人和附件入口。
- 可刷新详情、打开 Jira 原页面，并执行当前用户可用且不要求额外字段的状态流转。
- 可进入独立的 SVN 审核窗口；审核窗口是居中宽屏界面，不占用浮窗的信息展示宽度。
- 可收起为 Issue Key 状态胶囊；同一 Codex 运行周期内再次进入该会话时保持收起状态。
- 切换到未绑定会话、新对话或其他原生页面时会自动移除，不会残留上一张单子。
- 打开完整“Jira 任务”工作台时暂时隐藏，返回绑定会话后恢复。

浮窗按 Issue Key 直接读取 Jira 最新详情，不依赖该任务是否仍存在于当前看板筛选结果中。附件入口仍通过本机代理读取，Jira PAT 不会进入 Codex 页面。

### SVN 审核与提交

在绑定会话的右侧浮窗中点击“审核并提交 SVN”。本地服务会从该 Codex 会话日志读取真实项目目录，再定位其 SVN 工作副本；不需要额外维护项目路径映射。状态扫描默认限定在当前 Codex 项目目录，即使多个项目共用同一个 SVN 工作副本，也不会把其他项目的改动混入选择界面。

文件选择区按“可提交 / 未纳管 / 阻断项 / 全部”分类，以目录树展示；目录复选框支持半选。单击文件名会在右侧按需读取该文件的 SVN 差异，不会在首次打开时批量加载全部 diff。

每个提交草稿固定关联一个 Jira Issue、一个 Codex 会话和一个 SVN 工作副本。同一 Jira 可以创建任意多次提交；提交成功只保存一条 revision 历史，不会结束会话，也不会自动流转 Jira 状态。

1. 系统结合任务绑定时的 dirty 基线和当前 Codex 会话成功修改过的文件，生成本次需求候选集。会话直接修改的文件为高置信推荐，绑定后出现但没有直接会话证据的文件为普通推荐；推荐文件会作为初始勾选。
2. 用户在文件树中人工增删候选，最终选择始终以人工判断为准。绑定前改动、未纳管文件、目录和冲突等阻断项不会进入初始勾选。如果选定文件也被其他 Jira 的未完成草稿引用，界面会显示关联单号，提交前必须人工确认混入风险。
3. 本地服务读取 `svn info`、`svn status --xml` 和所选路径的 `svn diff`，检查冲突、缺失、阻塞、switched、混合版本、属性改动、未纳管文件、二进制差异及项目范围中的其他改动。内置差异用颜色区分新增、删除、区块和元数据；双击文件或点击按钮可以调用 TortoiseSVN 查看，但 TortoiseSVN 不参与提交。
4. 系统生成不可变审核快照、规范提交信息和三份本地审核材料：原任务需求上下文、SVN 原生 diff、审核清单。`svn diff` 是本次改动事实的主证据；原任务对话与该 Jira 的历史 revision 只提供需求、调用链和历史行为上下文。
5. 文件选择区顶部的“本次提交方式”默认选中“人工审核”，Codex 辅助审查需要用户主动选择。选择后，面板把三份审核材料作为原生文件附件，通过 Codex 当前会话启动一个真实审查 turn；不会创建独立任务，也不会操作或清空输入框。该审查可能耗时较长，必须等待审查完成，或主动取消并降级为人工审核，之后才能继续提交。若会话正忙会立即失败，不会排队抢占正在执行的工作。
6. 审查启动后，Jira 浮窗显示“挂起 · Codex 检查中”。本地服务按 `reviewId + snapshotHash + turnId` 跟踪当前会话日志；用户可以等待结果，也可以随时中断 turn 并降级为人工审核。投递失败、执行失败和超时都提供相同的人工降级入口，晚到结果不会覆盖取消后的人工状态。
7. Codex 按证据重新拆解需求覆盖，检查实现完整性和准确性、逐文件改动、调用方与被调用方、接口/事件/数据/配置/性能影响、历史 revision、工程合规性、潜在回归和测试证据，并明确列出无法核实的范围。审查仅提供建议，不会自动提交。
8. 关闭或取消 Codex 审查后，用户基于不可变快照、完整差异和机械检查自行审核需求符合性与影响风险。机械检查或 Codex 结果为“阻断”时不能提交；“有警告”需要额外确认理解风险。
9. 真正提交前必须人工勾选已完成审核；系统已从当前 Jira 上下文确定单号，不再要求手工重复输入 Issue Key。
10. 本地服务重新校验 Jira 信息、本地状态、差异和远端更新状态；快照一致时才用 `svn` 命令对显式路径执行 commit。提交结束后还会读取 `svn log --xml`，只有找到唯一匹配的 revision 才显示成功回执。

当前会话的 Codex 审查 turn 默认只能读取审核材料与项目代码。材料不可读时允许降级使用只读代码检索，以及 `svn info`、`svn status`、`svn diff`、`svn cat`；禁止一切 SVN 写操作和文件修改。无法取得稳定差异或完整上下文时必须阻断，不能猜测通过。

任何文件内容、SVN 属性、选择路径、提交说明、审核模式、Jira 标题/描述/修复版本或仓库状态发生变化，原审核都会失效。所选文件还会记录 SHA-256 内容指纹，因此二进制文件即使 `svn diff` 只返回通用提示也能被复检。

审核记录会原子写入当前用户数据目录的 `svn-reviews.json`。服务或 Codex 重启后会恢复未过期的审核、当前会话 ID、Turn ID、完成结果和已提交历史，并继续轮询运行中的审查；旧材料只会在原绑定会话中按 `reviewId + snapshotHash` 补关联。人工确认产生的一次性令牌只保存在内存中，有效期 90 秒，调用一次后立即作废；服务重启后必须重新人工确认。若 `svn commit` 的命令退出状态、输出或服务重启导致结果不明确，记录会进入“提交结果待核对”，禁止自动重试；用户可以重新读取 SVN 日志确认，或在人工核对仓库后放弃该草稿。

已取消、已完成、人工审核、失败、超时、阻断或失效的草稿都提供“返回文件选择并重新扫描”。该操作会明确废弃当前面板草稿并重新读取工作副本，不会撤销或修改 Jira、SVN 中已经提交的内容；因此关闭再打开面板时也不会重新恢复旧草稿。已成功提交的记录则通过“新建下一次提交”进入同样的最新状态扫描。

新建任务会话完成绑定时，面板还会记录一次只读 SVN 基线。绑定前已经处于 dirty 状态的路径会标记为“绑定前”，不能纳入自动提交流程；如果同一文件在绑定前后都有改动，由于无法可靠拆分归属，同样会阻断。升级前已经存在的旧会话绑定没有历史基线，界面会明确提示，必须由用户只选择已人工确认属于当前 Jira 的改动。

提交信息由 Jira 数据自动生成，前三或四行只读：

~~~text
修复的版本：DevelopV4
http://ctjira1.lmdgame.com:8080/browse/CT-13349
足球小将
CT-13349 【系统】优化3.0-护具-护具优化
--完成护具升级材料筛选及金币返还逻辑调整
~~~

“修复的版本”只在 Jira 实际返回 `fixVersions` 时出现；最后一行说明可选，但填写后固定以 `--` 开头。提交使用 UTF-8 临时消息文件和当前 Windows 用户已有的 SVN 认证缓存，本项目不保存 SVN 用户名或密码。提交成功后会显示 SVN revision、仓库地址、显式路径、提交信息和审核 ID；不会自动流转 Jira 状态。

未纳管文件不会被自动执行 `svn add`。为避免目录递归带入未审核内容，当前版本只接受具体文件路径，也不会替用户解决冲突、更新工作副本、处理 switched/external 路径或合并多个工作副本；这些情况需要先人工处理，再重新生成审核。超过 50 MB 的单个文件会被阻断，需要拆分或在面板外人工处理。

### 重新绑定

绑定错误时可以选择：

- **绑定已有会话**：替换会话 ID 并直接跳转，不发送消息。
- **新建会话**：创建新会话、挂载附件、发送首条分析消息，并在成功后覆盖旧绑定。

### 首条消息的固定约束

首条消息只允许理解、取证和分析，不允许直接修改代码或执行任务。固定约束不能通过自定义消息模板删除，主要规则包括：

- 禁止修改代码、配置、文件、数据库或 Jira 数据。
- 禁止实现、修复、提交、构建和部署。
- Jira 描述与附件已经随消息提供，禁止再次打开 Jira、JXL 或任务链接。
- 信息不足时只列出缺失项并等待补充。

Bug 会额外要求优先使用 `ct-devops-tracer` 技能，以 MCP-first、只读取证的方式诊断。技能不存在时，才降级到设置中绑定的 Codex 项目进行只读分析；未绑定项目时仅根据当前上下文分析，不允许猜测。

## 自动分析新 Bug

“待我处理”页面提供“自动分析新 Bug”开关，默认关闭。

开启后：

1. 当前待修复或处理中的 Bug 会加入队列。
2. 后续进入列表的新 Bug 会被周期检测。
3. 系统串行创建 Codex 新对话、挂载附件并发送只读诊断消息。
4. 每个 Bug 在当前监控记录中只处理一次。
5. 本地服务从 Codex 会话日志读取真实 `task_complete` 事件和最终分析文本。
6. 如果配置了企业微信群机器人 Webhook，则将结果推送到群；未配置时跳过推送。

关闭 Jira 面板或切换到其他 Codex 页面不会停止已经启用的监控。关闭开关后不再创建新的自动分析任务。

## Jira 配置

点击面板右上角齿轮可以打开设置。

| 配置项 | 说明 |
| --- | --- |
| 部署类型 | 固定为 Jira Data Center，不可修改 |
| 默认 Codex 项目 | 可选；新建任务对话时归入该项目，留空则创建普通对话 |
| Jira 地址 | 例如 `http://jira.company.com:8080`，不要包含账号、查询参数或锚点 |
| Personal Access Token | 必填；使用当前 Jira 用户的 PAT |
| 企业微信机器人 Webhook | 可选；只接受 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...` |
| JQL | 默认使用 CT 仪表盘与已完成任务规则，也可以填写自定义 JQL |
| 首条消息模板 | 控制 Jira 上下文的展示方式，不能覆盖固定的只读约束 |
| 每个分区最大任务数 | 1～200，默认 100 |

消息模板支持以下变量：

`{{key}}`、`{{title}}`、`{{url}}`、`{{status}}`、`{{type}}`、`{{assignee}}`、`{{collaborators}}`、`{{description}}`、`{{attachments}}`

保存配置时会先连接 Jira 验证 PAT 和查询是否可用。

### 默认任务查询

默认活动任务：

~~~jql
(filter = 10103 OR filter = 10102) ORDER BY updated DESC
~~~

- `10103`：`CT仪表盘-需要我完成的事宜`。
- `10102`：`CT-BUG-需要我修复的`。

默认历史任务：

~~~jql
project = CT
AND statusCategory = Done
AND (assignee = currentUser() OR "协同处理人" = currentUser())
ORDER BY updated DESC
~~~

使用默认查询时，服务分别加载活动分区和历史分区，避免活动任务数量较多时挤掉历史任务。改成自定义 JQL 后，面板按照自定义结果进行分类展示。

### 类型与状态分类

Issue 类型名称包含 `Bug`、`Defect`、`缺陷` 或 `故障` 时归为 Bug，其余归为需求。

状态显示遵循以下规则：

| 面板分组 | Jira 条件或状态 |
| --- | --- |
| 待处理 | 规划中、方案设计中、待宣讲、制作中、美术处理、待处理、待PO分转、待修复、搁置，以及其他未进入处理阶段的状态 |
| 处理中 | Jira `statusCategory=indeterminate`，包括程序处理、处理中及后续测试、验收阶段 |
| 已完成 | Jira `statusCategory=done` |

无论属于哪个面板分组，卡片和详情都会同时显示 Jira 原始状态。

## 安装、升级与卸载

### 安装器会做什么

- 将运行文件复制到 `%LOCALAPPDATA%\Programs\JiraCodexPanel`。
- 创建桌面和开始菜单“Codex”快捷方式。
- 为 Codex 配置本机 CDP 端口和隔离用户目录。
- 启动仅监听回环地址的面板服务和注入器。
- 默认不创建登录自启，避免和 Microsoft Store 原入口同时打开两个实例。
- 升级时保留 Jira PAT、企业微信 Webhook、会话绑定和个人设置。

如果普通 Codex 已经运行，启动器会询问是否正常关闭并重新启动；不会强制结束 Codex。正在执行的 Codex 任务可能因重启中断，请在确认前保存当前工作。

### 升级

在新版本项目目录中重新运行 `install.cmd` 或安装命令即可。安装器会停止旧的本地服务、覆盖程序文件并保留当前用户数据。

### 可选：登录自启

~~~powershell
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1 `
  -StartAtLogon:$true
~~~

不建议同时使用登录自启和 Microsoft Store 原始 Codex 入口。

### 卸载

开始菜单中提供“卸载 Jira Codex 任务面板”。默认只删除程序和快捷方式，保留 PAT、绑定与个人配置。

彻底删除用户数据：

~~~powershell
powershell -ExecutionPolicy Bypass -File `
  "$env:LOCALAPPDATA\Programs\JiraCodexPanel\installer\uninstall.ps1" `
  -PurgeUserData
~~~

卸载不会删除已经创建的 Codex 对话。

## 本地数据与端口

| 内容 | 默认位置或地址 |
| --- | --- |
| 安装目录 | `%LOCALAPPDATA%\Programs\JiraCodexPanel` |
| 用户配置 | `%LOCALAPPDATA%\jira-codex-panel-poc\config.json` |
| 隔离 Codex 数据 | `%LOCALAPPDATA%\jira-codex-panel-poc\codex-profile` |
| Jira 附件缓存 | `%LOCALAPPDATA%\jira-codex-panel-poc\attachments` |
| SVN 基线与审核状态 | `%LOCALAPPDATA%\jira-codex-panel-poc\svn-baselines.json`、`svn-reviews.json` |
| SVN 审核材料 | `%LOCALAPPDATA%\jira-codex-panel-poc\attachments\svn-reviews` |
| 运行日志与 PID | `%LOCALAPPDATA%\Programs\JiraCodexPanel\.runtime` |
| 面板服务 | `http://127.0.0.1:47823` |
| Codex CDP | `http://127.0.0.1:47824` |

Jira PAT 和企业微信 Webhook 使用 Windows DPAPI 加密后保存，只能由写入它们的 Windows 用户解密。公开配置接口不会返回这两个密钥。

会话绑定保存在隔离 Codex 配置的本地存储中。每位 Windows 用户和每个隔离配置目录相互独立。

## 开发运行

### 启动

~~~powershell
cd jira-codex-panel-poc
powershell -ExecutionPolicy Bypass -File .\scripts\start-poc.ps1
~~~

开发模式使用项目目录下的 `.cdp-profile`，不会复用安装版的 Codex 隔离目录。

### 停止

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-poc.ps1
~~~

停止脚本只停止 Node 服务和注入器，不会关闭 Codex 窗口。

### 测试

~~~powershell
npm test
~~~

测试覆盖 Jira 认证与字段映射、单 Issue 详情、任务分类、Sheets 排序筛选、JXL 权限、附件缓存、内嵌文档、会话浮窗注入、会话导航、配置加密、自动分析结果推送，以及 SVN 状态解析、审核快照、人工确认和显式路径提交。

### 截图

在 Codex 已通过 CDP 启动后执行：

~~~powershell
npm run capture
~~~

截图会写入 `artifacts/windows-codex-jira-panel-poc.png`。

## 架构

~~~mermaid
flowchart LR
    Shortcut["安装器创建的 Codex 快捷方式"] --> Codex["Windows Codex Desktop<br/>CDP :47824"]
    Injector["injector.mjs"] <--> Codex
    Injector --> Panel["Codex 内嵌 Jira 面板<br/>srcdoc"]
    Injector --> Float["对话右侧 Jira 浮窗"]
    Panel <-->|受限请求桥接| Injector
    Float <-->|受限请求桥接| Injector
    Injector <-->|127.0.0.1| Server["本地服务<br/>server.mjs :47823"]
    Server --> Jira["Jira Data Center / JXL"]
    Server --> UserData["DPAPI 配置<br/>附件缓存 / 自动任务状态"]
    Server --> Sessions["Codex 本地会话日志"]
    Server -->|人工确认后显式路径提交| SVN["SVN 工作副本 / 仓库"]
    Server -->|可选| WeCom["企业微信群机器人"]
~~~

Codex 的内容安全策略不允许主页面直接加载本机 HTTP iframe，因此安装版会把 HTML、CSS 和脚本组装成 `srcdoc` 内嵌文档。面板请求经注入器使用每次启动生成的临时令牌桥接到本地服务。

主要文件：

| 文件或目录 | 职责 |
| --- | --- |
| `server.mjs` | 本地静态页面和 API，仅监听 `127.0.0.1` |
| `config-store.mjs` | 配置校验和 Windows DPAPI 密钥存储 |
| `jira-client.mjs` | Jira REST 请求、单 Issue 详情、Issue 字段和状态映射 |
| `jxl-client.mjs` | JXL Directory、分块数据及访问权限解析 |
| `injector.mjs` | CDP 注入、内嵌文档组装和受限请求桥接 |
| `inject/client.js` | Codex 侧栏入口、页面切换、会话绑定、右侧 Jira 浮窗、SVN 审核界面、附件挂载和自动 Bug 监控 |
| `public/` | Jira 工作台界面、详情、Sheets 和消息模板 |
| `lib/codex-navigation.mjs` | 按会话 ID 调用 Codex 原生导航，并读取、启动或中断当前会话 turn |
| `lib/codex-session-reader.mjs` | 从 Codex 会话日志读取项目目录、任务完成结果，并按会话、审核 ID 与快照恢复审查 turn |
| `lib/automation-manager.mjs` | 自动分析状态、串行跟踪和企业微信推送 |
| `lib/svn-review-manager.mjs` | SVN 只读检查、审核状态持久化、可选 Codex 审核、人工确认令牌、提交前复检和显式路径 commit |
| `lib/panel-document.mjs` | 生成不依赖外部 iframe 的内嵌面板文档 |
| `installer/` | 当前用户安装、快捷方式和安全卸载 |

## 常见问题

### 侧栏没有“Jira 任务”

确认使用的是安装器创建的“Codex”快捷方式，而不是 Microsoft Store 原始入口。可以检查：

- 面板健康状态：`http://127.0.0.1:47823/api/health`
- Codex CDP 状态：`http://127.0.0.1:47824/json/version`
- 启动日志：`%LOCALAPPDATA%\Programs\JiraCodexPanel\.runtime`

### 启动后出现两个 Codex

完全退出所有 Codex 窗口，然后只使用安装器创建的快捷方式。若任务栏固定的是商店版原入口，请先取消固定。

### 点击 Jira 面板后空白、闪回或内容崩溃

先重新运行安装器升级到同一版本的完整文件，再检查 `.runtime` 中的 `server.stderr.log` 和 `injector.stderr.log`。面板版本必须与注入器版本一致。

### 已绑定会话无法打开

在 Issue 详情中点击“重新绑定对话”。可以绑定当前侧栏中的已有会话，也可以新建会话。绑定已有会话不会发送消息。

### 没有显示 JXL Sheet

确认当前 Jira 用户拥有对应项目和 Sheet 的访问权限，并确认 Sheet 使用 JQL 范围。非 JQL 范围只能在 JXL 中打开。

### 自动分析没有创建对话

确认：

- Jira 配置连接正常。
- “自动分析新 Bug”开关处于开启状态。
- Bug 位于当前待修复或处理中的 Bug 列表。
- 本地服务和注入器仍在运行。
- 该 Bug 没有已经进入当前监控记录或正在分析。

## 安全与已知限制

- Jira 写操作仅限用户在 Issue 详情或会话浮窗中二次确认的状态流转；没有修改摘要、描述、评论或附件的接口。
- SVN 是直接写入远端仓库的操作：只有审核未阻断、快照仍一致且用户人工勾选确认后才可执行。Codex 审查可以关闭或取消，但关闭后必须由用户明确确认已完成人工审核；Codex 审查 turn 本身永远不会触发 commit。
- SVN commit 只接收审核快照中的显式相对路径，不会以整个工作副本 `.` 作为提交目标，也不会保存 SVN 凭据。
- 提交命令结束不等于成功：必须通过 SVN 日志唯一确认 revision；结果不明确时禁止自动重试，并要求人工核对。
- 同一 Jira 可以多次提交，SVN 提交记录与 Jira 状态完全解耦。
- 状态流转提交前会重新校验 Jira 当前可用 transitions；要求额外字段的操作只能在 Jira 原页面完成。
- 企业微信推送是另一项可选外部写操作，只有配置 Webhook 并启用自动分析后才会发生。
- 这是非官方 Codex 注入方案，依赖客户端内部 DOM 和 RPC 资源；Codex 升级后可能需要更新适配。
- CDP 没有面向其他本机进程的身份认证，只应在可信设备上使用，不要将 `47823` 或 `47824` 转发到局域网或公网。
- 面板请求桥接限制目标来源、HTTP 方法、请求头和传输大小，它不是通用网络代理。
- 当前产品配置固定为 Jira Data Center，不提供 Jira Cloud 切换。
- Data Center 使用自签名 HTTPS 证书时，需要先让 Windows 和 Node.js 信任相应 CA；本项目不会绕过 TLS 验证。
- `ct-devops-tracer` 不是本项目自带组件；Bug 分析会在该技能不可用时按规则降级。
- 不要把 Jira PAT 或企业微信 Webhook 粘贴到聊天、日志或仓库中。
