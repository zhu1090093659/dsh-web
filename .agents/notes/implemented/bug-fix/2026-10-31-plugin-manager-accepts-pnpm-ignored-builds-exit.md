# Agent Note: Plugin-manager accepts pnpm's skipped-build-script exit only when the profile moved

Status: implemented

## Problem

On pnpm 11 a profile mutation this gateway drives can end non-zero *after* the
profile has been written, and `CliGateway` reported that exit as the whole
verdict: the job settled `error` and every post-mutation check was skipped even
though the profile carried the change.

pnpm 11 does not run a dependency's build script until that dependency is
approved with `pnpm approve-builds`, and an unapproved one fails the command at
its end: the packages are unpacked, the lockfile records them, and the profile's
`package.json` already carries the new dependency. Measured 2026-10-31 in an
isolated `DSH_HOME=/tmp/dsh-fix-0413` against DSH 0.2.1-rc.5, whose `dsh plugin`
forwards to its own bundled pnpm 11.9.0 (the host's pnpm 11.24.0 produces the
same exit):

```
$ dsh plugin --profile web add @linxin666/dsh-web-all@0.4.12
dependencies:
+ @linxin666/dsh-web-all 0.4.12
Packages: +46
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, ssh2@1.17.0

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
dsh: plugin command failed; diagnostics: /tmp/dsh-fix-0413/profiles/web/.plugin-manager/logs/operation-W7Uzsv/pnpm.log
exit 1

profiles/web/package.json: "@linxin666/dsh-web-all": "0.4.12"   (landed)
```

Nothing in that exit belongs to this release: pnpm 11 produces it for any
install that pulls in a dependency declaring a build script — `dsh plugin
--profile web add cpu-features` alone exits the same way — so it is a property
of pnpm and the dependency graph, not of a release.

The early return skipped every check the CLI path exists for: the
duplicate-mount strip (B9), the "did the install land" read (B8), the duplicate
entry-id check (B5), the unresolvable-insert check (B6), the `--dump-config`
boot preflight and, on an update, the exact-version gate with the orphan-override
prune behind it. Driven through `CliGateway` itself against the real CLI and real
pnpm (install `cloudflared@0.7.1`, then update to `0.7.3`), before this change:

```
install: phase=error  profile dependency=0.7.1  node_modules version=0.7.1
update:  phase=error  profile dependency=0.7.3  node_modules version=0.7.3
```

`job.error` was pnpm's tail, `[ERR_PNPM_IGNORED_BUILDS]` line included. A person
updating a plugin was told it failed while the new version was on disk, and the
state those checks would have rejected was never examined.

The tolerance then opened the opposite defect. The landing reads it re-ran look
at `dependencies`, and pnpm writes that line *before* the gate ends the run, so a
first install of a bundle-declaring package settled `done` on a profile whose
`dsh.profile.bundles` never gained the row: installed, unmounted, and reported as
a success. Measured 2026-10-31 in the isolated `DSH_HOME=/tmp/dsh-fix2-0413`
against the same CLI and pnpm, through `CliGateway.install` for
`@linxin666/dsh-web-all@0.4.13` on a fresh profile: the job settled
`phase=done` with pnpm's tail as a warning, while `dependencies` carried the
aggregate, `dsh.profile.bundles` held only the two official bundles, and
`--dump-config` exited 0 with **0** `web-ui-*` row ids against **25** for a
mounted install. A dependency that the composition never mounts is not an
install, and no exit code can say so.

## Decision

1. **Only one pnpm condition may be re-read, and only the profile may overrule
   it.** `reportsIgnoredBuilds(output)` recognises the
   `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: …` line in a run's captured
   output. A run whose output carries it is *tolerated*: the job runner keeps
   going instead of settling on the exit code. Every other non-zero exit keeps
   the settlement it has today — `phase = 'error'`, `job.error` set to the
   output tail, no further check — so `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`,
   a genuine resolution failure, a spawn failure and a timeout all report
   exactly what they reported before.
2. **The landing check is what decides, and it is the one already there.** A
   tolerated run goes through the unchanged chain, and each action's own read is
   the verdict: an install that added no dependency, an update whose installed
   version is not the one the route resolved, and a remove that left the
   dependency in the profile all still fail, before any preflight, with pnpm's
   tail as the reason — the text the early return produced. A dependency line is
   not that verdict on its own, so the install and update reads also consult the
   selection: `bundleSelectionMissing` asks `declaresBundle` — `dsh.bundle` in the
   installed package's own manifest, the fact the CLI's reconcile selects on —
   and answers a package that declares a bundle but sits in no
   `dsh.profile.bundles` entry. An install must carry the selection; a
   replacement must keep the one it found, and a package the profile mounts
   through a patch row was never selected, so its absence is the state the run
   found rather than a loss. The selection is read from the state the CLI wrote,
   *before* the duplicate-mount strip of item 3 removes entries from it: that
   strip is this gateway's correction, not evidence of what the run landed.
