# Agent Note: DSH host floor tracks the adapted cohort

Status: implemented

## Problem

Users installing the family had no authoritative answer to "which DSH host version do these plugins need". After the alpha.3 cohort bump the machine-readable floors still read `dsh.engines.dsh >=0.1.2-alpha.1`, the root-README DSH badge showed the host's live npm `alpha` dist-tag (which can run ahead of what the family has adapted to), and the CI/release mount-smoke lanes still pinned the alpha.2 host CLI. Nothing told an installing user to move to 0.1.2-alpha.3, and no rule tied the floor, the badge, and the smoke lanes to one version.

## Decision

The family's declared host floor is the cohort the family currently adapts to, and the three user-facing surfaces name that same version. dsh-web's latest release line always tracks the host's latest npm version, so the floor moves with every cohort bump. Concretely, at the alpha.3 cohort:

- Every family package and the plugin scaffold declare `dsh.engines.dsh >=0.1.2-alpha.3`; the plugin manager reads this floor at install/update checks and prompts or blocks older hosts.
- The root README badge (Chinese and English) states the requirement statically — a shields static badge rendering `DSH >=0.1.2-alpha.3`, still linking to the npm package — replacing the live dist-tag badge.
- The CI and release mount-smoke lanes pin `@deepseek-ai/dsh@0.1.2-alpha.3`: the lanes mount into the host version users are required to run, and docs/publish-prep.md states the same fact.
- The plugin scaffold's `@deepseek-ai/*` devDependencies align to `^0.1.2-alpha.3`, so new plugins scaffold on the adapted cohort.

The cohort-bump contract is therefore: one bump moves the manifest devDependency ranges, the engines floors, the README badge, and the CI mount pin together. The cohort mechanics live in [sdk-cohort-0.1.2-alpha.2-upgrade](2026-08-30-sdk-cohort-0.1.2-alpha.2-upgrade.md); the floor-must-declare rule lives in docs/plugins.md.

## Alternatives considered

Keeping the live `alpha` dist-tag badge was rejected: it shows the host's newest publish, not the family's requirement, and advertises versions the family has not adapted to yet. A bounded range (`^0.1.2-alpha.3`) was rejected: the plugin-manager contract only supports the `>=<semver>` form, and an upper bound would block future hosts the family adapts to on the same line. Leaving the floor at `>=0.1.2-alpha.1` to keep older hosts installable was rejected: the family ships on the alpha cohort line, older hosts are exactly what users must leave behind, and the manager only surfaces the floor it is given.

## Consequences

Users on hosts older than 0.1.2-alpha.3 now hit the plugin-manager floor check when installing or updating any family package, and the README states the requirement without drifting ahead of or behind the adapted cohort. Every future cohort bump gains two mandatory moves (the badge and the CI pin) alongside the existing devDependency-range and floor moves. Historical narratives that mention earlier cohorts (alpha.2 notes in package READMEs, release notes, archived records) stay as history and are not rewritten per bump.

## Testing

`pnpm test:scripts` passes (234 tests) including the family-dsh-engines invariant that every family package and the scaffold declare a supported `>=<semver>` floor — 22 declarations now at `>=0.1.2-alpha.3`. The badge URL was fetched and renders `>=0.1.2-alpha.3`. `pnpm docs:check`, `pnpm aggregate:check`, `pnpm typecheck`, and `pnpm i18n:check` pass. `pnpm market:check` fails on this checkout for a pre-existing reason unrelated to this change: the local `market/shell/dist` rebuild (built 2026-09-01 00:11, after the last shell source commit) differs wholesale from the committed `market/dist/tryon`, while the committed tryon verifies clean against its own 756-file hash manifest — the property CI's shell-dist-less check mode verifies — and the drift list contains no manifest entries, so family package.json changes are not an input to it.
