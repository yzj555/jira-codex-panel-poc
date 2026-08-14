# Jira Codex 任务面板

> 当前版本：`0.31.8`<br>
> 运行环境：Windows Codex Desktop + Jira Data Center<br>
> 使用方式：个人本地运行，每位用户配置自己的 Jira PAT，数据和会话绑定彼此独立

Jira Codex 任务面板把 Jira 待办、JXL Sheets 和 Codex 对话连接到同一个本地工作台。Codex 侧栏中的“Jira 任务”承载适合桌面操作的完整工作台；官方 Plugin + MCP Apps UI 同时保留为标准插件入口和 SVN 等能力组件。两种 UI 共用同一套本地服务、绑定数据和 App Server 会话能力，不形成第二份业务状态。

这不是部署在 Jira 服务器上的插件。它通过本机服务读取 Jira，并只在用户明确确认时提交状态流转或已审核的 SVN 改动。任务首页、历史、Sheets、详情、状态流转、现有会话关联和 SVN 审核提交已经提供官方 Plugin + MCP Apps UI；侧栏入口、会话浮窗和 Codex Desktop 窗口跳转仍由最小兼容层承载，适合个人工作环境使用。

## 快速开始

### 环境要求

- Windows 版 Codex（Microsoft Store 包名 `OpenAI.Codex`）。
- Windows PowerShell 5 或更高版本。
- Node.js 22 或更高版本。
- npm（通常随 Node.js 安装）；安装器用它准备官方独立 Codex CLI，供已文档化的 App Server 接口使用。
- SVN 命令行客户端 1.8 或更高版本，并已通过当前 Windows 用户的 SVN 凭据缓存取得目标仓库权限。
- TortoiseSVN 为可选项；安装后可以从文件树双击打开原生差异窗口，未安装时仍可使用内置差异预览。
- Jira Data Center 地址及当前用户的 Personal Access Token（PAT）。
- Jira 用户需要浏览项目权限；执行状态流转还需要对应项目的 `Transition Issues` 权限。

### 安装

双击项目根目录的 `install.cmd`，或在 PowerShell 中执行：

~~~powershell
git clone https://github.com/yzj555/jira-codex-panel-poc.git
cd jira-codex-panel-poc
& .\installer\lifecycle.ps1 -Action Auto
~~~

安装完成后：

1. 从桌面或开始菜单打开安装器创建的“Codex”快捷方式。
2. 在 Codex 左侧栏点击“Jira 任务”，直接进入完整任务工作台。
3. 首次使用时点击工作台右上角设置，在面板内填写 Jira 地址和 PAT。
4. 点击“保存并连接”，开始读取当前用户的 Jira 任务。

> 安装器创建的“Codex”快捷方式已经包含面板需要的启动参数。Microsoft Store 原始入口无法被安全修改；从原始入口启动的普通 Codex 不会加载 Jira 面板。

安装器默认执行一次 `npm install -g @openai/codex@latest`（已有独立 CLI 时不会重复安装），并记录真实的 npm vendor 可执行文件路径。该 CLI 只作为本地 App Server 控制面使用，不替换 Microsoft Store 桌面应用；缺少它会使会话、Skill、后台 turn 和审查等 App Server 能力不可用，但不会让本地 Jira 配置或只读服务丢失。若不希望安装，可传入 `-InstallCodexCli:$false`。

Plugin、MCP、本地服务、App Server Adapter 和最小 CDP 适配层都属于同一个“Jira Codex 助手”。用户不需要分别维护这些组件；统一生命周期入口负责安装、覆盖升级、修复、状态检查和卸载。安装器会准备本地服务依赖、注册 `jira-codex-local` Marketplace，并安装 `jira-codex-assistant` Plugin；卸载时会先清理 Plugin 与 Marketplace，再删除程序目录。Plugin 注册失败时会明确报告组件异常；侧栏完整工作台仍可使用同一套本地服务，但 Plugin/MCP Apps 能力会保持不可用状态，不会伪装成安装成功。

## 官方 Plugin 工作台

当前版本已经把可由公开协议稳定承载的主流程迁入官方 Plugin：

- Plugin 清单：`plugins/jira-codex-assistant/.codex-plugin/plugin.json`。
- 本地 Marketplace：`.agents/plugins/marketplace.json`。
- MCP 地址：`http://127.0.0.1:47823/mcp`，使用 Streamable HTTP。
- 只读工具：任务首页/历史、Issue 详情、JXL Sheets、可用状态流转、App Server 会话列表、SVN 状态/差异/审核结果和提交回执核对。
- 本地写工具：会话关联、解除关联、创建/取消/确认/放弃审核草稿；这些操作不修改 Jira、Codex 对话正文或 SVN 工作副本。
- 外部写工具：执行 Jira 状态流转与 SVN commit；都与只读工具分开声明权限、安全注解和人工确认边界。
- UI Resource：`ui://jira-codex-assistant/workbench-v3.html`，使用 MCP Apps 的 `_meta.ui.resourceUri`、`ui/*` bridge、`tools/call`、私有组件状态和空外联 CSP。

这些工具复用本地服务已经保存的 Jira 地址、PAT、协同处理人字段、面板查询配置和服务端会话绑定；Plugin 本身不保存 Token。工作台包含“待我处理 / Jira Sheets / 处理历史”三个页签，首页和历史继续按需求与 Bug 分成左右两栏，详情包含当前执行单、父级需求上下文、协同处理人、附件元数据、状态和会话关联状态。关联窗口通过官方 App Server 列出现有会话；保存关联前读取目标会话并使用绑定 revision 做并发校验，不发送首条消息。即使宿主不渲染 UI，工具仍返回结构化结果和简短回退说明。

状态流转必须先读取 Jira 最新可用操作，在 UI 中由用户明确确认后签发短时一次性凭据；执行时再次由 Jira 客户端校验 transition，凭据一经使用立即失效。需要额外字段的流转继续要求在 Jira 页面完成。

