# DeepSeek Harness 安装与维护

`@jira-workbench/dsh` 是 Jira Workbench 的 DeepSeek Harness（DSH）安装入口。它会自动安装严格同版本的 `@jira-workbench/core` 与 `@jira-workbench/dsh-client`，普通用户不需要下载仓库、解压 Release 或手工维护三个包。

## 最快安装：只看这三步

前提：`dsh web` 可以正常运行，本机可以执行 `pnpm` 和 `svn`。

### 1. 安装插件

停止正在运行的 DSH Web，然后在 PowerShell 执行：

```powershell
dsh plugin --profile web add @jira-workbench/dsh
```

### 2. 启动 DSH

```powershell
dsh web
```

### 3. 连接 Jira

1. 浏览器进入“设置 → 插件 → Jira 工作台”。
2. 填写 Jira Data Center 根地址和当前用户 PAT，点击保存。
3. 从侧边栏打开“Jira 工作台”；能看到需求和 Bug 列表即安装成功。

安装过程不需要修改 profile、复制 `cordis.patch.yml`、创建 junction，也不需要单独安装 Core 或 Client。

## 安装成功的三个标志

- 设置中出现“Jira 工作台”。
- 侧边栏出现“Jira 工作台”。
- 打开已关联会话后，摘要栏右侧出现 Jira 单号入口。

可用下面的命令确认实际版本和依赖来源：

```powershell
dsh plugin --profile web why @jira-workbench/dsh
dsh plugin --profile web why @jira-workbench/core
dsh plugin --profile web why @jira-workbench/dsh-client
```

三个包应解析为同一个 Jira Workbench 版本。

## 1. 环境要求

- DeepSeek Harness；当前验证版本为 `0.1.0-rc.7`。
- Web profile；默认启动命令是 `dsh web`。
- Node.js 满足 DSH 要求：`^22.19.0` 或 `>=24.0.0`。
- `pnpm` 已加入 `PATH`；`dsh plugin` 会在目标 profile 中调用 pnpm。
- SVN 命令行客户端 1.8+ 已加入 `PATH`，当前系统用户拥有目标工作副本和仓库权限。
- Jira Data Center 地址和当前用户 PAT。
- TortoiseSVN 可选；未安装时仍可使用内置差异预览。

DSH 适配在 DSH 进程内运行 Core，不启动 Codex 的 `127.0.0.1:47823` 服务、CDP 注入器或后台更新器。

### 从 DSH 源码运行

如果没有全局 `dsh` 命令，而是从 DSH 源码仓库运行，把命令前缀换成 `pnpm dsh`：

```powershell
Set-Location 'F:\dsh\deepseek-harness'
pnpm dsh plugin --profile web add @jira-workbench/dsh
pnpm dsh web
```

普通安装版 DSH 用户不要执行这一节。

## 2. 首次配置

1. 打开“设置 → 插件 → Jira 工作台”。
2. 填写 Jira 根地址，例如 `http://jira.example.com:8080`；不要填写 `/browse/...` 页面地址。
3. 填写当前用户 PAT 并保存。Token 写入 DSH credentials 的固定引用 `JIRA_WORKBENCH_TOKEN`，公开设置和 Jira Workbench 数据文件都不保存明文。
4. 从侧边栏打开“Jira 工作台”。
5. 在工作台“设置”中选择 Jira 项目，分别配置需求/Bug 面板来源、首条消息模板与 DSH Skill；“图片附件”中可选一个明确支持图片的 DSH 模型，并决定是否启用本地 OCR 降级。
6. 打开一个 Issue，在“处理上下文”中选择一个或多个 DSH 项目；需要时关联已有会话，或新建分析会话并关联。

## 3. 安装后验收

至少完成一次以下烟雾检查：

- 侧边栏“Jira 工作台”在中心区域打开，不产生第二层外部页面。
- 插件设置只显示 Jira 地址和 PAT 状态；面板来源、模板与 Skill 位于工作台设置。
- 首页能加载需求、Bug 和历史；Jira Sheets 能选择当前用户有权限的 Sheet。
- Issue 详情能显示父子上下文和附件，图片可以切换并放大预览。
- 项目候选来自 DSH workspace registry；会话候选来自 DSH session query。
- 新建并绑定会话后进入正式 DSH 会话；已绑定会话摘要栏显示 Jira 入口。
- 当前会话模型支持图片时首条消息携带原图、文件名和 Jira 来源；文本模型优先让这个新 Jira 会话使用配置的图片模型并直接接收原图，同时恢复未来新会话的默认模型。无法安全切换时再尝试结构化视觉解析与本地 OCR，均失败时仍创建会话并明确标记“图片未解析”。成功的视觉/OCR 结果按附件 ID 与文件 SHA-256 缓存。
- SVN 审核读取明确选择的工作副本；最终提交仍要求面板确认和 DSH approval。

仓库开发者还应在 Jira Workbench 根目录运行：

```powershell
npm test
```

## 4. 升级与回滚

停止 DSH 后更新到最新版本：

```powershell
dsh plugin --profile web update @jira-workbench/dsh
dsh web
```

如果需要固定或回滚到指定版本：

