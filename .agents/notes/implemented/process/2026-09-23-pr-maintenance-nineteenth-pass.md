# Agent Note: PR maintenance run 2026-09-23 (nineteenth pass) — align all 16 assigned external PRs onto the 0.1.7-alpha.2-adapted dev

Status: implemented

## Problem

Nineteenth maintenance pass on `zhu1090093659/dsh-web`, following the [eighteenth pass](2026-09-21-pr-maintenance-eighteenth-pass.md). The requested scope was the default one — the open PRs assigned to maintainer account `zhu1090093659`, no Issue scan — with one added constraint: `dev` had been adapted to the 0.1.7-alpha.2 host cohort and had accumulated substantial changes, so every externally contributed PR was to be aligned onto the current `dev` before its state could be assessed. Sixteen open assigned PRs existed; not one of them had been branched from a commit that `dev` still pointed at, and five carried conflicts.

The alignment rather than a review verdict was the deliverable here. No PR's review state was to change: several carried unanswered change requests from earlier passes, and `#1399` is still a draft.

## Decision

All sixteen PRs were aligned onto `dev` by merging `origin/dev` into the PR head and pushing the resulting merge commit back to the contributor's fork with a normal, non-force push. The alignment base is `fea8333c`, the `dev` commit recording the 0.1.7-alpha.2 compatibility scan, which was still local when the pass started and was pushed to `origin/dev` first; the thirteen PRs aligned before that push used its ancestor `4a573867`, which is a valid `dev` commit.

- Fifteen PRs needed only a merge; thirteen of them merged cleanly-enough that git resolved most files itself, and the conflicted files were always generated artifacts.
- The four skins/pets PRs (`#1679`, `#1671`, `#1603`, `#1607`) additionally needed their committed build output refreshed: the merged sources made their committed `lib/` and `market/dist` stale relative to what they ship.
- `#1666` needed `pnpm install --frozen-lockfile` in its worktree before the market build would run at all, because the worktree's committed `lib/` had been built against an older zod cohort and `scripts/market-build` died with `z.…volatile is not a function`.
- Conflicts were resolved by regeneration, never by hand-editing a generated file:
  - `packages/dsh-community-plugins/community.json` — the union of dev's 119 entries and the PR's new entry. Where git auto-merged the file it was validated and repaired to exactly `dev + pr_new`; where it conflicted the stage-2/stage-3 blobs were combined the same way. 1666, 1626, 1526, 1488, 1479 and 1399 each contributed one new id (`dsh-attention-health`, `dsh-deepseek-web`, `dsh-round-rightclick`, `dsh-plugin-bwm-friend`, `dsh-voice-talk`, `dsh-provider-signin`).
  - `market/dist` (`manifest.js`, `manifest/*.json`, `styles.js`, `sitemap.xml`) — `git checkout origin/dev -- market/dist`, then `node scripts/market-build` from the merged sources.
  - four packages' committed `lib/` and `scripts/lib-artifact-fingerprints.json` — `pnpm build`, then `node scripts/lib-artifact-check.mjs --write`, then `node scripts/market-build`. `#1671` and `#1603` conflicted on the fingerprint file itself.
- Two records from earlier comments in this pass were wrong and were corrected on the PRs: `#1607`'s `pnpm libs:check` failure and `#1679`'s `pnpm market:check` failure had been reported as pre-existing contributor defects, but both were the staleness the alignment itself creates, and both went green once the artifacts were regenerated and the refreshed output pushed (`#1607` `6aa228f2`, `#1679` `1235915b`).
- Each PR received one Chinese comment stating the base commit, the merge commit, which files were regenerated, which gates pass, and that no force push was used. Where a comment had recorded a failure that the follow-up fixed, a second comment corrected the record rather than leaving the stale claim standing.
- Review state was deliberately left untouched. Twelve PRs still show `CHANGES_REQUESTED` or `REVIEW_REQUIRED` as before, `#1399` is still a draft, and no verdict, approval or closure was issued in this pass.

## Alternatives considered

Rebasing each PR onto `origin/dev` was rejected: it rewrites the contributor's commits and therefore requires a force push to the fork, which this repository's contributor-fork rules forbid; a merge commit keeps the original commits intact, is reviewable as one diff against the previous head, and lets the contributor pull normally.