官方工作台通过 `jira-workbench-service`、`codex-conversation-service` 和 `svn-workbench-service` 访问统一业务边界，不会形成两套 Jira、绑定或 SVN 规则。附件预览、自动 Bug 监控、会话绑定和 SVN 状态全部由本地服务负责；注入层只保留四项官方 Desktop API 尚不能替代的能力：侧栏启动入口、当前会话轻量 Jira 浮窗、桌面会话跳转，以及当前窗口 App Server 命令适配。新会话创建仍由当前 Desktop 窗口原子执行，但提示词、附件、Skill、绑定和基线均由服务端编排。

开发验证命令：

~~~powershell
npm test
npm run mcp:probe
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" .\plugins\jira-codex-assistant
codex plugin marketplace add .
codex plugin add jira-codex-assistant@jira-codex-local
~~~

安装或更新 Plugin 后，需要新建 Codex 对话，才能稳定加载新的工具与 UI 资源。

## 页面说明

### 主题适配

桌面任务工作台、官方 MCP Apps 工作台和会话右侧 Jira 浮窗都会跟随 Codex 的浅色/深色主题。设置默认在任务工作台内部打开；独立 `#settings` 页面只作为维护回退入口。

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

任务卡片会显示 Issue Key、标题、Jira 原始状态、优先级、负责人、附件数量和可用的父级 Issue Key。点击任务后使用居中的详情窗口展示完整信息，不会挤压 Codex 侧边区域。

需求和 Bug 两栏分别读取当前返回的 Jira 原始状态，并提供独立的多选状态筛选；默认不选择任何状态表示全部，筛选互不影响。筛选只改变当前面板展示，不会修改 Jira 查询或任务状态。

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
- 当前绑定的 Codex 对话及更改关联入口。

存在标准 Jira 父子关系时，当前分配给个人的子单仍是执行单，也是会话绑定、状态流转、SVN 提交和历史记录的唯一操作对象。父单与子单的描述和附件按来源分区展示，共同组成需求上下文；系统不会用父单字段覆盖子单，也不会静默继承父单版本。子单没有修复版本时，父单版本只作为详情中的参考信息。父单无权限或暂时不可读不会阻断子单处理，界面会保留父单标识并明确显示上下文缺口。

图片、PDF、文本、音频和视频可以在面板内只读预览，也可以下载原文件；同一任务的多张图片可用左右按钮或方向键连续查看。Office 等文档附件首次点击会下载到当前用户的本地附件缓存，再次点击直接打开已下载文件，避免重复下载。文本预览最多显示前 50 万字符。

附件内容由本地服务根据附件 ID 代理。浏览器不会获得 Jira PAT，本地服务也不会向当前 Jira 地址以外的来源转发凭据。

### 状态流转

打开 Issue 详情后，右侧“状态流转”会实时读取 Jira 当前返回的 transitions，不依赖面板内置状态枚举：

1. 选择 Jira 当前允许到达的目标状态。
2. 面板显示当前状态、目标状态和工作流操作，并要求二次确认。
3. 本地服务在提交前重新读取一次 transitions，避免执行已经过期的流转。
4. Jira 接受流转后，面板关闭详情并刷新当前任务页。

如果流转要求填写解决结果等额外字段，面板会禁用该选项并提示在 Jira 原页面完成，避免提交不完整数据。面板没有修改摘要、描述、评论或附件的接口。

## Jira Issue 与 Codex 对话

每个 Jira Issue 可以保存一个 Codex 会话绑定。一个绑定可以同时包含多个 Codex 项目目录，并指定其中一个“主目录”：主目录用于新建会话的初始工作目录，全部已选目录共同构成该任务允许使用的项目范围。旧版本中只绑定一个项目的记录会自动迁移成单项目范围，不需要重新关联。

### 未绑定的任务

点击“关联 Codex 会话”后，可以选择“新建并绑定”或“绑定已有会话”。

关联窗口会列出当前 Codex 已加载的项目目录。用户可以按本次 Jira 的实际影响范围多选目录，并明确指定一个主目录；绑定已有会话时也可以补充或调整这些目录。项目范围保存于本地服务端绑定记录，不依赖浏览器 `localStorage`，任务详情和当前会话浮窗都会显示已关联目录。

新建并绑定时，面板会：

1. 使用所选主目录创建 Codex 对话；没有选择项目范围时创建不带项目的普通对话。
2. 允许补充 Jira 中缺失的背景、业务规则、环境或复现信息；补充内容独立标记为“用户补充说明”，不覆盖或回写 Jira。
3. 由本地服务读取当前执行单及一层标准父单关系，分别下载两侧的原始附件并标注来源，再作为 App Server 输入挂载到新对话。
4. 自动发送一次紧凑首条消息：当前执行单和父级关联单按来源分区呈现，父子信息共同用于理解需求，但明确限制本次只分析和处理当前执行单；冲突、缺失或边界不清时必须提出问题，不能自行扩展到父单中的其他工作。图片以 Codex 原生 `localImage` 输入发送，其他附件作为文件输入发送。
5. 把内置 Jira 降级 Skill 和用户选择的专业 Skill 作为结构化 Skill 输入提交。
6. 官方 MCP 工具把已经准备好的结构化请求交给当前窗口 App Server 适配器，一次性创建会话并提交首条消息；取得正式会话 ID 后，本地服务才保存 Issue 绑定、自动分析登记和 SVN 基线。流程不依赖新会话是否已经渲染到左侧列表。

如果当前执行单的任一附件没有成功挂载，首条消息不会发送，避免对话在缺少直接证据的情况下开始分析。父单附件不可访问时不会阻断子单流程；父单附件清单仍保留来源，分析必须明确指出未实际取得的材料。

绑定已有会话时，候选列表来自 App Server；系统读取目标会话、校验绑定 revision 后保存关联，不会自动插入 Jira 消息。若目标会话已关联其他 Issue，必须人工确认后才会转移关联。

“新建并绑定”会在同一个 Codex 桌面命令中完成会话创建和首条消息提交，只有命令成功返回正式会话 ID 后才替换旧关联。服务端不会读取 rollout 文件来确认新会话；若操作失败，旧关联和补充说明都会保留，可直接重试，也不会创建第二个补偿会话。