3. **Tolerating the exit buys nothing else.** B9, B5, B6, the composition
   preflight, the exact-version gate and the orphan-override prune run in full
   and can still fail the job, so a tolerated run that landed a boot-breaking
   state is rejected exactly as a successful exit would be.
4. **pnpm's words survive on the job.** A tolerated exit that passes every check
   settles `done` and carries the run's output in `GatewayJob.warnings`, and the
   host logs it with `console.warn`. It does not go into `job.notices`: that
   ledger's row shape `{id, name, from, to}` records a control-state move, and a
   build-script diagnostic is neither a row nor a state. `warnings` is the same
   optional string-list fact channel `restartRequired` already uses, so it rides
   `/status` to the caller instead of being dropped at the settlement.
5. **The migration install step is the same pnpm call and gets the same
   treatment.** `runMigration` tolerates that exit the same way and keeps the
   same fallbacks: a target that did not appear in the profile rolls the
   migration back and reports pnpm's tail. The rollback helper's own restore
   install (`rollbackMigration`) is deliberately untouched — it runs when the
   migration has already failed, and its report names the rollback, not a
   warning.
6. **A half mount fails; it is not repaired.** A run whose selection did not land
   settles `error` and leaves the profile exactly as the CLI wrote it. The
   message names the package, the `allowBuilds` approval that
   [the fresh-install limitation note](2026-10-26-fresh-install-allowbuilds-limitation.md)
   owns, and the remove-then-add that repairs the row — the only
   sequence measured to work: with the approvals patched in, re-running the same
   add exits 0 and still writes no row, because the CLI reconciles only the
   dependencies the run newly added, while remove followed by add lands it
   (2026-10-31, same isolated home, `dsh.profile.bundles` gaining the aggregate
   and `--dump-config` then carrying the 25 family row ids).

## Alternatives considered

**Treat any non-zero exit whose change landed as a success.** Rejected: landing
is not evidence that pnpm agreed with the run. A refused registry resolution can
leave the previously installed version in place, and an update whose version did
not move is then indistinguishable from a successful one — the diagnostic that
tells the person what to do would be thrown away.

**Match the human sentence ("Ignored build scripts") instead of the diagnostic
code.** Rejected: that sentence is pnpm's copy and can be reworded or translated
in a future release, while the bracketed code is the machine-readable token pnpm
keeps stable. Matching the copy would also fire on a log line that merely quotes
it.

**Trust the exit code and report the output as a warning without re-reading the
profile.** Rejected: the profile is the only authority for whether the change
happened, and the whole defect is a caller believing a single source. The
re-read is the same check the success path already performs, so tolerating
without it would mean shipping a second, weaker definition of "landed".

**Put the warning in `job.notices`.** Rejected: that array is the conflict-row
ledger (`ControlChange`), whose three fields are layer states. A pnpm diagnostic
would have to invent a state transition to fit, and every existing reader of the
ledger would then have to filter it back out.

**Roll the install back whenever the exit is non-zero.** Rejected: today the
landed state is never reached at all, and the packages are the ones the person
asked for. Rolling back a correct install because pnpm skipped an optional
native build would turn a warning into data loss.

**Re-run the CLI after a tolerated exit to confirm the change.** Rejected: the
confirmation run is itself a profile write through the same pnpm, so it inherits
the same exit and the same condition; the profile read is cheaper and answers the
question that matters.

**Settle the tolerated exit as `done` with no record.** Rejected: an unbuilt
optional dependency is exactly what a later boot reports as a missing native
module, and a job with no record leaves nothing to attribute it to.

**Read `dependencies` alone and call the dependency line the mount.** Rejected:
that line is written before the gate decides the exit, so on a first install it
names exactly the state the CLI never reconciled. The profile then composes
without a single row of the package while every check this gateway performs
passes, which is a success report for a plugin that never mounts.

**Read the selection after the duplicate-mount strip instead of before.** Rejected:
the strip deliberately removes the newly added entries of packages the composition
already mounts through a patch row, so a post-strip read would report the guard's
own correction as a lost mount and fail a correct install. The state the CLI wrote
is the evidence; the correction that follows is not.

