# Agent Note: The repository root installs as one plugin (alias bundle over the npm aggregate)

Status: implemented

## Problem

External hubs and `dsh plugin add` classify a Git repository by its root `package.json`. The dsh-web monorepo root declared no `dsh.bundle`, so pointing a hub or an installer at `github:zhu1090093659/dsh-web` produced the verdict "not an installable plugin package" even though the repository is the Web GUI plugin family. The only install routes were the npm aggregate (`@linxin666/dsh-web-all`, whose npm lane lags the repo) and the clone-build-link developer flow.

## Decision

The repository root is a thin bundle alias over the published aggregate:

- root `package.json` declares `"dsh": { "bundle": { "patch": "./packages/dsh-web-all/cordis.patch.yml" } }`, `dependencies: { "@linxin666/dsh-web-all": "^0.3.6" }`, and a two-entry `files` whitelist so a packed git install ships the manifest and nothing else;
- checkout `pnpm-workspace.yaml` sets `linkWorkspacePackages: true`, so inside the repository the root dependency links the workspace project (same source, no npm copy), while a profile install resolves it from the npm registry.

`dsh plugin --profile web add github:zhu1090093659/dsh-web` mounts the whole family: the root joins the `dsh.profile.bundles` layer stack, its patch is the aggregate's own generated `web-ui-*` manifest, and the npm aggregate dependency (resolved at install time) supplies every module the rows reference.

## Alternatives considered

- **Build member packages at install time (root as a real source bundle).** Rejected: a git install would have to run the monorepo build on user machines (prepare recursion, tsdown devDependencies, platform build scripts) — fragile, slow, and cross-platform hostile; the aggregate's npm tarballs already exist for exactly this job.
- **Root patch duplicating the aggregate rows.** Rejected: a hand-copied patch drifts from the generated one (`scripts/aggregate.mjs`); pointing at the generated file keeps a single source of truth.
- **Docs-only handling (the hub verdict is accurate as-is).** Rejected: the ask was to make the repository installable, not to re-explain why it is not; the hub card already points readers at the README.

## Consequences

- The npm lane's lag bounds what git installs get: the patch comes from the repo commit while member code comes from the newest published aggregate, so a source patch row referencing an unpublished member only resolves after that release publishes. The release flow needs no change, but members should be published promptly after the patch gains their rows.
- The alias and the npm aggregate are mutually exclusive in one profile: both produce identical `web-ui-*` rows, and installing both collides on duplicate ids (documented in the root README).
- The root dependency range `^0.3.6` must be raised when the family moves past the 0.3 major.
- `linkWorkspacePackages: true` is checkout-wide; no other workspace package declares a range spec matching a workspace project name, so only the root dependency is affected.

## Testing

- Scratch profile via the official command: `dsh plugin --profile zprobe-alias add --ignore-scripts git+file://<probe clone>` installed the root plus 224 packages (aggregate from npm), reconcile appended `dsh-web` to the bundle list, and `dsh --profile zprobe-alias --dump-config` composed all 23 `web-ui-*` entries; the scratch profile and probe clone were removed afterwards and the shared `profiles/node_modules` stayed unchanged.
- Checkout `pnpm install` resolves the root dependency as `0.3.8 <- packages/dsh-web-all` (workspace link; lockfile +4 lines).
