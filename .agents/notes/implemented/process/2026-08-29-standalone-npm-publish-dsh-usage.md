# Agent Note: Standalone npm publish of dsh-usage while the lane is paused

Status: implemented

## Problem

The npm publish lane is paused family-wide (see [the pause decision](2026-08-28-pause-release-npm-publish-unstable-dsh-alpha.md)): tags create GitHub Releases only, because the family's `@deepseek-ai/*` alpha cohort cannot resolve from the registry. The user nevertheless asked for the new usage statistics plugin to ship as a standalone npm package for distribution — `dsh plugin add` from npm is the easiest install path for machines outside this checkout, and the community-plugin ecosystem is npm-registry-shaped.

## Decision

`@linxin666/dsh-usage@0.3.7` is published to npm manually (one `pnpm publish --access public` from the package directory, from the committed feature state), outside the tag pipeline. The family lane stays paused; no other package publishes and no version numbers change.

This does not contradict the pause rationale. The pause blocks publishes whose dependency graph cannot resolve from the registry. dsh-usage's runtime graph is `schemastery` only; `@deepseek-ai/*` appear exclusively in `devDependencies` (never installed for a dependency) and its runtime imports of them resolve from the DSH runtime itself — the exact resolution the repo's `.npmrc` scope mapping and `scripts/runtime-deps-check.mjs` assert, and the check passes for this package. `react` is a normal registry peer. A consumer's `pnpm add @linxin666/dsh-usage` resolves cleanly, which is what the pause exists to guarantee.

## Consequences

- Version 0.3.7 corresponds to no tag: the package was created after v0.3.7 was cut, and the unified-version policy forbids bumping one package ahead of the family. The tarball's content is the feature commit it was published from; the next full release (0.3.8 or later) publishes dsh-usage through the pipeline like every other package, and the unified bump keeps `pnpm -r publish` clear of the already-published version.
- While the lane is paused, this is the only family package on npm; npm consumers must not expect the rest of the family there.
- The published manifest keeps the `@deepseek-ai/*` devDependency ranges (unresolvable but inert); that is the same shape every family package will publish with when the lane reopens.