### 已绑定的任务

点击“打开已绑定的 Codex 对话”时：

- 如果目标会话已经显示在侧栏，直接点击对应会话。
- 如果目标会话不在当前侧栏，通过 Codex 原生任务导航按会话 ID 打开。
- 不会再次发送首条消息。

任务详情同时提供“解除关联”。二次确认后会从本地服务主存储中清除该 Issue 的绑定，并移除当前会话中的 Jira 浮窗；原 Codex 对话不会被删除或归档，Jira 状态、SVN 记录和未发送的补充说明草稿也不会改变。解除后，该任务立即恢复为可重新关联状态；已完成任务也允许修正错误绑定。

### 会话右侧 Jira 浮窗

进入已绑定的 Codex 会话后，消息区右侧会自动显示当前 Issue 的最小浮窗：

- 浮窗固定在宿主层，不改变或挤压 Codex 消息区宽度。
- 展示 Issue 类型、Key、标题、原始状态和摘要。
- 提供“在 Jira 中打开”、任务详情、状态流转和 SVN 审核入口；当前本来就在绑定会话中，不再重复显示“打开会话”按钮。
- 切换到未绑定会话、新对话或其他原生页面时会自动移除，不会残留上一张单子。
- 打开“Jira 任务”启动页时暂时隐藏，返回绑定会话后恢复。

浮窗按 Issue Key 通过本机服务读取 Jira 最新摘要，不依赖该任务是否仍存在于当前看板筛选结果中；Jira PAT 不会进入 Codex 页面。

### SVN 审核与提交

在官方工作台的 Issue 详情中进入“审核并提交 SVN”。本地服务首先使用绑定记录中持久化的项目范围；旧绑定缺少工作区时才通过官方 App Server `thread/read` 恢复上下文，再定位 SVN 工作副本。新业务不依赖 session/rollout 文件。绑定只有一个项目目录时直接进入该范围；绑定多个项目目录时必须先明确选择本次要处理的目录，系统不会猜测，也不会把多个工作副本合并成一次提交。每个审核草稿始终只属于一个项目范围和一个 SVN 工作副本。

文件选择区按“可提交 / 未纳管 / 阻断项 / 全部”分类，以目录树展示；目录复选框支持半选。单击文件名会在右侧按需读取该文件的 SVN 差异，不会在首次打开时批量加载全部 diff。

每个提交草稿固定关联一个 Jira Issue、一个 Codex 会话和一个 SVN 工作副本。同一 Jira 可以创建任意多次提交；提交成功只保存一条 revision 历史，不会结束会话，也不会自动流转 Jira 状态。

1. 系统结合任务绑定时的 dirty 基线、App Server 返回的结构化文件改动和当前 SVN 状态生成本次需求候选集。结构化文件证据为高置信推荐；缺少该证据时只按绑定后的 SVN 差异给出普通推荐，不扫描 rollout 猜测改动归属。
2. 用户在文件树中人工增删候选，最终选择始终以人工判断为准。绑定前改动、未纳管文件、目录和冲突等阻断项不会进入初始勾选。如果选定文件也被其他 Jira 的未完成草稿引用，界面会显示关联单号，提交前必须人工确认混入风险。
3. 本地服务读取 `svn info`、`svn status --xml` 和所选路径的 `svn diff`，检查冲突、缺失、阻塞、switched、混合版本、属性改动、未纳管文件、二进制差异及项目范围中的其他改动。单击文件会在中央区域预览内置差异，双击同一文件可调用 TortoiseSVN 查看；TortoiseSVN 不参与提交。
4. 系统生成不可变审核快照、规范提交信息和三份本地审核材料：原任务需求上下文、SVN 原生 diff、审核清单。`svn diff` 是本次改动事实的主证据；原任务对话与该 Jira 的历史 revision 只提供需求、调用链和历史行为上下文。
5. 文件选择区顶部的“本次提交方式”默认选中“人工审核”，Codex 辅助审查需要用户主动选择。选择后，本地服务把三份审核材料的不可变绝对路径作为只读上下文，通过官方 App Server 在绑定会话启动真实审查 turn；不会把非图片文件伪装成原生附件，不会创建独立任务，也不会操作或清空输入框。该审查可能耗时较长，必须等待审查完成，或主动取消并降级为人工审核，之后才能继续提交。若会话正忙会立即失败，不会排队抢占正在执行的工作。
6. 审查启动后，官方工作台显示“挂起 · Codex 检查中”。本地服务按 `reviewId + snapshotHash + threadId + turnId` 跟踪官方 App Server 的 `item/completed` 与 `turn/completed` 事件；服务重启后使用 `thread/read(includeTurns: true)` 恢复最终状态。用户可以等待结果，也可以随时中断 turn 并降级为人工审核。投递失败、执行失败和超时都提供相同的人工降级入口，晚到结果不会覆盖取消后的人工状态。
7. Codex 按证据重新拆解需求覆盖，检查实现完整性和准确性、逐文件改动、调用方与被调用方、接口/事件/数据/配置/性能影响、历史 revision、工程合规性、潜在回归和测试证据，并明确列出无法核实的范围。审查仅提供建议，不会自动提交。
8. 关闭或取消 Codex 审查后，用户基于不可变快照、完整差异和机械检查自行审核需求符合性与影响风险。机械检查或 Codex 结果为“阻断”时不能提交；存在警告或跨任务文件重叠时，会合并显示在最终确认文案中。
9. 真正提交前只需勾选一次合并确认，表示已完成改动审核并理解当前列出的风险，再点击提交按钮；系统已从当前 Jira 上下文确定单号，不再要求手工重复输入 Issue Key。
10. 本地服务重新校验 Jira 信息、本地状态、差异和远端更新状态；快照一致时才用 `svn` 命令对显式路径执行 commit。提交结束后读取 `svn log --xml`，统一不同平台的换行格式后核对 revision 和提交说明；自动核对仍失败时，可在人工查看 SVN 日志后登记实际 revision，不会再次执行 commit。

