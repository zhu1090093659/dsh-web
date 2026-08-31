# Agent Note: Maintenance run unblocks dev CI (firewall platform leak) and awards rank 45 to dsh-agent-plugins-market

Status: implemented

## Problem

Continuation of [the preceding record](2026-08-29-maintenance-run-free-search-merge-four-registration-verdicts.md) under the default scope (open PRs whose assignees include zhu1090093659; Issues out of scope). Eight open PRs were in scope. The rank-45 race had three content-complete contenders (#1098, #1279, #1277) while the required CI check had been red on every dev commit since 3c3d5644 (2026-08-29), blocking all registration merges. The run had to decide whether the red gate blocks the merges, who holds rank 45, and whether the two refreshed verdicts are closed.

## Decision

- The dev CI break traced to a single test: `packages/dsh-remote-web-ui` `tests/firewall.spec.ts` "reports unmanaged platforms as ok" (277/278 tests in the package pass; plugin-mount green; the failure is identical on dev's own tip). Root cause: `computeFirewallSummary` defaulted its backend parameter to `firewallBackend()`, so the test's explicit `undefined` re-probed the real OS — a deterministic pass on darwin, real ufw/iptables detection on Linux CI. Introduced in the lan-bind hardening window 7512174d..3c3d5644.
- Fixed directly on dev (bb3d1588f): detection moved to the `firewallSummary` call site, so an explicit `undefined` deterministically means "no backend" on every platform and production behavior is unchanged (the single internal caller passes `firewallBackend()` itself). Verified with the package typecheck, all 296 package tests passing locally, and the dev CI run green on bb3d1588f.
- Rank 45 awarded to #1098 (dsh-agent-plugins-market, Sivan757) by first-complete-first-served: head 7550afa70 (2026-08-29 14:54) was the earliest push that was both content-complete and a pure rank-45 append on a 44-entry base. Local verification on the head: `node scripts/community-index --check` (45 entries) and `node scripts/market-build --check` (hash manifest consistent, 756 files) pass; plugin-mount green; the action_required CI and agent-notes-guard runs were released and the latter passed. The merge itself was deferred only by the then-red gate; the author is asked to rebase onto bb3d1588f for a green run, and the merge follows on green.
- #1279 (dsh-reasoning-effort, Jamsharden) verdict closed: the entry now declares its verified versions (0.1.1-rc.2 and 0.1.2-alpha.1) and discloses that uninstalling does not remove the reasoning settings written into llm-pi-ai; the PR template is complete. Queued for rank 46 after #1098 lands.
- #1277 (dsh-codekin, Nath-Vikky) verdict closed: the entry now discloses the real save path (`codekinsave/state.json` under the DSH home), the lossless first-launch migration from `tracewild/state.json`, and uninstall retention; the PR's failing CI check was confirmed pre-existing (the same dev-side defect). Queued for rank 47.
- No movement, no action: #1285 (cohort-verification and description blockers stand), #1282 (still claims rank 44 on an inject that cannot resolve on the alpha.1 cohort), #1100 (still claims rank 43), #1245 and #1144 (parked on their recorded blockers).
- Fact surfaced and owner-decided: commit dd376dcb ("Add dsh-memory plugin to community index", authored by yyspoem, 2026-08-29 23:29) was pushed directly onto dev and is no longer reachable from origin/dev — the 05:18 push of 5eaa7b0f3 replaced the branch line without it. dev still carries 44 entries, so the rank ledger is unaffected. The owner chose normal-flow re-registration over maintainer-side restoration; outreach issue #1290 tells yyspoem (account created hours before the push, not a collaborator) about the drop and the re-submission requirements: entry plus regenerated manifest in one PR, template test evidence (install, memory write, tool recall, uninstall), and a description matching the repo's current tool-based recall. The upstream plugin is real and active (yyspoem/dshstore, dsh-memory@0.1.0, cordis.patch.yml + dsh/ layout); its entry takes the next free slot after the queued 45/46/47 once its PR merges.

## Alternatives considered

- Merging #1098 over the red required check using the ruleset's owner bypass: rejected — the merge gates forbid merging while a required check fails, and the failure belonged to dev, so it had to be owned on dev rather than routed around.
- Asking every contender to rebase before diagnosing the gate: rejected — the failure was dev-side and would have failed every rebased head identically, burning author round-trips for nothing.
- Making the firewall test platform-conditional (`it.runIf` on darwin): rejected — it would remove the test from Linux CI entirely and preserve the trap that `computeFirewallSummary(port, lan, undefined)` probes the real OS.
- Restoring dd376dcb maintainer-side: rejected — a dropped direct push by an external author is an ownership decision; going through the normal registration flow re-earns the slot.

## Consequences

- dev advanced 700a74e09 to bb3d1588f carrying the firewall fix; the registration pipeline's required checks are green again, and a rebased registration head runs green without any test changes (the fix is in src, not in the spec).
- The rank queue is explicit: 45 = #1098 (pending its green rebase), 46 = #1279, 47 = #1277; #1285 must still clear its cohort-verification blockers before entering the queue. dsh-memory re-enters only through a fresh PR and takes the next free slot.
- `computeFirewallSummary`'s contract is now "undefined means no backend"; callers that want platform detection pass `firewallBackend()` themselves (`firewallSummary` does).
