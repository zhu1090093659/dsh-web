# Agent Note: A pristine profile fails its first plugin add on ignored build scripts and records the bundle without mounting it

Status: implemented

## Problem

A clean profile cannot mount this family on the first attempt, and the failure is silent in the direction that matters: the aggregate package reaches the profile's `package.json` and lockfile while `dsh.profile.bundles` never gains its row, so the profile says it installed something it does not load.

`dsh plugin --profile <name> add` of `@linxin666/dsh-web-all@<version>` exits 1 on a pristine profile under pnpm 11.9.0 with the official CLI 0.2.1-rc.3, and the only diagnostic is pnpm's own list: `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, ssh2@1.17.0`. Those three arrive through the aggregate's dependency tree, and pnpm 11 runs no postinstall script a profile has not approved.

The mount is skipped because the official CLI reconciles a profile only after an install that exited 0 (`dsh-plugin-manager`, `lib/types/operations.js:499`). Exit 1 therefore leaves a half-written profile: the dependency is recorded, the bundle row is absent, `dsh --dump-config` shows no bundle for it, and repeating the same command reproduces the same failure rather than healing it.

Approving the scripts after such a failure does not repair it, and the way it fails is the dangerous part: the reconcile pass walks only the dependencies the run itself added, so `if (beforeDeps.has(name)) continue` in the same `lib/types/operations.js` (around line 106) skips every name the profile manifest already carried when that run began, and the failed attempt has already written the aggregate there. An install that exits 0 after the approvals are patched in therefore writes no bundle row either, and the profile stays installed and unmounted behind a green exit code.

The official CLI prompts for the `allowBuilds` remedy only when a git-source plugin fails, so a registry package gets no prompt and no hint. This repository's own `allowBuilds` (`pnpm-workspace.yaml:13`, five entries all `true`) governs the development workspace and never reaches a user's profile.

The trap is older than the version that now documents it, and that is recorded rather than asserted: [the 0.4.7 upgrade matrix](../../../../docs/archive/2026-10-17-v0.4.7-upgrade-matrix.md) files the identical first-attempt failure at line 15 as `pre-existing, not a 0.4.7 regression` and carries the same `ERR_PNPM_IGNORED_BUILDS` line at line 110, and 0.4.9 reproduces it unchanged.

## Decision

0.4.10 records the limitation and ships no installer change. [The release notes](../../../../docs/release-notes/v0.4.10.md) carry one known-limitation bullet in each view, stating the trigger, the observed state, the order that actually recovers it (reset or replace the profile, approve the three builds, then add for the first time) and the fact that this version did not introduce the trap.

This note owns the limitation; the release notes summarize it. Neither candidate fix below is in 0.4.10, and the defect is unfixed: the limitation is documented, not closed.

No source file, test, workspace file or manifest changes. The repository cannot repair this from inside: the refusal comes from pnpm's build-script approval model, and the reconcile point that leaves the row absent belongs to the official CLI.

The blast radius is the first install only. A pristine profile is affected. An existing profile that already carries the build-script approvals is not: such a 0.4.9 profile upgrading to the registry version 0.4.10 exits 0, asks for no new approval, keeps its `dsh.profile.bundles` row unchanged and unduplicated, leaves `--dump-config` byte-identical and repeats idempotently, so the gate is decided by the approval state rather than by whether the dependency set is new. An older profile with no `allowBuilds` record at all, upgrading to 0.4.10 under pnpm 11.9.0, is the case this note measures: the command exits 1 on `[ERR_PNPM_IGNORED_BUILDS]` while the upgrade has landed and stays mounted, so what that user holds is a failed exit code in front of a working upgrade, and the remedy is the three approvals in the profile's own `pnpm-workspace.yaml` followed by the same command, which exits 0 and runs the three builds without a reinstall or a profile reset. That failure is unfixed like the one above: the path recorded here is a user's self-recovery, not an installer change.

## Evidence

