# Agent Note: Plugin manager switches show effective next-start enablement

Status: implemented

## Problem

Issue #1453: on the npm web runtime the plugin manager listed the aggregate's inactive-by-default family rows (`web-ui-ssh`, `web-ui-describe-image`, `web-ui-liangshen`, `web-ui-skill-explorer`, `web-ui-doctor`) as "enabled", while `dsh web --dump-config` showed `disabled: true` and the loader never mounted them.

The listing derived every row's state from the profile patch alone (`rowEnabled.get(id) ?? true`), and `insertRowsOf` reads only a bundle's `insert` entries, so the aggregate's trailing bare `{ id, disabled: true }` rows never entered the model. The write side had the matching defect: enabling a row deleted the user override, which only restores "no user opinion" — with a bundle layer that ships the row disabled, the family stayed off and the switch could never turn it on.

## Decision

- `rowDefaultEnabledOf(patchText)` reads the enablement a bundle patch itself declares: an insert entry's own `disabled` key, then later top-level bare `{ id, disabled }` rows in file order (the loader's later-wins semantics). An id no row mentions stays absent, meaning "this layer has no opinion" rather than "enabled".
- `buildPluginRow` resolves `user row ?? bundle default ?? enabled` for both the package-level row and each aggregate child, the same composition the loader performs.
- `claimedEntryRowsOf` and `findRowOwner` carry `baseEnabled`; `setRowEnabled` takes it as a parameter and, when enabling a row whose bundle layer disables it, writes or keeps an explicit `{ id, name, disabled: false }` user row instead of deleting the override. When the bundle leaves the row enabled, enabling still removes the override, so no stale rows accumulate.

## Testing

- `tests/rows.spec.ts`: `rowDefaultEnabledOf` over an aggregate-shaped patch reads the trailing inactive rows, honours an insert entry's own `disabled`, applies later rows last-wins, leaves undeclared ids absent, and tolerates empty/malformed input; `setRowEnabled` writes an explicit `disabled: false` for a bundle-disabled row and flips an existing user disable to it without duplicating rows.
- `tests/set-enabled.spec.ts`: an aggregate profile that ships `web-ui-ssh` disabled now lists that child (and the package row) as disabled through the real list route, while siblings stay enabled; a row-level enable writes `disabled: false` and the response reports the child enabled; a package-level enable writes the explicit override too.
- `pnpm --filter @linxin666/dsh-client-ui-plugin-manager test` (17 files, 204 tests), `typecheck`, and `build` pass; `pnpm docs:check` and `pnpm i18n:check` pass with the updated README pair.

## Alternatives considered

- Read the composed tree from `dsh --dump-config` for the listing. Rejected: it spawns the CLI on every listing, and it would still not tell the write side what to persist; the manager can only compose the layers it owns.
- Always write an explicit `disabled: false` on enable instead of only for bundle-disabled rows. Rejected: it would leave a row for every toggle ever flipped and change behavior the existing suite pins, for no gain when no layer disables the id.
- Treat `!!js` expression `disabled` values as disabled. Rejected: they cannot be evaluated offline, so the manager has no opinion; the aggregate generator emits only literal `true` for its inactive rows.
- Widening the listing to every dependency rather than only those in `dsh.profile.bundles`. Rejected as out of scope: it is a separate accuracy gap, not the reported defect.

## Consequences

- The switch position now matches what the next start loads for the two layers the manager can write (the installed bundle's patch and the profile patch); an explicit user row always wins over the bundle default.
- A `$DSH_HOME/cordis.patch.yml` or `--patch` overlay that disables a row still outranks the profile patch the manager writes, so the listing can remain optimistic for those layers.
- A dependency that declares a bundle but is missing from `dsh.profile.bundles` is still listed with rows the loader never composes; the fix does not model that case.
