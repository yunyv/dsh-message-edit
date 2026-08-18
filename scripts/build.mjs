/**
 * Build the Host and Browser halves of dsh-message-edit.
 *
 * - Host: bundles src/index.ts into index.mjs (ESM, @deepseek-ai/* external).
 * - Client: bundles src/client/index.ts into client.js + client.js.map, wrapped
 *   in the platform's window.__ModuleLoader__.load({ id, factory }) handoff.
 *   CSS Modules are compiled by lightningcss into a hashed class map plus an
 *   idempotent <style data-plugin> injection, mirroring the DSH client preset.
 */
import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const ID = '@yunyv/dsh-message-edit'

/** Platform modules resolved from the loader module table at runtime. */
const CLIENT_EXTERNALS = [
  '@deepseek-ai/dsh-client-runtime/client',
  'react',
  'react/jsx-runtime',
]

/** Compile one .module.css into a hashed class map + inline <style> injection. */
const cssModulePlugin = {
  name: 'css-modules',
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, async (args) => {
      const source = await readFile(args.path)
      const { code, exports: cssExports } = transform({
        filename: args.path,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return {
        contents: [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${ID}/${basename(args.path)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n'),
        loader: 'js',
      }
    })
  },
}

// Host half: plain ESM bundle, all @deepseek-ai/* resolved by the host loader.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  external: ['@deepseek-ai/*'],
  outfile: 'index.mjs',
  logLevel: 'info',
})

// Browser half: closure-factory artifact consumed by window.__ModuleLoader__.
await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  jsx: 'automatic',
  external: CLIENT_EXTERNALS,
  plugins: [cssModulePlugin],
  outfile: 'client.js',
  sourcemap: true,
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})
