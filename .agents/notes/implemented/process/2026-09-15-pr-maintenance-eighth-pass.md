# Agent Note: PR maintenance run 2026-09-15 (eighth pass) — five merges, two first reviews, one batch audit

Status: implemented

## Problem

Eighth maintenance pass on `zhu1090093659/dsh-web`, two days after the seventh. Default scope: the twelve open PRs assigned to the maintainer account — no Issue scan. The pass asked which author-blocked PRs had moved, whether the two authors who pushed fixes after a CHANGES_REQUESTED addressed every item, and whether the five never-reviewed registrations (four plugin registrations plus the Binary Veil skin) pass their mandatory reviews.

## Decision

Five PRs merged, two first reviews posted as CHANGES_REQUESTED, five author-blocked PRs re-verified read-only, six first-time-contributor workflow runs approved.

Merges, each verified on a dedicated worktree merged from the then-latest `origin/dev` before pushing:

- #1514 (dsh-whale-girl widget) as merge commit 1507ba0a7. The author's rebase addressed both blockers from the sixth-pass review; the regenerated `market/dist` reproduced exactly the claimed delta (plugins.json +12, other manifest date stamps to zero), and `market-build --check` passed on the merged tree.
- #1519 (dsh-desktop-shell) as a71e699f0. The audit covered the new upstream release rather than re-trusting the old one: npm `dsh-desktop-shell@1.1.1` is byte-identical to the `v1.1.1` tag, sign-in autostart resolves off by `raw?.autostart === true` in `readPreferences`, `cleanupInstall` removes every created shortcut plus the launcher home, and the committed `assets/SHA256SUMS.txt` verified OK locally for all six prebuilt binaries — closing the seventh pass's provenance watch item.
- #1542 (dsh-delete-session) as 4bcb27306. Because the plugin deletes user session data, review went beyond source reading: a sandbox harness in `/tmp` drove the real `deleteSession` through a mocked cordis context. It deleted only the target session directories across both workspaces, kept sibling sessions and stray files, returned 400 on a traversal id, 403 off-loopback, and 404 for an unknown session. A local push race (dev advanced to d35099d0b mid-verification) was resolved by constructing the merge commit fresh on the new base after a rebase attempt flattened the history — a rewritten PR head sha would never be marked MERGED, so the merge-commit form is required.
- #1539 (dsh-quick-ask) as a3704c3c6. The PR inserts its entry at the array front, shifting every rank; GitHub's merge-preview tree therefore mixed two dist generations and its `market-build --check` failed while the PR head itself was clean — the maintainer-side rebuild case, not an author defect.
- #1575 (nine dsh-plugin-kit registrations) as 970c64ea8. The nine-package audit ran as three parallel read-only investigations over the cloned monorepo plus mechanical checks (npm versions aligned, no lifecycle scripts, committed lib/, dependency allowlist, kit's four-way loopback fence on every route, same-origin-only clients, lib/src parity spot checks). Two findings are recorded publicly as non-blocking follow-ups: tty's `GET /config` returns stored SSH passwords in plaintext where the sibling docker plugin already redacts to `passwordSet`, and rss fetches user-configured feed URLs without a scheme allowlist, private-host blocking, or a response size cap.

First reviews: #1576 (Binary Veil skin) is CHANGES_REQUESTED on a single item — the 92.4 MB mp4 (11.5x the largest shipped skin, ~190 MB into committed `market/dist` and git history); every contract gate including the video `backgroundMedia` consumer path in `decoration-layers.ts` was verified passing. #1577 (dsh-stalled-turn-continue) passed the full three-axis review including upstream tests run locally, and is CHANGES_REQUESTED only because the author ticked the user-facing PR type without the screenshot the evidence workflow requires.

The five carried-over author-blocked PRs (#1399, #1467, #1479, #1488, #1526) had no new commits after their reviews; all stay author-blocked with prior reviews standing. Workflow runs stuck in `action_required` behind the first-time-contributor gate were approved for #1514, #1519, #1539, #1575, and #1577.

community.json and the market manifest now carry 73 plugins. No merged diff touched the Wallpaper Engine domain files that trigger the collaborator notification.

## Alternatives considered

Blocking tty's registration over the plaintext password readback was rejected: the exposure sits behind the same loopback-and-origin fence as the host's own APIs, so it adds little beyond the local-trust baseline, while rejecting would discard a genuinely well-built nine-package contribution — a public follow-up record achieves the fix without the loss.

Asking the #1539 author to rebase because CI failed on the merge preview was rejected: the failure is definitional for front-insertions (any two dist generations textually spliced are stale), the PR's own tree was consistent, and the rebuild-on-merge rule already assigns splice staleness to the maintainer.

Accepting the rewritten linear history for #1542 was rejected: GitHub marks a PR MERGED only when its exact head sha lands in the base branch, so a rebased-resolution commit would have left the PR open forever; the merge commit was rebuilt on the new base instead.

## Consequences

origin/dev carries 1507ba0a7, a71e699f0, 4bcb27306, a3704c3c6, and 970c64ea8; the workshop plugin listing grows from 63 to 73 entries. Seven PRs remain open: two waiting on their authors (#1576 asset re-encode, #1577 evidence screenshot) and five still author-blocked. Standing watch items: tty's password readback and /local-fs disclosure, rss outbound fetch hardening, both upstreams younger than a week, and the community.json tail remains a live both-appended conflict point every registration PR will hit until entries stop landing at the array end.

## Testing

Every merge was gated on its dedicated worktree before pushing: pnpm typecheck, test, docs:check, i18n:check, libs:check, aggregate:check, market:check, and community-index --check all pass on the final merged trees. #1542's sandbox harness exercised the deletion path end-to-end (4/4 assertions). The #1575 audit evidence is file:line-referenced in the PR review thread. Worktrees were removed after each integration.
