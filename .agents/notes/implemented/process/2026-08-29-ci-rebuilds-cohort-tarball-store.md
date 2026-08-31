# Agent Note: CI rebuilds the preview cohort tarball store

Status: implemented

## Problem

The [preview cohort overrides](2026-08-28-preview-cohort-tarball-overrides.md) resolve every `@deepseek-ai` package from file: tarballs under the machine-local store `/Users/zcl/.dsh-cohorts/0.1.2-alpha.1/`, and the frozen lockfile records those absolute paths throughout. The branch merged to dev the same evening despite the note's own precondition, so every GitHub runner failed at `pnpm install --frozen-lockfile` with a missing store — CI, the release pipeline, and the market deploy were all blocked on the alpha.1 state. Two smaller collisions surfaced in the same push: the workflows' `pnpm/action-setup` `version: 11` input clashed with the new `packageManager: pnpm@11.24.0` pin (a dual-specification error), and setup-node's package-manager cache detection required a pnpm binary inside the pnpm-less contributors workflow.

## Decision

`scripts/build-cohort-tarballs.mjs` materializes the store on any machine. It parses the overrides block into the expected tarball set (249 names) and exits instantly when the store already holds them; otherwise it prepares a harness checkout at the pinned source tag (`dsh-v0.1.2-alpha.1`, commit cd5ef814 — an existing checkout or a shallow clone), installs it with the frozen lockfile and scripts disabled, builds it with `pnpm run build:official` (the release packer's build-record gate demands the official artifact profile), packs the publish family with the harness's own `release:pack`, direct-packs the private experimental packages the family excludes but the overrides still reference, and finally normalizes each packed manifest to the store's self-contained shape: `peerDependencies` merge into `dependencies` under a canonical key order and the peer section is dropped, because the consumer lockfile installs with autoInstallPeers disabled; `peerDependenciesMeta` survives as inert documentation. Finally the script refreshes the lockfile's recorded integrity for the cohort tarballs to the store's actual bytes: pnpm records a sha512 for file: tarballs, and a rebuilt store is never byte-identical to the original because client faces embed the building checkout's absolute path, so each environment anchors the integrity to its own verified store; the rewrite stays runner-local and never enters git. The script verifies every referenced tarball exists and is non-empty.

The five pnpm-consuming jobs (CI checks, plugin-mount, release publish, release smoke, market deploy) restore the store from the actions cache keyed `dsh-cohorts-<hash of pnpm-workspace.yaml>` and then run the script: a cache hit is a no-op, a miss rebuilds the whole store. The store location is machine-relative, two levels above the checkout, because the lockfile records the tarball resolutions as `file:../../.dsh-cohorts/...` — on the local machine that lands in the home directory, on a runner in the workspace parent. The workflows drop the `version: 11` input so `packageManager` is the single pnpm source, and the contributors workflow disables the package-manager cache detection it cannot satisfy.

## Alternatives considered

- Waiting for the cohort to reach npm before anything lands on dev: rejected; the merge already happened, and the overrides remain the remove-me switch that ends this whole mechanism the day the cohort publishes.
- Shipping the 251 tarballs as release assets for CI to download: rejected; it redistributes upstream build artifacts on the public repository and adds an upload step to every cohort bump.
- Committing the tarballs to the repository: rejected for the same redistribution reason plus repository bloat.
- Relative file: overrides so the store lives inside the workspace: rejected; the lockfile records the absolute paths throughout, and rewriting both would forfeit the frozen install.

## Consequences

Cold CI runs clone, install, build, and pack the harness once per cohort, and the cache serves every later run a no-op; the cache key changes with any pnpm-workspace.yaml edit. Rebuilt client faces embed the building checkout's absolute path and CSS-module hashes, so a rebuilt store differs byte-wise from the machine-local one in exactly the documented per-checkout nondeterminism — each store is self-consistent, and the CI gates plus the mount smoke validate the CI-built one end to end. When the cohort reaches npm, deleting the overrides block deletes the store, this script, and the cache steps together.

## Testing

An isolated worktree of the harness at the pinned commit was installed, built with the official profile, and packed end to end through the script into a fresh store: 249/249 referenced tarballs produced, every manifest semantically identical to the machine-local store's, and the remaining lib diffs are the documented per-checkout path and CSS-hash nondeterminism; the fast path no-ops against both stores. The packageManager clash was reproduced from the dev-branch CI failure logs and resolved by the workflow edits. A dev-branch CI run on a fresh runner materialized the full store in about four minutes, proving the runner-side build path; its subsequent install still failed because that run had placed the store at the overrides' absolute location while the lockfile resolutions are relative to the checkout root, which the store placement above now follows.
