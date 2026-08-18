# Contributing

Thanks for your interest in `@yunyv/dsh-message-edit`!

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # esbuild + lightningcss → index.mjs / client.js / client.js.map
npm run check       # typecheck + build
```

## What to touch

- Host logic: `src/index.ts` (Cordis plugin, session versioning, HTTP API)
- Browser UI: `src/client/` (Timeline, header controls, assistant-actions slot)
- Build: `scripts/build.mjs`

## Before submitting

1. Run `npm run check` — the build must reproduce committed artifacts
   byte-for-byte (`git diff --exit-code -- index.mjs client.js client.js.map`).
2. If you change behavior, update `README.md` and `README.zh.md` together and
   refresh the hashes in `README.i18n.yaml`
   (`git hash-object README.md && git hash-object README.zh.md`).
3. Bump the version in `package.json` and add a `CHANGELOG.md` entry.

## Scope

The plugin never rewrites Session events, never touches the DSH engine
internals, and does not modify workspace files or external artifacts.
