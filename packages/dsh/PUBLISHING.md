# npm 发布流程

本文面向 Jira Workbench 维护者。普通用户只需执行：

```powershell
dsh plugin --profile web add @jira-workbench/dsh
```

## 发布内容

每个版本按以下顺序发布三个公开包：

1. `@jira-workbench/core`
2. `@jira-workbench/dsh-client`
3. `@jira-workbench/dsh`

用户只安装第三个包。Host 用精确版本依赖前两个包，避免 Core、Client 与 Host 混用不同版本。

## 首次发布前准备

- npm 组织 `jira-workbench` 已创建，发布账号是该组织 owner。
- npm 邮箱已经验证。
- npm 账号启用 `auth-and-writes` 双重验证。
- 本机登录官方 registry：

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm org ls jira-workbench --registry=https://registry.npmjs.org/
```

仓库可以继续使用企业 npm 镜像安装依赖；三个包的 `publishConfig.registry` 已固定为官方 npm，不会误发到镜像。

## 准备新版本

npm 已发布版本不可覆盖。修改版本时只运行仓库脚本，不要分别手工改多个 manifest：

```powershell
node packages/codex/scripts/set-version.mjs 0.33.0
npm install --package-lock-only --ignore-scripts
npm test
npm run release:npm:verify
```

`release:npm:verify` 会执行三个 `npm pack --dry-run`，核对名称、统一版本、公开 registry、Host 精确依赖及关键运行文件。发布前还要检查：

```powershell
git status --short
git diff --check
node packages/codex/scripts/verify-release-version.mjs v0.33.0
```

确认没有 Token、凭据、缓存、测试输出或本机绝对路径进入 tarball。版本源代码应先提交并推送到 `main`，再上传 npm；这样 npm 页面指向的 GitHub 源码与包内容一致。

## 第一次人工发布

Trusted Publisher 只能在 npm 包已经存在后从包设置页配置，因此三个包的首个版本需要在维护者机器上人工发布一次：

```powershell
npm run release:npm:publish
```

脚本按 Core → Client → Host 顺序发布，并在每次上传前确认目标版本尚不存在。npm CLI 会按账号策略要求输入一次性验证码。任何一个包失败都会立即停止，不会对已经成功的 npm 版本做覆盖或删除。

发布后核对：

```powershell
npm view @jira-workbench/core@0.33.0 name version dist.integrity --registry=https://registry.npmjs.org/
npm view @jira-workbench/dsh-client@0.33.0 name version dist.integrity --registry=https://registry.npmjs.org/
npm view @jira-workbench/dsh@0.33.0 name version dependencies --registry=https://registry.npmjs.org/
```

再用一个测试 DSH profile 执行真实安装与启动烟雾检查。

## 配置 GitHub Trusted Publishing

首次发布完成后，分别进入三个 npm 包的 Settings → Trusted Publisher，添加相同的 GitHub Actions publisher：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `yzj555` |
| Repository | `jira-workbench` |
| Workflow filename | `release.yml` |
| Environment | 留空 |

仓库的 `.github/workflows/release.yml` 已给 npm job 配置 `id-token: write`，并在 GitHub 托管 runner 上使用 Node 22.19 与 npm 11。正式 tag 构建完成后，该 job 会：

1. 构建并检查 DSH Client。
2. 执行三个 tarball 内容检查。
3. 按顺序发布 registry 中尚不存在的包。
4. 使用 npm provenance 记录 GitHub Actions 来源。

首个版本若已由人工发布，tag job 会识别到同版本已存在并跳过，不会重复上传。

## 后续正式发版

1. 用 `set-version.mjs` 设置新版本。
2. 执行全量测试、pack 检查与版本一致性检查。
3. 审核变更，提交并推送 `main`。
4. 在同一个已推送提交上创建并推送 `vX.Y.Z` tag。
5. 等待 Release workflow 完成 GitHub Release 和 npm 发布。
6. 核对三个 npm 包的版本、integrity、provenance，并从 registry 安装到测试 profile。

不要从本地再发布同一个正式版本，也不要移动 tag。失败时先判断哪些包已经存在；修复原因后用 workflow rerun。`--if-missing` 只补缺失包，不会覆盖已发布版本。

## 撤回与回滚

- npm 版本不可覆盖；代码修复必须发布更高版本。
- 已安装用户可用 `dsh plugin --profile web add @jira-workbench/dsh@<旧版本>` 回滚。
- 除非确认版本泄露凭据或包含严重安全问题，不使用 `npm unpublish`。常规问题应发布修复版本，并按 npm 规则对坏版本执行 `npm deprecate`。
- npm tag、GitHub tag 和仓库版本必须保持一致。
