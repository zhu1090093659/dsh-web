# Agent Note: PR maintenance run 2026-09-20 (fifteenth pass) — merge whale-mom pet bubble fix, review whale-maid and doro contributions, audit open PR queue

Status: implemented

## Problem

Fifteenth maintenance pass on `zhu1090093659/dsh-web` following the [fourteenth pass](2026-09-19-pr-maintenance-fourteenth-pass.md). Default scope: the 10 open PRs assigned to maintainer account `zhu1090093659` — no Issue scan. Three new PRs arrived: #1640 (whale-mom pet usage bubble contrast fix by DDDMUC), #1631 (Whale Girl / Sea Gaze skin contribution by stushansusu), and #1630 (Doro pet contribution by stushansusu). Seven carried-over PRs (#1626, #1607, #1603, #1526, #1488, #1479, #1399) remained open with standing change requests.

## Decision

Reviewed and merged bug/visual fix PR #1640, reviewed skin contribution PR #1631 and pet contribution PR #1630 submitting CHANGES_REQUESTED for missing licenses and provenance, and verified the remaining 7 PRs in the queue remain author-blocked.

- #1640 (whale-mom pet usage bubble contrast, submitted by DDDMUC): approved and merged.
  1. Root cause: on the light theme, the shell-wide rule `[class*="chipLabel"], [class*="bubble"] { color: var(--dsh-skin-text-strong) }` sets bubble text to near-black (`#05070d`), while dsh-pet's `.bubbleUsage` background is constant dark navy, causing the usage note to become illegible (#1636).
  2. Fix and verification: appends `[data-dsh-pet-root] [class*="bubble"] { color: #f4f7ff; }` in `patches.css`. Static regression assertion added in `tests/whale-mom-pet-bubble-contrast.spec.ts`. All 43 test files in skin-center pass, market dist manifests are synchronized, and before/after screenshots confirm contrast restoration.
  3. Merged into dev via GitHub API and integrated into the local integration branch.

- #1631 (Whale Girl / Sea Gaze skin, submitted by stushansusu): reviewed as CHANGES_REQUESTED.
  1. Content Gate 1 (Evidence): card preview exports provided; advised adding in-situ chat UI screenshots.
  2. Content Gate 2 (Provenance and copyright): blocked. The skin directory `packages/skins/skin-center/skins/whale-maid/` lacks a `LICENSE` file, `skin.json` lacks `license` metadata, and the skin-center README copyright table lacks an entry. Under repository content contribution rules, even personal original assets require an explicit open-source license file (such as CC BY-NC-SA 4.0) before inclusion.
  3. Content Gate 3 (Aesthetic appraisal): passed. Multimodal image evaluation confirmed high-quality cel-shaded illustrations, harmonious light/dark palettes, and readable panel contrast.

- #1630 (Doro pet with wash mode, random roaming, and drag struggle, submitted by stushansusu): reviewed as CHANGES_REQUESTED.
  1. Content Gate 1 (Evidence): 11-track overview, frame strips, and registration evidence provided.
  2. Content Gate 2 (Provenance and copyright): blocked. Doro is a meme/chibi parody of Dorothy from the mobile game *Goddess of Victory: Nikke* (developed by SHIFT UP). The PR attributes it solely as "contributed by stushansusu under MIT" without acknowledging the original character rights holder. Under Gate 2, derivative/fan works require explicit attribution, an entry in `packages/dsh-pet/THIRD_PARTY_NOTICES.md`, non-commercial fan-work disclaimers, and clear ownership statements.
  3. Content Gate 3 (Aesthetic appraisal): passed. Multimodal inspection of the 11 tracks and 802 webp frames confirmed clean alpha transparency and lively character expression.

- Seven carried-over PRs (#1626, #1607, #1603, #1526, #1488, #1479, #1399) confirmed still author-blocked with no new commits:
  1. #1626 (dsh-deepseek-web): blocked on lack of upstream CI and release tags; formatting error in `community.json`.
  2. #1607 (Porco Rosso, Last Exile, White Snake skins): blocked on bundling non-whitelisted binary MP3 files exceeding scale limits and missing in-situ UI screenshots.
  3. #1603 (Paper Ink skin): blocked on missing SIL OFL font license text in `assets/fonts/` and contrast feedback.
  4. #1526 (dsh-round-rightclick): blocked on missing upstream CI/lib and git merge conflicts.
  5. #1488 (dsh-plugin-bwm-friend): blocked on missing `subcategory` causing CI failure, plus merge conflicts.
  6. #1479 (dsh-voice-talk): blocked on boot crash under host 0.1.5-rc.1, plus merge conflicts.
  7. #1399 (dsh-provider-signin): draft PR blocked on missing LICENSE, missing dependency `llm-pi-ai`, and merge conflicts.

## Alternatives considered

Merging PR #1631 on good faith and deferring the LICENSE addition was rejected: Gate 2 explicitly mandates that maintainers must not fill in or endorse provenance on behalf of contributors, and skins cannot be distributed without explicit license text.

Accepting PR #1630 as pure MIT without third-party copyright attribution was rejected: Doro's character identity belongs to SHIFT UP (*Goddess of Victory: Nikke*). Omitting the third-party notice would expose the distribution pipeline to copyright ambiguity, breaking consistency with the Miku pet's Piapro attribution.

## Consequences

One PR (#1640) merged and integrated; two PRs (#1631, #1630) returned with concrete change requests on license and copyright declarations; seven carried-over PRs remain author-blocked. No changes touched Wallpaper Engine core runtime files requiring collaborator notification.

## Testing

Local verification conducted in an isolated worktree (`wt switch --create review-pr-1640 --base origin/dev`):
- PR #1640 test suite: `pnpm --filter @linxin666/dsh-client-ui-skin-center test` (43 files, 661 tests passed, including `whale-mom-pet-bubble-contrast.spec.ts`)
- `node scripts/market-build --check`: OK (tryon verified, dist in sync)
- `node scripts/skin-center-catalog-check --check`: OK (41 repo catalog skins)
- `node scripts/skin-hooks-registry.mjs --check`: OK
- `node scripts/lib-artifact-check.mjs`: OK (4 committed lib packages match fingerprints)
- `pnpm typecheck`: all 22 workspace projects passed
- `pnpm docs:check`: all documentation gates passed
- `pnpm i18n:check`: 17 namespaces, 1438 keys, clean
- Multimodal visual inspection via `read_image`:
  - PR #1631 preview images (`light.jpg`, `dark.jpg`): verified visual quality and palette contrast
  - PR #1630 pet assets (`doro-overview.png`, `doro-struggle.png`): verified animation tracks and transparency
- Integration merge into `dev`: clean rebuild and fingerprint recording via `pnpm build && pnpm libs:write`
- Worktrees cleaned up via `wt remove review-pr-1640` and `node scripts/pr-review.mjs --cleanup`.
