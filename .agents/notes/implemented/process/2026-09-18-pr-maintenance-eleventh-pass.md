# Agent Note: PR maintenance run 2026-09-18 (eleventh pass) — three merges: dsh-workbench, island-life, and remiel-starlit

Status: implemented

## Problem

Eleventh maintenance pass on `zhu1090093659/dsh-web`, two days after the [tenth pass](2026-09-16-pr-maintenance-tenth-pass.md). Default scope: the 12 open PRs assigned to the maintainer account — no Issue scan. Four PRs were carried over from earlier passes and author-blocked (#1526, #1488, #1479, #1399). Eight new PRs awaited initial review: two community plugin index registrations (#1620, #1602) evaluated against the mandatory three-axis standard (practicality, stability, compatibility), and six skin submissions (#1603, #1607, #1608, #1614, #1616, #1617) evaluated against the content contribution gates (visual evidence, copyright/licensing provenance, and aesthetic review).

## Decision

Three PRs merged, five PRs reviewed as CHANGES_REQUESTED, four carried-over PRs confirmed still author-blocked, six first-time-contributor workflow runs approved to allow honest green CI reports.

- #1620 (dsh-workbench, registered by liiydong) merged as 7e24b3e06. Practicality: adds an iteration timeline for AI document generation (Markdown to docx/pdf/xlsx) with build hover-cards and approval state tracking, plus core `ctx.skills` inspection and source/artifact pairing. Stability: zero runtime dependencies, 120/120 local smoke and host-route tests pass, safe path traversal checks on write requests, cleanly scoped to DSH Web >=0.1.5-rc.1. Compatibility: unique `/api/dsh-workbench/` route namespace, official sidebar slot and optional betterSidebar tab registration, clean fiber unmount. The committed manifest matches generator output at rank 77.
- #1608 (island-life, submitted by wertyq111) merged as 84331b4f9. Pure asset directory paying homage to Animal Crossing. Visual evidence: distinct light and dark captures attached in PR body and previews. Copyright: original AI-generated illustration artwork, original cursor, Apache-2.0 license, explicit trademark disclaimer. Aesthetics: high-quality day/night palette harmony, readable contrast, polished 3D button styling.
- #1617 (remiel-starlit, submitted by oh-wang) merged as fbd5f6c22. Pure asset directory based on Zenless Zone Zero. Visual evidence: distinct light and dark GUI captures attached. Copyright: comprehensive NOTICE and LICENSE documenting miHoYo non-commercial fan creation copyright terms and CC BY-NC-SA 4.0 engineering license. Aesthetics: delicate frosted glass styling, high text contrast in both modes.
- #1602 (dsh-ppt-studio, registered by zbsph) reviewed as CHANGES_REQUESTED. Practicality is conceptually sound, but clean clone `npm test` fails with 3 errors (smoke test assertions for referenceTemplate and reference/ copy fail, and doc assertion count verification fails at 209 vs 213); no upstream CI workflow; rank 77 and index tail conflict with #1620.
- #1603 (paper-ink, submitted by JinFuLee) reviewed as CHANGES_REQUESTED. Bundles 27 binary font files (424 KiB) in `assets/fonts/` without required SIL OFL 1.1 license files, copyright notices, or a README "Source and Copyright" section; visual impression is nearly flat monochromatic with obscured brushwork.
- #1607 (porco-rosso, last-exile, white-snake, submitted by binlecode) reviewed as CHANGES_REQUESTED. PR body contains zero visual evidence attachments (only text bullets); bundles commercial copyrighted MP3 OST audio files and commercial animation wallpapers without distributor licensing.
- #1614 (hairline, submitted by stushansusu) reviewed as CHANGES_REQUESTED. Preview captures light and dark are byte-identical; lacks LICENSE/NOTICE files; third-party video material lacks licensing provenance in repo records.
- #1616 (kaleido, submitted by stushansusu) reviewed as CHANGES_REQUESTED. `hooks.mjs` makes outbound runtime requests to external API `https://api.elaina.cat/random/`, bypassing the skin loader's relative-asset sandbox and CSS url whitelist, leaking user activity, and introducing unvetted dynamic external media without verifiable copyright.

The four carried-over PRs (#1526, #1488, #1479, #1399) had no new commits or replies and remain author-blocked.

## Alternatives considered

Merging #1602 with a manual rank increment was rejected: upstream smoke tests fail in a clean checkout, and stability cannot be certified until upstream fixes the broken assertions and provides a green CI gate.

Approving #1616 under the assumption that hooks are an open-ended escape hatch was rejected: loading dynamic external images via runtime `new Image()` breaks the offline guarantee, leaks user network requests, bypasses the CSS whitelist and path checks, and violates the content copyright gate.

Overlooking missing font licenses in #1603 was rejected: bundling third-party font binaries in the npm distribution without OFL license text violates both SIL OFL 1.1 redistribution requirements and repository content gate 2.

Bypassing CI runs with admin permissions was rejected: approving the first-time contributor workflow runs allowed honest green CI checks across all three merging PRs.

## Consequences

origin/dev carries 7e24b3e06 (#1620), 84331b4f9 (#1608), and fbd5f6c22 (#1617). The catalog now lists 77 plugins and 43 skins. Nine PRs remain open (#1602, #1603, #1607, #1614, #1616, #1526, #1488, #1479, #1399), all author-blocked with standing reviews. No reviewed diff touched the Wallpaper Engine domain files that require collaborator notification.

## Testing

All three merged PRs passed required repository CI checks on GitHub Actions: CI checks (lint, typecheck, test, test:scripts, docs:check, i18n:check, emoji:check, market:check), agent-notes-guard, plugin-mount, and PR contribution rules. Local test integration on an isolated worktree verified `node scripts/community-index --check` (77 entries), `node scripts/market-build --check` (dist up to date, 2347 files), `pnpm test:scripts` (291/0), `pnpm skin-center:check` (40 catalog skins), `dsh-skin validate` on new skins, and visual inspection of all preview and backdrop images. All merges and review states confirmed through the GitHub API.
