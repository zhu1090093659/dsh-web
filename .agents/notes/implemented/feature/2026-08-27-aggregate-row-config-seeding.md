# Agent Note: aggregate row config seeding (patches section), ssh ships disabled in the family bundle

Status: implemented

Supersession check: no active note owns aggregate manifest sections or per-bundle default policy. The aionui default-off precedent lived only in aggregate.yml comments until the package's removal (see [remove dsh-aionui-panel](../simplification/2026-08-28-remove-dsh-aionui-panel.md)); the compat shim and family fan-out mechanics belong to the web-all package docs.

## Problem

The maintainer wants rarely-used plugins shipped off by default for fresh installs while every existing install keeps its current state. Investigation ruled out two shapes:

- Pure declarative config cannot distinguish cohorts: the boot layer recomposes the entry tree from the profile bundle list on every start (`~/.dsh/profiles/web/cordis.yml` is an empty root plus patches; no per-user resolved entry file exists). Any inline value re-applies to everyone who never edited that setting.
- Runtime first-run detection needs new host-side code and usage-trace heuristics that misclassify (a veteran who never opened the pet would look "new").

Meanwhile the official seams already define what a row-level config can mean: `dsh-app-boot`'s `applyEntryPatches` applies non-insert patches per-key over inserted rows, and `dsh-settings`' `installSettingsSection(ns, schema, entry)` uses that entry only as `base` - the registered settings scope wins once it carries values. So a row shipping `config:` acts as a *seed default* for users who never touched the plugin's settings, and never overrules anyone who did.

## Decision

- `scripts/aggregate.mjs` gains a manifest `patches:` section (single-line JSON flow mappings). Each entry renders after ALL insert blocks as a bare patch row (`- id: <namespaced id>` + `config: {...}`) targeting one of this aggregate's own rows; the generator errors when the id does not match an existing row or duplicates another override. Manifest entries also stopped bleeding across sections (an unknown-section guard now resets parsing, so section order no longer matters).
- `@linxin666/dsh-web-all` seeds `web-ui-ssh` with `enabled: false`: fresh family installs get SSH off (low usage for most users), turning it on once under Settings makes it stick, and any user who already changed SSH's settings keeps their exact current state on upgrade. Pet stays untouched by explicit decision; standalone package distribution is unchanged.
- README pairs document the selective-default behavior; the package AGENTS documents the new manifest section.

## Alternatives considered

- **Standalone-package schema default flip**: rejected - it would ship to independent dsh-ssh installs too, beyond the requested family-only scope.
- **Runtime first-run cohort detection**: rejected above - complex, misclassifying, new persistent state.
- **Row inline `enabled:false` via the child patch**: rejected - the child patch ships inside the published dsh-ssh package, changing standalone semantics identically.
- **Do nothing / documentation-only**: rejected - the maintainer explicitly chose behavioral seeding.

## Consequences

- Existing family users who NEVER touched SSH settings get SSH turned off at next upgrade - accepted and announced by the maintainer; recovery is one settings toggle.
- Fresh installs see fewer surfaces without losing any capability (SSH remains installable/on-able).
- Future seeds for other rows are one manifest line each; the mechanism enforces target existence, uniqueness, and object-shaped config at generation time.
- Pre-existing unrelated gate failure observed during validation: `test:scripts` market-build clean-checkout test was already failing before this change (isolated via targeted stash); tracked separately from this work.

## Testing

- Regenerated output verified: the override renders last (`# config override for web-ui-ssh`), `node scripts/aggregate.mjs --check` and `pnpm aggregate:check` pass; `pnpm docs:check` passes after pair re-record. Cross-checked upstream facts against installed rc.2 bundles (applyEntryPatches insert indexing and installSettingsSection base-fallback semantics).
