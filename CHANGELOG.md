# Changelog

All notable changes to this project are documented in this file.

## [0.2.8] - 2026-08-18

### Fixed

- Path-independent CSS module hashing: `scripts/build.mjs` passes the
  project-relative filename to lightningcss, so class-name hashes no longer
  depend on the checkout path and builds are byte-reproducible across machines
  (CI gate: `git diff --exit-code` on built artifacts).

## [0.2.7] - 2026-08-18

### Added

- Repo packaging pass: `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`,
  bilingual README (`README.md` + `README.zh.md` + `README.i18n.yaml`
  consistency record), CI workflow (typecheck + build + reproducible-build
  gate), `.npmrc`, `.gitattributes`.
- `package.json`: `engines`, `peerDependencies`, `publishConfig` (public
  access), `files` (src + zh readme), `check` script, fuller keywords.

## [0.2.6] - 2026-08-18

### Fixed

- Scoped package identity: `scripts/build.mjs` now emits the `@yunyv/dsh-message-edit`
  module id and CSS plugin tags, and `cordis.patch.yml` references the scoped name.
  Rebuilt `client.js` / `client.js.map` / `index.mjs` accordingly.

## [0.2.5] - 2026-07-18

### Changed

- Assistant message edit/retry now rides the official
  `conversation.chat.assistant-actions` slot (`messageId` dispatch); the
  MutationObserver is scoped to user messages only (no user slot exists).
- Forked versions join the source agent's standing composition via
  `AgentPresets.composeFrom` instead of re-resolving the roster, avoiding
  generation drift when preset files change.

### Added

- Full `src/` tree (host + client + CSS modules) and a working
  `scripts/build.mjs` (esbuild + lightningcss) so `npm run build` reproduces
  `index.mjs` / `client.js` / `client.js.map` with clean relative sourcemap
  paths; `tsconfig.json` + `typecheck` script.

## [0.2.4] - 2026-08-18

### Fixed

- DSH compatibility: `message-edit/version` events now carry `ignorable: true`
  on the event envelope (new events and inherited ones). Newer DSH builds skip
  unknown event types marked ignorable instead of refusing the whole log,
  keeping session history loadable across DSH upgrades (rc.6 / rc.7+).
