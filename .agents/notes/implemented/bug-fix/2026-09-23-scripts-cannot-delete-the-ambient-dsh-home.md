# Agent Note: Scripts cannot delete the ambient DSH home

Status: implemented

## Problem

The user's `~/.dsh` was emptied twice on 2026-09-23, and the sweep that followed found three ways a repository actor could reach the real home — one of them a shipped CLI that needs only a typo:

1. `packages/dsh-task-board/tests/host-apply.spec.ts` restored the ambient `DSH_HOME` into `process.env` and then deleted whatever the variable held. A run in any shell where `DSH_HOME` was exported — the state of a host-spawned shell — recursively removed the whole home while the suite stayed green. Shipped as a fix in `7c513ad5`.
2. `scripts/dsh-skin uninstall <id>` joined raw argv under `$DSH_HOME/skins` and recursively deleted the result with no id validation. `uninstall ..` resolved to `$DSH_HOME` itself and took the entire home (sessions, storages, profiles, credentials, logs); `uninstall ../..` resolved to the OS user directory.
3. `scripts/e2e-mount.sh` used `DSH_HOME_BASE` verbatim as its scratch root and ran `rm -rf "$SCRATCH"` on exit. `DSH_HOME_BASE=~/.dsh pnpm test:mount` deleted the home.

## Decision

`scripts/dsh-skin uninstall` validates the id against the skin-center id contract (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, the class `uninstallUserSkin` already applies) and asserts the resolved target stays under the user skins root before the recursive delete. A path-shaped id exits 1 with `refusing "<id>" — a skin id is a directory name, not a path`. `scripts/dsh-skin.test.mjs` pins the behavior: `..`, `.` and `sub/../..` are refused, and both the file beside `skins/` and the installed skin survive the attempt.

`scripts/e2e-mount.sh` refuses a `DSH_HOME_BASE` that resolves to `/`, `$HOME` or `$HOME/.dsh`, and never removes a caller-supplied root wholesale: cleanup deletes only the `home/` and `workspace/` subdirectories the run created under it. A root the script created itself with `mktemp -d` is still removed as before, so the default path and `KEEP_HOME` are unchanged.

## Audit result

Two independent passes covered the repository, and a third covered the harness the machine boots from (`Documents/deepseek-harness`; `AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` is a symlink to it, so it is one body of code):

- **Tests.** The `DSH_HOME`-restore-then-delete shape existed once, in the host-apply teardown now fixed. Every other teardown deletes a directory its own suite created with `mkdtemp`.
- **Plugin host halves and the desktop app.** Every recursive delete is confined to a validated `$DSH_HOME/<subdir>`: market, preset-center, session-archive and skin-center validate the id and re-assert containment; task-board, usage, pet, ssh, remote-web-ui, doctor and plugin-manager touch only their own files; the desktop reseed removes four fixed profile entries and preserves `cordis.patch.yml`.
- **Harness runtime.** Nothing deletes or renames the home. Its only home-level removal is `<profile>/.dsh-module-fallback` plus the `node_modules` links pointing into it; `settings.yaml` is moved to `settings.yaml.imported` rather than deleted, and `cordis.yml` is rewritten from a constant on every profile boot.
- **Measured.** A decoy home with 16 marker files was used as `DSH_HOME` for the whole gate surface (`typecheck`, `test`, `test:scripts`, `test:desktop`, `test:standards`, `docs:check`, `i18n:check`, `emoji:check`, `aggregate:check`, `libs:check`, `sync-shared:check`, `runtime-deps:check`, `community:check`, `skin-center:check`, `market:check`): the decoy came out byte-for-byte intact, with no file added or removed.

`scripts/pr-review.mjs --cleanup` still deletes its `--workdir` root unconditionally (default `~/remote-e2e`). It is the same class and is deliberately left to its own change, which needs a guard design for worktree roots rather than a one-line refusal.

## Alternatives considered

- **Call the skin-center lib's `uninstallUserSkin()` from the CLI.** The function already regex-validates and asserts containment, and the CLI header says the lib owns this logic. Rejected because it is not exported from the built entry (`packages/skins/skin-center/lib/index.js` keeps it internal, with the route layer as its only consumer), so the CLI would have to carry a skin-center export and rebuild change to gain a few lines of validation.
- **Reject only `..` and `.` in `cmdUninstall`.** Rejected: a blocklist of two spellings leaves separators and mixed forms (`sub/../..`) unhandled, and the repository already has one id contract for skins. Mirroring it keeps a single rule for every caller.
- **Refuse only the two catastrophic values in `e2e-mount.sh` and keep the wholesale delete.** Rejected as insufficient: it protects `~/.dsh` by spelling rather than by ownership, and any other caller-supplied root stays one typo away from deletion. Deleting only what the run created is the property that holds for every value.
- **Guard the `dsh-home` resolvers against `DSH_HOME=~`.** Deferred, not rejected: the resolvers are generated copies across a dozen packages and the behavior (an explicit env value wins) is a documented contract. The e2e guard covers the one place where such a value is deleted rather than written.

## Consequences

An uninstall of a real skin is unaffected — the id contract admits every name the catalog can produce, and the refusal path only fires on values that could never name a skin. Scripts that pass a caller root to the e2e harness now leave that directory behind after a run, holding only the run's own `home/` and `workspace/` subdirectories; `KEEP_HOME` still short-circuits cleanup entirely. The audit's negative result is what makes the remaining footguns enumerable: a plugin that writes outside its own subdirectory, or a new script that deletes an argument-derived path, is now a deviation from a stated guarantee rather than an open question.

## Testing

`node --test scripts/dsh-skin.test.mjs` (9 cases, including the refusal case), `bash -n scripts/e2e-mount.sh`, `DSH_HOME_BASE="$HOME/.dsh" bash scripts/e2e-mount.sh` (refuses before any directory is created, exit 1), and the repository gates `test:scripts`, `test:standards`, `docs:check`, `emoji:check`, `typecheck`, `test`.
