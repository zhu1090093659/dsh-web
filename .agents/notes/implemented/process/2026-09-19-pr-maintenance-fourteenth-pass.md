# Agent Note: PR maintenance run 2026-09-19 (fourteenth pass) — re-review porco-rosso skin contribution and audit open PR queue

Status: implemented

## Problem

Fourteenth maintenance pass on `zhu1090093659/dsh-web` following the [thirteenth pass](2026-09-18-pr-maintenance-thirteenth-pass.md). Default scope: the 7 open PRs assigned to maintainer account `zhu1090093659` — no Issue scan. Carried-over skin contribution PR #1607 (Porco Rosso, Last Exile, White Snake by binlecode) received commits 0f581d0f and 38f3e9dc responding to prior review feedback, syncing `dev`, and replacing commercial anime OSTs with public-domain classical piano recordings. Six carried-over PRs (#1626, #1603, #1526, #1488, #1479, #1399) remained open with standing change requests.

## Decision

Re-reviewed PR #1607 and submitted CHANGES_REQUESTED; verified the remaining 6 PRs in the queue remain author-blocked.

- #1607 (Porco Rosso, Last Exile, and White Snake skins, submitted by binlecode) re-reviewed as CHANGES_REQUESTED (review ID 5254413743). Evaluated against repository rules and the mandatory content contribution gates:
  1. Content Gate 1 (Local feature evidence): blocked. The PR description's "Local Feature Evidence" section linked raw wallpaper background images (`preview/light.jpg`, `preview/dark.jpg`) rather than real DSH Web GUI in-situ screenshots displaying sidebar, chat streams, inputs, and components under the skins.
  2. Binary Whitelist and Scale Limit: blocked. Bundling 6 MP3 audio files (and 6 duplicate dist copies, totaling >22 MB) violates the repository binary whitelist (`scripts/pr-review.mjs` `ALLOWED_BINARY_EXT` allows only images, fonts, pdf, zip, gz). Binary audio and generated dist inflated the PR to 17,320 lines (+17,320/-6), exceeding the 10,000-line change ceiling. Furthermore, DSH Web skins are purely visual theme asset packs; bundling local audio playback and embedded vinyl players in `hooks.mjs` exceeds skin scope. Guided contributor to strip all MP3 files and player hooks, and regenerate market manifests.
  3. Content Gate 2 (Provenance and copyright): met. `NOTICE` and `LICENSE` (CC BY-NC-SA 4.0) properly state source attribution and clarify that code is open source while original anime imagery remains with rights holders.
  4. Content Gate 3 (Aesthetic appraisal): passed. Direct multimodal inspection of previews for all three skins confirmed high visual quality, well-proportioned compositions, harmonious color palettes, and contrast ratios (>14:1) meeting WCAG standards.
- Six carried-over PRs (#1626, #1603, #1526, #1488, #1479, #1399) confirmed still author-blocked with no new commits:
  1. #1626 (dsh-deepseek-web): blocked on lack of upstream CI and release tags; formatting error in `community.json`.
  2. #1603 (Paper Ink skin): blocked on missing SIL OFL font license text in `assets/fonts/` and contrast feedback.
  3. #1526 (dsh-round-rightclick): blocked on missing upstream CI/lib and git merge conflicts.
  4. #1488 (dsh-plugin-bwm-friend): blocked on missing `subcategory` causing CI failure, plus merge conflicts.
  5. #1479 (dsh-voice-talk): blocked on boot crash under host 0.1.5-rc.1, plus merge conflicts.
  6. #1399 (dsh-provider-signin): draft PR blocked on missing LICENSE, missing dependency `llm-pi-ai`, and merge conflicts.

## Alternatives considered

Accepting PR #1607 because the replacement classical piano tracks are public domain was rejected: the restriction on audio in the skin center is structural rather than purely copyright-based. Storing multi-megabyte binary audio in git inflates repository clones permanently, violates the repository's binary whitelist in `scripts/pr-review.mjs`, and triggers the 10,000-line scale gate. Skins are visual themes; audio players belong in dedicated media plugins if at all.

Silently merging PR #1607 without real DSH Web GUI in-situ screenshots was rejected: Gate 1 explicitly requires evidence of the theme applied to the actual UI to prevent unreadable text, broken layout, and panel contrast regressions. Linking raw wallpaper images does not satisfy this gate.

## Consequences

No PRs were merged in this pass; all 7 open PRs assigned to `zhu1090093659` remain open and author-blocked with documented change requests on GitHub. No changes touched Wallpaper Engine core runtime files requiring collaborator notification.

## Testing

Local verification conducted in an isolated worktree created via `wt switch --create review-pr-1607 --base origin/dev`:
- Merge simulation of `refs/pull/1607/head` into `origin/dev`: clean merge with ort strategy
- `node scripts/dsh-skin validate packages/skins/skin-center/skins/{porco-rosso,last-exile,white-snake}`: PASS
- `node scripts/skin-hooks-registry.mjs --check`: OK
- `pnpm skin-center:check`: OK (44 repo catalog skins)
- `node scripts/market-build --check`: OK (tryon verified, dist in sync)
- `pnpm test:scripts`: 291/291 pass
- `pnpm docs:check`: all documentation gates passed
- `pnpm i18n:check`: 17 namespaces, 1442 keys, clean
- `node scripts/pr-review.mjs --skip-build 1607`: REJECT on non-whitelisted binary (`.mp3`) and line addition count (>10,000 lines)
- Multimodal aesthetic inspection using `read_image` on all 6 skin preview images: PASS
- Worktree and temporary branch cleaned up via `wt remove review-pr-1607`
All review and PR states verified via GitHub API.
