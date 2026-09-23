# Agent Note: family row-state route for #1372 UI gating

Status: implemented

## Problem

Disabling a family row of the aggregate (`web-ui-market`, `web-ui-plugin-manager`, ...) removes only the host half: the loader never starts that entry, so the row's backend channels vanish, while the aggregate client bundle still registers the row's settings tab unconditionally. The tab stays and errors on click — the #1372 complaint. The first fix attempt (v0.3.15) gated mounting on `__DSH_BOOT__.entries` and was reverted the next day ([aggregate child mount boot wire shape](../../implemented/bug-fix/2026-09-05-aggregate-child-mount-boot-wire-shape.md)): boot entries carry served-bundle package ids only and cannot express per-row state. The revert restored service but left #1372 unfixed: disabled rows keep a visible UI entry.

## Decision

The aggregate's browser half gets an authoritative, self-hosted answer to "which family rows are active", served by the aggregate's own host half over the same plugin-route idiom every family plugin already uses (same-origin fetch to a `webServer.register` route, like task-board's `HttpTaskBoardHostTransport`).

Host half (`packages/dsh-web-all/src/rows.ts` + `src/shell.ts`):

- `src/rows.ts` holds the active-rows ledger: a module-level Set of real plugin package names. Each shell apply with a valid `config.plugin` records the name at apply start — not after a successful start, so an enabled-but-degraded row keeps its UI entry (honest state) and only a disabled row (never applied by the loader) drops out. Entry dispose removes the name (`ctx.effect` cleanup).
- Every shell entry — including the config-less self row `web-ui-compat` — holds both health routes through one shared ref-count (`holdHealthRoutes`): registration happens exactly once on the first entry, teardown with the last, so `GET /api/dsh-web-all/rows` survives even when every family row is disabled. This widened the proposal's "the self row owns registration" to "every entry holds the pair" — one refcount covers both routes. Registration rides a nested `ctx.inject(['webServer'], cb)` fiber per entry (2026-09-09 fix): the shell applies with `inject = []` and therefore runs before the web app provides `webServer`, so a synchronous read at apply time misses the service and the routes never register — the nested fiber starts when the service appears, and simply never starts on hosts without it.
- `GET /api/dsh-web-all/rows` answers `{ ok: true, children: ["@linxin666/dsh-client-ui-market", ...] }` — the active real-plugin package names. Unlike the degraded route it is NOT loopback-fenced: remote browsers (remote-web-ui) read it same-origin for gating, and the payload exposes nothing beyond names already public in the served client bundle.

Browser half (`src/client/mount-children.ts`):

- Before mounting, the client fetches the route with a 1500 ms `AbortController` timeout and defensive shape validation. Any uncertainty — network error, non-200, unexpected shape, non-JSON body, timeout, or a stale host half that predates the route — yields "unknown" and the gate FAILS OPEN: every family child mounts, bit-identical to the pre-gating hotfix behavior. The gate may only hide a child when the route answered with a well-formed active set that lacks that child's name.
- `mountClientChildren` became `async`, but the client `apply` does NOT await it — it is fire-and-forget with an error log, because the same `apply` installs the time-critical DOM shims and boot-splash dismissal, which must not queue behind a network fetch. Tabs mount a few dozen milliseconds later; no ordering dependency exists. This deviates from the proposal's "apply awaits it" on purpose.
- Double-mount guard unchanged: a child whose own package id appears in `__DSH_BOOT__.entries` is still skipped first (standalone installs win).

Consistency gate: `packages/dsh-web-all/tests/children-consistency.spec.ts` asserts the join in both directions — every client child has exactly one family row carrying its name in `config.plugin`, and every family row whose real plugin ships a client face (`dsh.client` + `exports["./client"]`) is in `children.specifiers.json` — so adding a family can never silently break the join between the row config and the client ledger keys.

Management entry point: the rows route is the read half; the write half (per-row enable/disable switches) is [aggregate row-level plugin management](2026-09-09-aggregate-row-level-management.md).

## Alternatives considered

- Query the host `loader` service (`inject: ['loader']`, read `entry.options.id`/`options.name`/`entry.disabled`): the most authoritative signal (evaluates `!!js` disabled expressions and ancestor inheritance), but it couples the plugin to host loader internals and buys nothing over the ledger — the loader only starts enabled rows, so an absent shell apply already means disabled, whatever the reason.
- Reuse the official plugin-inventory UI's data source: it is host-internal, versioned with the host, and not a published plugin contract; same coupling objection.
- Mount-then-prune (mount everything, unregister tabs after the fetch): slot and side-effect teardown is unreliable across every family UI; a visible-then-vanishing tab is worse than a slightly deferred mount.
- Server-side pruning (serve per-row client bundles): re-architects the single-bundle aggregate; rejected before in [#1372 discussion](../../implemented/bug-fix/2026-09-04-multi-issue-landing-1368-1370-1372-1359.md) for performance and structure.

## Consequences

- Boot-ordering discovery (2026-09-09): the same synchronous-read flaw meant the degraded route had never actually registered in production since its introduction — a mock-only verification blind spot, since every unit test supplied `webServer` before `apply`. Both routes now register via the inject fiber; `rows-ledger.spec.ts` carries a regression test asserting the routes stay absent before `webServer` exists and register when it appears.
- Chunk-split discovery (2026-09-09): the built package loads through TWO entry artifacts (`lib/index.js` for the self row, `lib/shells/shell.js` for family rows) whose bundler chunk split gives each its own module copy, so module-local state silently splits. First symptom: duplicate-route warnings as both copies registered the health routes. Second, worse: the copy that won registration served its own EMPTY ledger, and the well-formed-but-wrong `children: []` answer made the client gate hide every family tab — fail-open covers uncertainty, not incorrect certainty. All shell state (active-rows ledger, degraded ledger, route refcount) now lives in `src/state.ts`, a globalThis registry keyed by `Symbol.for` (the client half's mounted-plugins idiom); a `vi.resetModules()` double-import test simulates the split. The package AGENTS.md bans module-level mutable singletons in this package.
- One extra same-origin GET per page load (a few hundred bytes, `no-store`), one in-memory Set on the host, roughly a hundred lines across shell/client plus tests. No schema, protocol, or on-disk format changes; the route is additive and version-skew-safe (a 404 degrades to fail-open).
- Verified: `pnpm --filter @linxin666/dsh-web-all test` (42 tests, incl. gating, fail-open, ledger, and both-route refcount cases), package typecheck and build.
- Desktop shell: the desktop app is an Electron window over the same origin, so the route and the gating apply unchanged; the fail-open rule absorbs any cohort skew.
- Residual edge, accepted: with the compat row AND every family row disabled, no route owner exists, the client fails open, and disabled rows keep their tabs (the pre-0.3.15 behavior for a fully-dismantled aggregate). Whole-package disable through the plugin manager force-keeps the locked rows (compat, settings, manager), so this state is unreachable from the GUI.
- The route is unauthenticated like all plugin `/api` routes; it discloses only active family child names. Accepted as platform parity; revisit if the platform adds route-level auth.
- A row toggled while a page stays open is reflected only after the loader's plugin-change reload; same freshness model as the degraded route.

## Testing

- `tests/rows-ledger.spec.ts`: ledger ordering, route registration by the self row, disposal bookkeeping, unfenced remote read, degraded-but-active honesty.
- `tests/client-children-mount.spec.ts`: hidden-when-inactive gating plus the fail-open matrix (route absent, non-200, shape-broken, non-JSON).
- `tests/shell-isolation.spec.ts`: the #1363 singleton test now asserts both routes register once across 17 entries and lift together with the last.
- `tests/children-consistency.spec.ts`: the row-config/client-children join gate described above.