当前会话的 Codex 审查 turn 默认只能读取审核材料与项目代码。材料不可读时允许降级使用只读代码检索，以及 `svn info`、`svn status`、`svn diff`、`svn cat`；禁止一切 SVN 写操作和文件修改。无法取得稳定差异或完整上下文时必须阻断，不能猜测通过。

任何文件内容、SVN 属性、选择路径、提交说明、审核模式、Jira 标题/描述/修复版本或仓库状态发生变化，原审核都会失效。所选文件还会记录 SHA-256 内容指纹，因此二进制文件即使 `svn diff` 只返回通用提示也能被复检。

审核记录会原子写入当前用户数据目录的 `svn-reviews.json`。服务或 Codex 重启后会恢复未过期的审核、当前会话 ID、Turn ID、完成结果和已提交历史，并通过 App Server 继续轮询运行中的审查；迁移前的旧材料才会在原绑定会话中按 `reviewId + snapshotHash` 使用本地会话日志补关联。人工确认产生的一次性令牌只保存在内存中，有效期 90 秒，调用一次后立即作废；服务重启后必须重新人工确认。若 `svn commit` 的命令退出状态、输出或服务重启导致结果不明确，记录会进入“提交结果待核对”，禁止自动重试；用户可以重新读取 SVN 日志，或人工核实并登记实际 revision。只有确认本次操作没有产生有效提交时，才应放弃草稿。

已取消、已完成、人工审核、失败、超时、阻断或失效的草稿都提供“返回文件选择并重新扫描”。该操作会明确废弃当前面板草稿并重新读取工作副本，不会撤销或修改 Jira、SVN 中已经提交的内容；因此关闭再打开面板时也不会重新恢复旧草稿。已成功提交的记录则通过“新建下一次提交”进入同样的最新状态扫描。

新建任务会话完成绑定时，面板会为每个已关联项目范围分别记录一次只读 SVN 基线；后续新增目录时只补录新范围，不覆盖已有范围的基线。绑定前已经处于 dirty 状态的路径会标记为“绑定前”，不能纳入自动提交流程；如果同一文件在绑定前后都有改动，由于无法可靠拆分归属，同样会阻断。升级前已经存在的旧会话绑定没有历史基线，界面会明确提示，必须由用户只选择已人工确认属于当前 Jira 的改动。

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

### 会话关联与更改关联

未绑定任务和绑定错误时使用同一个关联窗口：

- **绑定已有会话**：验证会话 ID、保存关联并直接跳转，不发送消息。
- **新建并绑定**：可填写补充说明，创建新会话、挂载附件并发送首条分析消息；旧绑定会保留到新关联成功为止。

### 首条消息与分析 Skill

需求和 Bug 使用独立的精简模板。Jira 当前执行单以及可用的父级需求上下文由程序按来源生成且只出现一次；模板只规定分析目标，避免首条消息被重复上下文和长篇规则撑大。父子单附件内容通过真实文件传入，不会再次展开到消息正文。

每种模板都可以绑定一个额外 Codex Skill。需求和 Bug 默认都不绑定外部技能；技能选择器读取当前 Codex 已加载的 Skill 列表，用户可按当前环境选择。绑定 Skill 中与当前任务相关的工具、流程、证据、安全边界和输出格式优先；需求或 Bug 模板只补充 Skill 未覆盖的分析内容，内置 `jira-first-turn-analysis` 再补充仍未覆盖的首轮边界和证据规则。

所选 Skill 不存在或被禁用时，系统自动降级到分析模板、内置 Jira Skill 和已有 Jira/项目上下文，并在消息中给出简短提示。Skill 选择器会持续显示这条优先级规则，避免用户误认为模板会覆盖专业 Skill。技能列表来自当前 Codex 已加载的 Skill，不再扫描或假设其他用户的本地目录。

## 自动分析新 Bug

“待我处理”页面提供“自动分析新 Bug”开关，默认关闭。

开启后：

1. 当前待修复或处理中的 Bug 会加入队列。
2. 后续进入列表的新 Bug 会被周期检测。
3. 系统串行创建 Codex 新对话、挂载附件并发送只读诊断消息。
4. 每个 Bug 在当前监控记录中只处理一次。
5. 本地服务保存 App Server 返回的真实 `threadId + turnId`，优先接收 `item/completed`、`turn/completed`，并在重启后通过 `thread/read` 恢复最终分析文本；只有迁移前没有 Turn ID 的旧任务才读取本地会话日志。
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
| 首页任务来源 | 需求和 Bug 分别选择“内置通用 JQL”“自定义 JQL”或“已有 Filter”；Filter 直接使用 Jira 当前保存的 JQL |
| 项目 Key | 内置通用 JQL 使用的项目 Key；首次配置不预置，使用自定义 JQL 或 Filter 时可留空 |
| 需求分析模板 | 独立控制需求首条消息正文；设置页仅显示摘要，点击“编辑”打开完整编辑器 |
| Bug 分析模板 | 独立控制 Bug 首条消息正文；自动 Bug 监控也使用这个模板 |
| 模板绑定技能 | 每种模板可单独选择 Codex 当前已加载的 Skill；需求和 Bug 默认均不绑定 |
| 每个分区最大任务数 | 1～200，默认 100 |

设置面板按 Jira 连接、Codex 集成、数据同步、自动化通知、消息模板、高级配置和版本更新分组，版本更新固定排列在最后并拥有独立的左侧导航入口；顶部和底部操作区固定，中间配置内容独立滚动，保存按钮始终可见。

### 数据同步

- **自动同步任务**：默认开启，可选 30 秒、1 分钟、5 分钟或 10 分钟。
- **返回面板时同步**：默认开启；重新打开或回到 Jira 面板时立即刷新一次。
- **Sheets 同步频率**：默认 5 分钟，也可以选择手动或 10 分钟。
- **手动刷新**：顶部刷新按钮始终保留，不受自动同步开关影响。
- **自动检查更新**：默认开启；本地服务每 6 小时最多访问一次 GitHub。关闭后仍可使用“立即检查”。

