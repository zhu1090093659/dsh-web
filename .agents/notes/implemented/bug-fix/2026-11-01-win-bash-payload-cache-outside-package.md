# Agent Note: win_bash runs its payload from a published copy outside the package

Status: implemented

## Problem

`packages/dsh-win-bash` ships the pinned MinGit payload inside the npm package (`runtime/win32-x64`, 91 files, about 16 MiB) and spawned `bash.exe` from that absolute path. Windows refuses to rename or delete a directory that holds a running executable, and pnpm imports a package by renaming a staging directory over the target — `node_modules/@linxin666/dsh-win-bash_tmp_<pid>_<n>` -> `@linxin666/dsh-win-bash` — so a session that had ever run one `win_bash` command made the next update, remove or reinstall of this package fail with `[ERR_PNPM_EPERM] [importPackage ...]` until the host was restarted or `bash.exe` killed (issue [#1996](https://github.com/zhu1090093659/dsh-web/issues/1996)). The persistent shell is the package's whole point, so the conflict was between the payload's location and the process model, not a defect in either one.

Two collateral facts made it worth fixing rather than documenting: a failed import can leave `*_tmp_*` directories in the profile's `node_modules`, and the failure arrives exactly when a user is trying to update — the plugin manager's own update path, or `dsh plugin --profile desktop update`. The official `@deepseek-ai/dsh-tool-bash` never hits this because it spawns a one-shot `bash -c` whose executable is outside the package.

## Decision

The payload stays in the package; the tree that RUNS is a verified copy outside it. `prepareRuntime()` in `src/runtime.ts` is the mount-time entry point, and `apply()` calls it instead of `resolveRuntime()`:

- **The cache is content-addressed.** `payloadKey()` hashes the manifest's sorted `path + digest` rows and keeps 16 hex characters, so the directory name states which payload it holds. A release that changes only JavaScript reuses the copy already published; any changed payload file produces a new name.
- **The cache lives under the DSH home**: `$DSH_HOME/win-bash/runtime/<key>`, resolved through the family's shared `resolveDshHome()` (the new `packages/dsh-win-bash/src/dsh-home.ts` is a `sync-shared` copy). `DSH_HOME` rather than `%LOCALAPPDATA%`: the repository's probe-isolation convention already says a verification instance runs on its own `DSH_HOME`, so an isolated host gets an isolated cache with no second convention to learn, and a test or a probe never writes into the user's cache.
- **A hit must prove itself.** The copy's own manifest has to reproduce the expected key and every file has to hash correctly before anything is spawned. A directory whose manifest was rewritten alongside its files therefore reads as a miss, not a match: the key is a digest of the manifest, so changing a digest changes the name. A byte match alone is no longer sufficient: the copy's Windows mandatory integrity label is also checked on every mount, and a Low-labelled tree is abandoned for an isolated root (see [the cache integrity label note](2026-11-04-win-bash-cache-integrity-label.md)).
- **A miss verifies, copies, then re-verifies.** The packaged tree goes through `resolveRuntime()` — unchanged messages, unchanged refusals — is copied into a `.staging-<key>-<pid>-<uuid8>` directory beside the target, renamed into place, and the copy is verified again before it is returned. A published name therefore only ever refers to a complete, verified tree.
- **A cache that cannot be written is not a refusal.** The verified packaged tree runs instead and `apply()` logs one warning naming the cache path, the packaged path and `ERR_PNPM_EPERM`. Withholding the shell would turn a packaging hazard into a capability loss on a machine where the shell works; a payload that fails its manifest is still refused, cache or no cache.
- **Every shell takes the paths from `RuntimeReady`.** `shell.ts` already received `{ bash, bin }` from the caller, so the persistent shell, every background job and the `PATH` prefix moved to the published copy without touching that module.

## Alternatives considered

**Stop the shells before pnpm mutates the package** (the issue's third suggestion: a `disposeAll` lifecycle hook). Rejected: the mutation can come from the `dsh plugin` CLI in another process, which cannot reach into a running host's shell registry; uninstalling this very package is one of the changes that must work; and a race remains between "shells stopped" and "another session started one", which is the same EPERM again with extra steps.

**Ship the payload as a separate cache package outside `node_modules`.** Rejected: a second artifact to version, publish and pin, and pnpm still owns whatever tree it installs — the copy outside the package has to exist either way, so this adds a release surface without removing the copy.

**Spawn a fresh `bash -c` per command from inside the package.** Rejected: it trades away the persistent shell, which is the reason this package exists (see [the pinned bash note](../feature/2026-10-16-dsh-win-bash-pinned-bash.md)).

**Turn `replacePwsh` off by default as the safety exit** (the issue's fourth suggestion). Rejected: that gives every Windows session a second visible shell to work around a packaging hazard, and it reverses the shell ladder's decision — `pwsh` is withdrawn only from sessions `win_bash` can actually serve, which is a capability statement, not a workaround.

**Prune old payload directories automatically.** Rejected: one directory per distinct payload is already bounded by payload revisions, and a prune would race a second host that is copying or running an older payload (a running executable refuses the delete anyway, and a host still on the old version republishes into the same name).

## Consequences

- Updating, removing or reinstalling `@linxin666/dsh-win-bash` no longer depends on no session having used `win_bash`: no running executable sits inside the package directory.
- The transition itself still costs one restart. While a version that predates this change is installed, its `bash.exe` runs from the package, so the first update to a version that carries this fix needs `bash.exe` stopped or the host restarted, exactly as the issue describes.
- A mount with the copy already published costs nothing extra; a mount that has to publish pays one 16 MiB copy (and the verification both trees already required). The mount stays synchronous, so that cost lands on the host's start, once per payload revision.
- Cache growth is one directory per distinct payload, about 16 MiB each, under `<DSH_HOME>/win-bash/runtime/`, plus the same under the isolated root when the DSH home is labelled Low. Such a directory is safe to delete while DSH is stopped; the next mount publishes it again.
- What runs is verified; the packaged tree is not re-hashed on a cache hit. The package is then only a source, and a tampered packaged tree with a valid cache stays inert instead of being spawned.
- A copy that a live shell still holds open cannot be replaced: the rebuild refuses the delete, and the mount falls back to the packaged tree with the same warning rather than failing.
- A host killed in the middle of the first publication leaves a `.staging-*` directory. It is inert — its name is not a payload key, so no mount mistakes it for one — and it is removed by hand.

## Testing

- `tests/runtime-cache.spec.ts` (new, 11 cases) certifies the contract against a real file system with fixture payloads: the first mount publishes under the cache root with the key the manifest implies and no staging directory left behind; a second mount reuses that copy (the injected copy step throws if it is ever reached); a damaged copy and a copy carrying a rewritten manifest are rebuilt from the packaged one; an unwritable cache falls back to the packaged tree with one warning naming `ERR_PNPM_EPERM`; a copy that fails partway leaves no staging directory; a packaged payload that fails its manifest is refused and publishes nothing; a published copy keeps serving after the packaged tree is damaged; a POSIX host is refused before the cache is touched; the default cache root follows `DSH_HOME`.
- `tests/runtime-cache.spec.ts` also spawns the shipped payload's published copy on a real Windows x64 host (`cd /usr/bin && pwd -W`) and asserts the resolved MSYS root is the copy under the cache root, which is what proves the copied tree is complete enough to run rather than merely identical.
- `tests/mount.spec.ts` points `DSH_HOME` at a temp directory for the suite, so a mount no longer publishes into the home of whoever runs it.
- `pnpm --filter @linxin666/dsh-win-bash typecheck`, `test` (14 files, 181 tests) and `build` pass; `pnpm --filter @linxin666/dsh-win-bash test` ran on win32 x64. `tests/runtime-integrity.spec.ts` and two new live cases in `tests/runtime-cache.spec.ts` cover the mandatory-label check (see [the cache integrity label note](2026-11-04-win-bash-cache-integrity-label.md)).
