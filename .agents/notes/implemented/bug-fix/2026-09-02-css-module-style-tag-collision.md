# Agent Note: CSS module style-tag collision in inlined client bundles

Status: implemented

## Problem

In the deployed web GUI every family settings card except the first-processed
one rendered as bare UA defaults: collapsed cards were fit-content inline
buttons instead of full-width disclosure rows, and the pet / doctor /
task-board / remote / describe-image / desktop-launcher fields had no styling
at all, under every appearance skin. Separately, hint and description text in
the shared card chrome could drop below readable contrast (orca-link's
`--dsw-alias-label-tertiary` #778399 on its cream surface measures ~3.4:1 at
12-13px), and the card's error styling referenced `--dsw-alias-label-error`,
a token no skin or host surface defines, so save-failure and invalid-input
signaling silently inherited the ink color.

Two root causes:

1. The shared client preset (`shared/tsdown.client.ts`) keyed each injected
   stylesheet tag by `data-plugin-css = "<bundle id>/<basename>"`. The
   aggregate build inlines eight packages that each ship their own
   `settings-card.module.css`; all eight emitted the same tag id, the
   idempotency guard let the first tag suppress the other seven, while every
   package's class map carries a path-derived CSS-modules hash — so seven
   class maps pointed at styles that were never injected.
2. `SETTINGS_CONSUMERS` in `scripts/sync-shared.mjs` did not include
   `dsh-perf`, so its card-chrome copies drifted: the aggregate inlined the
   fresh shared stylesheet for seven children but perf's stale copy kept
   serving the old tertiary hint color from its own bundle.

## Decision

- The preset keys each style tag by the full repo-relative file id
  (`<bundle id>/packages/<pkg>/src/client/<file>.module.css`), so
  same-basename modules in different packages can no longer suppress each
  other. `data-plugin` (the unload-cleanup key) is unchanged.
- The shared `settings-card.module.css` small-text roles (`.description`,
  `.hint`, `.readOnly`) use `--dsw-alias-label-secondary` instead of
  tertiary; the error roles (`.failed`, `.invalid`, `.inputInvalid` and its
  focus ring) use `--dsw-alias-state-error-primary` with a `#b42318` fallback.
- `scripts/sync-shared.mjs` gains a `SETTINGS_CARD_ONLY_CONSUMERS` tier:
  `dsh-perf` syncs the card chrome pair (`PluginSettingsCard.tsx` +
  `settings-card.module.css`) like every other consumer, but
  `settings-form.ts` deliberately stays a seven-consumer target because
  dsh-perf still runs the pre-0.1.2 per-field form generation (its save path
  judges each write per-field instead of the shared atomic mutate +
  read-back). Overwriting it would be a behavioral change to perf's save
  flow, not a style sync. `perf-settings-card.tsx` now renders its two
  select hints through `css.hint` instead of inline `opacity: 0.66` styles.

## Alternatives considered

- Content-hash dedupe of identical stylesheets: rejected — CSS-modules
  hashes derive from the file path, so identical copies still produce
  different class maps and cannot share one tag.
- Aliasing all eight copies onto one canonical stylesheet inside the
  aggregate build: rejected — the per-package committed copy is the sync
  contract; remapping inside the preset would couple it to package layout.
- Leaving dsh-perf out of the sync manifest: that was the bug (the drift
  this note fixes).

## Consequences

- Bundles that inline several packages now inject one style tag per module
  file instead of per basename; the aggregate carries a handful of
  near-duplicate 4KB stylesheets. Negligible, and it fails visibly (styled)
  rather than silently.
- dsh-perf's settings save path still runs the older form generation and its
  bundle keeps a stale hint shade until it rebuilds; with dsh-perf slated for
  full deprecation, aligning its `settings-form.ts` is not planned — the
  deprecation should remove the `SETTINGS_CARD_ONLY_CONSUMERS` tier.
- Square-corner skins (orca-link, xp) deliberately square switches, selects
  and popups with `border-radius: 0 !important`; the settings controls stay
  legible but squared there. Exempting `[role="switch"]` per skin is a
  one-line patch if the look is judged broken — left to the skins' owner.

## Testing

`node --test scripts/sync-shared.test.mjs` 4/4 (copy counts 110 -> 112,
client trio 39 -> 41); `node scripts/aggregate.mjs --check` OK; repo-wide
`pnpm typecheck` and `pnpm i18n:check` green. Live GUI (127.0.0.1:3080):
under the orca-link skin and the default appearance all six Web 插件 cards
plus the pet card render full-width disclosure headers (`display: flex`,
522px), nine settings-card stylesheets inject (8 aggregate + perf
standalone), fields/badges/hints carry the shared chrome, the native-select
fallback under skins is 34px tall with token colors, and synced packages'
hints compute to label-secondary #343b47.
