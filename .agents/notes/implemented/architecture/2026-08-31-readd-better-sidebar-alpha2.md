# Agent Note: Re-add dsh-better-sidebar to the alpha.2 aggregate

Status: implemented

## Problem

The alpha.2 cohort migration (2026-08-30) excluded `dsh-better-sidebar` and `@mlgbnb/dsh-archive-manager` from the `dsh-web-all` aggregate: both hard-imported the `@deepseek-ai/dsh-client-runtime` face that alpha.2 removed, and under the host loader's strict import resolution they abort the whole `dsh web` boot. The exclusion took the family's default right panel (better-sidebar) out of the shipped bundle — a user-visible regression, not just a CI matter.

## Decision

`dsh-better-sidebar` is back in the aggregate at exactly `0.18.0-alpha.0` (npm `alpha` dist-tag, published 2026-08-30) — the first upstream build aligned to the alpha.2 cohort: every `@deepseek-ai/*` peer declares `^0.1.2-alpha.2`, `dsh.client.inject` names `@deepseek-ai/dsh-client-modules` (the alpha rename) instead of the removed runtime face, and the only remaining `dsh-client-runtime` occurrences are comments. The aggregate row is restored as a direct external row (`web-ui-better-sidebar` / `name: 'dsh-better-sidebar'`); the bundle's standalone `disabled: !!js` double-mount guard is not carried into the aggregate patch, because the generator drops non-name/config keys on insert rows and the guard's `id !== 'better-sidebar'` predicate would misfire under the namespaced id. The smoke lane asserts the better-sidebar host div mounts again next to the frame boot anchor.

`@mlgbnb/dsh-archive-manager` remains excluded: its latest build (1.0.7) still imports the removed face. Re-add it with the same pattern (aggregate.yml row + package.json dep + `scripts/aggregate.test.mjs` mount assertion) when upstream ships an alpha.2-compatible build.

## Alternatives considered

- Stay on `0.17.1` (npm `latest`): rejected — its peers declare `^0.1.0-rc.8`, an rc.8-cohort constraint that the alpha.2 loader would not satisfy, and the user explicitly asked for the latest alpha.
- Re-add archive-manager at the same time: rejected — no compatible upstream build exists yet.

## Consequences

The right panel ships again in the aggregate on the alpha.2 cohort (exact pin `0.18.0-alpha.0`, so later upstream publishes need no re-pin). The `minimumReleaseAgeExclude` pin in `pnpm-workspace.yaml` moved to the new exact version, and the docs (package README pair, root README pair, `docs/publish-prep.md`) no longer present better-sidebar as excluded. The exclusion rationale stays recorded in [the alpha.2 upgrade note](2026-08-30-sdk-cohort-0.1.2-alpha.2-upgrade.md) and the smoke-rewrite [e2e-mount-excluded-externals-anchor](../testing/2026-08-31-e2e-mount-excluded-externals-anchor.md) note, both cross-linked back here.

## Testing

`node scripts/aggregate.mjs` regenerates `cordis.patch.yml` with the `web-ui-better-sidebar` insert row; `scripts/aggregate.test.mjs` asserts it is present and `web-ui-archive-manager` is absent; `pnpm test:scripts`, `docs:check`, and `aggregate:check` pass. `bash scripts/e2e-mount.sh` boots a scratch `dsh web` from the packed aggregate tarball and the Playwright lane waits for `[data-dsh-better-sidebar]` (count 1) after the frame — the run passes.

Follow-up (2026-08-31): the scratch smoke cannot see the linked-profile dependency gap. The local `web` profile links `dsh-web-all` into this repo, so better-sidebar's host half physically resolves from the repo's `node_modules` top level, where its required peers were absent (`autoInstallPeers: false`, root had no `@deepseek-ai/*` deps) — `dsh web` aborted with `ERR_MODULE_NOT_FOUND` on `@deepseek-ai/dsh-subagent`, then `@deepseek-ai/dsh-util-time`. The fix mirrors better-sidebar's static-import host-face closure (walked from `lib/index.js` through the harness sources: 15 faces) into root `devDependencies` at the cohort ranges (`^0.1.2-alpha.2`, `@deepseek-ai/cordis@^4.0.2`, `schemastery@^3.18.1`), so the linked profile resolves every host face the bundle imports. The scratch smoke's hoisted profile installs the host closure alongside the aggregate, which is why CI stays green either way.
