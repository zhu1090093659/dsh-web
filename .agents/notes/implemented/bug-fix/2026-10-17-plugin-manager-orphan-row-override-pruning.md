# Agent Note: Prune orphan row overrides on the plugin-manager update path

Status: implemented

Owns one migration decision: what happens to a per-row override a user carries for a cordis row that no longer exists. The retirement it exists for is owned by [Remove dsh-model-capabilities](../simplification/2026-10-17-model-capabilities-native-removal.md); this note owns how a profile survives it.

## Problem

Retiring a package removes its aggregate row id. 0.4.6 shipped `web-ui-model-capabilities`; 0.4.7's aggregate patch declares `web-ui-win-bash` instead, and the model-capabilities removal note records the package itself as gone. The plugin manager, not the aggregate, writes per-row overrides: the set-enabled route stores a bare `{ id, name, disabled }` row in the profile's `cordis.patch.yml` through `setRowEnabled`, so a user who toggled that family row carries an override for an id the next release no longer declares.

A recorded row id is not a recorded package specifier. The module subpath tombstone in the removal note exists because a profile that recorded `@linxin666/dsh-web-all/model-capabilities` fails to import without it (`ERR_PACKAGE_PATH_NOT_EXPORTED` is a boot error). A row id is different: composing a patch entry whose id nothing declares is not fatal. The loader prints `patch: entry "web-ui-model-capabilities" not found` on stderr and keeps composing — measured on an isolated profile, exit code 0 with 292 entries composed. So the upgrade is not broken, it is noisy on every single boot, forever, and the file keeps a line that means nothing.

## Decision

The plugin-manager update transaction prunes its own orphan overrides as one more post-mutation guard, next to the duplicate-mount strip it already performs. Nothing prunes on boot, no separate command exists, and the aggregate patch is untouched: the retirement stays a shipped removal, the migration happens on the write path that already owns the update.

