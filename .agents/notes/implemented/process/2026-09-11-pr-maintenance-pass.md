# Agent Note: PR maintenance run 2026-09-11 — two skin PRs merged, one plugin registration returned

Status: implemented

## Problem

The default maintenance scope is every open pull request in `zhu1090093659/dsh-web` whose assignees include the maintainer account. Six PRs matched: three awaiting a first review (#1464 Black Gold Gilded skin, #1468 blue-fantasy readability layer, #1467 dsh-thread-tools community registration) and three still blocked on their authors since earlier changes-requested reviews (#1399 provider-signin, #1321 dsh-memory, #1318 dsh-git-badge). The working rules require the three-axis evidence review (usefulness, stability, compatibility) for third-party plugin registrations, merging only from a verified clean state, and treating a PR this account already reviewed as author-blocked until the author responds.

## Decision

#1464 and #1468 are reviewed, approved, and merged into `dev` as merge commits (`796a436a`, `bf1e40ea`); #1467 is returned with changes requested; the three author-blocked registrations are left untouched.

#1464 — verified in a detached worktree: `market-build --check` (dist up to date), `skin-center:check`, `i18n:check`, `docs:check`, `community:check` and `dsh-skin validate` all pass; the head then merged cleanly into a `dev` 14 commits ahead with every gate still green, so no author regeneration was needed. Both previews were inspected; the dark-only design is intentional and the skin is asset-backed, not a recolour.

#1468 — the same gate set passes, plus `dsh-skin validate` PASS on the integrated tree. Its `pull_request` CI suite was stuck in `action_required` (first-time contributor) and the run was approved; the first `Tests` attempt failed inside `packages/dsh-ssh` on an unrelated `write EPIPE` proxy-command assertion and passed on re-run. Three selectors use full CSS-modules hashes (`_5OnbHa_body`, `lcKema_thinkBody`, `XrJvXW_body`); they resolve against the installed host today and `dsh-skin validate` reports them as warnings, so they are recorded to the author as non-blocking.

#1467 — the entry declares `"npm": "@wig123/dsh-thread-tools"`, but that package is unpublished (`npm view` E404, checked including unscoped and alternate variants). `installSpec` (packages/dsh-market/src/client/install-source.ts:28) prefers the npm field over the repo, so a Workshop install fails; the fix is to publish the package or drop the npm field and fall back to the committed `lib/` git install. Stability evidence is otherwise absent (repo created the same day, no CI, no test suite, no tag or release); usefulness passes (top-level cross-session tools fill a gap `subagent` / `send_message` do not). Repo gates (`community-index --check` 59 entries, `market-build --check`) pass.

#1399, #1321 and #1318 have no author commits or replies since their changes-requested reviews and stay as they are.

## Alternatives considered

Blocking #1468 on its hash-prefixed class selectors was rejected: `dsh-skin validate` classifies them as warnings rather than errors, the current host still carries the hashes, and the same pattern is already tolerated in shipped skins; the fragility is recorded to the author instead. Merging #1467 anyway or approving the npm field was rejected: the declared install path returns 404, so the entry would be dead on arrival in the Workshop. Auto-closing #1467 as a new-capability PR was rejected: community-plugin registration is an accepted content type and carries the mandatory three-axis review rather than a close. Squash merges were rejected in favour of the repository's `merge PR #NNNN` merge-commit convention. Repairing the `dsh-ssh` proxy-command flake in this pass was rejected: it cannot be reproduced locally (the targeted test passes three times), `dsh-ssh` is security-sensitive, and a speculative product-code change is not justified.

## Consequences

`dev` carries the two new skins at `bf1e40ea`; the repo catalog reports 32 skins and `market/dist` regenerates cleanly. #1467 stays open and blocked until the npm field is published or removed and the contribution-evidence checks pass. The integration branch's push CI is red on the `packages/dsh-ssh` ProxyCommand assertion for reasons unrelated to content PRs; that flake is recorded here as an open gap.

## Testing

Per-PR detached worktrees: `node scripts/market-build --check`, `node scripts/skin-center-catalog-check --check`, `node scripts/i18n-audit.mjs --check`, `node scripts/verify-docs.mjs`, `node scripts/community-index --check` and `node scripts/dsh-skin validate <skin>` are green for #1464 and #1468 on both the PR head and the merged integration tree. The target test for the reported flake, `npx vitest run tests/engine.test.ts -t "surfaces a failing ProxyCommand"` in `packages/dsh-ssh`, passes three consecutive local runs.