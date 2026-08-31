# Agent Note: Maintenance run records the two-tier acceptance policy and lands four registrations

Status: implemented

## Problem

The owner set a standing acceptance standard for community-registration PRs: when only small problems remain (mechanical rank shifts, manifest regeneration, formatting, stale branches), the maintainer fixes them and includes the registration directly; when a big problem remains (cohort-compatibility evidence gaps, untrusted provenance, upstream changes only the author can make), the PR goes back to the author until fixed. The run applied the standard to the eight open PRs, with the rank ledger at 44 entries and #1098 verified-complete but parked on the red required check from the firewall defect fixed earlier the same day.

## Decision

- The two-tier standard supersedes the author-side-rebase convention recorded in [the preceding note](2026-08-30-maintenance-run-firewall-unblock-rank45-award.md): mechanical items are maintainer-work now, and a registration may land without author round-trips. The merge gates (required checks green, review approval) still apply to anything merging through a PR.
- #1098 (dsh-agent-plugins-market, Sivan757) merged the normal way as rank 45 (47167a1d6): the PR branch was refreshed server-side with update-branch (no author contact needed), the action_required CI and agent-notes-guard runs were released, CI went green on the updated head, and the PR was approved and rebase-merged, preserving the single-commit shape.
- #1100 (dsh-fulltext-search, termanli), #1279 (dsh-reasoning-effort, Jamsharden) and #1277 (dsh-codekin, Nath-Vikky) landed maintainer-side as ranks 46/47/48 (eafe5981d, 127816890, d6cec6d74) and the PRs were closed with co-author credit. All three forks disallow maintainer edits (push:false on termanli and Jamsharden; the Nath-Vikky fork is inaccessible), and each branch's tail conflicted with the moving dev tip, so no PR-head path existed. The entries were inserted verbatim into community.json (whitespace-normalized for #1100, whose old base also made its diff unintentionally remove two dev entries and two npm fields), manifests were regenerated with scripts/market-build, community-index --check (48 entries) and market-build --check pass, and dev CI is green on the tree carrying all three.
- #1144 (dsh-deepsea) re-classified under the new standard: big problem, stays with the author — the recorded blockers (upstream tests and typecheck failing on a clean clone, telemetry not gating third-party uploads, no upstream CI) are upstream changes only the author can make.
- #1285 (dsh-completion-guard) and #1282 (dsh-prompt-enhance) remain with their authors: cohort-verification evidence and an inject that cannot resolve on the running alpha.1 cohort are big problems by the new standard.
- Small dev-side fix en route: the freshly landed turnstile note quoted wrangler's verbatim success line containing U+2728 and failed the no-emoji gate, turning dev red again; the quote was sanitized (no meaning lost) and the note's sidecar re-recorded (e5618309f). Two CI runs in between were cancelled by the concurrency group from the busy multi-session push traffic; the green run on the final tip validates the full tree including all four registrations.

## Alternatives considered

- Keeping the author-rebase convention: superseded — mechanical round-trips were the observed bottleneck and the owner explicitly redirected the standard.
- Bypass-merging the stale PR heads with --admin: rejected — rebase or squash merges of conflicted old heads would ship the old trees, which silently delete entries dev has gained; landing the entry itself on dev is content-exact.
- Force-pushing corrected branches to the forks: attempted for #1100 and blocked by the forks themselves (push:false, or an inaccessible fork) — not a chosen path.
- Deleting the emoji line from the turnstile note: rejected — it is verbatim tool output supporting the diagnosis; sanitizing the character preserves the evidence.

## Consequences

- The ledger stands at 48 entries; ranks 45-48 are dsh-agent-plugins-market, dsh-fulltext-search, dsh-reasoning-effort, dsh-codekin. The next free slot is 49.
- Registrations from forks that allow maintainer edits can still close through the normal PR flow (update-branch, gates, approve, rebase-merge); the maintainer-side landing with co-author credit and a closed PR is the fallback when forks disallow edits.
- #1285, #1282 and #1144 wait on their authors; dsh-memory (yyspoem) re-enters through a fresh PR per issue #1290 for the next free slot.
