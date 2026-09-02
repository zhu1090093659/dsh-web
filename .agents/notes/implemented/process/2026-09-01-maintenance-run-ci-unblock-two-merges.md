# Agent Note: 2026-09-01 maintenance run (CI unblocked, two PRs merged, one blocked)

Status: implemented

## Problem

The scheduled PR-maintenance pass over `zhu1090093659/dsh-web` found eight
open PRs, all assigned to `zhu1090093659`. Five already had a maintainer
`CHANGES_REQUESTED` review with no new commits (#1334, #1333, #1318, #1306,
#1144) and only needed a read-only confirmation. The three unreviewed ones
(#1329 community entry update, #1324 new pet, #1321 community entry) needed
review. Meanwhile every merge gate was frozen: CI on `dev` had been red since
commit `c681332b`, failing in `dsh-session-archive` tests on CI's Node
22.23.2 while passing locally on Node 24/25.

## Decision

- **CI root cause and fix (733712b66, a04ff87a6)**: vitest 4 builds vite's
  external list from the running process's `module.builtinModules`; on Node
  22.23.2 `node:sqlite` is importable but absent from that list, so vite 8's
  jsdom (client) environment errored trying to bundle it. The four host-side
  session-archive specs now run under a file-level
  `// @vitest-environment node` override (the `dsh-perf` pattern), and the
  janitor's projcache scrub write is awaited so a reported delete success
  implies the scrub landed. Verified under portable Node v22.23.2: 77/77
  three consecutive runs, janitor spec 10x (it flaked every other run before
  the await fix).
- **Second CI break found and fixed (7b0cbc709)**: the earlier SDK-cohort
  commits left emoji in
  `.dsh/skills/dsh-sdk-upgrade/scripts/profile-cohort-check.sh` output
  strings, tripping the no-emoji gate. Replaced with plain WARN/FAIL/OK
  prefixes.
- **#1329 (dsh-auto-memory description update): approved and merged
  (rebase, admin) at 48eebf003's parent.** The rebased head's CI failed only
  the market-dist staleness check (`manifest/plugins.json`), a maintainer-
  side gap, not an author error; regenerated the manifest directly on dev
  (d78c1e791) and merged. Follows the standing small-problems maintainer-fix
  policy.
- **#1324 (starry-doll sprite2d pet): approved and merged (48eebf003).**
  Manifest v2 contract, registry test assertions, README bilingual pair with
  sidecar hashes, and market/dist assets all verified consistent.
- **#1321 (dsh-memory index entry): CHANGES_REQUESTED.** Blocking: npm
  package `dsh-memory` already exists (bbnopromo, unrelated SQLite FTS5
  memory plugin), and the store's install path falls back to the entry id,
  so a one-click install would fetch the wrong package; also the PR template
  is incomplete (contribution-evidence check failing). Commented with both
  points.
- **Read-only confirmations**: #1334, #1333, #1318, #1306, #1144 remain
  waiting on their authors (maintainer review already present, no new
  commits); no actions taken per the no-duplicate-review rule.

## Consequences

- `dev` CI is green again (run for 48eebf003: success), so the merge gate
  works for all future PRs.
- Community entry submissions that change `community.json` must include the
  regenerated `market/dist/manifest/plugins.json`; the staleness check
  enforces it and the maintainer can regenerate when the change is trivial.
- Reviewers should verify an entry's `npm` name against the actual registry
  before approval — id/repo fallback in `install-source.ts` makes name
  collisions user-visible install hazards.

## Alternatives considered

- **Leave CI red and judge PRs on content alone**: rejected, the ruleset
  requires green required checks, and every community PR stays blocked.
- **Pin CI's Node to a version whose `builtinModules` contains `sqlite`**:
  rejected in favor of explicit per-file test environments; the CI pin stays
  broad (`node-version: 22`) on purpose.
- **Push the manifest regen commit to the contributor's fork** so the PR head
  goes green before merging: rejected; pushing to forks uses one-off remotes
  and the maintainer-side direct-merge policy covers trivial dist regen
  without another round trip.