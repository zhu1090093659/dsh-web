# Agent Note: preview SDK cohort via source-built tarball overrides

Status: implemented

## Problem

The official `@deepseek-ai` SDK cohort 0.1.2-alpha.1 is a developer preview that is intentionally not published to npm: the registry's `latest`/`next` dist-tags stay at 0.1.1-rc.2 and every 0.1.2-alpha.1 package name returns 404. The cohort nevertheless carries the breaking changes the plugins must adapt to (dsh-client-runtime and dsh-host-apiproxy deleted, the settings/session/workspace client faces reorganized into the api-*-controller and client-store packages, and the browser frozen module table gaining dsh-client-store). The repository could not typecheck, test, or build against the target cohort by any npm-supported means.

## Decision

The upgrade worktree resolves the whole cohort from tarballs built once from the official source tag `deepseek-harness@dsh-v0.1.2-alpha.1` (commit cd5ef81): a throwaway store at `~/.dsh-cohorts/0.1.2-alpha.1/` outside the repository holds one `pnpm pack` tarball per official package, and a generated `overrides:` block in `pnpm-workspace.yaml` pins every `@deepseek-ai/dsh-*` name to its tarball. Manifest ranges read `^0.1.2-alpha.1` so that deleting the block restores ordinary registry resolution once the cohort is published. Two upstream removals are honored in the manifests themselves: `dsh-client-runtime` and `dsh-host-apiproxy` devDependencies are gone, and `minimumReleaseAgeExclude` pins moved to the target version with the two dead entries dropped. The toolchain is pinned to `packageManager: pnpm@11.24.0` because pnpm 11.9.0 misresolves transitive dependencies of `file:` tarball packages when third-party peers are present (it bypasses overrides and hits the registry for versions that do not exist); 11.24.0 resolves the identical tree correctly. `dsh-aionui-panel` is removed at the maintainer's decision: discontinued, its client cannot build without the deleted package, and dsh-better-sidebar has owned the right-panel seat; the package directory, its aggregate membership, and its README/publish-prep rows are deleted with this migration.

Plugin client code migrates off `dsh-client-runtime/client`: `ClientContext` becomes a local alias of cordis `Context`, the settings scope family comes from `dsh-client-ui-settings/client`, the snapshot-store engine from `dsh-client-store` (now a platform module, so the preset's RUNTIME_STORE_EXEMPTION is deleted), sessions from `dsh-api-session-controller/client`, workspaces from `dsh-api-workspace-controller`, and the `ctx.slots` merge point moved to `dsh-client-ui-renderer/client`.

## Alternatives considered

Waiting for the npm publish was rejected because the adaptation work the user asked for cannot even typecheck against a cohort that has no published date. Pointing TypeScript at a DSH source checkout or linking the harness workspace's node_modules was rejected because it breaks CI-resolution, violates the repository's SDK-boundary rule, and couples the plugin build to a mutable checkout. Serving the cohort through a local registry daemon was rejected as operationally heavier than static tarballs for the same result. Repacking third-party aggregate plugins (dsh-better-sidebar and friends) with stripped peers was tested and dropped: keeping them on the registry with unsatisfied-peer warnings preserves the rc.2-era behavior and a smaller diff.

## Consequences

Every manifest, the lockfile, and the aggregate bundle now describe a cohort that exists only in the throwaway store, so CI cannot pass until either the cohort is published or CI grows a cohort-build step. The branch merged to `dev` that same evening, and CI now rebuilds the store itself: [CI rebuilds the preview cohort tarball store](2026-08-29-ci-rebuilds-cohort-tarball-store.md). The overrides block is the single remove-me switch back to the registry. The aionui panel is gone from the family bundle entirely. The third-party aggregate plugins stay on versions whose SDK peers predate the cohort; they install with peer warnings and remain runtime-broken until their upstreams adapt, which is an accepted external limit of the preview rather than a regression introduced here.
