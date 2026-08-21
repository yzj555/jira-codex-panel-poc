/**
 * jira-workbench 的 DSH 客户端 UI 插件，node half。
 *
 * 空 apply：本半侧不注册任何 host 服务，只为让 @jira-workbench/dsh 的
 * cordis.patch.yml 能挂载本包（客户端扫描据此发现 package.json 里的
 * `dsh.client` 声明并 serve `./client`）。全部业务状态在外部
 * `@jira-workbench/dsh` host 插件（工具、settings namespace、看板路由）。
 */

/** Host 插件体——本 UI 包无 host 侧行为。 */
export function apply() {}
