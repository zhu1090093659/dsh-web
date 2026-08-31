# Agent Note: dsh-perf render pipeline batch 2 (settle flip queue, weighted heaviness, list publish gate, stream cooldown)

Status: implemented

Follows [dsh-perf render shadow rework](../bug-fix/2026-08-26-dsh-perf-render-shadow-rework.md).

## Problem

A three-way bundle audit of the official DOM rendering pipeline (conversation / renderer+frontend markdown / runtime+sidebar, all evidence with file:line in the shipped lib bundles) produced four plugin-reachable findings, ordered by user-visible impact:

1. **Settle flip bursts (from our own shadow)**: the look-preserving shadow gave every heavy message an independent 600 ms timer, so opening a session or ending a multi-step turn flipped N heavy messages in the same frame - one synchronous burst of N x (full markdown parse + per-fence shiki `codeToHtml` + per-formula KaTeX `renderToString` + innerHTML parse). The official pipeline has no staggering (no `requestIdleCallback`/`scheduler.postTask` anywhere in the bundle).
2. **Heaviness blind spot**: `blockChars` counted raw text characters only. A "12 code fences x 400 lines ~ 15k chars" message stayed under the 20k threshold, yet chat code blocks have NO line cap (unlike ReadBlock/DiffBlock/TerminalBlock at 16 lines), so its settle burst is as heavy as a giant message. Assistant `data.blocks` only has three kinds (text / reasoning / tool-call); fences are markdown source inside text blocks.
3. **Sidebar list publish waste**: `projectList` (dsh-client-runtime L9216-9284) rebuilds `{ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress}` as fresh objects on every manager flush, and the tree components subscribe with `useSessions((s) => s)` (workspace lib L1201/L1471/L1589, no equality fn). During streaming the flush body is usage/token projection frames where only `byId[].projectionValues` identity changes - zero sidebar-visible change, yet the whole tree re-renders. Measured on the live account (1704 sessions): 30 such wasted publishes in 30 s.
4. **Streaming re-parse O(n^2) on giant single nodes**: the official incremental parser freezes completed top-level nodes, but a giant open fence / blank-line-free paragraph pins `tailStart` to 0, and the DeepSeek host adapter streams a whole reply as one text block. Block-level memo / tail-window rendering must live inside the official renderer (splitting blocks breaks spacing: `p{margin:16px 0}` + `gap:16px` turn 16px into 48px) - confirmed outside plugin reach.

## Decision

