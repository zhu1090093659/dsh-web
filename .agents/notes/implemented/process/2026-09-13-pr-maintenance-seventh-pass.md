# Agent Note: PR maintenance run 2026-09-13 (seventh pass) — two merges cleared, two new registrations blocked on first review

Status: implemented

## Problem

Seventh maintenance pass on `zhu1090093659/dsh-web`, hours after the sixth. Default scope: the nine open PRs assigned to the maintainer account — the seven carried over from the sixth pass plus the two registrations opened that morning (#1526 dsh-round-rightclick, #1519 dsh-desktop-shell) — no Issue scan. The pass asked which author-blocked PRs had moved, and whether the two new third-party plugin registrations pass the mandatory three-axis acceptance (utility, stability, compatibility).

## Decision

Two PRs merged, two first reviews posted as CHANGES_REQUESTED, five PRs confirmed still author-blocked, four first-time-contributor workflow runs approved.

#1516 (skin-center bubble blur slider): the author fixed the single blocking item from the fifth pass — blue-fantasy's user bubble now reads `blur(calc(var(--dsh-skin-bubble-blur, 10px) * 1.2))`, so the default reproduces the original 12px exactly like the alpha rule's 120% compensation — squashed the branch to one commit, and rebased. Merged as merge commit ffedeaeff.

#1502 (Miku redesign): the author pushed the three mechanical commits the approval was waiting on (emoji replaced with text in a patches comment, lib rebuilt, market/dist regenerated, fingerprints re-recorded); the diff since approval was verified line-by-line before treating the approval as current. Merged as merge commit 527856ac0.

Both merges hit the same conflict class and crystallize a rule the fifth pass only implied: when an external PR is content-complete and review has passed, and the only conflicts are generated artifacts (`lib/`, `scripts/lib-artifact-fingerprints.json`) caused by dev advancing past the PR's rebase base, the maintainer merges locally, rebuilds the four lib packages from the merged sources, re-records fingerprints with `lib-artifact-check --write`, and documents the resolution in the merge commit — the author is not bounced for another rebase. Both sides' intent is provably preserved because the rebuild compiles the merged sources; libs:check enforces the fingerprint contract. The inverse case (branch-side staleness before review completes) stays author-owned, as the fifth pass decided for this very PR.

The two new registrations failed acceptance on stability, with the utility axis verified both times. #1526 (dsh-round-rightclick): code quality is good — 47/47 upstream vitest cases pass locally, the one HTTP route is hardened (fence check, 64 KiB cap, array-form spawn without shell), namespaces are clean, market/dist was regenerated. Blocked on: the entry's `npm` field points to a package that does not exist on npm (E404 verified; the established pattern is to omit the field and fall back to github install), plus no upstream CI workflow and no committed lib/ (install would build on the user's machine via prepare). #1519 (dsh-desktop-shell): audited source has no malicious patterns and the npm package matches the PR's numbers, but the plugin creates login-autostart shortcuts by default (opt-out only via `DSH_DESKTOP_NO_AUTOINSTALL=1`) while uninstalling cleans up nothing — install.js has no cleanup and the client copy tells users to delete the folder and shortcuts by hand; default-on persistence plus uninstall residue cannot ship as-is. Second block: the store-card description must disclose Windows-only behavior, the launcher install into `%USERPROFILE%\dsh-desktop`, the shortcut creation, and the restart fallback that `taskkill /T /F`s the whole backend process tree. Non-blocking notes: the prebuilt DSHLauncher.exe cannot be byte-verified against the shipped source, and both upstreams are one day old with no maintenance track record.

Housekeeping: the two new PRs' `CI` and `agent-notes-guard` runs were stuck in `action_required` behind the first-time-contributor gate; the maintainer approved the four runs so the required checks can execute. The five carried-over PRs (#1399, #1467, #1479, #1488, #1514) were re-verified read-only — no author movement on any of them, so every one stays author-blocked with its prior review standing.

## Alternatives considered

Bouncing #1516 and #1502 back to their authors for a second rebase was rejected: the staleness was dev's advance after review completed, the repo's own contract defines rebuild-plus-libs:write as the resolution for fingerprint conflicts, and the gates on the merged trees prove both sides survived.

Treating #1526's npm 404 as a non-blocking note was rejected: the #1467 and #1318 precedents treat install-path integrity and upstream CI as stability blockers for registrations, and an entry whose install field 404s breaks the workshop path it advertises.

Closing #1519 outright over the autostart behavior was rejected: the audited code has no malicious patterns, the behavior is documented in the upstream repo and opt-out exists, and both the plugin defaults and the entry description are fixable — rejection would discard a genuinely useful, salvageable contribution.

## Consequences

origin/dev carries ffedeaeff and 527856ac0; GitHub marks #1516 and #1502 MERGED, so the bubble blur knob and the Miku redesign are live on the integration branch. Neither merge touched the Wallpaper Engine files that trigger the domain-collaborator notification (wallpaper.ts / we-player-source.ts and their tests were not in either diff). Seven PRs remain open and author-blocked (#1399, #1467, #1479, #1488, #1514, #1519, #1526), each with concrete fix instructions on record. The rebuild-on-merge rule now has two exercised precedents in one day. Standing watch items: the prebuilt-exe provenance question on dsh-desktop-shell, the one-day age of both new upstreams, and the fifth pass's subcategory two-gate inconsistency, still unowned.

## Testing

Both merges were built and gated on merged trees in dedicated worktrees: pnpm typecheck, test, docs:check, i18n:check, libs:check, aggregate:check, market:check (plus skin-center:check for #1502) all pass; worktrees removed after integration. The #1502 post-approval delta was read as a git diff against the fetched head before approval. #1526's upstream suite (47 vitest cases) and #1519's (22 checks, 20 pass on macOS with 2 Windows-path test assumptions) were run from temp clones by the investigation pass. PR states, review postings, and workflow approvals were confirmed through gh pr view and the actions runs API.
