# Agent Note: PR maintenance run 2026-09-13 (sixth pass) — two stale registrations closed on the seven-day inactivity rule

Status: implemented

## Problem

Sixth maintenance pass on `zhu1090093659/dsh-web`, hours after the fifth. This run's scope parameter: close PRs that have had no new commits and no new replies for more than seven days. Candidates: the ten open PRs at run start, all assigned to the maintainer account; no Issue scan. Staleness was decided from authoritative timestamps — author commits, issue comments, review submissions, inline review comments — not from `updatedAt`, which bot and label events distort. One data quirk mattered: the REST review-list payload returns `submittedAt: null`, so review ages came from the GraphQL timeline; the newest pre-run activity anywhere was the maintainer's own 2026-09-01T10:41Z review on #1321, so every candidate had been fully dormant well before the 2026-09-06T06:23Z cutoff.

## Decision

Two PRs met the criterion and are closed with an explanatory comment each; the other eight had commits or replies within the week and were left untouched.

#1318 (dsh-git-badge registration): last activity of any kind 2026-08-31T23:53Z — the maintainer's CHANGES_REQUESTED, which passed the plugin's practicality and compatibility axes and blocked stability on the missing CI workflow and tests (a security-sensitive plugin that runs git commands and exposes local HTTP/SSE routes). The failed run's log confirms the red `CI checks` step is exactly the `dsh-git-graph` sourcemap ENOENT and `dsh-doctor` bomb-render failures the author had evidenced on dev; plugin-mount and contribution-evidence checks pass. Closed with that state and the reopen path recorded.

#1321 (dsh-memory registration): last author activity 2026-08-31T14:36Z; two maintainer reviews (2026-08-31T23:55Z, 2026-09-01T10:41Z) blocked on the npm artifact not matching the repository source and on the `dsh-memory` npm name colliding with bbnopromo's unrelated package, plus failing contribution-evidence checks. Closed with the missing-evidence state and reopen path recorded.

Both entries are absent from the `community.json` on `origin/dev` (58 entries), so closure removes no registered capability. Neither PR carries a collaborator formal review — every existing review is the maintainer account's own — so the no-re-review rule did not apply. Both are community-plugin registrations (the mandatory three-axis type); their acceptance reviews were already on record from 08-31/09-01, and this run's decision is inactivity closure, not a second acceptance.

## Alternatives considered

Waiting for the stale-assignment workflow's 14-day transfer was rejected: the run's instruction sets a seven-day rule and both PRs were already assigned to the owner account, so the transfer would change nothing. Closing without comments was rejected per the comment norms — each closure states the check state and the reopen path. Re-running the three-axis acceptance before closing was rejected: the axis conclusions are already recorded and closure is reopenable. Doing the author-side fixes ourselves (tests, CI, npm rename, dist regeneration) on the stale author branches was rejected on the standing norm that registration PRs stay author-owned.

## Consequences

#1318 and #1321 are closed; either author can reopen after pushing the asked-for updates or resubmit fresh. Dev's own CI runs today are green, so a rebase should also clear #1318's red. Eight open PRs (#1399, #1467, #1479, #1488, #1502, #1514, #1516, #1519) carry over to the next pass. The `dsh-memory` npm-name collision remains a standing fact for future registrations of similarly named plugins.

## Testing

Closures verified via `gh pr view` (state CLOSED, closedAt 2026-09-13T06:28Z) and one maintainer comment on each PR. Staleness from the GraphQL timeline (commits, comments, review submissions) cross-checked with `gh pr checks`; #1318's failure attribution read from the failed run's log; dev CI status from `gh run list --workflow CI --branch dev`; index membership from `community.json` on the freshly fetched `origin/dev`.
