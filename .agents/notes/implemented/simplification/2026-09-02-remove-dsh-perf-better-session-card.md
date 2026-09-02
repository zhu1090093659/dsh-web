# Agent Note: Remove the dsh-perf Better Session card and the bsm migration core

Status: implemented

## Problem

The dsh-perf Better Session card kept managing the @morlay/better-session integration after that integration had already left the aggregate ([drop-deprecated-better-session-integration](2026-09-02-drop-deprecated-better-session-integration.md)). Its enable switch rewrote managed overrides for aggregate rows that no longer exist, so the card could only ever show the inactive posture (stock jsonl storage) — the enable-and-migrate path led nowhere. Keeping it cost a host-side module directory (`src/bsm/`: routes, service, migration core and runner, legacy-log codec, profile managed blocks, import worker entry), a client card with its own dictionaries, a standalone build artifact behind a package export, five test files, and 24 centrally maintained ru keys — all riding every build, audit, and cohort move.

## Decision

The management surface is removed from dsh-perf entirely. `src/bsm/` and the client card module are deleted; the perf settings card no longer mounts a Better Session section; the client half registers only the perf dictionaries under the dsh-perf namespace; the `./better-session-import` export and its tsdown companion build are dropped; the five bsm test files go away; the central dsh-i18n ru dictionary loses its 24 `bsm.*` keys; and the i18n audit's package table lists dsh-perf's single dictionary module again. The e2e mount comment now states the integration is removed rather than inactive.

dsh-perf is a pure performance-observation plugin again: meter, HUD, stats routes, the write-batch tuning row, integrity observer, list gate, and its settings card.

## Alternatives considered

- Keep the card as a read-only legacy-session inventory (it still counted 326 legacy jsonl sessions across 25 projects): rejected — no action sat behind the display, and inspecting legacy sessions belongs to the session-archive plugin.
- Keep the migration core as a dormant library for a future import feature: rejected — dead sqlite/wire contract code with five test files is a permanent maintenance tax; the jsonl.zstd decode knowledge lives in the retired notes and git history.

## Consequences

No enable or migrate path back to RDB persistence exists in this repository; environments that still run better-session install it against their own profile. Legacy jsonl sessions simply remain jsonl — the stock backend owns storage, so no migration is offered or needed. The `/api/dsh-perf/better-session/*` routes and the `bsm.*` locale keys disappear; a managed block that an earlier enable action wrote into a profile patch degrades to an inert marker comment whose target rows no longer exist. dsh-perf's npm payload shrinks by the import-runner artifact and the card code.

## Testing

dsh-perf `pnpm build` rebuilds both halves without the import-runner companion; `vitest run` passes 45/45 across the remaining six files; `tsc --noEmit` is clean. The workspace gates pass: `pnpm typecheck`, `pnpm test`, `pnpm test:scripts` (237/237, including the updated i18n-audit suite), `pnpm i18n:check` (16 namespaces, 1278 zh = 1278 ru keys), `pnpm docs:check`.
