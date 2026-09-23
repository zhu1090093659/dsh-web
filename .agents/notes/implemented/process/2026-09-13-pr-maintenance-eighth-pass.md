# Agent Note: PR maintenance run 2026-09-13 (eighth pass) — dual-plugin registration #1529 merged; seven registrations re-confirmed author-blocked

Status: implemented

## Problem

Eighth maintenance pass on `zhu1090093659/dsh-web`, hours after the seventh. Default scope: the eight open PRs assigned to the maintainer account — the seven author-blocked registrations carried over from earlier passes plus #1529 (PerryLink registering dsh-auto-review and dsh-permission-rules, opened that morning) — no Issue scan. The pass asked whether the new dual-plugin registration passes the mandatory three-axis acceptance (utility, stability, compatibility), and whether any carried-over PR had moved.

## Decision

One PR merged (#1529), one first-time approval review posted, two first-time-contributor workflow runs approved, seven PRs confirmed still author-blocked.

#1529 registers two security-category plugins as data-only index entries (community.json plus the derived market/dist/manifest/plugins.json; ranks 59/60). Utility passed: dsh-auto-review puts a second-model reviewer on the approval/request waterfall with per-tool ai/human/never policy and fail-closed fallback — a different mechanism from the indexed dsh-approve-for-me heuristic auto-approver, composable per the upstream README's waterfall-position guidance; dsh-permission-rules adds ordered allow/deny/ask rules on tools/pre-execute plus a loopback-only proxy governing shell subprocess network, with no equivalent in the index and network modes mapping onto the official sandbox presets rather than replacing them. Stability evidence: npm 24/34 versions since mid-August with GitHub releases matching npm, upstream ci/compat/plugin-doctor/scorecard all green, local upstream test runs 291/291 (dsh-auto-review) and 349 pass plus 1 skipped (dsh-permission-rules), tarballs ship prebuilt lib/ and cordis.patch.yml with no preinstall/postinstall hooks, source scan found no exfiltration/telemetry/credential patterns (vendor/ holds companion-plugin compat fixtures), and dependencies are official @deepseek-ai/* plus react/yaml/zod/chokidar. Compatibility evidence: both packages satisfy the cordis bundle standard (dsh.bundle.patch, web client with four official dsh-client-* injects), each patch is a single insert row in its own namespace with no id/name collision across the existing entries, security/policy is a legal category pair, and the workshop install path resolves the entry's npm field (`dsh plugin --profile web add <npm>`, packages/dsh-market/src/client/install-source.ts:24) against real published packages — the #1526 failure mode does not apply. One non-blocking note went into the review: tsdown/typescript/@types/react sit in dependencies instead of devDependencies. Merged as merge commit eaed6042f after the approval review.

Repository-side verification ran in a dedicated worktree on the PR head: community-index --check passes with 60 entries, market-build --check confirms the committed manifest is byte-identical to regenerating from community.json (2275 files), and the community-index plus market-layout contract tests pass 18/18. The repo's own plugin-mount CI job on the PR passed, which covers the runtime-mount evidence this pass did not re-run locally (the running DSH service is not to be restarted).

The seven carried-over PRs (#1399, #1467, #1479, #1488, #1514, #1519, #1526) were re-verified read-only: no commits and no author comments after the latest CHANGES_REQUESTED reviews on any of them, so each stays author-blocked with its prior review standing; #1399 additionally remains CONFLICTING.

Housekeeping: PerryLink is a first-time contributor; the CI and agent-notes-guard runs on #1529 were stuck in action_required and were approved so the required checks could execute.

## Alternatives considered

Blocking #1529 on a local runtime mount verification was rejected: the running DSH service must not be interrupted or restarted, and the repository's own CI runs a plugin-mount job on registration PRs — green on this head — so the mount surface was verified without disturbing the local service.

Treating the dependencies/devDependencies misplacement as a blocker was rejected: it only adds install weight, has no behavioral or security impact, and index registration does not gate on upstream dependency hygiene; it was recorded in the review for the author to fix upstream.

## Consequences

origin/dev carries eaed6042f; the community index now exposes 60 plugins, including two security/policy entries from the same author that are designed to compose (permission-rules' ask seam can route to auto-review). Seven registrations remain open and author-blocked with concrete fix instructions on record. The pass extended the registration-review precedent to a two-plugin single PR and recorded the npm-path install check (install-source.ts) as the discriminator that makes committed lib/ unnecessary when the npm field is valid.

## Testing

Worktree on PR head 94877e8ae (base origin/dev f5190be20): node scripts/community-index --check (OK, 60 entries), node scripts/market-build --check (dist up to date, 2275 files), node --test scripts/community-index.test.mjs scripts/market-layout.test.mjs (18/18). Upstream suites from temp clones: dsh-auto-review vitest 291/291, dsh-permission-rules vitest 349 pass plus 1 skipped. PR checks all green post-approval including CI and plugin-mount; merge state CLEAN before merging. Review posting, workflow approvals, and the merge were confirmed through gh pr view and the API.
