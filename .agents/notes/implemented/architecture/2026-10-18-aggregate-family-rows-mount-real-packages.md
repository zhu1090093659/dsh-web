# Agent Note: Aggregate family rows mount real packages

Status: implemented

## Problem

Every family row the aggregate generated named a per-family subpath export of `@linxin666/dsh-web-all` and carried the real package in `config.plugin` (see [the fault-isolation shell](2026-09-01-aggregate-plugin-fault-isolation-shell.md)). That shape had a cost nobody measured until a user on a forwarded remote page did (issue #1901).

The official `dsh-client-modules` mounts a package's browser half on the loader entry whose `name` equals the package name. A subpath row is not that entry, so no family row could bring its own browser half. The aggregate compensated by inlining all thirteen family clients into its own `./client` bundle: `lib/client.js` reached 2,890,548 bytes in 0.4.7 and 2,982,246 bytes on `dev`, and every page downloaded and evaluated the whole file before any family surface could render. Over EasyConnect/VPN forwarding that read as a slow, stuttering page with WebSocket drops; turning the compat row off made the page smooth and every family panel disappear.

Three structural complaints came with it. Turning off the compat row looked like it turned off the family, because the browser half lived there. A family switch only wrote `disabled` onto the shell row, so with compat off the switch did nothing visible. And the aggregate client half re-decided in the browser which children to mount, from a host ledger it fetched over `GET /api/dsh-web-all/rows` (#1372), duplicating a decision the loader had already made.

## Decision

Every family row mounts its real package:

```yaml
- insert:
    - id: web-ui-task-board
      name: '@linxin666/dsh-client-ui-task-board'
```

`scripts/aggregate.mjs` emits the child's own package name, so the loader serves that package's browser half from its own entry. Nothing is inlined: `lib/client.js` is the compat patch layer alone, 22,714 bytes, and a page downloads a family UI only when that family's row is enabled. Row ids stay `web-ui-*`, so per-row overrides already in a profile keep applying.

The compat row becomes what the issue asked for — an optional layer for the scenarios that need patches. It keeps the semantic DOM hooks (`data-pane` / `data-dsh-frame`), the responsive contract and the boot splash, and it is no longer in `LOCKED_ENTRY_IDS` (`packages/dsh-plugin-manager/src/host/state.ts`): it used to be locked because disabling it blanked the page while the host rows kept running, which is no longer true.

Two pieces of machinery lost their reason and were removed rather than left dormant. The active-row ledger (`src/rows.ts`) and `GET /api/dsh-web-all/rows` existed to tell the browser half which inlined children to mount; with no inlined children and the loader owning row state, the route and the ledger are gone, together with the client-side mount gate. The generated `children.generated.ts` / `children.specifiers.json` / `children.modules.d.ts` and the tsdown source alias that consumed them went with them.

Compatibility is preserved on the host side only. Every former family subpath (`./settings`, `./task-board`, …) moved into `tombstones:`, so a profile written before this change — where the row's `name` is still `@linxin666/dsh-web-all/<family>` — keeps resolving to the shell re-export instead of failing the boot group with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Those rows mount the shell, which still honours `config.plugin`; they simply never mount again on a profile regenerated from the new bundle. The `shell-metadata` display resources stay, because the subpaths still exist and the inventory reads their titles and purpose lines.

## Alternatives considered

**Keep the shell and only shrink the bundle.** Code-splitting the aggregate client per family was rejected: the loader serves one client bundle per entry, so the split would have had to be reimplemented inside the bundle as lazy imports the module system does not understand, and the browser half would still be served by the aggregate instead of by the package that owns it.

**Keep the shell rows and add a second, bare row per family.** Rejected: two rows per family means two switches, two ids in the loader's global space, and a user who cannot tell which one is authoritative.

**Keep the row-state route for other consumers.** Rejected: nothing else read it. The plugin manager reads the profile's patch layers directly, and the degraded ledger (`GET /api/dsh-web-all/degraded`) is a separate surface with its own consumers, which stays.

**Preserve fault isolation by wrapping the real package in a loader-level supervisor.** Out of reach from this repository, as [the shell note](2026-09-01-aggregate-plugin-fault-isolation-shell.md) already recorded; the shell was the in-repo approximation.

## Consequences

- A family plugin that fails to import or start now rolls back the loader group again, which is exactly what the shell was built to prevent. This is the deliberate trade the issue asked for: one copy of every family UI on every page was the price of containing a failure that is rare, and the loader's own transactional boot is the host's documented behavior. A future loader-level `continueOnError` restores isolation without inlining anything.
- The settings surface is simpler rather than different: a family row now edits the family package's own `Config` schema directly, instead of the shell's `z.any().volatile()` stand-in forwarding fields to `ctx.plugin()`. A field the package refuses is refused at write time by that package's schema, which the shell could never do.
- Row titles in the plugin inventory come from each package instead of `web-all/<family>`; the family subpath exports and their `shell-metadata` stay for profiles that still record them.
- Re-inlining a family client into the aggregate bundle would silently restore the cost. `scripts/client-bundle-contract.test.mjs` pins the compat artifact as store-free and family-free, and `packages/dsh-web-all/tests/shell-subpath.spec.ts` pins the bare-row shape and the surviving subpath exports.
- `packages/dsh-web-all/lib/client.js` drops from 2,982,246 bytes to 22,714 bytes (gzip: about 1 MB to 7 kB). The total page cost of the family is now the sum of the family rows the user enabled, not one fixed copy of all of them.

## Testing

`node scripts/aggregate.mjs --check` pins the generated patch; `scripts/aggregate.test.mjs` asserts every family row mounts a real package name with no shell config block, that the win-bash platform guard survives verbatim, and that the row ids and subpaths a profile may record are unchanged. `packages/dsh-web-all/tests/shell-subpath.spec.ts` asserts the former subpaths still resolve to the shell re-export, `tests/satellite-rows.spec.ts` asserts no satellite client is inlined, and `scripts/client-bundle-contract.test.mjs` asserts the compat bundle consumes no client store and inlines no family client. `pnpm typecheck`, `pnpm test`, `pnpm test:scripts`, `pnpm test:standards`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm emoji:check`, `pnpm libs:check` and `pnpm aggregate:check` pass. Requires a user-side `dsh web` restart to take effect (bundle-layer change).

## Coverage gap

The measurement in issue #1901 came from a forwarded remote page. This change removes the copy that dominated it, but the WebSocket drops the issue also documents come from the upstream gateway heartbeat window (`@deepseek-ai/dsh-api-gateway`, 2 s interval with two missed heartbeats) and are outside this repository. No lane here reproduces the remote-forwarding latency profile, so the improvement is verified by bundle size and mount shape rather than by a re-run of that field measurement.
