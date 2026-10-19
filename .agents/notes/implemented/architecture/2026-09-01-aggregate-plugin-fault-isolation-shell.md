# Agent Note: Aggregate shell isolates per-plugin boot failures

Status: implemented

> Partially superseded: the family rows no longer mount the shell. They mount
> their real packages since [aggregate family rows mount real packages](2026-10-18-aggregate-family-rows-mount-real-packages.md), which also records the
> fault-isolation trade this note argued for. The shell module, its degraded
> ledger and the subpath exports for profiles written before that change are
> unchanged.

## Problem

The dsh-web family ships as one aggregate bundle whose patch rows mount ~20 plugins through the DSH loader. The loader treats all rows as one transactional group (`EntryGroup.update` in the vendored cordis loader): any entry that fails to import or start rolls the whole group back, and the boot audit (`assertEntriesActivated` in `@deepseek-ai/dsh-app-boot`) then aborts the entire `dsh web` process. One broken plugin — an SDK drift, a bad release, a third-party import — took every plugin down, contradicting the "everything is a plugin" composition premise. The family had already lost whole boot sessions to this shape (chatgpt-subscription's `CallId` import crash, 2026-08-28; host SDK drift killing third-party plugins at import).

## Decision

The fault unit is now one plugin, not the whole family. `scripts/aggregate.mjs` emits each family insert row with `name: '@linxin666/dsh-web-all/<family>'` (a per-family subpath export of the aggregate package, whose shared target is the fault-isolation shell) and carries the real plugin package name in the row config (`config.plugin`), with the wrapped plugin's own config fields beside it at the row config root. The shell (`packages/dsh-web-all/src/shell.ts`) imports the real module at start time; an import failure, an unusable module shape, or an activation failure (sync throw or rejected fiber) is captured, logged, and recorded — the shell entry itself stays active, so the boot audit sees a healthy tree and the rest of the family mounts. (The row-name spelling was originally the bare package name; the subpath display names came later — see [aggregate family row display names](2026-09-02-aggregate-family-row-display-names.md).)

The real plugin runs as a nested plugin on the shell's child context, preserving cordis semantics: provided services remain visible through the normal scope chain, lifecycle tracks the shell entry, and a later failure retracts only its own services. A loopback-only health route (`GET /api/dsh-web-all/degraded`) reports the current degradation ledger (`@linxin666/dsh-web-all/degraded`), so monitoring can surface "these plugins are degraded" without log scraping. `dsh-i18n` stays direct-mounted (its host half is an empty function), as do all external rows (npm packages outside the family) — their owners own their failure semantics.

The row config is also the wrapped plugin's settings surface. The Host settings surface (`@deepseek-ai/dsh-settings`) serves one form per profile entry, derived from THAT entry's own `Config` schema, and refuses every write outside a schema-declared volatile path — and for a family row that schema is the shell's, not the plugin's. The shell therefore declares `Config = z.any().volatile()`:

- `any` rather than an object, because an object schema projects only its own declared keys and the browser cards would read empty values; the family fields stay at the form root, exactly where a standalone install of the same package keeps them, so one profile shape serves both ways of mounting the plugin.
- `.volatile()` because a schema without a volatile field puts no entry on the settings surface at all (the surface projects through `volatileForm()`), and because a volatile ROOT admits a write to any path (`isVolatilePath` short-circuits on `schema.meta.volatile`).

Root volatility also moves the edit to the live path: the Loader commits a new config into the running entry's reference instead of remounting it (a schema without volatile nodes remounts the row), so the shell listens for `loader/volatile-update` and mounts the family plugin again with the committed config — the same live-apply contract family plugins already follow for their own volatile fields.

The wrapped plugin's own `Config` still governs the value: the shell hands the family fields to `ctx.plugin()`, where that schema validates them, so an invalid write leaves that one row degraded (ledger and log) while the rest of the family keeps running.

Complementing the boot-time shell, `shared/host/run-guarded.ts` converts fire-and-forget rejections into logged errors: the host's `installFailLoud` turns ANY unhandled rejection into a whole-process exit, so family code must never let one escape.

## Alternatives considered

Waiting for a loader-level `continueOnError` entry option was deferred: it is the complete host-level answer but sits outside this repository, and the shell achieves the same failure containment with the current host (0.1.2-alpha.3). Wrapping external rows too was rejected: third-party plugins carry their own lifecycle contracts and the inactive-row mechanism already covers opt-in externals. A supervisor-only approach (detect boot-loop, disable, restart — the future doctor closure) was deferred to a second phase: it shortens recovery time but does not contain the failure the way the shell does.

For the settings surface, three shapes were considered and rejected. Importing the family module to read its `Config` at shell activation was rejected outright: an eager import of the module the shell exists to isolate is the failure mode this shell was built to contain. Keeping the row config nested (`config.plugin` plus `config.config`) and teaching every family card to address the inner path was rejected as fleet-wide churn that would put the aggregate's internal shape into ten client packages, and the native `ctx.configForms` binding cannot carry a path prefix at all. Giving each family plugin back a bespoke write route was rejected because it reintroduces per-plugin persistence, works only over the loopback bridge (family settings would stop working on a paired remote browser), and leaves the settings surface lying about what it serves.

## Consequences

A family plugin can no longer take the Web down at boot: the blast radius of a broken plugin is a degraded entry plus a log line. The costs: a plugin failure surfaces only through logs/degraded-route instead of failing the boot, and every future family package needs its aggregate row generated through `scripts/aggregate.mjs` (which is already the only sanctioned path). The original "every inventory card shows the same shell package name" display cost was later removed by the per-family subpath row names (see [aggregate family row display names](2026-09-02-aggregate-family-row-display-names.md)). The runGuarded discipline is opt-in per package; no package in this repository adopts it, so `shared/host/run-guarded.ts` stays the shared source (with its spec) without generated copies here.

The config surface costs three things. The Host cannot validate family fields at write time (it has no schema for them), so a value the family schema refuses degrades that one row instead of being refused with a message. A row config edit re-mounts the family plugin rather than committing in place, because the shell hands a plain config to `ctx.plugin()`. And the settings write persists the whole effective row config — the shell's `plugin` key included, which is what keeps the row mounting the right module — so a hand-written override must carry `plugin` too; a config without it leaves the row mounting nothing, loudly for any other shape and silently for the bare-override shape the loader's whole-config replacement produces.

## Testing

`packages/dsh-web-all/tests/shell-isolation.spec.ts` exercises the contract through the real installed host boot (`@deepseek-ai/dsh-app-boot`): start-failure and import-failure scenarios both leave the shell entry ACTIVE with the healthy sibling mounted and its service reachable at root, a no-webServer scenario proves the degraded route is best-effort, and the control case (direct mount, today's shape) still kills the boot — anchoring why the shell exists. `packages/dsh-web-all/tests/shell-config-surface.spec.ts` pins the config surface: the schema's root-volatile shape and single-reference validation, the family-fields-only forward, the re-mount on a `loader/volatile-update` (and the no-op for an unchanged value), and two real-boot cases — a flattened row config validated by the family's own schema reaching `apply`, and an invalid one leaving the shell entry ACTIVE with the healthy sibling untouched. `scripts/aggregate.test.mjs` holds the generated patch to the flat shape. `pnpm typecheck`, `pnpm test` (all 22 workspace packages), `pnpm docs:check`, `pnpm aggregate:check`, `node scripts/sync-shared.mjs --check`, and `pnpm i18n:check` pass. Requires a user-side `dsh web` restart to take effect (bundle-layer change).