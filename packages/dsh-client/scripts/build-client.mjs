/**
 * 构建 jira-workbench 的 DSH 客户端 bundle（`lib/client.js`）。
 *
 * 复刻 DSH `packages/client/tsdown.client.ts` 的 `clientBundle` 预设输出格式，
 * 使本包能被 DSH 的客户端模块系统（`window.__ModuleLoader__.load`）正确加载：
 *
 * - 外层：`window.__ModuleLoader__.load({ id, factory: (require) => { … } })`，
 *   工厂内部 `var module = { exports: {} }; var exports = module.exports;`。
 * - externals（走工厂参数 `require`，由 DSH shell 的冻结模块表回答）：
 *   react / react/jsx-runtime / @deepseek-ai/dsh-client-runtime/client /
 *   @deepseek-ai/dsh-client-ui-primitives。
 * - clsx 等非 externals 依赖内联进 bundle。
 * - CSS Modules：lightningcss 编译成 `[hash]_[local]` class map，并把样式文本
 *   注入一个 `<style data-plugin-css>` 标签（幂等，卸载时由加载器移除）。
 *
 * 本脚本是有意的最小复刻，只覆盖本包用到的 externals 与 CSS 形状；DSH 未来
 * 若改 bundle 协议（banner/externals/CSS 注入），需同步跟进（见包 README 的
 * Known Limitations）。
 *
 * @module scripts/build-client
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

/** 包名：stamp 进 `__ModuleLoader__.load` 的 id 与 `<style>` 标签。 */
const ID = '@jira-workbench/dsh-client'

/** 值 import 的 externals（运行时由 DSH shell 的模块表回答）。 */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** CSS Modules 插件：拦截 `*.module.css`，产出 class map + 样式注入代码。 */
const cssModulesPlugin = {
  name: 'dsh-css-modules',
  setup(buildContext) {
    buildContext.onLoad({ filter: /\.module\.css$/ }, async (args) => {
      const source = await readFile(args.path)
      const { code, exports: cssExports } = transform({
        filename: args.path,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      // lightningcss 返回的 exports 键序不稳定（内部 hash map），而对象字面量
      // 的键书写顺序会进产物、破坏可复现构建。按 local 名排序后重建，保证
      // 同一源码两次构建产出 byte-identical 的 lib/client.js。
      const classMap = {}
      for (const local of Object.keys(cssExports ?? {}).sort()) classMap[local] = cssExports[local].name
      // 复刻 tsdown.client.ts 的注入代码：一个 <style data-plugin-css> 标签，
      // 幂等（已存在则不重复注入）。
      const lines = [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${ID}/${args.path.split(/[\\/]/).pop()}`)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        `  tag.dataset.pluginCss = tagId;`,
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ]
      return { contents: lines.join('\n'), loader: 'js' }
    })
  },
}

// esbuild 输出顺序：banner → 打包体 → footer。banner 同时带 factory 开头与
// module/exports 声明（两行连续），复刻 DSH 协议：
//   window.__ModuleLoader__.load({ id, factory: (require) => {   ┐ banner
//   var module = { exports: {} }; var exports = module.exports;   ┘
//   … 打包体（externals 走 require，clsx 内联，CSS 注入）…
//   return module.exports; } });                                  ← footer
await build({
  entryPoints: [join(pkgRoot, 'src', 'client', 'index.ts')],
  outfile: join(pkgRoot, 'lib', 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: EXTERNALS,
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  plugins: [cssModulesPlugin],
})

console.log(`[dsh-client] built lib/client.js`)