自动同步只读取 Jira 数据，不会修改 Issue。请求重叠时会跳过后续请求；后台同步失败会保留上一次成功数据，并在连接状态中提示，不会阻塞面板使用。上次选择的 Sheet 仍会在本地记忆，重新打开面板后优先恢复。

面板标题旁始终显示当前安装版本。版本检查优先比较最新 GitHub Release；仓库尚未发布 Release 时回退到远端 `main` 的 `package.json`。只有正式 Release 同时包含 Windows ZIP 和 `update-manifest.json` 时，面板才提供一键下载；只有远端 `main` 版本或 Release 缺少安装资产时，只显示发布说明入口，不会拿源码分支直接覆盖安装。

点击“下载并安装”后不再需要第二次安装确认：安装包保存在 `%LOCALAPPDATA%\jira-codex-panel-poc\updates\<版本>`，同时匹配 Release 资产大小和清单中的 SHA-256 后会自动进入安全安装。正在执行的 SVN commit、Codex SVN 审查、自动 Bug 分析或桌面会话操作会阻止安装。独立更新器先备份现有程序，再复用统一安装器升级并检查服务版本、必要组件和 Plugin 注册；验证失败会自动回滚。验证通过后保留当前 Codex 窗口并明确提示“需要重启”，这是更新流程唯一需要再次人工操作的步骤。用户确认后只请求 Codex 正常退出，不会强制结束进程；重新打开成功后，启动器会确认目标版本并自动清理临时更新状态。GitHub 暂时不可用只会显示非阻塞状态，不影响 Jira、会话或 SVN 功能。

两个消息模板都支持以下变量：

`{{key}}`、`{{title}}`、`{{url}}`、`{{status}}`、`{{type}}`、`{{assignee}}`、`{{collaborators}}`、`{{description}}`、`{{attachments}}`

模板编辑器支持恢复系统默认。已有版本中的单一自定义模板升级后会复制到需求和 Bug 两类，避免丢失个人配置；可以分别恢复默认后再调整。保存配置时会先连接 Jira 验证 PAT 和查询是否可用。

### 首页任务来源

需求和 Bug 面板是两个独立查询源，设置页提供三种方式：

- **内置通用 JQL**：按用户选择的项目 Key、当前用户（经办人或协同处理人）和 Issue 类型自动查询；首次配置不预置项目、Filter 或站点字段，项目需从当前 Token 可访问的 Jira 项目中选择。协同处理人字段会优先从 Jira 字段元数据自动识别，识别不到时降级为仅按经办人查询；类型元数据不可读时仍可加载并由面板分类。
- **自定义 JQL**：直接使用该面板的 JQL；保存时服务会分别追加 `statusCategory != Done` 和 `statusCategory = Done`，用于活动面板与处理历史。
- **已有 Filter**：从当前用户当前 Token 可访问的 Jira Filter 中多选；列表来自 Jira REST 接口并合并搜索、我的和收藏结果，支持分页。服务查询时使用 `filter = <id>`，因此 Filter 在 Jira 中修改后，下一次同步会自动生效；已删除或无权限的旧 Filter 会标记并阻止保存。

设置页读取的是 Jira Filter 和 Filter 的 JQL，不读取 Jira 仪表盘布局或 Gadget。仪表盘增删、排列变化不会影响面板；Filter 的权限、删除或 JQL 变化会影响对应面板，并会在同步或保存时返回 Jira 错误。

旧版本只有一个 JQL 配置时会自动迁移：旧的 CT 仪表盘 Filter、项目 Key 和协同字段只作为一次性兼容信息保留，新的首次配置不再写入这些环境值；自定义 JQL 会同时作为需求和 Bug 面板的自定义来源。保存一次新的面板来源配置后，即可分别调整两个区域。

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
- 检测并默认安装官方 npm Codex CLI，保存独立 App Server 命令路径；不会尝试直接执行 Store 包内部受保护的 `codex.exe`。
- 启动仅监听回环地址的面板服务和注入器。
- 默认不创建登录自启，避免和 Microsoft Store 原入口同时打开两个实例。
- 升级时保留 Jira PAT、企业微信 Webhook、会话绑定和个人设置。
- 写入 `install-state.json` 组件清单，并在 Windows“已安装的应用”中只登记一个“Jira Codex 助手”。
- 创建开始菜单“维护 Jira Codex 助手”入口，统一提供修复、普通卸载和完全清除。
- “查看安装状态”会实时复检必需组件、快捷方式与卸载注册项；不会只回显安装时的旧快照。

如果普通 Codex 已经运行，启动器会询问是否正常关闭并重新启动；不会强制结束 Codex。正在执行的 Codex 任务可能因重启中断，请在确认前保存当前工作。

### 升级

普通用户优先在“设置 → 版本更新”中下载正式 GitHub Release；下载校验通过后自动安装，安装验证完成后再由用户确认重启。也可以在新版本项目目录中重新运行 `install.cmd` 或安装命令；两种方式最终都调用同一个统一生命周期入口，保留 Jira PAT、企业微信 Webhook、会话绑定和个人设置。

修复当前安装：

~~~powershell
& "$env:LOCALAPPDATA\Programs\JiraCodexPanel\installer\lifecycle.ps1" -Action Repair
~~~

### 发布 GitHub Release

维护者先把版本改动合入 `main`，然后执行 `npm run version:set -- <版本>`，确认 `package.json`、锁文件、服务端、注入客户端和 README 已同步。`npm test` 与 `npm run release:verify -- v<版本>` 通过后，提交并推送 `main`，再创建并推送同名 tag：

~~~powershell
git tag -a v0.31.3 -m "发布 v0.31.3"
git push origin main
git push origin v0.31.3
~~~