**Roll a half mount back instead of failing with the repair.** Rejected: the
packages are the ones the person asked for, and the row is recoverable without a
re-download — approving the build scripts and re-adding restores the mount. A
rollback would turn a diagnosable state into a silent fetch of the same 51
packages on the next attempt.

## Consequences

- An install, update, removal or migration whose packages landed is reported as
  the success it is, with pnpm's tail on the job, instead of as a failure that
  also skipped every guard.
- A package that landed as a dependency without its bundle selection is reported
  as the half mount it is — with the reason, pnpm's tail and the two steps that
  repair it — instead of as a success whose composition carries no row of it. On
  the same half-mounted profile this read is the difference between `phase=done`
  and `phase=error`.
- The condition is pnpm's, not this release's: whether a profile gains a
  dependency with a build script decides it, so the next package that adds one
  behaves the same way without a code change here.
- The browser half does not read `warnings` yet. `GatewayJobWire` in
  `src/client/index.ts` reads `phase`, `plugin`, `error` and `restartRequired`,
  and the notice ledger has had no renderer since the plugin-management tab was
  removed, so the update surface shows its normal success path (the restart
  hint) and the tail is reachable on `/status` and in the host log until a
  client surface for job warnings exists. Naming this here is deliberate: the
  warning is recorded and not swallowed, but it is not yet on screen.
- A skipped build script stays skipped. The gateway only stops calling the run a
  failure; approving the build script is still the person's `pnpm approve-builds`
  call, which the recorded output names.
- The spawn-failure settlement is untouched: a spawn failure produces no output
  at all, so it carries no diagnostic and keeps settling as an error
  ([the spawn-failure note](2026-10-12-plugin-manager-spawn-failure-settlement.md)).
  The application-owned profile's native path reads the official manager's own
  verdict instead of an exit code and is likewise unchanged
  ([the app-owned update path](2026-09-26-plugin-manager-app-owned-update-path.md)).

## Testing

`tests/gateway-jobs.spec.ts` covers the decision from both sides against a
scripted CLI, with the pnpm output the real CLI produced as the fixture. A
tolerated install and a tolerated update settle `done` with `plugin` set and
`warnings` equal to the tail, and their `--dump-config` probe is asserted to have
run — the last gate of the chain. A tolerated install that added nothing and a
tolerated update that left the old version in place stay `error` with pnpm's tail
and never reach a probe. A landed update carrying
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` stays `error` with that text. A
tolerated install whose insert entry resolves nowhere is rolled back by B6
without any preflight, and a tolerated update whose composition cannot boot fails
on the preflight. A tolerated removal whose dependency is gone and a tolerated
migration whose install step landed both settle `done` with the warning.
Disabling `reportsIgnoredBuilds` fails six of those tests, so they are pinned to
the decision rather than to the outcome alone.

`bundleSelectionMissing` is pinned from both sides. A tolerated install whose
bundle row never landed — the fixture writes the dependency and leaves the
selection alone, which is the state the real CLI leaves — stays `error` with the
half-mount reason and pnpm's tail, and never reaches the composition probe; a
tolerated install of the same aggregate that did land its selection settles
`done` with the probe run; a tolerated update that dropped a selection the
profile had fails the same way; and an update of a bundle-declaring package the
profile mounts through a patch row — never selected, so nothing to lose — still
settles `done`; and a tolerated migration whose install step wrote the dependency
without the row rolls back to the legacy aggregate and reports the same half
mount. Disabling the gate (`bundleSelectionMissing` answering false) fails
exactly those three half-mount tests with `expected 'done' to be 'error'`.
`tests/bundle-guard.spec.ts` pins `declaresBundle` on a declaring package, a
plain native dependency and a package that is not on disk.

Live: the same two-stage scenario above, run through `CliGateway` in the isolated
`DSH_HOME` against the real CLI and real pnpm, reports `phase=done` with
`plugin.version` equal to the version on disk and `warnings` carrying
`[ERR_PNPM_IGNORED_BUILDS]` for both stages; the package suite (457 tests) passes.

Live half mount, same isolated `DSH_HOME=/tmp/dsh-fix2-0413`, DSH 0.2.1-rc.5 with
its bundled pnpm 11.9.0: through `CliGateway.install` for
`@linxin666/dsh-web-all@0.4.13` on a fresh profile, one and the same
half-mounted state reports `phase=done` before this read and `phase=error` after
it, and `--dump-config` shows 0 `web-ui-*` row ids against 25 for a mounted
install. Approving the builds and re-running the same add then exits 0 and still
writes no row; remove followed by add writes it.