- **#1 settle flip serialization queue** (`perf-flip-queue.ts`): one module-level FIFO. Each enqueue keeps the original 600 ms minimum delay (`eligibleAt`); the queue flips ONE message per `intervalMs` (default 120, `dsh-perf-flip-interval`). Turns an N-message same-frame burst into N spread frames. Look stays pixel-identical; only flip timing changes.
- **#2 weighted heaviness** (`perf-heaviness.ts`): `scoreBlocks` = text chars + fence chars x1 extra (regex `/```[\s\S]*?(```|$)/g`) + formula count x 1000 (O(n) delimiter scan `$$` / `\[`, no catastrophic regex) + reasoning x 0.2 + tool-call argsRaw x 0.25.
- **#4 session-list publish gate** (`perf-list-gate.ts`): a method-level patch of `sessions.list.set` (the store object is shared, so the official `this.list.set` call sites route through the gate). Each publish is compared against the currently published snapshot over sidebar-visible fields (all entry fields except `projectionValues` identity, ids order, current, phase, currentAddress, subagentsByParent/jobsBySession content). Visible changes publish immediately with the latest projections; projection-identity-only publishes coalesce to a ~1 s trailing flush (`dsh-perf-list-coalesce`, default 1000 ms). The one perceptible cost: the subagent lineage header token counter refreshes at ~1 Hz instead of per usage frame. Dispose restores the original `set` and flushes any pending snapshot. Measured live: 30 wasted tree re-renders in 30 s dropped to 3 trailing flushes.
- **Sidebar row degrade CSS**: dsh-better-sidebar (third-party, renders the sidebar) mounts every row of a group in one shot on "expand rest" (395 rows = ~4-7k DOM nodes, zero React.memo in its 642KB bundle) and holds a childList+subtree MutationObserver on #root. dsh-perf's degrade stylesheet now also applies content-visibility:auto + contain-intrinsic-size 32px to sidebar session rows (class substring _sessionRow scoped under _sidebarCol; fails open if upstream renames). Upstream issue: https://github.com/omdsh-dev/DSH-better-sidebar/issues/403. Removed again in [dsh-perf sidebar row degrade CSS removal](../simplification/2026-08-28-dsh-perf-sidebar-row-degrade-css-removal.md): the fixed 32px placeholder pinned rows to fixed positions and fought dsh-better-sidebar's own layout, so the degrade stylesheet is back to message rows only. The same audit found @omdsh-dev/dsh-annotation running a 1Hz full-document scan (decorateAll: querySelectorAll('[data-chat-flow-kind]') + per-row subtree query + textContent reads) - cost grows linearly with context length; not yet reported upstream.
- **#5 streaming forward cooldown** (in `perf-assistant-shadow.tsx`, `dsh-perf-stream-cooldown` ms, default 0 = off): while a node streams, forwards the previous node reference inside the cooldown window so the official `memo(assistant-step)` skips the frame entirely; a trailing timer guarantees catch-up. Text appears in coarser jumps - a visible difference, hence opt-in.
- **#3 ConversationRoot shell re-render every frame - NOT implemented, upstream only.** Blocked at every plugin layer, with evidence: the three shell slots (`conversation.session` / `conversation.session.header` / `conversation.composer.bar`) are `kind:"single"` whose winner entry supplies `store` + `inject` (kit is built from the winning entry in renderer `standardKit`/`cachedSessionInject`), and the official registrations close over package-internal state (`inputHub`, `submissionPolicy`, `views`), so a shadow cannot supply equivalent props. A store-level fix is also impossible: zustand notifies only on identity change, and chat seats require per-flush notification, so the outer snapshot identity must change. The correct fix is upstream: field-level selectors in `ConversationRoot` (conversation lib L7155-7162 `useSession((s) => s)` + `useInput((s) => s)` + `useWorkspaces((s) => s)`) and a memoized `InputBar`.

## Upstream recommendations (recorded, not implemented)

- `subagent.history` / `session.history` responses are uncompressed raw event streams: a subagent session open fetches 12.3 MB / 65,844 events for ~188k chars of reasoning (65x amplification by reasoning-delta/tool-call-delta chunks); `maxMessages` paginates by message count so a 49-message session is one page. Enable gzip, add a projection-first load path, and reconsider chunk-level paging.
- `ConversationRoot` whole-object subscriptions (above).
- Global language-load re-highlight storm: the shiki language generation counter `Wu` is in every CodeBlock memo dep, so any newly loaded language re-highlights every code block on the page.
- KaTeX has no cache; identical formulas across messages re-run `renderToString` + `DOMParser`.
- `locations.touch` is O(turn) per chunk; scroll container does a forced layout per frame while at bottom.
- No mermaid renderer exists anywhere in the official tree (an earlier assumption was wrong).

## Consequences

- New localStorage knobs (all optional, debug-oriented): `dsh-perf-flip-interval` (120), `dsh-perf-list-coalesce` (1000), `dsh-perf-stream-cooldown` (0), `dsh-perf-debug` (1 exposes `window.__dshPerfListGate` counters and flip logs).
- The list gate follows the master switch + `renderDegrade`; it is idempotent against HMR double-install and restores the original `set` on dispose.
- Risk watch: the gate patches a method on a non-public store shape (`sessions.list`); if upstream renames it, install logs a warn and skips (fail-open).

## Verification

- `pnpm --filter @linxin666/dsh-perf test`: 28/28 (heaviness 8, flip-queue 4, list-gate 10, integrity 6); typecheck and build pass; `pnpm docs:check` passes.
- Live headless CDP on the real 127.0.0.1:3080 GUI: flip queue debug logs show 4 heavy messages enqueued then flipped one at a time with zero >50 ms longtasks (previously a single ~200 ms burst); list gate counters during active streaming: 10 immediate publishes / 30 coalesced / 3 trailing flushes in 30 s; highlighted code spans present after flips (no message stuck unhighlighted).
- Blocked check: a concurrent session edited `~/.dsh/profiles/web/package.json` at 10:32 and broke web boot (`dsh-client-ui-subagent` pending on a `slash` service no active plugin provides), so full-GUI visual verification of the sidebar was deferred; the gate mechanics are covered by unit tests and live counters.
