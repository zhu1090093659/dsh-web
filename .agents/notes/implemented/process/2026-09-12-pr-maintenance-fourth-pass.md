# Agent Note: PR maintenance run 2026-09-12 (fourth pass) — whalechan skin and jyn pet content/persistence merged

Status: implemented

## Problem

Fourth maintenance pass on `zhu1090093659/dsh-web`, a few hours after the third pass. Default scope: the eight open PRs assigned to the maintainer account (the new jyn pet PR #1499 joined the seven from the third pass), no Issue scan. The third pass ended with all seven author-blocked; the questions were whether any author had moved, and whether the two PRs showing activity could clear their gates.

## Decision

Two PRs merged, six remain open and author-blocked.

#1484 (whalechan workshop skin): the author removed the maintainer-only Agent Note triplet exactly as the third pass requested (commit 5cefe4425e, deletions only). The fork's required checks were stuck because the `pull_request`-event workflows (CI, agent-notes-guard) sat in `action_required` awaiting maintainer approval; both runs (34669149915, 34669149894) were approved through the runs API, completed green, and the PR merged as a merge commit (eb41ec213).

#1499 (jyn ice-princess pet content plus skin-selection persistence, 850 files, 415 new frame assets per side): reviewed as one unit. The content config is self-consistent — three click actions split 0.3333 / 0.3333 / 0.3334, rest and work tracks loop, result tracks are non-loop with fallback into the skin's own work loop, `gameplayTracks` keys match the manifest's `work.successState` / `failState`, and the 10s / 50% adjudication stays pet-level while skins only swap art. The persistence feature is host-authoritative: `set-skin` validates against the manifest, `persist.ts` sanitizes stale entries, the client rolls back to the served value on rejection, and the bus latches `idleTrack` so late or remounted renderers keep the restored skin — the same pattern the sleep-loop skin override already used. Corroborated locally in a detached worktree at the PR head: the dsh-pet suite passes 505 tests across 42 files; CI checks, guard-agent-notes, plugin-mount, and Windows unit tests were green on the head commit. Approved and merged (ce18796f4).

The remaining six re-verified read-only: every review is still maintainer-authored and no author moved, so nothing re-enters review. #1488 stays approved-but-red on the `plugins.json` subcategory contract; #1479, #1467, #1399, #1321, #1318 keep their changes-requested blockers as recorded in earlier passes.

## Alternatives considered

Merging #1484 without approving the queued workflow runs was not an option — the ruleset requires those checks, so approval was a prerequisite rather than a courtesy. Squash-merging was rejected: repo history merges external PRs with merge commits, keeping author commit boundaries. Pushing the missing `subcategory` fix to #1488's fork was rejected on the standing third-pass norm that fork pushes carry only rebase updates, not content edits, and the branch is actively authored. Splitting #1499 into separate content and feature PRs was rejected: the author offered the split, but the halves share the manifest, tests, and generated artifacts, and were reviewed as one disclosed unit.

## Consequences

The whalechan skin and the jyn content/persistence work are on `origin/dev`. Future pet skins can rely on the bus-latch contract (`GameplayBus.idleTrack`) and the host `setSkin` RPC; reviews of future content PRs that bundle feature changes should keep checking the shared adjudication rule stays pet-level. The fork-approval step is now recorded for reuse: first-time or unprivileged fork PRs keep CI queued until a maintainer approves the runs via `POST /actions/runs/{id}/approve`. Six PRs remain author-blocked; the oldest (#1318, #1321) are twelve days without author movement.

## Testing

GitHub state via `gh pr view` / `gh run list` / `gh api` (reviews, comments, checks, merge state). Local corroboration for #1499 in a detached worktree at ffb728b300: `pnpm install`, then `pnpm test` in `packages/dsh-pet` — 42 files, 505 tests, all passed. The review worktree and temp branch were removed after the merges were confirmed on `origin/dev` (eb41ec213, ce18796f4).
