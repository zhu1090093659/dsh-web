# Agent Note: Maintenance run merges dsh-passwords at rank 43, approves free-search, narrows two parked threads

Status: implemented

## Problem

The /pr-issue-maintenance pass following [the preceding record](2026-08-28-maintenance-run-catppuccin-acceptance-notion-skill-merge.md), run under the default scope (open PRs whose assignees include zhu1090093659; Issues out of scope). Six open PRs were in scope, all mid-conversation with the maintainer account already engaged, and three index registrations (#1224, #1249, #1100) had each rebased to claim the same rank-43 tail slot that the preceding record opened up. This run had to pick a merge order for that slot, re-verify the remaining items each author pushed since, and keep the other threads moving without re-litigating settled verdicts.

## Decision

- #1224 (slywalker2006, dsh-passwords): verified and merged as 8b1615959. The rebase commit (cf1978fc) converges to two files with +25 lines and zero deletions; on a detached worktree at the PR head, `node scripts/community-index --check` passed (43 entries) and `node scripts/market-build --check` passed (tryon/ hash manifest 756 files, dist up to date), with the manifest tail confirming dsh-passwords rank 43, 远程访问网关 / Access Gateway, security/access. The CI and agent-notes-guard runs for the head were released from first-contribution `action_required` and both finished green; an approving review was submitted (the ruleset needs a formal approval, thread comments do not count) and the PR squash-merged. The merged dev tip (8b1615959, 43 entries) passes `market-build --check` and `community-index --check` after a fast-forward.
- #1249 (DDDMUC, dsh-free-search): all three blockers verified and the PR approved. The bilingual takeover disclosure is in the diff (searchProvider=ddg takeover plus rollbackPatch restore, keyed engines need their own keys); the deployment-reproduction doc was fetched at its raw URL and carries the five-step record (install, takeover, keyless real search, settings panel, uninstall restoring deepseek-official); the rank-43 rebased diff is clean. Local re-verification matched #1224's (43 entries, market-build --check, manifest tail 免费搜索 / Free Search), CI/plugin-mount/guard-agent-notes were already green, and the approving review asks for one more push: rebase to rank 44 because #1224 took 43. The author's own alpha.1 note (client bundle route 404 under the alpha.1 client-routing rework, host seams unaffected) is accepted as non-blocking for the stable cohort the entry targets.
- #1100 (termanli, dsh-fulltext-search): the two known items verified done in the pushed commits — the `.agents/notes` trio nets out to zero changes against dev and the regenerated manifest passes `market-build --check` (rank 43, tools/dev). One new defect from the rebuild: thirteen blank lines sit between the entry and the closing bracket in community.json (the generator ignores them, so `--check` still passes, but the hand-maintained source stays polluted). CI and agent-notes-guard gates were released and a comment asks for one push: drop the blank lines, rebase to rank 44, regenerate.
- #1098 (Sivan757, dsh-agent-plugins-market): the index-side review items are closed — subcategory tools/dev is in the diff, the manifest is regenerated, and the lockCommit confirmation-modal item shipped upstream in 0.5.3 per the author. The remaining evidence was narrowed to two log excerpts (dsh web restart restores suite and MCP/hooks mounts per enabled state; hooks bridge actually stops at runtime after disable or uninstall — the MCP disable/uninstall record from 2026-08-25 stands and need not be redone). Windows validation is waived as an author-side hardware limitation and recorded as maintainer-side follow-up; CI and agent-notes-guard gates were released and the comment points at the rebase too.
- #1245 (tokyo-night) and #1144 (deepsea): no author movement since the last round; both stay parked on their recorded blockers (watermark-free artwork; the changes-requested list).

## Alternatives considered

- Hand-renumbering the second and third registrations to land several merges in one round: rejected, per the standing rule that regeneration and rebases belong in contributor branches behind required checks; the maintainer rewriting fork branches would also churn authorship.
- Merging #1249 ahead of #1224: rejected on first-complete-first-served — #1224's content verdict landed at 04:45 UTC versus #1249's 15:02, and its rebase push (05:35) was the earliest.
- Waiving all outstanding #1098 evidence: rejected; restart-recovery and hooks stop are the plugin's core lifecycle claims and stay required. Only the Windows item moved to maintainer-side follow-up.
- Holding the #1249 approval until after its rebase: considered and declined; posting the approval now records the completed verification, and if the repo dismisses stale reviews on the rebase push, re-approving a rank-number-only diff is mechanical.

## Consequences

- dev advanced fcc6caa4e to 8b1615959 carrying the dsh-passwords registration (43 entries, rank 43); `market-build --check` and `community-index --check` pass on the tip.
- #1249 and #1100 were both pointed at rank 44 against tip 8b1615959; same-day pushes will collide again, and the next runner must re-read both threads and reassign the slot by first-complete-first-served.
- #1098's acceptance path is a single push: two log excerpts plus a rank rebase (44 or the next free slot by then); #1100's is the blank-line fix plus the same rebase; #1249 is content-complete pending its rebase push.
- Verification worktrees and a node_modules link lived under /tmp and were removed after use; no shared-checkout state was altered besides this note commit and the fast-forward to the remote tip.
