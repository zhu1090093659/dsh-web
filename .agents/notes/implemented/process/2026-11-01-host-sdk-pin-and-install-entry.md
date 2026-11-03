# Agent Note: The workspace pins @deepseek-ai to the running host's SDK tree

Status: implemented

## Problem

This checkout is loaded by the running host through the profile's `link:` entries, so Node resolves a plugin's `@deepseek-ai/*` imports by walking up from the plugin directory into this repository's `node_modules`. Two paths decide what that resolution finds: the root `node_modules/@deepseek-ai` scope directory, and the per-package `packages/<pkg>/node_modules/@deepseek-ai` entries a dev install creates, which outrank the root one for that package's own imports.

A second copy of the SDK beside the host's does not fail loudly. A second cordis makes service registration miss, and a split cohort splits type identity, so a package that consumes a host core type and augments cordis sees two unrelated `Context` declarations; `packages/dsh-i18n` failed exactly that way on tsgo before the pin covered libraries as well. A plain `pnpm install` is not guaranteed to produce the cohort the host runs: the declared ranges can resolve beside, rather than to, the installed host version.

## Decision

`scripts/host-sdk-link.mjs` owns the pin. It resolves the host SDK tree (the installed dsh's own `node_modules/@deepseek-ai`, `DSH_HOST_SDK_DIR` when set, versioned node builds as a fallback for the window where `current` is being swapped), links the root scope directory at it, and repoints every workspace entry the host supplies at the host copy. The few the host does not ship — client-only build inputs such as `dsh-client-ui-primitives` — keep the registry copy, because they are bundled at build time and never resolve in the running host. The script is idempotent, never removes a package the host does not supply, verifies without writing under `--check` (exit 1 on drift), and on a machine with no complete host install reports that and exits 0, so CI and contributor checkouts are unaffected.

`scripts/install-deps.mjs` is the install entry point (`pnpm run deps:install`). pnpm cannot be allowed to link against the pin while it writes: the root scope directory is a symlink into the root-owned host tree and pnpm reaches through it, so an install that has to place a scope member there dies with EACCES halfway through. The script detaches the root link, runs `pnpm install --ignore-scripts --frozen-lockfile --config.confirmModulesPurge=false`, and restores the pin even when the install fails, so a broken install never leaves the running host resolving a registry copy. `--ignore-scripts` is deliberate: the cloudflared, ssh2 and cpu-features postinstall hooks fetch platform binaries this machine cannot reach, and workspace prepare hooks rebuild packages that are not part of a dependency install. `--no-frozen-lockfile` is the documented exception for a change that edits a manifest.

`build`, `test` and `typecheck` run `host-sdk-link --check` ahead of the recursive command, so a registry copy of the SDK fails loudly at the gate instead of splitting the cohort silently. `pnpm-workspace.yaml` turns `verifyDepsBeforeRun` off: pnpm 11's pre-run dependency self-check rewrites `node_modules` headlessly when it decides it must, and against the root-owned host link that check can only end in EACCES — including for `pnpm run deps:install` itself.

The three client-only packages the host does not install (`dsh-client-store`, `dsh-client-ui-primitives`, `dsh-client-ui-slots`) are forced to `0.2.2-alpha.3` through workspace `overrides`, so resolution stays on one cohort. The manifests declare `^0.2.2-alpha.3`; the override only unifies the resolution result, and the matching `packageExtensions` keys move with it.

## Alternatives considered

**Let a plain `pnpm install` produce the cohort.** Rejected: the declared range resolves to rc.3 while the host runs rc.5, and the failure mode is a silently split cohort rather than an install error — exactly the class of failure this change removes.

**Pin only the root scope directory.** Rejected: a dev install creates `packages/<pkg>/node_modules/@deepseek-ai` entries that outrank the root pin for that package's own imports, so the root link alone leaves every package that declares SDK devDependencies resolving somewhere else.

**Keep pnpm's pre-run dependency self-check and repair the pin afterwards.** Rejected: the self-check runs before every `pnpm run` and can only end in EACCES against the root-owned link, so the install entry point exists precisely to detach the pin while pnpm writes.

**Advance the three client-only packages by editing the manifests.** Rejected: the cohort literal is carried by many manifests that are still correct, and the override unifies resolution without touching a declaration rc.5 already satisfies.

**Move the whole workspace to a declared rc.5 cohort in this change.** Rejected: cohort declarations belong to the cohort chain and the satellites, while this change is about what this checkout resolves. The measured typecheck limitation below is unchanged by the move, so it is not a reason to hold resolution back either.

## Consequences

- The pin requires a complete host SDK tree. Windows npm-global discovery reads `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`; the current global tree lacks valid `dsh-session` and `dsh-agent` package markers, so it is rejected rather than pinned. A plain registry install remains the supported fallback for CI and incomplete installations.
- The pin is a local development contract: it changes no manifest, no lockfile and no committed artifact, and a checkout that never runs it still builds from the registry cohort.
- `pnpm run deps:install` is the only install path that keeps a valid running host resolving the host cohort. On Windows the entry point invokes `pnpm.cmd` through the shell; the alpha.3 re-resolution completed through that path.
- pnpm no longer runs its pre-run dependency self-check in this workspace, so a stale `node_modules` after a manifest edit is reported by the install and gate commands instead of being repaired in place.

## Testing

- The Windows candidate test passes, while the real global tree is correctly rejected as incomplete. No pin is forced and no running service is restarted.
- `node scripts/install-deps.mjs --no-frozen-lockfile` completes on Windows and installs the alpha.3 cohort. The subsequent full `pnpm typecheck` and complete `pnpm test` pass on the registry cohort.
- `pnpm test:scripts` has 552 passing tests and one pre-existing Windows file-mode failure: the deploy-market probe expects mode `600` while Windows reports `666`. `pnpm libs:check`, `pnpm runtime-deps:check`, `pnpm aggregate:check`, `pnpm docs:check` and `pnpm i18n:check` pass on the same tree.
