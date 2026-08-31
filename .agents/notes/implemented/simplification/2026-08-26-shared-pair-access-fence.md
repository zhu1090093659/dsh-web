# Agent Note: Shared pairing trust fence (pair-access) via sync-shared

Status: implemented

## Problem

Three plugins — git-graph (`src/host/access.ts`), pet (`src/access.ts`), and skill-explorer (`src/access.ts`) — carried byte-identical trust-fence decision logic (loopback short-circuit, `remoteWebUiPairing` structural lookup with ctx.get/property fallback) differing only in the exported function name and header comment. A duplicated security check must drift in lockstep across copies or silently diverge; the audit flagged all three locations plus their triple-cloned tests.

## Decision

The decision logic now lives once in `shared/host/pair-access.ts` (`isPairedOrLoopbackAllowed`), distributed to the three packages as generated copies through the existing `scripts/sync-shared.mjs` table — the same mechanism that already syncs `loopback.ts`/`http.ts`/`dsh-home.ts`. Each package keeps a hand-written `access.ts` wrapper exporting its self-describing name (`isGitAllowed`, `isPetAllowed`, `isSkillExplorerAllowed`) that delegates to the synced copy, so no call site changes. A canonical test for the core logic lives in `shared/tests/pair-access.spec.ts`; the per-package wrapper specs stay as wiring tests.

## Alternatives considered

A new shared runtime package imported as a dependency was rejected: every existing shared helper in this monorepo ships via sync-shared copies (packages must stay independently publishable without a workspace-internal dependency chain), and pair-access must not be the first exception. Replacing the wrappers entirely (renaming call sites to a single function) was rejected as needless churn — the wrapper keeps each package's public vocabulary and documents which routes the fence guards. Syncing the tests was rejected: sync-shared copies source files only, and the per-package specs double as wiring verification. The deprecated dsh-aionui-panel (fully removed on 2026-08-28) has no fence code (client-only), so nothing was consolidated there.

## Consequences

Fence fixes now propagate by editing one shared source and running `node scripts/sync-shared.mjs`; the drift gate (`test:scripts`) fails CI if any copy diverges. The sync-shared test's copy-count buckets grew (97 to 100 entries, 45 to 48 host copies) and its fake tree gained a pair-access source. No behavior change: identical logic, verified by the unchanged per-package specs.

## Testing

`pnpm test:scripts` (copy-count and drift suites), `pnpm docs:check`, and per-package `pnpm typecheck` + `pnpm test` for dsh-git-graph (141), dsh-pet (445), dsh-skill-explorer (72) — all pass. Shared spec: 15 tests in shared/tests (pair-access + loopback). Follow-up (same day): the root `pnpm typecheck` exposed that shared sources must not import `@deepseek-ai/cordis` (the shared package typechecks standalone without it), so the fence signature now takes a structural two-member context shape that cordis `Context` satisfies; the wrappers' signatures are unchanged.
