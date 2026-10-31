# Agent Note: Probing a shared DSH home isolates its own home and reaps its own instances

Status: implemented

## Problem

Two failures in one working session traced back to probes that ran against the user's default DSH home instead of their own, and each one denied the user something they were already using.

**A leftover probe owned the task board's ledger.** The task board admits exactly one ledger writer: the winner writes `$DSH_HOME/task-board/ledger-v2.lock` with its pid and token, and any other host that starts against that home refuses the board and names the owning pid. A `dsh --profile rescue --no-open` instance, started earlier in the session as a background probe and never stopped, held that lock. The user's desktop host lost the board and was told to close a process it had not started. Reclaiming it took more than one kill: the probe had been launched with `&` inside a tool call, so its parent shells were already gone and it had been reparented to launchd (parent 1), and a second probe instance existed besides the pid the message named. Each terminated process merely freed the next one to take the lock, so a single targeted kill did not end the outage.

**A helper's cleanup deleted the repository's root manifest.** To read the version of the running DSH, a probe ran `npx --yes @electron/asar extract-file <app.asar> 'dsh/package.json' && python3 -c "..." ; rm -f package.json` with the tool's default working directory, which is the repository root. `extract-file` writes the archive member to the current directory under its own basename, so the command materialized a foreign manifest as the repository's `package.json` and the trailing `rm -f package.json` then deleted the repository's root manifest. That manifest declares `dsh.bundle.patch`, so the whole install layer stopped resolving: the plugin manager refuses a path install whose package "declares no dsh.bundle", and app-boot throws the same for a declared profile bundle. The symptom reached the user much later and elsewhere, as a refusal to install the plugin family.

**A second helper replaced the manifest instead of deleting it.** On 2026-10-31 the same command shape recurred during an investigation of the running desktop app: `npx --yes asar extract-file "<app>.asar" package.json` ran with the checkout as its working directory and wrote that application's own manifest over the repository's `package.json`. Nothing failed at the moment of writing — the file still parsed and only its identity changed (`dsh-trading-desktop` in place of `dsh-web`, with no `dsh.bundle`), so the worktree showed a single modified file that reads like a deliberate edit. The user met it as the same plugin-manager refusal, `dsh-trading-desktop declares no dsh.bundle`, while installing the family from the checkout path.

## Decision

A probe of a shared DSH home gets its own home and stops everything it starts.

- **The probe points `DSH_HOME` at a scratch directory**, conventionally `/tmp/dsh-verify-<topic>\`. Its profiles, sessions, ledger, settings, skins and pets are then its own, and the user's home becomes a fact to read rather than a place to write. Choosing a different port is not isolation: the port was never the shared resource.
- **Every instance the probe starts is stopped in the same session.** Background instances are launched as managed background jobs, or with their pid recorded, and are terminated before the session reports the verification done. A probe that cannot stop its own instance says so instead of reporting success.
- **A helper that writes to a current directory runs in a scratch directory.** Archive extraction and any comparable helper runs under `cd "$(mktemp -d)"\`, never in the checkout, so its output cannot land on a repository file. A delete in such a chain names an absolute path instead of a bare basename.
- **Attribution comes before termination.** When a shared service reports a foreign owner, the named pid is inspected first and only processes attributable to the probe are terminated. The user's running host is never signalled, which is the existing rule in the root AGENTS.md.

## Diagnosing a foreign ledger owner

The refusal is actionable because the ledger's owner is observable on disk:

- `lsof $DSH_HOME/task-board/ledger-v2.lock` names the holding process, and the lock file records `pid`, `token` and `startedAt`.
- `ps -o pid=,ppid=,lstart=,command= -p <pid>` separates an orphan (parent 1) from a live host the user is using, and `lsof -nP -a -p <pid> -iTCP -sTCP:LISTEN` shows the port it took.
- Processes matching the probe's own profile and start time belong to the same probe: reaping only the pid named in the message leaves its siblings free to take the lock again.

## Alternatives considered

**Keep probing the user's home and clean up afterwards.** Rejected: the collision happens during the probe, not after it. An instance that boots against the shared home has already denied the user's board, and stopping it later restores nothing the user was using in the meantime.

**Let the ledger take over a lock held by another pid.** Rejected: the single-writer lock is exactly what keeps two hosts from interleaving writes into one ledger, and the refusal is the correct behavior. The defect is the leftover writer, not the lock.

**Move only the ledger out of the shared home.** Rejected: isolation is a property of the probe's home, not of one file. A probe that keeps sharing sessions, settings and skins still writes the user's state while escaping the one collision that was noticed first.

**Isolate by port in the same home.** Rejected: the leftover instance in this incident was already listening on its own port and still owned the ledger. Ports do not partition state.

**Extract the artifact and trust a relative delete.** Rejected: the delete targets whatever the current directory holds, which is why it hit a repository file. The helper must run where its output is expected, not merely be cleaned up from where it was not.

**Restore the deleted manifest and treat the incident as local.** Rejected as the record: the deletion surfaced away from its cause, as an install refusal under a later task in the same session, so the cause belongs in a durable record rather than in the repair commit alone.

## Consequences

- The procedure lives in [dsh-web-web-qa](../../../skills/dsh-web-web-qa/SKILL.md) (scratch `DSH_HOME`, reap in-session, no repository-root writes) and the rule is stated once in the root [AGENTS.md](../../../../AGENTS.md) section 运行中的 DSH 服务. The probe that follows both never touches the user's host.
- A scratch home installs its own profile dependencies, so a probe pays network and disk for a private tree. That cost is the price of not sharing profiles, sessions or the ledger.
- The task-board refusal path already names the owning pid and is covered by the degraded-reason and ledger-lock suites; this decision changes no runtime code. Its owner is [task-board host failure diagnostics](../bug-fix/2026-09-13-task-board-host-failure-diagnostics.md).
- A worktree file deleted without staging is recovered with `git checkout -- <path>`; the root manifest's declaration of `dsh.bundle.patch` is what makes its absence fatal to an install rather than cosmetic.
- A replaced file is recovered the same way, but is only noticed by reading `git status --porcelain` and the diff: an overwritten manifest still parses and still looks like an intentional edit. The check costs one command, so it runs after any helper that did not execute in a scratch directory, before the session continues on work that depends on the checkout.
- Verification of this decision is the repair evidence: the shared home's ledger lock was freed by terminating the three attributed orphan instances, and the restored manifest resolved again as a bundle (`readProfileManifest`, `resolveBundleDir` and `evaluatePluginCompatibility` all accepted the checkout). No new test was added; the behaviors exercised belong to the host, not to this repository's code.