Resolving the conflicted generated files by hand — taking dev's `market/dist` and stopping there, or editing `community.json`'s JSON directly without validating the result — was rejected: those files are byte-derived from sources the checks re-derive, so a hand edit either fails `market:check` or silently desynchronizes the committed artifact from the source it claims to represent.

Aligning only the five conflicting PRs, which is what the conflict report alone would suggest, was rejected: the eleven non-conflicting heads still carried committed artifacts built before `dev`'s changes, and `#1607`/`#1679` proved that a clean merge can still leave a gate failing.

Leaving the stale `lib/` on `#1607` because its `libs:check` failure existed before the merge was rejected once the regeneration route was known to work: the failure is the PR's own committed output not matching its sources, the pass exists to make each PR mergeable and assessable, and regenerating it is exactly the step the repository requires before such a PR is merged.

Bumping the SDK cohort to 0.1.7-alpha.2 in this pass was rejected: the registry's `alpha` tag does publish `0.1.7-alpha.2`, but a cohort change is the authorized `dsh-sdk-upgrade` process with its own review and rollout, not a side effect of aligning contributor branches.

## Consequences

Sixteen contributor branches now carry a merge commit from `dev` (`fea8333c`, or its ancestor `4a573867` for the thirteen aligned earlier in the pass) and report `MERGEABLE` on GitHub. Their authors can pull with a plain `git pull`, with no history rewrite to reconcile.

The four skins/pets PRs are now internally consistent — their committed `lib/`, `market/dist` and fingerprints match the sources they ship — so the content gate that is still owed on them (`#1679`, `#1671`, `#1603`, `#1607`) now only has to judge the content: the repository's Local Feature Evidence, third-party copyright source declaration and aesthetic review requirements. Their earlier staleness findings are closed.

Nothing in this pass changed a review verdict, so the nine PRs standing on unanswered change requests and the one draft remain author-blocked exactly as the eighteenth pass left them.

One environment fact was confirmed and is recorded here rather than acted on: this repository's own SDK cohort is pinned at `0.1.7-alpha.1` (`package.json` declares `^0.1.7-alpha.1` for the whole `@deepseek-ai/dsh-*` set, `pnpm-lock.yaml` resolves `0.1.7-alpha.1`, and `node_modules/@deepseek-ai/dsh-agent` is `0.1.7-alpha.1`), while the running host application is `0.1.7-alpha.2` and pins its own dependencies at `0.1.7-alpha.2`; the registry's `alpha` dist-tag is `0.1.7-alpha.2`. So "adapted to 0.1.7-alpha.2" describes the source-level compatibility work recorded in `docs/archive/`, not the installed cohort, and the caret range would resolve to `alpha.2` on a lockfile-refreshing install.

A supersession check across `.agents/notes/implemented/` found no note that owns the procedure this pass applied. The closest record is the [sixteenth pass](2026-09-20-pr-maintenance-sixteenth-pass.md), which resolved generated-artifact conflicts by regeneration when integrating `origin/dev` into local `dev`; this pass reuses that mechanism and extends it to contributor-fork branches, so the two notes are cross-linked rather than consolidated, and no earlier note is superseded.

This pass's note commit is left local, following the eighteenth pass: every alignment reached the contributor forks through GitHub, and the current request asked for PR alignment, not for publishing the note.

## Testing

Every PR was handled in its own `wt` worktree created off the main checkout, with `git fetch origin refs/pull/<n>/head` as the source, so the shared `dev` checkout was never switched.

Authoritative state after the pass, from `gh pr view` / `gh pr list` (not from local logs): all sixteen PRs `state=OPEN`, `mergeable=MERGEABLE`, each `headRefOid` equal to the merge commit pushed in this pass.