- Command and result: `dsh plugin --profile <name> add` of `@linxin666/dsh-web-all@<version>` on a clean profile, pnpm 11.9.0, official CLI 0.2.1-rc.3, exit 1 with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, ssh2@1.17.0`.
- Reconcile site: `dsh-plugin-manager` `lib/types/operations.js:499` runs the profile reconcile only for an install that exited 0, which is why exit 1 leaves the dependency recorded and the `dsh.profile.bundles` row missing.
- Reconcile scope after the failed attempt: `if (beforeDeps.has(name)) continue` in `lib/types/operations.js` (around line 106) leaves the pass walking only the dependencies that run added, and the failed attempt already recorded the aggregate, so an install that exits 0 after the approvals are patched in writes no bundle row; measured as exit 0 with `dsh.profile.bundles` and `--dump-config` unchanged.
- Observed state after the failure: `--dump-config` lists no bundle for the family package, and the install command repeats the same exit 1 for the same inputs.
- The gate reads the approval state, not the dependency set: with the approvals unsatisfied, an install whose dependency set is unchanged still exits 1 with the same three names, so an unchanged dependency set is not by itself what lets a repeat install succeed.
- Workspace scope: `pnpm-workspace.yaml:13` opens the `allowBuilds` block that governs the development workspace; a user profile has its own `pnpm-workspace.yaml` and is not covered by it.
- Ways out, with what each rests on: reset the profile with the official `--from-default-profile web` and write the three names into `<profile>/pnpm-workspace.yaml` under `allowBuilds` before the first add, or do the same on a new profile this failure never touched, then add: the order measured on this machine to mount the bundle. Patching the approvals after an exit 1 is not a way out, for the reconcile reason recorded above.
- The approval is a mapping, one `true` per package, and a list is not an approvable form: `allowBuilds:` followed by `cloudflared: true`, `cpu-features: true` and `ssh2: true` mounts the family on the first add (measured 2026-10-31 on DSH 0.2.1-rc.5 with its bundled pnpm 11.9.0, `dsh.profile.bundles` gaining the aggregate and `--dump-config` listing 25 `web-ui-*` row ids), while the same three names written as a list are rewritten by pnpm into placeholder entries of the shape `'0': cloudflared` and the retry then rolls resolved packages back (`Packages: -10`) without writing the row.
- Upgrade with the approvals in place: a 0.4.9 profile that already carries the build-script approvals upgrades to the registry version 0.4.10 with exit 0, demands no new approval, keeps the `dsh.profile.bundles` row unchanged and unduplicated, leaves `--dump-config` byte-identical and repeats idempotently.
- Upgrade with no approval on record: a 0.4.9 profile whose `pnpm-workspace.yaml` carries no `allowBuilds` entry at all, upgraded to the registry version 0.4.10 under pnpm 11.9.0 with the official CLI 0.2.1-rc.3, exits 1 with `[ERR_PNPM_IGNORED_BUILDS]` naming cloudflared@0.7.3, cpu-features@0.0.10 and ssh2@1.17.0, and the upgrade itself lands and stays mounted: the profile manifest records 0.4.10, all 25 family packages in `node_modules` are 0.4.10, `dsh.profile.bundles` still holds exactly one row for the aggregate, `dsh --profile <name> --dump-config` exits 0 and lists that bundle, and the 60 dependencies those 25 packages declare resolve with zero failures. The exit code and the cleanliness of what follows are what fail, not the upgrade result or the mount state, and re-running the same command exits 1 again instead of healing.
- Recovery for that upgrade: with cloudflared, cpu-features and ssh2 written as `true` in `<profile>/pnpm-workspace.yaml` (or approved through the interactive `pnpm approve-builds`), the same upgrade command exits 0 and the three native or binary builds really run (cloudflared's postinstall writes `bin/cloudflared`, cpu-features produces `build/Release/cpufeatures.node` through node-gyp, ssh2 produces `sshcrypto.node`), with the versions and the mount state unchanged and `--dump-config` byte-identical. No reinstall and no profile deletion are involved.
- The gate reads the approval record, not the build output: a variant whose build output already exists but whose approval record does not still exits 1, with the same already-upgraded 0.4.10 state and the same mounted bundle.
- `--config.strictDepBuilds=false` buys the mount and not the install: on a clean first add it exits 0 and writes the bundle row, but it leaves a placeholder entry behind in the profile (shaped `cloudflared: set this to true or false`) and none of the three native or binary builds run, so no `bin/cloudflared` and no `build/Release/cpufeatures.node` appear.
- Prior record: [the 0.4.7 upgrade matrix](../../../../docs/archive/2026-10-17-v0.4.7-upgrade-matrix.md) line 15 and line 110, plus the same failure reproduced against the published 0.4.9.

## Impact

- A pristine first install is affected: the family is installed and not mounted, and nothing in the CLI output names the missing bundle row.
- An existing profile that already carries the approvals sees no change of behavior from 0.4.9 to 0.4.10, while a profile whose approval state was never recorded upgrades and mounts and then reports exit 1, so its user reads a failure where the work is already done.
- A user who recovers by hand must edit the profile's own `pnpm-workspace.yaml`; the development workspace's approval list does not travel with the package.
- The state is not self-healing on retry, so a user who stops at exit 1 keeps a profile that resolves the package and loads nothing from it.

## Candidate fixes

- Write `allowBuilds` from this repository's install entry. It removes the trap for anyone who reaches the profile through our own flow, and it is the only candidate that leaves a first install working unattended. It has to land before the first add rather than after a failure, because the reconcile pass skips dependencies the run did not add, so a retro-patch cannot mount what an exit-1 attempt already recorded. It changes install behavior, writes to a user-owned file, and needs its own verification against both a clean profile and an existing one, so it does not belong in a documentation change.
- Guide the user in the documentation. It costs no behavior change and is what 0.4.10 does, but it only helps a reader who looks after the fact: the CLI exits 1 before any of our documentation is in front of them. The guidance has to carry the order as well as the names, because approvals patched in after the failure leave the same silent half-mount this note records.

## Alternatives considered

- **Patch the install entry in this change.** Deferred rather than rejected: the change that records this limitation is documentation only, and an installer that writes into a user's profile needs verification this change does not carry.
- **Change this repository's `pnpm-workspace.yaml`.** Rejected: it configures the development workspace, and a user's profile reads its own file, so the edit cannot reach the failure it is meant to fix.
- **Leave it unrecorded.** Rejected: the failure is an exit code plus a half-mounted profile that `--dump-config` does not reveal, so a user cannot tell "not installed" from "installed and not mounted", and the next reader would have to rediscover the chain from scratch.

## Consequences

- The limitation is visible where a user meets it, in both views of the 0.4.10 release notes, and its reasoning lives here.
- The failure stays reproducible in 0.4.10 for a pristine profile until one of the two candidate fixes ships.
- A later fix has to move the decision rather than edit it: the shipped state changes, so the note either gains the fix as a superseding record or is superseded by one that carries the verification.
- Installer work that follows has to write the approvals ahead of the first add rather than after a failure, because the reconcile pass ignores the dependencies a run did not add.
- Two failure shapes stay distinct and are not interchangeable: a clean first attempt retried after the approvals are patched in ends at exit 0 with no bundle row ever written, while an un-approved profile upgrading keeps the row it had, is already upgraded, and only fails on the exit code. Applying the fresh-install description to an upgrade, or the reverse, points a reader at the wrong answer about whether a reinstall is needed.
- The dependency set, the protocol, and every mount path keep their current behavior, because nothing outside documentation changed here.
