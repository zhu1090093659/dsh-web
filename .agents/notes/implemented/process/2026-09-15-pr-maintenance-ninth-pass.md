# Agent Note: PR maintenance run 2026-09-15 (ninth pass) — one merge, one first review, six authors still blocked

Status: implemented

## Problem

Ninth maintenance pass on `zhu1090093659/dsh-web`, hours after the eighth. Default scope: the eight open PRs assigned to the maintainer account — no Issue scan. The pass asked whether #1577's post-review push resolved its evidence blocker, whether the never-reviewed three-skin submission #1582 passes its mandatory review, and whether any of the six author-blocked PRs had moved.

## Decision

One PR merged, one first review posted as CHANGES_REQUESTED, six author-blocked PRs re-verified read-only, four first-time-contributor workflow runs approved.

- #1577 (dsh-stalled-turn-continue) merged as 0c282b026. The blocker was the contribution-evidence check; the author edited the PR body at 04:45 and the check re-ran to success, honoring the eighth pass's "merge when green" commitment. The two commits pushed after that review were upstream merge-syncs plus a community.json formatting fix — verified by diffing `origin/dev...head` (25 insertions: one entry + regenerated manifest, upstream formatting preserved). The PR head already contained dev through #1575, so the test-merge on a dedicated worktree was trivial: community-index OK (74 entries), `market-build --check` exit 0. The branch policy then blocked the merge because the head's required CI runs sat in `action_required` behind the first-time-contributor gate; approving the CI and agent-notes-guard runs let every required check report honestly, and the merge went through without administrator bypass.
- #1582 (hive-maw / ember-fall / astral-choir skins) is CHANGES_REQUESTED on two items. The blocking one: both astral-choir preview files are byte-identical copies of a screenshot of the contributor's own chat with their coding assistant (87,902 bytes each) — not skin captures — so the third skin has no visual evidence and the PR body's third embedded "try-on" image leaks that conversation. The second: `market-build --check` on the merged tree reports 46 stale `market/dist` paths (the three `assets/skins/` copies, `manifest/skins.json`, `sitemap.xml`, `tryon-assets/skins/*`), so the body's "committed market artifacts" claim is not true of the diff. Everything else was verified passing on the merged tree: `dsh-skin validate` PASS on all three, catalog check OK (38 skins), 97/97 non-font official tokens per skin.css, CTA fill/hover/dimmed/label-foreground declared per theme block, patches whitelist clean (no `rgb()`/`hsl()`/`color-mix`, no `:global`, no hash classes), no performance-rule violations, emoji scan clean, bilingual READMEs plus CC0 LICENSE present, and the hive-maw / ember-fall captures themselves are legible with genuinely distinct edge languages. A non-blocking note asks for distinct light/dark captures on all three skins: light.jpg equals dark.jpg byte-for-byte while every shipped skin (observatory, cyber-night, tokyo-night) ships two distinct captures, and the light capture is what demonstrates the dark-only shell under a light system.

The six carried-over author-blocked PRs (#1576, #1526, #1488, #1479, #1467, #1399) had no commits or replies after their standing reviews; all stay author-blocked. The same two `action_required` workflow runs were approved for #1582 so its checks run while the author prepares fixes.

community.json and the market manifest now carry 74 plugins. No reviewed diff touched the Wallpaper Engine domain files that trigger the collaborator notification.

## Alternatives considered

Regenerating `market/dist` for #1582 immediately and pushing it to the contributor's fork was rejected: the author explicitly asked the maintainer to run that step, but doing it before the astral-choir previews are replaced would bake the wrong image into the committed market artifacts — the rebuild is deferred until the blocking item lands.

Merging #1577 with `--admin` when the base branch policy refused was rejected: the policy block was the first-time-contributor workflow gate, not a failing check, so approving the two stuck runs achieves a fully-honest green instead of teaching the ruleset to be ignored.

Re-reviewing the six author-blocked PRs was rejected: none received commits or replies after their standing reviews, and re-judging identical trees would only duplicate feedback already on record.

## Consequences

origin/dev carries 0c282b026; the workshop plugin listing grows from 73 to 74 entries. Seven PRs remain open: #1582 waiting on its author for real astral-choir captures (after which the maintainer-side `market-build` runs, as offered in the review), and six still author-blocked (#1576 video re-encode, #1526 npm field plus CI/lib, #1488 subcategory, #1479 host-line adaptation, #1467 engines claim, #1399 rebase/LICENSE/llm-pi-ai sourcing). The wrong-file preview also means the contributor's chat sidebar is publicly visible in the PR until replaced. Local housekeeping: the `maint-pr-1577` test-merge branch was deleted after its tree hash proved byte-identical to origin/dev's — `git branch -d` refuses because GitHub's own merge commit hides the ancestry, so the removal went through verify-equivalence-then-delete.

## Testing

#1577 was gated on a dedicated worktree merged from the then-latest `origin/dev`: community-index OK (74 entries) and `market-build --check` exit 0 on the test-merge; the repo's required CI checks passed on the PR head once the approved workflows ran, and the GitHub merge commit 0c282b026 was confirmed on origin/dev. #1582's evidence comes from the merged worktree: `dsh-skin validate` (3x PASS), skin-center catalog check, per-skin token-coverage comparison against `contracts/official-tokens-v1.json` (97/97), whitelist and performance greps, emoji scan, and `market-build --check` whose 46-path staleness report is the recorded finding. The full repo gate suite (typecheck / test / docs:check / i18n:check) was not run this pass — no #1582 merge happened; it runs at that merge's gate.