| PR | fork branch | merge commit | base | gates after alignment |
| --- | --- | --- | --- | --- |
| 1679 | Yuji6278 dev | `1235915b` (repair) | `4a573867` | three gates pass |
| 1671 | Sddft97 feat/skin-verdandi | `60cb042d` | `fea8333c` | three gates pass |
| 1603 | JinFuLee feat/skin-paper-ink | `97ee6766` | `fea8333c` | three gates pass |
| 1607 | binlecode feat/add-skins-porco-exile-snake | `6aa228f2` (repair) | `4a573867` | three gates pass |
| 1399 | chunjin666 feat/community-register-provider-signin | `44fd585b` | `fea8333c` | three gates pass |
| 1666 | donghangxunlang-cmd add-dsh-attention-health | `ea6cc71d` | `4a573867` | market:check pass |
| 1626 | zgrajdnhj7806-svg feat/community-dsh-deepseek-web | `d82c43fa` | `4a573867` | market:check pass |
| 1526 | hmr-BH add-hmr-bh-dsh-round-rightclick | `d1d959ed` | `4a573867` | market:check pass |
| 1488 | Lawrencezeng818 community/register-bwm-friend | `24486fa8` | `4a573867` | market:check pass |
| 1479 | duoduoqian708 feat/community-voice-talk | `7402be0e` | `4a573867` | market:check pass |
| 1685 | DDDMUC fix/whale-mom-plugin-page-readability | `01e43688` | `4a573867` | market:check pass |
| 1684 | tr1v3r feat/community-dsh-ltm | `6990e5da` | `4a573867` | market:check pass |
| 1681 | PerryLink add-perrylink-dsh-laya | `e5399011` | `4a573867` | market:check pass |
| 1673 | zhy5 feat/community-plugins-dsh-wx-bridge | `65bd495a` | `4a573867` | market:check pass |
| 1659 | aklnaaw feat/skin-claude | `d4e84dd2` | `4a573867` | market:check pass |
| 1658 | mengge237 community-dsh-model-priority | `549a6da5` | `4a573867` | market:check pass |

Per-PR evidence:

- `#1671`: conflicted only on `scripts/lib-artifact-fingerprints.json`; after `pnpm build` + `libs:write` + `market-build`, `market:check` reported `dist up to date (3264 files)`, `skin-center:check` `OK (43 repo catalog skins)`, `libs:check` `OK (4 committed lib/ packages match their sources)`; the diff against `dev` is the new `verdandi` skin (assets, `skin.css`, `patches.css`, `skin.json`, previews), its `market/dist` copy and the refreshed fingerprints.
- `#1603`: conflicts on `market/dist/manifest.js`, `manifest/skins.json`, `sitemap.xml`, `styles.js`; same regeneration; `3268` files, `43` skins, `libs:check` `OK`; the diff against `dev` is the new `paper-ink` skin and its `market/dist` copy.
- `#1399` (draft): conflicts on `market/dist/manifest.js`, `manifest/{pets,plugins,skins}.json` and `community.json`; the community conflict resolved by union to `dev`'s 119 entries plus `dsh-provider-signin`; `market:check` `dist up to date (3230 files)`, `42` skins, `libs:check` `OK`; the entire diff against `dev` is `manifest/plugins.json` (+12) and `community.json` (+11).
- `#1607`: before repair `market:check` passed (`3280` files) and `libs:check` failed; after `pnpm build` + `libs:write` + `market-build`, all three gates passed and the commit `6aa228f2` was pushed.
- `#1679`: before repair `market:check` failed with `market/dist stale — … assets/skins/endfield-baker/patches.css, styles.js, tryon-assets/skins/endfield-baker/patches.css` while `skin-center:check` and `libs:check` passed; after regeneration all three passed (`3253` files) and `1235915b` was pushed.
- `#1666`: the market build initially crashed inside `scripts/market-build` on `z.number(...).volatile is not a function` at the worktree's committed `packages/skins/skin-center/lib/index.js`; `pnpm install --frozen-lockfile` in the worktree replaced the mismatched cohort and the same build then reported `dist up to date (3230 files)`. The remaining diff against `dev` is `manifest/plugins.json` (+12) and `community.json` (+11).
- The twelve community-only PRs were verified with `node scripts/market-build --check` (`dist up to date (3230 files)` on each) plus `gh pr view` for head and mergeable state.

Not verified: no aligned PR was mounted in the running GUI, so nothing here is evidence about runtime behaviour; the skins/pets content gate on `#1679`, `#1671`, `#1603` and `#1607` is still owed; the twelve community-only PRs did not get a full `lib/` rebuild because none of them touches a package whose `lib/` is committed; and no PR was merged.