```powershell
dsh plugin --profile web add @jira-workbench/dsh@0.33.0
dsh web
```

升级后用 `why` 核对 Host、Core、Client 三个包版本一致，再刷新浏览器；仍显示旧界面时关闭旧标签页并使用 `Ctrl+F5`。

Jira 配置、credentials、会话绑定、项目绑定、附件缓存和 SVN 审核状态位于 `$DSH_HOME/jira-workbench`，不在 npm 包目录中，正常升级和回滚不会清除个人数据。

## 5. 卸载

停止 DSH，然后执行：

```powershell
dsh plugin --profile web remove @jira-workbench/dsh
```

重新启动 DSH 后，侧边栏入口和插件设置卡片应消失。Core 与 Client 是 Host 的依赖，由 pnpm 按依赖关系清理；不要分别手工删除 profile 内的包目录。

普通卸载会保留 `$DSH_HOME/jira-workbench`。只有明确需要彻底清除个人 Jira Workbench 数据时，才在确认路径后执行删除；该操作不可恢复：

```powershell
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dataRoot = Join-Path $dshHome 'jira-workbench'
$dataRoot
# 确认上面输出正确后再取消下一行注释。
# Remove-Item -LiteralPath $dataRoot -Recurse -Force
```

## 6. 源码开发或离线安装

普通用户优先使用 npm 安装。本节仅用于修改 Jira Workbench 源码、验证未发布版本，或无法访问 npm registry 的环境。

### 从源码安装

```powershell
git clone https://github.com/yzj555/jira-workbench.git
Set-Location .\jira-workbench
npm ci
npm run build --workspace @jira-workbench/dsh-client

$workbenchRoot = (Resolve-Path '.').Path.Replace('\', '/')
dsh plugin --profile web add `
  "link:$workbenchRoot/packages/core" `
  "link:$workbenchRoot/packages/dsh-client" `
  "link:$workbenchRoot/packages/dsh"
dsh web
```

三个 `link:` 包必须来自同一个 checkout 和同一个版本。修改 `packages/dsh-client/src` 后必须重新构建 `lib/client.js` 并重启 DSH；只修改 Host/Core 的 `.mjs` 文件也应重启 DSH，避免继续使用旧模块实例。

### 从 GitHub Release 离线安装

1. 下载同一版本的 `jira-workbench-assistant-<version>-win-x64.zip` 和 `SHA256SUMS.txt`。
2. 核对 ZIP 的 SHA-256，并解压到不会移动的目录。
3. 在解压目录使用上面的三个本地 `link:` spec 安装。

使用 `link:` 后 DSH 会继续从该目录加载包，运行期间不能移动或删除它。升级应解压到新目录、重新执行三包链接、验收成功后再删除旧目录。

## 7. 常见问题

### npm 镜像提示找不到包

先查看 pnpm registry：

```powershell
pnpm config get registry
```

如果企业镜像尚未同步 `@jira-workbench` scope，可只对本次安装指定官方 registry：

```powershell
dsh plugin --profile web add @jira-workbench/dsh --registry=https://registry.npmjs.org/
```

### `dsh` 或 `pnpm` 无法识别

确认 DSH CLI 和 pnpm 已加入 `PATH`。从 DSH 源码运行时使用 `pnpm dsh ...`，并确保 DSH 自身已执行 `pnpm install` 和 `pnpm run build`。

### 安装后没有侧边栏入口

```powershell
dsh plugin --profile web why @jira-workbench/dsh
dsh plugin --profile web why @jira-workbench/dsh-client
dsh web --dump-config
```

确认 bundle 列表包含 `@jira-workbench/dsh`，配置树存在 `jira-workbench` 与 `ui-jira-workbench` 两行。修改依赖后必须重启 DSH，浏览器端必要时使用 `Ctrl+F5`。

### 项目列表为空

项目列表只读取 DSH workspace registry。先在 DSH 中添加项目目录，再刷新 Jira 工作台；系统不会根据历史会话标题猜测项目。

### Skill 列表为空或保存后不可用

Skill 候选来自 DSH 当前加载的全局 Skill 和所选项目 Skill。确认目标项目已加入 workspace registry、Skill 能被该项目解析，再重新打开工作台设置。Skill 不可用时，新会话会安全降级到对应的需求或 Bug 模板。

### 只能看到只读工具

这是安全降级：DSH 没有提供 `ctx.approval` 时，Host 只注册只读工具，不回退为自动许可。检查当前 profile 是否挂载 approval 服务。

### Jira 配置保存失败

确认 Jira 根地址可从本机访问、PAT 仍有效，并确认 DSH credentials provider 可写入 `JIRA_WORKBENCH_TOKEN`。不要把 PAT 手工写入公开 `config.json`。

### SVN 无法读取工作副本

确认 Issue 已绑定一个或多个 DSH 项目，并在当前操作中选择了明确的 SVN 主目录。随后运行 `svn info <目录>`，确认当前系统用户的 SVN 客户端和凭据缓存可用。会话关联本身不会决定 SVN 目录。

## 8. 维护者发布

npm 包发布、首次人工发布、GitHub Trusted Publishing 和版本回滚规则见 [PUBLISHING.md](PUBLISHING.md)。
