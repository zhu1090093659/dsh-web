# Agent Note: Task Board Remote Model Inject, Pet Remainder Carry, and Preset SemVer Update Check

Status: implemented

## Problem

### 1. Task board execution settings model dropdown only lists host default with un-injected remote.session exception (Issue #1486)
In `dsh-task-board`, the client `inject` declaration only declared `'remote'`, without the dotted sub-namespace `'remote.session'`. When accessing `ctx.remote.session`, the Cordis service proxy threw `cannot get property "remote.session" without inject`, aborting retrieval. Furthermore, model fetching relied solely on legacy connection RPC, missing DSH 0.1.5-rc.1's generated `remote.session.modelCatalog()` API, and inspected `g.provider` instead of `g.id` for provider groups, resulting in empty model lists.

### 2. Pet passive income and sleep restore flattened by frequent polling (Issue #1478)
In `dsh-pet`'s `settleGameplay`, ticks were computed by `Math.floor(elapsedMs / intervalMs)` followed unconditionally by `state.settledAt = now`. With the frontend HUD polling every 2 seconds, any fractional duration less than an interval (e.g. 60 seconds or 30 seconds) was discarded on every cycle, preventing passive income and sleep energy restore from accumulating during background idling.

### 3. Preset center hasUpdate compared versions using bare inequality (Issue #1477)
In `dsh-preset-center`, `hasUpdate` checked `record.version !== row.assetVersion`. When a user had a newer local dev build installed, or when version representations differed without being newer, the panel reported an available update and downgraded upon click.

## Decision

### 1. Task board model discovery aligned with Cordis declarations
- Added `'remote.session'` to `packages/dsh-task-board/src/client/index.ts`'s `inject` declaration.
- Reworked `pushModelOptions` to probe `(remote as Partial<ClientRemote>).session.modelCatalog()`, reading `g.id ?? g.provider` as the group key, while preserving fallback to connection RPC interfaces.
- Added `tests/model-options.spec.ts` unit test to guarantee required inject declarations.

### 2. Pet gameplay lazy settle remainder carry
- Added `incomeCarryMs?: number` and `restoreCarryMs?: number` to `PetGameplayState`.
- Retained the remainder modulo `intervalMs` in the carry fields across settle calls, and reset `restoreCarryMs` upon leaving `sleep` mode.
- Sanitized remainder fields in `persist.ts` with round-trip compatibility for existing files.
- Added a 30-cycle 2-second polling simulation test in `src/gameplay.test.ts`.

### 3. Strict SemVer update checking in Preset Center
- Introduced lightweight `parseSemver` and `compareVersions` algorithms in `packages/dsh-preset-center/src/client/PresetPanel.tsx`.
- Changed `hasUpdate` to `compareVersions(record.version, row.assetVersion) > 0`.
- Added test coverage in `tests/preset-panel.spec.tsx`.

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-task-board test`: 37 files passed (337 passed).
- `pnpm --filter @linxin666/dsh-pet test`: 41 files passed (493 passed).
- `pnpm --filter @linxin666/dsh-client-ui-preset-center test`: 4 files passed (33 passed).
- `pnpm typecheck`: All 22 packages passed with 0 errors.
- `pnpm test`: All tests across monorepo passed.
- `pnpm docs:check && pnpm i18n:check && pnpm test:scripts`: All passed.
