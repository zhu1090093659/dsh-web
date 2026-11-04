# Agent Note: Git-graph status reads run a three-spawn plan

Status: implemented
Superseded by: [the dsh-git-graph package is retired in favour of the official Git changes plugin](../simplification/2026-11-03-git-graph-package-retired.md)

## Problem

One SCM tab is a fixed number of git child processes, and the host pays it on every open and on every poll tick. The status path needed five spawns per call (`rev-parse --show-toplevel`, `rev-parse --abbrev-ref HEAD`, `status --porcelain`, the combined `rev-parse --git-path` marker probe, and `rev-parse --short HEAD`), the branch list added a sixth, and a tab therefore cost 15 processes: status, branches, graph and worktrees. On Windows a cold `git.exe` costs about 0.7 s per spawn, which is why the route layer already caps its poll cadence at 30 s; each of those spawns is also a full process start on every other platform, and the SSE loop repeats two of the views for every subscriber.

## Decision

The read plumbing is three spawns, and `status` is those three:

1. `git rev-parse --show-toplevel --short HEAD` — the repository root and the abbreviated head in one invocation.
2. `git rev-parse --git-path <marker>...` — the operation-marker probe, unchanged, one spawn for all seven markers.
3. `git status --porcelain=v2 --branch` — the three counts plus the branch header.

Spawns 2 and 3 run in parallel with each other; spawn 1 comes first because both need the repository root. `status` is therefore 3 processes, `branches` 4 (adding `for-each-ref`), `graph` 2 and `worktrees` 2, which brings one SCM tab from 15 to 12.

The head cannot come from the v2 header. `# branch.oid` carries the full object name, `git status --porcelain=v2 --branch --abbrev=7` is rejected by git (`error: unknown option 'abbrev=7'`, exit 129), and both the branch chip and the SSE change key consume the abbreviated id `rev-parse --short HEAD` prints, whose length is git's own adaptive abbreviation. `--abbrev-ref` and `--short` cannot share one `rev-parse` either: with `--abbrev-ref HEAD --short HEAD` the branch prints twice because the mode persists, and with the two swapped the command fails with `Needed a single revision`.

`status --porcelain=v2 --branch` is parsed by `parseStatusV2` in `host/status-porcelain.ts`, a host-local module: this path is host-only (the browser half never spawns git), and keeping the new argv builders and parser there leaves the shared `core/git-command.ts` and its parsers as the single home for every other command shape.

## Equivalence

The v2 parser is pinned against 18 scenarios of real captured git output under `tests/fixtures/status-porcelain/`, recorded by `capture.sh` from real temporary repositories rather than hand-written: clean, modified-unstaged, staged-modified, rename-staged, rename-plus-modify, a path with spaces both modified and untracked, an untracked directory, a non-ASCII untracked path, an ignored file present, `UU`, `AA`, an approximate `DU` conflict, 201 dirty entries, a bulk untracked set, detached head, a clean tree after changes, and an unborn branch. The parser is compared field by field against the v1 parser's verdict on each, and the branch taken from the v2 header agrees with the previous `rev-parse --abbrev-ref HEAD` source in 18 of 18 cases. `manifest.tsv` records each case's exit codes alongside the capture.

The per-marker fallback survives verbatim: when the combined `--git-path` probe exits non-zero, every marker is still probed one command at a time, so a single failed `rev-parse` cannot silently hide an operation in progress. `statusFlights` still de-duplicates concurrent reads of the same path, which is what keeps a timed-out poll from stacking.

## Alternatives considered

- **Take the head from the v2 branch header.** Rejected on measurement: the header carries the 40-character oid, and `--abbrev=7` is refused by git, so the delivered head would change length and with it the SSE change key `root|branch|head` and the branch chip.
- **One `rev-parse` for branch and head (`--abbrev-ref HEAD --short HEAD`).** Rejected on measurement: both orderings fail as described above, and the marker probe already uses `rev-parse`.
- **Fold the marker probe into the status spawn (two spawns).** Rejected: the marker probe is the only step with a per-marker fallback, and merging it into `status --porcelain=v2` would widen the surface that one command's failure can take down — the fallback exists precisely because a single failed `rev-parse` must not hide an in-progress operation.
- **Run status from the workspace path instead of the resolved repository root.** Rejected: git filters `status` by the current directory, so a path below the root would report a subset of the working tree. The root is resolved first for that reason.
- **Leave the five-spawn shape and raise the poll interval instead.** Rejected: the cost is per call and per subscriber, so a longer interval still pays five processes whenever a tab opens or a tick lands; the interval is already at the point where interactive freshness depends on the client's own refresh.

## Consequences

A status call costs three process starts instead of five, and one SCM tab 12 instead of 15, at the price of a larger status payload: `--porcelain=v2` prints one record per entry with its own field layout, and across the 18 fixtures the v2 output is 82,294 bytes against the v1 output's 13,034 bytes — 6.31 times the bytes. That trade is deliberate: the bytes are piped and parsed in-process, while each spawn saved is a process start, which is the dominant term on Windows.

The v2 header also becomes a second source for the current branch, so a future change to that header's fields has to keep the equivalence fixtures updated, and `parseStatusV2` must keep returning the same `StatusCounts` verdict the v1 parser produces — the counts, not the record text, are what the branch chip and the worktree manager consume.

The host-graph git service now has two parser modules with different homes: the branch/graph/worktree parsers stay in `core/`, and the status plumbing and its parser are host-local. Adding a new status-shaped command means deciding which home it belongs to.

## Testing

`tests/status-porcelain-v2.spec.ts` asserts the parity case by case over the fixtures, including the branch agreement with the captured `--abbrev-ref HEAD` output and the counting rules for rename, staged+unstaged, conflict and untracked-directory states. The fixture directory carries `README.md` for provenance and `manifest.tsv` for the recorded exit codes, so a recapture can be diffed against what the parser was pinned to.

The closest existing records are [Git worktree parallel sessions in dsh-git-graph](../feature/2026-08-26-git-worktree-parallel-sessions.md), which owns worktree creation and session isolation, and [Git Graph branch chip portals into hero workspace row](../bug-fix/2026-08-31-git-graph-branch-chip-hero-portal.md), which owns the chip's DOM placement in the browser half. Neither owns the host read path's command shape: worktrees decide which tree a session works in, the chip decides where a control renders, and this note decides how many processes one repository read costs. It is a new record rather than an edit to either.
