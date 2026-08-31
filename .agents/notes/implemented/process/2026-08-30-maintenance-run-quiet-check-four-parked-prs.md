# Agent Note: Maintenance run confirms four in-scope PRs parked with no author movement

Status: implemented

## Problem

Continuation of [the preceding record](2026-08-30-maintenance-run-firewall-unblock-rank45-award.md) under the default scope (open PRs whose assignees include zhu1090093659; Issues out of scope). After the rank queue drained — #1098 (45), #1100 (46), #1279 (47), #1277 (48) all landed on origin/dev since that record — exactly four open PRs remained assigned: #1285 (dsh-completion-guard), #1282 (dsh-prompt-enhance), #1245 (tokyo-night), #1144 (dsh-deepsea). The run had to decide whether any of them saw author movement since the standing feedback that would warrant a re-review, a follow-up comment, or a merge.

## Decision

- Authorship and review state re-verified from GitHub: no formal review on any of the four comes from an account other than this one (the only review on file is this account's CHANGES_REQUESTED on #1144), so the collaborator-reviewed read-only rule does not apply and all four stay in the regular queue.
- All four heads are unchanged since the standing feedback, and no author comment follows it: #1285 head 3213cbcc4 (2026-08-29 11:31, already the basis of the previous run's verdict), #1282 dfdd3525d (08-29 08:48), #1245 9b2003290 (08-27 15:14), #1144 a931807cd (08-25 05:52). Every recorded blocker stands unaddressed: #1285 on alpha.1 cohort verification of its rc.2-pinned peers and hooked seams plus the entry-description fixes; #1282 on the `@deepseek-ai/dsh-client-runtime` client inject that cannot resolve in the 0.1.2-alpha.1 cohort store and the engines floor; #1245 on the watermarked `assets/tokyo-night-art.webp`; #1144 on its nine review items with red CI and a stale manifest.
- Mergeability re-checked: #1285, #1282, and #1144 are CONFLICTING against current dev (the index grew to 48 entries while their heads carry older manifests); #1245 reports UNKNOWN. No merge is possible and none of the blockers has lifted, so no remote action was taken — heads unchanged means the existing reviews stand without duplicate commenting.
- Rank ledger recorded for the next runner: origin/dev's community index holds 48 entries with tail 44 dsh-free-search, 45 dsh-agent-plugins-market, 46 dsh-fulltext-search, 47 dsh-reasoning-effort, 48 dsh-codekin; the next free slot is 49. #1285 and #1282 cannot enter the queue until their blockers clear, and both must also rebase onto the 48-entry manifest.

## Alternatives considered

- Re-posting the blocker summaries as fresh comments to nudge the authors: rejected — the heads have not moved, so the existing reviews and comments remain accurate; a duplicate of a three-day-old verdict only buries the actionable items under repetition.
- Closing the two oldest threads (#1144 at eight days, #1245 at three) as abandoned: rejected — each has a concrete single-push path to acceptance, the feedback is recent enough that silence does not signal abandonment, and no standing policy closes a PR for inactivity at this age.
- Re-verifying the alpha.1 cohort store for #1282's missing `dsh-client-runtime`: skipped as unnecessary — the cohort store is a local fixed target for this profile and the upstream removal is not going to reverse itself; the previous run's check remains valid.

## Consequences

- The queue is unchanged: four parked PRs, all waiting on author action, with no maintainer-side work outstanding on any of them. The next runner must re-read all four threads before acting, since same-day pushes remain likely.
- The rank queue waits on the outside: #1098's slot awards are complete, so the next entry lands at 49 from whichever of #1285/#1282 (or a new registration) clears its blockers first; the two-tier acceptance policy note on origin/dev now owns how small-defect registrations get maintainer-side fixes and direct merges.
- No shared-checkout state was touched: local dev still carries three unrelated unpushed commits from another session with their working-tree changes, and this note reached origin/dev from an isolated worktree branched off origin/dev.