tag 会触发 `.github/workflows/release.yml`：在 Windows runner 重跑全量测试、为 Release 包刷新 Plugin cachebuster、生成 ZIP / `update-manifest.json` / `SHA256SUMS.txt`，并为 ZIP 生成 GitHub artifact attestation。流水线只创建 **Draft Release**；维护者必须在 GitHub 检查版本、变更说明、三个资产和 attestation 后人工点击 Publish。只有发布后的 Release 才会被用户更新检查识别，失败或未审核的 draft 不会进入更新渠道。

### 可选：登录自启

~~~powershell
& .\installer\lifecycle.ps1 -Action Install -StartAtLogon $true
~~~

不建议同时使用登录自启和 Microsoft Store 原始 Codex 入口。

### 卸载

可以从 Windows“已安装的应用”中的“Jira Codex 助手”卸载，也可以打开开始菜单“维护 Jira Codex 助手”。普通卸载删除所有程序组件、快捷方式和注册项，但保留 PAT、绑定与个人配置。

彻底删除用户数据：

~~~powershell
& "$env:LOCALAPPDATA\Programs\JiraCodexPanel\installer\lifecycle.ps1" -Action Purge
~~~

卸载不会删除已经创建的 Codex 对话，也不会卸载可能被其他工具共用的全局 `@openai/codex` CLI。

## 本地数据与端口

| 内容 | 默认位置或地址 |
| --- | --- |
| 安装目录 | `%LOCALAPPDATA%\Programs\JiraCodexPanel` |
| 安装状态与组件清单 | `%LOCALAPPDATA%\Programs\JiraCodexPanel\install-state.json` |
| 用户配置 | `%LOCALAPPDATA%\jira-codex-panel-poc\config.json` |
| Jira 与 Codex 会话绑定 | `%LOCALAPPDATA%\jira-codex-panel-poc\issue-bindings.json` |
| 隔离 Codex 数据 | `%LOCALAPPDATA%\jira-codex-panel-poc\codex-profile` |
| Jira 附件缓存 | `%LOCALAPPDATA%\jira-codex-panel-poc\attachments` |
| SVN 基线与审核状态 | `%LOCALAPPDATA%\jira-codex-panel-poc\svn-baselines.json`、`svn-reviews.json` |
| SVN 审核材料 | `%LOCALAPPDATA%\jira-codex-panel-poc\attachments\svn-reviews` |
| 内置首轮分析 Skill | `<安装目录>\skills\jira-first-turn-analysis\SKILL.md` |
| 运行日志与 PID | `%LOCALAPPDATA%\Programs\JiraCodexPanel\.runtime` |
| 面板服务 | `http://127.0.0.1:47823` |
| Codex CDP | `http://127.0.0.1:47824` |

Jira PAT 和企业微信 Webhook 使用 Windows DPAPI 加密后保存，只能由写入它们的 Windows 用户解密。公开配置接口不会返回这两个密钥。

会话绑定由本地服务作为唯一数据源持久化。升级后的注入层只会读取一次旧 `localStorage` 绑定并导入服务端，成功后立即删除旧值；后续读取、并发 revision 校验、写入和解除都不再使用浏览器双状态。每位 Windows 用户仍然彼此独立。

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

只读检测 App Server（不会创建任务或发送消息）：

~~~powershell
npm run codex:probe
~~~

验证浏览器 Runtime Adapter、本地 HTTP API、会话读取和 App Server 的完整只读链路可执行 `npm run codex:probe:http`。若开发机只有 Microsoft Store 版 Codex，这两个命令会提示安装独立 CLI。也可以通过 `JIRA_CODEX_APP_SERVER_COMMAND` 指向 npm 包内真实的 `codex.exe`。

测试覆盖 Jira 认证与字段映射、单 Issue 详情、任务分类、Sheets 排序筛选、JXL 权限、附件缓存、需求/Bug 模板迁移、Codex 技能发现与结构化输入、MCP Apps UI、最小会话浮窗注入、会话导航、服务端绑定、配置加密、本地 Bug 监控及结果推送，以及 SVN 状态解析、审核快照、人工确认和显式路径提交。

### 截图

在 Codex 已通过 CDP 启动后执行：

~~~powershell
npm run capture
~~~

截图会写入 `artifacts/windows-codex-jira-panel-poc.png`。

## 架构

~~~mermaid
flowchart TB
    Codex["Windows Codex Desktop"] --> Plugin["官方 Plugin + MCP Apps UI<br/>标准入口 / SVN 能力组件"]
    Plugin <-->|Streamable HTTP| Server["本地 Jira / SVN 服务<br/>127.0.0.1:47823"]
    Server <-->|官方 JSON-RPC / stdio| AppServer["Codex App Server<br/>会话、Skill、turn、结构化输出"]

    Injector["最小 UI 注入层"] <--> Codex
    Injector --> Sidebar["侧栏完整任务工作台<br/>面板内设置"]
    Injector --> Float["当前会话 Jira 浮窗<br/>详情 / 流转 / SVN 入口"]
    Injector --> Navigation["桌面会话跳转"]
    Injector --> DesktopAdapter["当前窗口 App Server 适配"]
    Sidebar --> Commands["Application Commands<br/>统一能力与归属路由"]
    Float --> Commands
    Navigation --> Commands
    DesktopAdapter --> Commands
    Commands <-->|受限本机 API| Server
    Commands <-->|当前桌面会话协议适配| Codex

    Server --> Jira["Jira Data Center / JXL"]
    Server --> UserData["DPAPI 配置<br/>附件缓存 / 自动任务状态"]
    Server -.-> LegacySessions["迁移前会话日志<br/>仅用于旧记录恢复"]
    Server -->|人工确认后显式路径提交| SVN["SVN 工作副本 / 仓库"]
    Server -->|可选| WeCom["企业微信群机器人"]
~~~

当前采用“官方业务协议为主、桌面展示适配最小化”的混合架构。完整桌面工作台与官方 Plugin/MCP Apps UI 都通过按权限拆分的服务接口访问同一业务边界；待办、历史、Sheets、详情、状态流转、会话关联和 SVN 审核没有两套数据规则。Skill、会话列表/读取/命名、后台分析 turn、中断以及 SVN 审查的 `outputSchema` 通过 App Server 协议。图片使用官方 `localImage`；PDF、diff、JSON 等非图片文件不会伪装成原生附件，而是以只读绝对路径上下文提供给沙箱读取。