The authority for "does this row id still exist" is the loader's own composition of the *updated* profile — the `--dump-config` probe whose text the boot preflight already captures, parsed by `composedEntryIdsOf` for its column-0 `- id:` items — **widened by every id the profile's bundle layers still declare** (`declaredRowIds` over each `dsh.profile.bundles` package's own `cordis.patch.yml`, read by `liveOverrideIds`). It is the composed target entry set, not the source profile and not the profile patch:

- The profile patch cannot answer it. It only holds overrides; the ids they point at live in bundle patches the manager never reads, and an override whose row exists looks identical to one whose row does not.
- The source profile cannot answer it either. After an update the old composition still declares the retired id, which is exactly the state being repaired.
- Only the composition sees the official base layer. An override for an id that `@deepseek-ai/dsh-base` or another installed bundle mounts is valid even though no family patch mentions it, so a locally computed id set (family bundle patches plus the profile) would prune live rows.
- The composition is a *snapshot of a running host*, so it is added to, never substituted for. A host that composes while a bundle is being replaced omits that bundle's rows even though the bundle still declares them (see [Composition is not proof on its own](#composition-is-not-proof-on-its-own)). The bundle layers' own declarations are the floor that survives that window; the composition is still what proves a row retired, because only it sees the official base.

Pruning runs in three places, all after the mutation has landed and the version check has passed: the CLI update branch (`runInner`, reusing the preflight's dump instead of spawning a second probe), the legacy aggregate migration (`runMigration`, reusing its `--dump-config` output), and the application-owned path (`runNativeUpdate`), which composes through the same read-only probe even though the CLI is refused every write there. Installs and removals do not prune: they do not change the row-id universe, so a stale row there is a pre-existing state, not something those actions created.

Ownership is a shape, not a hunch. `overrideRowId` claims a top-level item only when it is a bare row (no `insert` key) whose `id` is a string, whose `disabled` is a boolean, and whose entire key set is `id`/`name`/`disabled` — the shape `setRowEnabled` writes. A config row carrying `config:`, an insert wrapper, or any row with a key this package does not write is never removed and never rewritten, even when its id is absent from the composition. A comment block above a removed row is user text, so it moves to the row that follows (or to the end of the file when none does) instead of disappearing with the entry.

### Composition is not proof on its own

0.4.7 shipped this guard with the composition as its only authority. On 2026-10-17 19:32 a real desktop profile lost rows to it: an update that ran while the aggregate bundle was being replaced composed without `web-ui-remote-web-ui` and `ui-schedule`, both of which the bundle layer still declared. The bare override for `ui-schedule` was pruned out of the user's file, and the profile fell back to the bundle defaults for the remote row — `autoTunnel: false` — so the quick tunnel never started, the relay kept a dead `trycloudflare` hostname, and the phone's `hello` was cut off at the edge.

The lesson is about *when* the probe runs, not about what it reads. An application-owned update is a remove-then-install (removal is needed because the in-process manager refuses `installBundle` for a package the profile already carries, `already-installed`), so for a moment the profile's own manifest no longer carries that bundle. A composition taken in that window reports a host that has not reloaded yet, not a retirement.

Three rules therefore hold now:

- A row whose id any bundle layer still declares is never pruned, whatever the probe says.
- A layer that cannot be read — its package is not resolvable right now, or its patch does not parse — makes the declarations unknown, and the guard writes nothing at all. A bundle without a patch file, or one whose patch is `[]`, declares no rows and is not an error.
- Retirement is still proven by the composition: the id must be absent from the probe *and* from every layer's declarations. A retired row is declared by no layer at all, so the original migration still converges.

### Resolving bundle layer directories

The bundle layers whose declarations form that floor are located by `bundleLayerDir`, resolving each `dsh.profile.bundles` entry:

- If the package directory exists inside the profile's own `node_modules` (`package.json` can be read), that copy declares its rows.
- If the directory is missing and the bundle name is in the profile's `dependencies`, it is treated as unknown (`undefined`), so the guard writes nothing. A package listed in `dependencies` belongs to this profile and is caught mid-install or mid-replace; pruning on a missing copy there would repeat the 0.4.7 defect of deleting live overrides during replacement.
- If the directory is missing and the bundle is not in profile `dependencies`, it is an installation-provided bundle. Profiles created by the official CLI naturally list `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` in `dsh.profile.bundles` without installing them locally (the CLI supplies them from the DSH installation at boot). Demanding a profile-local copy would leave declarations unknown and silently disable pruning across every CLI-created profile. Resolution therefore falls back to `hostBundleDir(binary, name)`.
- `hostBundleDir` starts from the resolved dsh CLI entry (tracing symlink shims such as npm-global and homebrew via `realpathSync`) and probes ancestor directories up to 16 levels for `node_modules/<name>` and `lib/node_modules/<name>`. If no installation copy exists or no CLI binary is resolvable (`binary === null`), declarations are treated as unknown (`undefined`) and pruning remains safely skipped.

## Contract

- **Backup.** The write goes through `writePatchAtomic`, the same helper the set-enabled route uses: the current file is copied to `cordis.patch.yml.bak-plugin-manager`, then a `0o600` temporary file is renamed over the target. No new write discipline is introduced.
- **Idempotency.** `pruneOrphanRowOverrides` returns its input text unchanged when nothing is orphaned, and the caller returns before the write when the pruned list is empty. A second run over a pruned profile therefore performs no write, takes no second backup, and reports nothing pruned — the backup still holds the pre-prune text.
- **No authority, no edit.** An unobtainable or empty composition (`composedEntryIdsOf` returns undefined), an unparseable patch file, or a profile without a `cordis.patch.yml` leaves the file exactly as it is. An empty id set never means "prune everything".
- **Failure semantics.** A write that fails settles the job as `error` with the failure text, the backup path and the patch path, exactly like the duplicate-mount guard in the same transaction; the profile keeps its pre-prune text and the backup is the recorded recovery copy. The migration path does not roll the package swap back for this either — the same choice it already makes when the duplicate-mount strip fails.
- **What the user sees.** After the first update to a release that retired a row, the override for it is gone, the boot warning stops, and `cordis.patch.yml.bak-plugin-manager` holds what the file looked like before. Every other override and every unrelated line is byte-identical, and a user whose overrides are all still valid never notices the guard ran.

## Alternatives considered

- **Tombstone the row id in the aggregate patch.** Rejected: a row id is a globally reserved loader id, and the aggregate would keep declaring a row that mounts nothing for the rest of the family's life, blocking that id for any future plugin while hiding the retirement from every reader of the patch. The module tombstone is a different thing — it repairs a boot-blocking import — and stays.
- **Strip the stale entry inside the loader when it cannot find the entry.** Rejected: the loader cannot distinguish "the user meant a row that is gone" from "the user meant a row another layer adds later", it owns no write discipline for the profile, and it would silently edit a user's file during boot.
- **Prune against the installed family bundle patches instead of the composition.** Rejected: it misses the official base layer, so an override for an official row id (the common case for shipped UI rows) would be pruned as an orphan and the user's enablement opinion would be destroyed.
- **Prune after every install and removal too.** Rejected: those actions do not change which row ids exist, so the extra write would edit a user's file for no defect, and the update path is where a retirement can actually strand an override.
- **Report orphaned ids to the user before pruning.** Rejected: the state it would ask about has exactly one useful answer, the entry is provably dead (the composition does not declare it), and the backup already makes the edit reversible by hand.
- **Treat every missing bundle as declaring zero rows.** Rejected: a bundle missing from disk during a remove-then-install update window would be treated as declaring no rows and prune live overrides, re-introducing the 0.4.7 defect. Missing bundles that appear in profile dependencies must remain unknown, and only uninstalled official bundles fall back to the host installation.

## Consequences

- A retired family row no longer leaves a permanent boot warning; the profile converges on the first update after the retirement without any user action, and the same rule covers every future retirement without new code.
- The guard only recognises the override shape this manager writes. A hand-written row that targets a retired id and carries extra keys (a `config:` block, say) is left alone by design, so that user keeps the loader warning until they edit the row themselves — pruning never trades a warning for deleting content the manager cannot reproduce.
- The application-owned (desktop) path prunes only when its runtime can still compose the profile. A host whose CLI cannot run `--dump-config` leaves every override untouched, which keeps the file safe but defers the cleanup to a runtime that can compose.
- An update now performs one more write in the worst case (prune) and no write at all in the common case; the `--dump-config` probe is not spawned twice on the CLI path because the pruning reuses the preflight's dump.
- The guard is narrower than 0.4.7's: an id a bundle still declares survives even when the running host has not mounted it (a denied or incompatible bundle, a package mid-install). That leaves a stale override in place, which the next update running once the bundle is really gone clears — a noise residue is accepted over deleting a live override.
- Cost of the floor: one `readFile` per bundle layer plus a parse of each layer's patch on the pruning path only, after the mutation landed. A profile whose layer list is long pays it once per update, not per boot.
- Official bundles uninstalled in CLI-created profiles resolve through `hostBundleDir`, so orphan pruning operates normally on standard CLI profiles rather than aborting silently due to missing local bundle packages.

## Testing

- `packages/dsh-plugin-manager/tests/rows.spec.ts` pins the pure edit: the retired override is dropped while the comment block, a live override and a config row stay byte-identical; an already-pruned layer returns the input text with nothing pruned; a config row, an insert wrapper and a row with an extra key are never classified as overrides.
- The desktop regression of the 0.4.7 incident is a case in `packages/dsh-plugin-manager/tests/gateway-jobs.spec.ts`: an aggregate bundle declaring `web-ui-remote-web-ui` and `ui-schedule`, a user layer carrying the quick-tunnel override (`autoTunnel: true`, `relay: true`) and a bare `ui-schedule` override, and a composition probe taken while the bundle was gone. The update ends with the user layer byte-identical and no backup, because nothing is orphaned. A second case removes a listed bundle's package directory and asserts the layer is left untouched even though the composition really lacks a row — the declarations are unknown, not empty.
- `packages/dsh-plugin-manager/tests/rows.spec.ts` pins `declaredRowIds`: a layer's insert entries, its own rows, one id declared twice, and an id nested inside a row's own `config:` (a child, not a layer entry) resolve to the layer's ids once each; a layer that does not parse throws so the caller cannot read it as empty.
- `packages/dsh-plugin-manager/tests/gateway-jobs.spec.ts` pins the transaction: an update over a layer carrying a retired id ends pruned with `cordis.patch.yml.bak-plugin-manager` holding the pre-prune text; the same update run again writes nothing (the backup still holds the pre-prune text); a layer whose overrides are all live is byte-identical and leaves no backup; a write failure settles the job as `error` with the backup in place; a desktop-owned update prunes through the read-only probe, and leaves the layer untouched when no composition can be read.
- `packages/dsh-plugin-manager/tests/gateway.spec.ts` pins `hostBundleDir`: resolving installation copies beside the CLI entry, tracing through npm-global/homebrew symlink shims before walking ancestors, finding `lib/node_modules` prefix layouts, and returning `undefined` when no copy exists or the CLI binary is unresolvable (`binary === null`).

## Known limitation: the transition that creates the orphan cannot run the prune

Post-publish verification against the real registry (isolated home, pinned `0.2.1-rc.2` CLI) showed that a `0.4.6` to `0.4.7` upgrade does not prune: the override survives, no `.bak-plugin-manager` backup is written, and `dsh --dump-config` keeps printing `patch: entry "web-ui-model-capabilities" not found`.

The cause is structural rather than a wiring bug. An update runs the plugin-manager code the running host already loaded, so the update that installs `0.4.7` is executed by `0.4.6` handlers (an npm pack of `@linxin666/dsh-client-ui-plugin-manager@0.4.6` contains zero references to `pruneOrphanRowOverrides`). Nothing repairs it afterwards: boot composes without touching the patch, and a second update short-circuits with `409 already at 0.4.7`. The entry is cleared by the next update that runs under `0.4.7` or later, so the residue is one update behind rather than permanent.

The `0.4.7` upgrade matrix passed this scenario because it imported `makeGatewayRoutes` from repository source, exercising `0.4.7` handlers over a `0.4.6` profile. Substituting a local registry for the unpublished `0.4.7` tarball also substituted the handler code under test, which is the part that mattered.

Decision for `0.4.7`: disclose the limitation in the release notes and the release body with a manual fix, and move the prune to a path that runs for an already-upgraded host (after boot or on first gateway touch, plus the install and remove jobs) in the next release. Any future row retirement must prune before the retiring version performs the transition, or accept the same one-update lag.
