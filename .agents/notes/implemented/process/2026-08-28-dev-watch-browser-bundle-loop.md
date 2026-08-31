# dev:watch — browser-bundle watch loop for the monorepo dev flow

Status: implemented
Date: 2026-08-28

## Decision

`pnpm dev:watch` (scripts/dev-watch.mjs) spawns one `tsdown --watch` per package that has both `src/client/index.ts` and a `tsdown.config.ts` (15 packages today), so every browser bundle the Web GUI serves is rebuilt on source edit.

## Rationale

- The `dsh web` host stat-polls the `lib/client.js` files it serves and broadcasts `rebuilt` frames itself (the same mechanism the harness's own `scripts/dev-web.ts` documents), so any process that rewrites those bundles triggers a GUI reload. The monorepo only needs to keep its own bundles rebuilt — no harness-side watcher is required for linked plugins.
- tsdown bundles straight from `src/`, so `tsdown --watch` alone refreshes the browser artifact; `tsc -b` stays the type gate and runs via `pnpm typecheck` / `pnpm build` before commits, not in the loop.
- A root-level `tsdown --watch` does not work: without a root config it errors with "No input files" — per-package watchers are the supported shape here.

## Consequences

- Iteration loop: `pnpm dev:watch` in one terminal; edit client sources; the GUI reloads itself when the bundle lands. Host-half (`src/index.ts`) changes still need a DSH service restart — marked in delivery reports as before.
- The watcher rewrites the same committed `lib/` artifacts as `pnpm build`; output is byte-stable, so a clean tree stays clean.
- Rollback: delete the script and the `dev:watch` root script entry.

## Verification

- 2026-08-28: 15 watchers started with zero errors; touching `packages/dsh-session-id/src/client/index.ts` produced a "Rebuilt in 26ms" cycle; `git status` stayed clean after full rebuilds.