只读命令可以在任一 Runtime 失败后安全降级。创建会话和发送消息只会在能够确认请求尚未产生副作用时降级；超时、`CODEX_TURN_START_FAILED` 等结果不确定的错误不会自动重试，以免创建重复会话或发送重复消息。交互式新会话由当前 Codex Desktop 窗口持有的 App Server Runtime 原子创建并发送首个 turn，成功确认后才保存绑定和显示；独立 App Server 继续负责后台分析、读取、命名和审查等不要求桌面窗口持有的协议操作。旧的“独立 App Server 先建空会话、桌面接管后再补发首条消息”分步流程已经删除。

注入层只组装桌面 UI 外壳：侧栏入口、完整工作台的 `srcdoc` 容器、当前会话浮窗、SVN MCP Apps 弹层、桌面任务跳转和当前窗口 App Server 命令适配。它不查找输入框、不扫描侧栏会话或项目、不调用 `DOM.setFileInputFiles`、不粘贴附件或模拟发送，也不维护绑定、不调度 Bug 监控、不实现 Jira/SVN 业务规则。旧 `localStorage` 绑定与监控状态只执行一次导入，迁移前的本地会话日志只用于旧记录恢复，不作为新会话、自动分析或 SVN 业务的默认数据源。

当前迁移状态：

| 能力 | 当前实现 |
| --- | --- |
| Jira 待办、历史、Sheets、详情 | 桌面完整工作台 + 官方 Plugin/MCP Apps UI；共用 `jira-workbench-service` |
| Jira 状态流转 | 官方 MCP 写工具；UI 确认、短时一次性凭据、执行前复检 |
| Jira、JXL 的 MCP 与本地设置接口 | 共用 `jira-workbench-service`，无双份业务规则 |
| App Server 会话列表、读取、关联与解除 | 官方 MCP 工具 + `codex-conversation-service`；revision 并发校验，不发送消息 |
| SVN 状态、差异、审核、确认、提交与回执核对 | 官方 MCP 工具 + `svn-workbench-service`；迁移期本地路由仅委托同一服务 |
| 附件缓存、SVN 命令执行 | 统一的本地服务；Plugin 不接触 Jira PAT 或 SVN 凭据 |
| Skill、会话读取/命名、turn、中断、结构化审查结果 | 官方 App Server 协议 |
| 人工新建会话与首条消息 | 当前 Codex Desktop 持有的 App Server Runtime 原子执行 |
| 侧栏完整工作台、右侧浮窗、Codex Desktop 跳转/当前窗口接管 | 最小桌面 UI 兼容层；公开协议暂无等价 Desktop API |
| 旧绑定、监控状态与审查恢复 | 一次性导入或兼容读取；不作为新业务通道 |

App Server 接口依据 [OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server) 实现；项目内部的 Adapter 和命令层负责隔离实验协议变化。

主要文件：

| 文件或目录 | 职责 |
| --- | --- |
| `server.mjs` | 本地 Jira/SVN/MCP/桌面命令服务，仅监听 `127.0.0.1` |
| `config-store.mjs` | 配置校验和 Windows DPAPI 密钥存储 |
| `jira-client.mjs` | Jira REST 请求、单 Issue 详情、Issue 字段和状态映射 |
| `jxl-client.mjs` | JXL Directory、分块数据及访问权限解析 |
| `lib/jira-workbench-service.mjs` | 官方工作台使用的 Jira、JXL、附件和状态流转服务边界 |
| `lib/codex-conversation-service.mjs` | 官方 App Server 会话发现、会话存在性验证和带 revision 的 Jira 绑定服务边界 |
| `lib/svn-workbench-service.mjs` | 官方工作台使用的 SVN 状态、差异、审核、确认和提交服务边界 |
| `lib/action-confirmation-store.mjs` | 官方写工具的短时、一次性人工确认凭据 |
| `mcp/` | 官方 MCP 工具、Streamable HTTP 端点和 MCP Apps 工作台 UI |
| `injector.mjs` | 编译完整桌面工作台文档并安装最小 CDP UI 宿主 |
| `inject/client.js` | 实现侧栏工作台容器、当前会话 Jira 浮窗、SVN MCP Apps 弹层、桌面跳转和当前窗口 App Server 命令适配 |
| `public/` | Codex 内的完整桌面任务工作台及面板内设置；业务数据全部来自共享服务 |
| `skills/jira-first-turn-analysis/` | 不进入可见消息正文的首轮只读分析边界和输出要求 |
| `lib/codex-navigation.mjs` | 当前 Codex Desktop 会话适配器与原生导航；用于桌面持有会话及官方尚未公开的跳转能力 |
| `lib/codex-app-server-client.mjs` | 官方 App Server JSON-RPC 客户端、npm CLI 自动发现、只读能力探测及明确降级状态 |
| `lib/codex-runtime-gateway.mjs` | 面向面板业务的稳定 Runtime 能力接口，隔离 App Server 协议细节并标记会话归属 |
| `lib/codex-application-commands.mjs` | Application Commands、浏览器 App Server Adapter、Runtime 能力选择、安全降级和诊断快照 |
| `lib/issue-binding-store.mjs` | 服务端会话绑定唯一存储，负责 revision 并发校验和旧 `localStorage` 一次性迁移 |
| `lib/codex-session-reader.mjs` | 兼容读取迁移前的本地会话目录、文件操作证据和旧审核 turn；新建后台分析与审查结果不再以此为主通道 |
| `lib/bug-monitor-service.mjs` | 服务端 Bug 发现、去重队列、App Server 分析调度和重启恢复 |
| `lib/automation-manager.mjs` | 自动分析任务状态、结果跟踪和企业微信推送 |
| `lib/svn-review-manager.mjs` | SVN 只读检查、审核状态持久化、可选 Codex 审核、人工确认令牌、提交前复检和显式路径 commit |
| `lib/github-update-checker.mjs`、`lib/update-manager.mjs` | GitHub Release 版本发现、受管下载、SHA-256 校验和持久更新状态机 |
| `installer/lifecycle.ps1` | 产品唯一生命周期入口：安装、覆盖升级、修复、状态检查、卸载和完全清除 |
| `installer/update-bootstrap.ps1`、`scripts/restart-codex-after-update.ps1` | 安装目录外运行的独立更新器与重启助手：备份、统一升级、健康检查、显式重启确认、自动收尾和失败回滚 |
| `installer/product-manifest.json` | 官方 Plugin、MCP、本地服务与最小桌面适配层共用的产品组件清单 |
| `installer/install.ps1`、`installer/uninstall.ps1` | 由统一入口调用的底层安装与清理执行器 |
| `.github/workflows/release.yml`、`scripts/build-release.ps1` | tag 版本校验、可重复 Windows 发布包、哈希、provenance 与 Draft Release |

