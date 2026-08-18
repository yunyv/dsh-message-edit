# DSH Message Edit

[![npm version](https://img.shields.io/npm/v/@yunyv/dsh-message-edit)](https://www.npmjs.com/package/@yunyv/dsh-message-edit)
[![npm downloads](https://img.shields.io/npm/dm/@yunyv/dsh-message-edit)](https://www.npmjs.com/package/@yunyv/dsh-message-edit)
[![license](https://img.shields.io/npm/l/@yunyv/dsh-message-edit)](LICENSE)
[![CI](https://github.com/yunyv/dsh-message-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/yunyv/dsh-message-edit/actions/workflows/ci.yml)

Event-sourced **message editing, rerolling, retrying, and version navigation**
for [DeepSeek Harness](https://github.com/deepseek-ai/dsh). The plugin never
rewrites history events and never touches the DSH engine internals: every
edit, reroll, or retry forks a new session version before the target turn,
while the original session is always preserved and can be switched back to at
any time.

## Compatibility

- Works with DSH **0.1.0-rc.6**, **0.1.0-rc.7**, and newer.
- Version events (`message-edit/version`) carry `ignorable: true` on the event
  envelope: newer DSH builds skip unknown event types marked ignorable instead
  of refusing the entire log, so session history stays loadable across DSH
  upgrades.

## Features

- **Edit messages**: settled user text, `assistant.reasoning` thinking blocks,
  and `assistant.response` reply text are all editable.
- **Rerun**: fork before the turn of the last settled assistant reply and
  regenerate from the original user input.
- **Retry any turn**: pick any historical turn in the Timeline and re-execute it.
- **Cascade policies**:
  - `truncate` (default): re-execute only the target input, dropping the old
    tail after that point.
  - `preserve`: keep the following user inputs and re-execute them in order on
    the new branch; assistant outputs and tool chains are fully regenerated.
- **Version switching**: `←` in the session title bar undoes the current atomic
  effect, `→` re-applies the latest direct child effect; the Timeline shows the
  full known branch tree, operation time, before/after content, and the
  current version.
- **Timeline tab**: registered on `conversation.view`, `order: 15`, between
  Trajectory (10) and Prompt Studio (20).

## Installation

```bash
# npm
dsh plugin --profile web add @yunyv/dsh-message-edit

# or GitHub
dsh plugin --profile web add github:yunyv/dsh-message-edit

# or local development (link mode)
dsh plugin --profile web add -w link:/path/to/dsh-message-edit
```

`dsh plugin` is a pnpm forwarder: after `add`, the `dsh.bundle` declaration is
recognized and the plugin is adopted into the profile's `dsh.profile.bundles`;
restart dsh for it to take effect.

## Design

### Temporal composition

The plugin treats a **complete turn** as the atomic effect. The target turn's
`turn/start`, model request, tool calls, tool results, and `turn/end` are never
partially copied and spliced; a new version forks from a closed boundary before
that turn:

1. User-message edit, Reroll, and Retry: roll back the whole target turn, then
   hand the target user input to the Agent as a new turn.
2. Assistant-block edit: roll back the whole target turn and construct a new
   complete closed turn from the original user input plus the edited assistant
   content; the original tool chain does not enter the new version. With
   `preserve`, the following user inputs are re-executed in order, producing a
   fresh tool chain.
3. Each version appends an inseparable `message-edit/version` effect pair:
   `effect` records the forward effect, `inverse` records the restore target.
   The parent chain derives composite inverses automatically; restoring is not
   event deletion but switching along the inverse chain to a version that still
   exists.
4. Message-history transforms do not commute, so undo follows LIFO: only the
   current atomic effect is undone at a time, keeping earlier effects; every
   successor branch is retained and can be re-applied from the parent version.

### Branching and Agent wiring

1. Inside the source Agent's `runMaintenance()`, take an immutable seed from
   the closed boundary; before the first turn, use an empty seed.
2. Append the version effect pair and an optional manual assistant turn with
   local pure event constructors, then call `ctx.agents.create({ seed, meta })`.
   The Session validates the whole seed once before Agent construction; any
   failure is structurally reverted by AgentFactory, so observers never see a
   half-built Session and the Agent's turn count initializes directly from the
   full history.
3. Call `ctx.sessions.flush()` after publishing, establishing a durability
   barrier before the HTTP operation succeeds.
4. Workspace attachment and child-Agent lifecycle each return an atomic
   inverse; on failure they are composed in reverse order. The child input is
   then queued via `child.agent.followup()`.

This path never touches `ReactLoopAgent`, AgentLoop private methods, or
apiproxy's narrowed fork RPC; branch seeds still pass through the same public
Session event contract.

### Spatial composition

- Host depends only on the public `sessions`, `agents`, `sessionPersistence`,
  `sessionQuery`, `workspaceRegistry`, and `webServer` services.
- Browser composes only `slots`, `conversation`, `connection`, and runtime
  `sessions` services.
- The Timeline and title bar share a value-level Snapshot source keyed by
  `sessionId`; the controller reactively subscribes to the current Session's
  closed turns and the lineage values in the Session list, rebinding on
  Session identity replacement without caching stale Session objects.
- Version navigation waits for the runtime Session list to publish the
  matching ID before `ctx.sessions.open()`; availability changes drive
  navigation directly.

## Data model

Each plugin version contains one `message-edit/version` event in its own
non-inherited suffix:

```ts
interface MessageEditVersionEvent {
  schemaVersion: 2
  effect: {
    id: string
    operation: 'edit' | 'reroll' | 'retry'
    cascade: 'truncate' | 'preserve'
    targetTurn: number
    targetEventSeq: number
    targetBlockIndex?: number
    blockKind?: 'user' | 'assistant.reasoning' | 'assistant.response'
    before?: string
    after?: string
  }
  inverse: {
    kind: 'restore-version'
    sessionId: string
  }
}
```

The session header's `parentSession` builds the version tree and must match
`inverse.sessionId`; `seedLength` separates the current version's own metadata
from same-named events inherited from ancestors. The Timeline derives the full
value-level projection via `ctx.sessionQuery.traceSession()` and
`readSession()`, and exports `undoStack` and direct `redoSessionIds` from the
atomic inverse chain. Legacy flat events remain readable and normalize to the
same effect pair in the projection.

## UI

- `conversation.view`
  - `id: message-edit-timeline`
  - `order: 15`
  - `label: Timeline`
- `conversation.session.header.actions`
  - `id: message-edit-controls`
  - undo the direct parent effect, re-apply the latest direct child effect,
    effect-chain count, rerun the last reply
- `conversation.chat.assistant-actions`
  - `id: message-edit-assistant-actions`
  - per-message edit / retry buttons riding the official per-message action
    slot (`messageId` dispatch); user messages have no such slot and are
    covered by DOM injection

Components use CSS Modules and `--dsw-*` semantic tokens with no UI library.
Product copy is Chinese; code comments are English.

## HTTP API

- `GET /message-edit?sessionId=<id>`: readable messages, retryable turns, and
  the full version tree.
- `POST /message-edit`: run `edit`, `reroll`, or `retry`; returns the newly
  published Session ID.

## Build

```bash
npm install
npm run build
```

Source lives in `src/` (host at `src/index.ts`, browser at `src/client/`); the
build script is `scripts/build.mjs` on top of esbuild + lightningcss:

- Host: `src/index.ts` → `index.mjs` (ESM, `@deepseek-ai/*` external)
- Browser: `src/client/index.ts` → `client.js` + `client.js.map`
  (`window.__ModuleLoader__.load` closure factory; CSS Modules are compiled by
  lightningcss into a hashed class map plus idempotent `<style data-plugin>`
  injection)

`npm run typecheck` (`tsc --noEmit`) validates types; `npm run build` emits
both halves.

## Scope

- Never rewrites Session events; history is append-only and deep-frozen.
- Does not restore or modify workspace files, external command effects, or
  existing artifacts.
- Does not modify the DSH engine, apiproxy, or official UI packages.

## License

MIT — see [LICENSE](LICENSE).
