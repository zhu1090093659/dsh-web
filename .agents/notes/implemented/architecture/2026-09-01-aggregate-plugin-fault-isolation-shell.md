# Agent Note: Aggregate shell isolates per-plugin boot failures

Status: implemented

## Problem

The dsh-web family ships as one aggregate bundle whose patch rows mount ~20 plugins through the DSH loader. The loader treats all rows as one transactional group (`EntryGroup.update` in the vendored cordis loader): any entry that fails to import or start rolls the whole group back, and the boot audit (`assertEntriesActivated` in `@deepseek-ai/dsh-app-boot`) then aborts the entire `dsh web` process. One broken plugin — an SDK drift, a bad release, a third-party import — took every plugin down, contradicting the "everything is a plugin" composition premise. The family had already lost whole boot sessions to this shape (chatgpt-subscription's `CallId` import crash, 2026-08-28; host SDK drift killing third-party plugins at import).

## Decision

The fault unit is now one plugin, not the whole family. `scripts/aggregate.mjs` emits each family insert row with `name: '@linxin666/dsh-web-all/<family>'` (a per-family subpath export of the aggregate package, whose shared target is the fault-isolation shell) and carries the real plugin package name in the row config (`config.plugin`, with the row's original config nested under `config.config`). The shell (`packages/dsh-web-all/src/shell.ts`) imports the real module at start time; an import failure, an unusable module shape, or an activation failure (sync throw or rejected fiber) is captured, logged, and recorded — the shell entry itself stays active, so the boot audit sees a healthy tree and the rest of the family mounts. (The row-name spelling was originally the bare package name; the subpath display names came later — see [aggregate family row display names](2026-09-02-aggregate-family-row-display-names.md).)

The real plugin runs as a nested plugin on the shell's child context, preserving cordis semantics: provided services remain visible through the normal scope chain, lifecycle tracks the shell entry, and a later failure retracts only its own services. A loopback-only health route (`GET /api/dsh-web-all/degraded`) reports the current degradation ledger (`@linxin666/dsh-web-all/degraded`), so monitoring can surface "these plugins are degraded" without log scraping. `dsh-i18n` stays direct-mounted (its host half is an empty function), as do all external rows (npm packages outside the family) — their owners own their failure semantics.

Complementing the boot-time shell, `shared/host/run-guarded.ts` (synced to the four packages with in-process HTTP/poll faces) converts fire-and-forget rejections into logged errors: the host's `installFailLoud` turns ANY unhandled rejection into a whole-process exit, so family code must never let one escape.

## Alternatives considered

Waiting for a loader-level `continueOnError` entry option was deferred: it is the complete host-level answer but sits outside this repository, and the shell achieves the same failure containment with the current host (0.1.2-alpha.3). Wrapping external rows too was rejected: third-party plugins carry their own lifecycle contracts and the inactive-row mechanism already covers opt-in externals. A supervisor-only approach (detect boot-loop, disable, restart — the future doctor closure) was deferred to a second phase: it shortens recovery time but does not contain the failure the way the shell does.

## Consequences

A family plugin can no longer take the Web down at boot: the blast radius of a broken plugin is a degraded entry plus a log line. The costs: a plugin failure surfaces only through logs/degraded-route instead of failing the boot, and every future family package needs its aggregate row generated through `scripts/aggregate.mjs` (which is already the only sanctioned path). The original "every inventory card shows the same shell package name" display cost was later removed by the per-family subpath row names (see [aggregate family row display names](2026-09-02-aggregate-family-row-display-names.md)). The runGuarded discipline is opt-in per package and synced by `scripts/sync-shared.mjs`.

## Testing

`packages/dsh-web-all/tests/shell-isolation.spec.ts` exercises the contract through the real installed host boot (`@deepseek-ai/dsh-app-boot`): start-failure and import-failure scenarios both leave the shell entry ACTIVE with the healthy sibling mounted and its service reachable at root, a no-webServer scenario proves the degraded route is best-effort, and the control case (direct mount, today's shape) still kills the boot — anchoring why the shell exists. `pnpm typecheck`, `pnpm test` (all 22 workspace packages), `pnpm docs:check`, `pnpm aggregate:check`, `node scripts/sync-shared.mjs --check`, and `pnpm i18n:check` pass. Requires a user-side `dsh web` restart to take effect (bundle-layer change).