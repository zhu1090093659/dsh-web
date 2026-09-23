# Agent Note: The root alias pins one exact released aggregate version

Status: implemented

## Problem

Issue #1442: a profile that installs the repository root over git (`dsh plugin add github:zhu1090093659/dsh-web#v0.3.17`) entered the loader's recovery mode because every `web-ui-*` row failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The root patch ships the aggregate's generated manifest, whose rows mount per-family subpaths, while the modules come from the `@linxin666/dsh-web-all` dependency. That dependency was declared as `^0.3.6`, a range wide enough to resolve an aggregate whose `exports` predate the patch: family subpaths first appear in 0.3.13, `./model-capabilities` in 0.3.18, and `./preset-center` in 0.3.19. When the git ref moved, the dependency spec string did not, so an existing lockfile kept the old child (0.3.10 in the report) and the new patch could not import its rows.

The published aggregate tarballs are complete — `npm pack --dry-run` lists `lib/` and every subpath for 0.3.17 and 0.3.20 alike. The report's "no lib/ build output" describes the repository root's git payload, which intentionally ships only the manifest and the generated patch (the [alias note](../feature/2026-08-30-repo-root-installable-alias.md)).

## Decision

- Root `package.json` depends on `"@linxin666/dsh-web-all": "0.3.20"` — one exact released version instead of a range, so the patch and the modules always come from the same release and a lockfile can never retain an older child.
- `scripts/verify-version.mjs` asserts the root dependency equals the release tag and runs before publishing (`release.yml`); a drift fails the release. The check lives in `scripts/lib/root-alias-pin.mjs` with a unit test in `scripts/root-alias-pin.test.mjs` (part of `pnpm test:scripts`).

## Testing

- `node scripts/verify-version.mjs 0.3.20` reports "all 21 packages and the root aggregate pin match v0.3.20"; the same command against v0.3.21 exits 1 and annotates `package.json`.
- `node --test scripts/root-alias-pin.test.mjs` accepts an exact pin and rejects a caret range, a stale exact pin, and a missing dependency.
- `pnpm install --lockfile-only --ignore-scripts` refreshes the lockfile in one line (`specifier: 0.3.20`, still `version: link:packages/dsh-web-all`), so the in-checkout workspace link is unchanged.

## Alternatives considered

- Keep the range and add a runtime guard that fails early when the resolved aggregate lacks a subpath. Rejected: it converts a boot failure into a slightly earlier boot failure and still leaves lockfiles resolving an incompatible child.
- `>=0.3.19` (the first version exporting every current row). Rejected: it forces lock re-resolution today but silently drifts the moment a family adds a subpath, which is exactly how this bug appeared.
- Ship the built aggregate inside the root git payload. Rejected: it contradicts the alias design (a thin manifest whose modules come from npm) and would duplicate the release build on user machines or in git.

## Consequences

- Every family release repins the root dependency to the new version; `verify-version.mjs` makes forgetting it a release failure rather than a user-visible boot failure.
- A profile that installs the tag gets exactly the aggregate built from that tag, so patch rows and exported subpaths can no longer diverge.
- The npm lane lag described in the alias note still applies: a git install of a commit whose patch references not-yet-published members resolves only after that release publishes.