## 常见问题

### 侧栏没有“Jira 任务”

确认使用的是安装器创建的“Codex”快捷方式，而不是 Microsoft Store 原始入口。可以检查：

- 面板健康状态：`http://127.0.0.1:47823/api/health`
- Codex CDP 状态：`http://127.0.0.1:47824/json/version`
- 启动日志：`%LOCALAPPDATA%\Programs\JiraCodexPanel\.runtime`

### 启动后出现两个 Codex

完全退出所有 Codex 窗口，然后只使用安装器创建的快捷方式。若任务栏固定的是商店版原入口，请先取消固定。

### 点击 Jira 任务后没有打开工作台

侧栏“Jira 任务”会在 Codex 主内容区挂载完整桌面工作台，设置在工作台内部打开；SVN 审核从浮窗或任务详情进入 MCP Apps 弹层。面板的 Jira、绑定和配置操作调用本机共享服务，Skill 与会话由 App Server 读取。若入口或页面无法打开，先查看 `.runtime` 中的 `server.stderr.log` 和 `injector.stderr.log`，再通过维护助手核对 Plugin 和服务状态；注入器异常只影响 UI 入口、浮窗和桌面跳转，不会产生第二份任务或绑定数据。

### 已绑定会话无法打开

在 Issue 详情中点击“更改关联”。可以从 App Server 返回的已有会话中选择，也可以新建会话。绑定已有会话不会发送消息。

### App Server 显示不可用

先执行 `npm run codex:probe`。如果错误指向 `WindowsApps`、`EPERM` 或 `EACCES`，说明系统命令解析到了 Store 包内部受保护的程序；重新运行安装器，或手工执行 `npm install -g @openai/codex@latest`。Jira 只读查询仍可工作，但依赖 App Server 的 Skill、会话验证、后台分析和 Codex 审查会明确不可用，不会悄悄扫描 session/rollout 作为新业务回退。

### 没有显示 JXL Sheet

确认当前 Jira 用户拥有对应项目和 Sheet 的访问权限，并确认 Sheet 使用 JQL 范围。非 JQL 范围只能在 JXL 中打开。

### 自动分析没有创建对话

确认：

- Jira 配置连接正常。
- “自动分析新 Bug”开关处于开启状态。
- Bug 位于当前待修复或处理中的 Bug 列表。
- 本地服务仍在运行；关闭官方工作台或退出 Codex 页面不会停止服务端监控。
- 该 Bug 没有已经进入当前监控记录或正在分析。

## 安全与已知限制

- Jira 写操作仅限用户在官方 Issue 详情中二次确认的状态流转；没有修改摘要、描述、评论或附件的接口。
- SVN 是直接写入远端仓库的操作：只有审核未阻断、快照仍一致且用户人工勾选确认后才可执行。Codex 审查可以关闭或取消，但关闭后必须由用户明确确认已完成人工审核；Codex 审查 turn 本身永远不会触发 commit。
- SVN commit 只接收审核快照中的显式相对路径，不会以整个工作副本 `.` 作为提交目标，也不会保存 SVN 凭据。
- 提交命令结束不等于成功：系统优先通过 SVN 日志唯一确认 revision；结果不明确时禁止自动重试。人工核实仓库后可以登记实际 revision，或在确认未提交时放弃草稿。
- 同一 Jira 可以多次提交，SVN 提交记录与 Jira 状态完全解耦。
- 状态流转提交前会重新校验 Jira 当前可用 transitions；要求额外字段的操作只能在 Jira 原页面完成。
- 企业微信推送是另一项可选外部写操作，只有配置 Webhook 并启用自动分析后才会发生。
- App Server 控制面使用官方文档描述的 JSON-RPC 协议，协议变化被限制在 Runtime Adapter 内；官方 Plugin/MCP Apps UI 与侧栏完整工作台复用同一业务服务。Codex Desktop 当前没有公开的自定义侧栏入口、完整主区工作台、当前会话浮窗和按 ID 桌面跳转接口，因此这些桌面展示能力及当前窗口命令适配仍属于最小 CDP 层，客户端升级后可能需要调整。
- CDP 没有面向其他本机进程的身份认证，只应在可信设备上使用，不要将 `47823` 或 `47824` 转发到局域网或公网。
- 面板请求桥接限制目标来源、HTTP 方法、请求头和传输大小，它不是通用网络代理。
- 当前产品配置固定为 Jira Data Center，不提供 Jira Cloud 切换。
- Data Center 使用自签名 HTTPS 证书时，需要先让 Windows 和 Node.js 信任相应 CA；本项目不会绕过 TLS 验证。
- 外部 Skill 不是本项目自带组件；技能只从当前 Codex 已加载列表中选择，失效时按规则降级。旧版本无路径的 `ct-devops-tracer` 默认绑定会自动清除，不会再影响其他用户。
- 用户选择的额外 Skill 只保存名称、路径和作用域；发送前会重新与 Codex 当前技能列表匹配，失效时不会阻断新对话，而是按绑定项目/Jira 上下文降级。
- 不要把 Jira PAT 或企业微信 Webhook 粘贴到聊天、日志或仓库中。
