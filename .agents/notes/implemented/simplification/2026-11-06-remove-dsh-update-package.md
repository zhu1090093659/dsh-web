# Agent Note: the family removes the self-update package

Status: implemented

## Problem

`packages/dsh-update` (`@linxin666/dsh-update`) was the family's in-GUI self-update surface: a sidebar footer trigger, a release-notes panel, and the `/api/update/status` plus `/api/update/run` routes that ran a verified `pnpm update --latest` inside the profile. It owned row id `update` on its own — rather than sharing `dsh-remote-web-ui`'s row — so that turning remote access off could never take the update trigger away, and it refused the desktop shell's page because that application owns its own updater.

Two things then removed its reason to exist. The aggregate retired the row on 2026-11-01, because the package refuses a profile whose family is installed from a checkout — the `link:` profile this repository's own development flow builds — so the bundle's users were exactly the population whose update entry could never work. Then DSH 0.2.2-rc.1 shipped registry version checking into the official Plugins page: every installed bundle is compared against the version its source serves, gated on the DSH minimum the release declares, updated in place with the removal/installation/restore steps the dialog narrates, and summarized in the list toolbar. That is the same job, on the page users already open, for every plugin rather than only this family.

What remained unique to the package was a passive badge in the sidebar footer announcing a newer release before the Plugins page was opened, and one click that moved the whole family at once. Both describe a release line the bundle no longer installs by default: the package stayed published for standalone installs, carrying its own tests, its ru dictionary, six entries in the shared-module manifest and four gate baselines — upkeep for a surface reachable only by a deliberate extra install whose capability the official page already provides.

## Decision

- **The package is gone.** `packages/dsh-update` is deleted whole, together with the two Agent Notes that decided it — the one that gave the capability its own row and package, and the one that retired the aggregate's mount. This note carries their surviving rationale: the capability deserved its own row and package while the family carried it, and the aggregate stopped mounting that row before the package itself was removed.
- **The official Plugins page owns plugin updating.** A profile that wants to move `@linxin666/dsh-web-all`, or any family package installed on its own, does it from that page's version check, which the family no longer wraps.
- **The aggregate keeps its retirement trace.** `update` stays in the aggregate's `tombstones:`, `retiredPlugins` still registers it as `{"family":"update","plugin":"@linxin666/dsh-update"}`, and the `shellNotes:` row stays: a stored row name `@linxin666/dsh-web-all/update` still resolves to the shell and mounts as a silent no-op. That mechanism belongs to [Generate the aggregate's retired-plugin registry from its manifest](../bug-fix/2026-10-17-aggregate-retired-plugin-registry.md), not to the deleted package.
- **The ru dictionary goes with its only consumer.** `packages/dsh-i18n/src/client/ru/update.ts` and its namespace row in that package's `ruDictionaries` map are removed, and the i18n audit package list loses its `dsh-update` row. This differs from the aggregate retirement, which kept the dictionary because the package stayed installable.
- **The shared-module manifest and the gate baselines lose their rows.** `scripts/sync-shared.mjs` no longer copies `mount-once.ts`, `telemetry.ts`, `loopback.ts`, `http.ts`, `vitest.setup.ts` or `console-output.ts` into the package; `coverage-baseline.json`, `test-standards-baseline.json` and `test-shard.mjs` no longer carry it.
- **The documents state the absence.** The root README pair and `docs/architecture.md` list no self-update entry, `docs/publish-prep.md` no longer publishes the package, and the package's README pair is deleted with it.
- **npm keeps the last release.** `@linxin666/dsh-update@0.4.15` stays on the registry and is marked deprecated, pointing at the official Plugins page: an existing standalone install keeps working until its owner uninstalls it, and no further release of the package is made.

## Alternatives considered

- **Keep the package published but mounted nowhere.** Rejected: that is already the state the aggregate retirement left, and it is the state this change is judged against — a release line, a dictionary, six shared-module copies and four gate baselines kept green for a capability the official page performs, reachable only by an extra install.
- **Slim the package to the one thing the official page does not do: move the whole family in one click.** Rejected: a family installed through the aggregate is one bundle on the official page, so one update moves all of it, and a family installed package by package is a list the toolbar summarizes and the user updates row by row. The coarse updater has no distinct job left, and keeping it would keep the same six shared copies and dictionary.
- **Keep the sidebar badge as a passive notifier and delete the rest.** Rejected: the badge's only client was its own panel, and the badge alone would still mean a published package, a mounted row and a dictionary for a status the user acts on inside another page.
- **Excise the `update` subpath export instead of tombstoning it.** Rejected on the earlier retirement's grounds and unchanged here: every profile that upgraded through the bundle stores the row name `@linxin666/dsh-web-all/update`, and without the export that entry fails at import and is recorded as failed or degraded. The tombstone is what makes the deletion silent.
- **Keep the ru `update` dictionary for standalone installs.** Rejected: deleting the package ends the release line, so there is no family build whose ru copy would drift from it, and the dictionary would describe a namespace nothing registers. The earlier retirement kept it only because the package still shipped.

## Consequences

- An aggregate profile and a standalone profile both lose the sidebar footer update trigger and the release-notes panel; updating is the official Plugins page's version check, with the runtime minimum gate and the restore-on-failure steps that page owns.
- Four gate baselines and the shared-module manifest shrink by one package; `pnpm test:scripts`, `pnpm i18n:check` and `pnpm aggregate:check` are the checks that would notice a missed row.
- A profile still carrying the old row name upgrades silently: the subpath resolves to the shell and the shell no-ops the row, so nothing lands in the degraded ledger.
- `/api/update/` no longer exists on any host. `dsh-remote-web-ui` keeps that prefix in its gated-channel tables, where it costs one entry and fences a path nothing serves — removing it there would be a separate change to another package's channel rules.
- A Russian UI loses the `update` namespace: the dictionary is gone and no installed plugin registers it.
- `@linxin666/dsh-update@0.4.15` remains installable from npm. Its code is no longer maintained, and a profile that installs it after this change gets a plugin whose capability the official page already provides.
