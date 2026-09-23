# Agent Note: aggregate row-level plugin management

Status: implemented

## Problem

Installing the family through `@linxin666/dsh-web-all` collapsed nineteen plugins into one management unit: the plugin manager listed one row per profile dependency, and its enable switch wrote a `disabled` override for EVERY entry id the aggregate's bundle patch claims, so a family plugin could not be switched off (or back on) individually. That broke the everything-is-a-plugin, hot-pluggable promise for the install path most users take. The loader was never the limitation — `applyEntryPatches` honors id-targeted `disabled` overrides and the web profile hot-reloads its user patch layer — the granularity was lost in the manager's per-dependency listing and per-package writes.

## Decision

The plugin manager manages aggregate contents at ROW granularity in gateway mode; the package row becomes a group of individually switchable entry rows.

Wire shape (`src/core/protocol.ts`): `InstalledPluginItem` gains an optional `children` array (`{ id, name, enabled, locked? }` per claimed entry row). The field is additive and absent from the official-channel wire, so official-mode behavior is unchanged by construction — child UI appears only when the gateway supplies children.

Host listing (`src/host/state.ts`): `buildPluginRow` emits `children` when the installed package's bundle patch claims more than one insert row. A child's display name prefers the real plugin package (the aggregate shell row's `config.plugin`, now parsed by `insertRowsOf`) over the per-family subpath name. Rows in `LOCKED_ENTRY_IDS` (the manager tab itself, the family settings surface, the aggregate compat face — standalone and aggregate spellings) carry `locked: true`.

Row-level writes (`src/host/routes.ts` set-enabled): the `id` payload first resolves as a profile dependency (whole-package toggle, existing semantics). Otherwise `findRowOwner` locates the dependency whose bundle patch claims that entry id, and only that row gets the `{ id, name, disabled }` user-layer override — the id-targeted, later-wins patch semantics the official desktop writer uses. Disabling a locked row is rejected with an error; a whole-package disable still force-keeps locked rows enabled, so the GUI escape hatch can never be switched off by its own hand. The response carries the refreshed OWNING package row (with children), and the tab patches its state by the returned row id.

Tab (`src/client/PluginManagerTab.tsx`): a package row with children renders an indented child list — each child its own switch, state label, and a `Core row` hint instead of a switch when locked. A parent whose children are partially enabled shows the existing `mixed` label; its switch enables all from any mixed state. A hint line under the child list states the semantics: children toggle individually, a disabled child is never loaded, and its code still updates with the bundle.

Uninstall stays whole-package: the children ship inside the aggregate's npm package, so physical per-child uninstall is impossible by construction; a disabled child is the runtime equivalent (never loaded), and the standalone package remains the path for independently versioned installs (it wins over the aggregate row through the boot-entries double-mount guard).

Client gating of disabled rows' UI entries is the companion mechanism: [family row-state route](2026-09-05-family-row-state-route.md).

## Alternatives considered

- Re-found the aggregate as a meta-installer that adds each family package as a top-level profile dependency at first boot: the purest everything-is-a-plugin shape, but it introduces first-boot network and pnpm side effects (offline installs break outright), decouples the aggregate version from its children, strands orphans on uninstall, and multiplies the failure surface of "one-click install". Rejected; row-level management reaches the same user-visible granularity without any of it.
- Wait for the official installer to manage rows: the official inventory already renders one title per `web-all/<family>` row, so upstream row-level control may arrive. Rejected as the plan of record (the roadmap is not ours), but the row id space used here is exactly the loader's, so an official writer can take over the same rows without migration.
- Per-row uninstall that deletes files from the aggregate's node_modules: corrupts the package for every other row and breaks the next upgrade. Never viable.

## Consequences

- Gateway mode only: the official-channel protocol has no children concept, so official runtimes render the same whole-package rows as before. The dual-channel discipline is preserved — no official RPC is asked to carry row ids.
- The profile patch file grows one bare override row per disabled family row; re-enabling removes the row, leaving no residue.
- Locked-row protection is host-enforced (not just UI-hidden): direct HTTP calls to the gateway get a 404 with an explanatory error.
- Verified: `pnpm --filter @linxin666/dsh-client-ui-plugin-manager test` (196 tests, incl. row-level toggle/sibling isolation, locked-row rejection, insert-format row edits, wire parsing, and tab rendering), typecheck, build, and `pnpm i18n:check` (zh/en/ru key parity).

## Testing

- `tests/set-enabled.spec.ts`: row-level toggle writes only the target row, re-enable removes only its override, locked rows refuse disable without touching the patch, unknown row ids 404 without writes, insert-format rows are edited in place.
- `tests/protocol.spec.ts`: children parse with locked flags; malformed children throw with row and child indexes.
- `tests/PluginManagerTab.spec.tsx`: child rows render with switches and the locked hint, the mixed parent label shows, and a child toggle calls setEnabled with the entry id and refreshes from the returned parent row.
