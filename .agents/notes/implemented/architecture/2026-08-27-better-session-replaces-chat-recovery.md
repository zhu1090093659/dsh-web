# Agent Note: branching session editing moves to external better-session; dsh-chat-recovery retired

Status: implemented

Supersession check: no active Note owns session-edit capability strategy. [task-handoff-issue-316-edit-retry](../../../docs/archive/task-handoff-issue-316-edit-retry-2026-08-17.md) (archive) produced chat-recovery itself and is frozen history. The 2026-08-24 dock-chrome and 2026-08-25 workshop-fixes bug-fix Notes mention chat-recovery only as past-tense fix records inside unrelated subjects and stay untouched.

## Problem

dsh-chat-recovery and the upstream [morlay/better-session](https://github.com/morlay/better-session) overlap on the same user-facing surface (edit a past message, retry a turn) with different depth:

- chat-recovery is fork-only by design: every edit cuts a child branch before the affected message, only the last completed user message is editable, retry targets failed turns only, and repeated retries grow a session-tree tail of stale children the client runtime cannot delete.
- better-session implements true in-place editing over an RDB (`ctx.sessionPersistence` replacement): edit / reroll / retry / rewind rewrite the same session id, only fork derives a new id, and live (open) sessions support rewind. Deltas never hit storage; events renumber densely.

With maintainer approval obtained from the upstream author (morlay) on 2026-08-27, running both plugins together duplicates entry points and render shadows (`conversation.chat.node`, turn-tail buttons), so the fork-based plugin had to go.

## Decision

- Ingestion follows the established external-integration pattern used for `dsh-better-sidebar` and `@mlgbnb/dsh-archive-manager`: consume the upstream **npm package** (`@morlay/better-session@0.0.11`, registry-readable, SDK cohort rc.2-compatible), pinned in `packages/dsh-web-all/package.json`; no source is vendored into this repository.
- Aggregate manifest (`aggregate.yml`) gains an external row `{"id": "better-session", "name": "@morlay/better-session"}` rendered after the patchFrom blocks, so the plugin's rewiring applies after the jsonl tuning row; regenerated artifacts committed. MIT license recorded in the root licensing sections (both languages).
- Because `@morlay/better-session` ships as a profile bundle (its `dsh.bundle.patch` inserts the importable child plugins), the aggregate generator expands bundle rows: `dsh-better-sidebar`, `@mlgbnb/dsh-archive-manager`, and `@morlay/better-session` all contribute their patch rows to `cordis.patch.yml`, the insert ids stay namespaced (`web-ui-*`), and the bundle's own harness-row patches (such as disabling `session-persistence-jsonl`) are preserved. `link-profile.mjs` also links bundle child packages into the profile layer so aggregate rows resolve them from the profile root.
- `packages/dsh-chat-recovery/` is deleted outright, including its aggregate manifest entries, telemetry sync target, and publish-prep row (family package count 19 -> 18).
- Historical records that mention chat-recovery (release notes, archive snapshots, past fix Notes) stay frozen; the community index never registered it.

## Alternatives considered

- **Porting better-session source into packages/**: rejected - the owner's convention is that ingested third-party plugins ride their released npm packages; vendoring three packages (~10k lines with contract tests against persistence internals) creates a second maintenance site and drifts from upstream immediately.
- **Keeping both plugins** (better-session for edit/retry/rewind, chat-recovery for its supervisor UI): rejected - duplicate conversation.chat.node shadows and turn-tail slots double render work and confuse entry points; the supervision niche (explicit one-click retry of failed turns with visible fork warnings) is subsumed by better-session's safer in-place retry.
- **Keeping chat-recovery for non-aggregate installs**: rejected - the package no longer has a distinguishing capability; standalone users install `@morlay/better-session` directly.

## Consequences

- Storage surface changes when the aggregate loads better-session: its bundle patch swaps `ctx.sessionPersistence` from the jsonl files under `$DSH_HOME/sessions/` to `$DSH_HOME/sessions/sessions.sqlite`. There is **no migration toolchain**: existing jsonl sessions are invisible to the new backend until reopened through their own store; users upgrading the family bundle must be told prominently. (Rollout update, same day: the integration now ships inactive by default with a jsonl importer — see [better-session-default-off-and-jsonl-import](2026-08-27-better-session-default-off-and-jsonl-import.md).)
- Editing semantics improve: in-place rewrite keeps one canonical log per session; no stale-child accumulation; first-turn edits no longer fall back to a blank session.
- Single-writer-per-session guard: concurrent hosts sharing one sqlite store fail loud instead of interleaving logs (multi-process safe across different sessions only).
- Performance governance interplay shifts: dsh-perf's restated jsonl write-batch row stops matching once jsonl rows are superseded; its observe/degrade halves remain valid, and PerfMeter becomes the A/B measurement tool for jsonl vs rdb write behavior.
- Upstream pinning means future breakage follows the cohort-review path like any external dependency bump.

## Testing

- `node scripts/aggregate.mjs --check` passes after regeneration (19 rows / 17 deps); artifact diff reviewed.
- `pnpm docs:check`, `pnpm test:scripts` (102 copy entries, 42 client trio), and residual-reference greps pass; release-assets fixture updated to a live package name.
- Workspace typecheck and vitest run as pre-merge evidence; runtime verification requires restarting `dsh web` with the rebuilt profile (documented in the delivery report).
