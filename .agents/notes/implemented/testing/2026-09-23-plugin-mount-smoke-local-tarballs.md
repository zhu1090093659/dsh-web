# Agent Note: Plugin-mount smoke packs family tarballs from the checkout

Status: implemented

## Problem

The 0.1.7-alpha.2 host upgrade turned the CI `plugin-mount` lane red for reasons unrelated to the branch under test, and the same round of repairs exposed three more test-infrastructure faults:

1. The mount smoke's auto mode resolves published family tarballs from the npm registry. Those tarballs (family 0.3.24) were built against an older cohort — skin-center's client still waits on the `settingsScope` service the alpha.2 host no longer provides — so the scratch profile booted with `1 entry did not activate ... waiting for service: settingsScope` and the smoke timed out. The repository source had the fix long before; the lane was testing stale published artifacts, not the checkout.
2. `scripts/e2e-mount.sh` expanded `"${TAR_LOCAL[@]}"` unguarded, which aborts under `set -u` on macOS bash 3.2 when the array is empty.
3. The dsh-liangshen live-run benchmark had two host-coupling faults: `officialMinimalPresetPatch()` called `createRequire` on the `dsh` shim path, which does not resolve symlinks and so walked the wrong directory tree on a homebrew install; and the two real-host cases ran unconditionally, failing CI's Tests job (`no dsh command on PATH`) where no dsh is installed.
4. The dsh-web-all shell-isolation control test pinned the pre-alpha.2 boot contract (boot rejects when a directly mounted plugin fails); alpha.2 (cordis 4.0.4) natively isolates plugin failure — boot resolves, the bad entry sits at state FAILED, and healthy services stay reachable — so the control assertion was testing a contract upstream intentionally changed.

## Decision

The CI `plugin-mount` job gains a "Pack family tarballs from this checkout" step after Build: every `packages/dsh-*` and `packages/skins/skin-center` is `pnpm pack`-ed into `$RUNNER_TEMP/family-tgzs`, and the smoke step runs with `FAMILY_TGZS_DIR` pointing there, so the lane exercises exactly the artifacts the branch ships against the real alpha.2 host. `release.yml` is untouched — release verification deliberately keeps registry semantics, because a release must prove the published tarballs mount. The e2e-mount array expansions use the bash-3.2-safe `${TAR_LOCAL[@]+"${TAR_LOCAL[@]}"}` form.

In the benchmark, `officialMinimalPresetPatch()` resolves the shim through `realpathSync` before `createRequire`, and a new `harnessInstallAvailable()` export (true when `dshCommands()` is non-empty) gates the two real-host cases via `it.runIf(...)`. The shell-isolation control test is rewritten to pin the new semantics: `boot()` resolves, the failed direct entry reports state FAILED, and a healthy sibling service remains reachable — the comment header records that fault isolation is now native to the host, not a shell feature.

## Alternatives considered

- Pin the smoke's auto mode to older published family tarballs known to mount on alpha.2: rejected — the lane would validate someone else's artifacts forever and stay blind to what the branch actually ships.
- Keep the shell-isolation control asserting the old reject-on-failure contract by wrapping boot: rejected — that re-implements isolation upstream now owns, against the native-first rule; the correct move is to pin the native semantics.
- Skip the real-sshd sftp test failure: accepted as-is — it fails only on this macOS host's sshd configuration (`All configured authentication methods failed`), passes on CI ubuntu, and no alpha.2 commit touched dsh-ssh or ssh2; no code change is warranted.

## Consequences

The plugin-mount lane no longer depends on the publication state of the family — a branch that breaks mounting fails before release, not after. Local runs of `scripts/e2e-mount.sh` work on stock macOS bash again. The benchmark suite passes on machines without dsh installed (328/328 locally, and CI's Tests job skips only the two genuinely host-bound cases). The shell-isolation spec now documents and enforces that alpha.2 isolates plugin failure natively; if upstream ever reverts to fail-fast boot, this test goes red first.

## Testing

`FAMILY_TGZS_DIR=/tmp/family-tgzs bash scripts/e2e-mount.sh` passes locally: 19 packages packed, the real 0.1.7-alpha.2 host boots, `[data-dsh-frame]` mounts, and the excluded plugins are absent. `pnpm -C packages/dsh-liangshen test` passes 328/328. `pnpm -C packages/dsh-web-all test` passes 47/47 including the rewritten isolation suite. The full workspace gate sequence passes on the same commit; the only red is the environmental dsh-ssh sftp case described above.
