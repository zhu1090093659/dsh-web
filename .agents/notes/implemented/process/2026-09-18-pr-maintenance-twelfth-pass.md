# Agent Note: PR maintenance run 2026-09-18 (twelfth pass) — merge dsh-ppt-studio and hairline author guidance

Status: implemented

## Problem

Twelfth maintenance pass on `zhu1090093659/dsh-web` following the [eleventh pass](2026-09-18-pr-maintenance-eleventh-pass.md). Default scope: the 8 open PRs assigned to maintainer account `zhu1090093659` — no Issue scan. Two PRs (#1602, #1614) received substantial author follow-ups responding to the eleventh pass reviews: community plugin registration #1602 addressed upstream clean-clone failures and rank sequencing, and skin submission #1614 addressed light-mode previews while seeking guidance on unverified third-party video licensing. Six PRs (#1607, #1603, #1526, #1488, #1479, #1399) remained author-blocked without updates.

## Decision

One PR merged, one PR reviewed with updated guidance as CHANGES_REQUESTED, six carried-over PRs confirmed still author-blocked.

- #1602 (dsh-ppt-studio, registered by zbsph) merged as 0ec3c3a3e. Evaluated against the mandatory three-axis standard:
  1. Practicality: introduces a dedicated deck engineering workflow (PPTD intermediate layer, 21 `ppt_*` tools, 4 bundled skills, agent preset) covering element collision elimination, single-page splice editing with byte-identical retention of other pages, and real Office COM spot checks, complementing existing document generation tools without duplicate surface.
  2. Stability: upstream resolved clean-clone assertions in `scripts/smoke.mjs` (handling environments lacking Office COM), fixed Windows CRLF line-ending regex regressions, established dual-platform GitHub Actions CI passing 245/245 assertions on Ubuntu and Windows, and published `v1.0.2` with release tarball assets.
  3. Compatibility: cleanly sequenced at rank 78 in `community.json` and `plugins.json`; author clarified deployment scope (default profile bundle via one command + opt-in session isolation via `--isolate`); all repository CI gates (CI checks, plugin-mount, agent-notes-guard, desktop tests) and local gates passed cleanly.
- #1614 (hairline, submitted by stushansusu) reviewed as CHANGES_REQUESTED. The light-host rendering preview update in `07eda3e7` satisfied visual evidence requirements. However, the contributor's NOTICE and comments acknowledged that the third-party background video (`assets/water-line-dark.mp4` from 哲风壁纸) has no identifiable rights holder, lacks licence documentation, and that the "freely distributed / no authorization required" claim cannot be verified. Guided the author to adopt their suggested procedural programmatic water loop under CC0 to remove unverified third-party assets.
- Six carried-over PRs (#1607, #1603, #1526, #1488, #1479, #1399) remain author-blocked with standing reviews.

## Alternatives considered

Accepting #1614 with a contributor disclaimer in NOTICE was rejected: content contribution gate 2 explicitly requires verified licenses and rights provenance for third-party media in repository records; self-declared lack of authorization cannot substitute for licensing documentation.

Deferring #1602 merge pending additional review was rejected: the contributor completely addressed every defect raised in the eleventh pass (clean-clone tests, CI workflow, rank conflict, deployment clarity), and all repository automated checks and manual validations passed without regression.

## Consequences

origin/dev carries 0ec3c3a3e (#1602). The workshop catalog now indexes 78 plugins and 43 skins. Seven PRs remain open (#1614, #1607, #1603, #1526, #1488, #1479, #1399), all author-blocked with formal reviews recorded. No reviewed changes touched files in the Wallpaper Engine domain requiring collaborator notification.

## Testing

PR #1602 passed all GitHub Actions CI checks on commit 8dc586a: CI checks (lint, typecheck, test, test:scripts, docs:check, i18n:check, emoji:check, market:check), agent-notes-guard, plugin-mount, and Desktop unit tests (Windows). Local verification in an isolated worktree confirmed `node scripts/community-index --check` (78 entries), `node scripts/market-build --check` (dist up to date, 2347 files), `pnpm test:scripts` (291/0), `node scripts/emoji-audit.mjs` (0 violations), `pnpm docs:check`, and `pnpm i18n:check`. Upstream `zbsph/dsh-ppt-studio` actions confirmed green CI runs on Ubuntu and Windows. All merge and review statuses confirmed via the GitHub API.
