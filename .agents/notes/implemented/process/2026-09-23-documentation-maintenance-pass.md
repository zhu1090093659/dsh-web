# Agent Note: Documentation maintenance run 2026-09-23 — realign the family inventory and the built-in skin count, and file the one-off records

Status: implemented

## Problem

A periodic documentation maintenance pass on `zhu1090093659/dsh-web`, requested in five parts: reconcile the 21 family packages, their versions and the `docs/publish-prep.md` inventory against [scripts/lib/family-packages.mjs](../../../../scripts/lib/family-packages.mjs); check the long-lived documents against the code they describe, with the built-in skin count and the SDK cohort named as examples; find stale drafts, one-off records and temporary research under `docs/` or the repository root and file them into `docs/archive/` per [docs/AGENTS.md](../../../../docs/AGENTS.md); run the documentation and standards gate set; and commit documentation-only changes one at a time, staging only this task's files.

Four drifts were live when the pass started. `docs/publish-prep.md` still pinned `0.3.23` in 23 places while every package and the root aggregate were already `0.3.24`. `docs/architecture.md` stated 38 built-in skins while `packages/skins/skin-center/skins/` holds 42 directories, `market/dist/manifest/skins.json` lists the same 42 ids, and `pnpm skin-center:check` reports 42 catalog skins. Two LiangShen V4.1 records — the presentation-rework record added 2026-09-16 and the Flash optimization record added 2026-09-21 — were still in the long-lived `docs/` tree as one-off design records. And `docs/pr-evidence/` held 24 tracked validation PNGs added between 2026-08-16 and 2026-09-19, a directory the documentation contract does not admit next to the long-lived documents.

## Decision

The family inventory and the version-bearing facts were corrected against the code, not against the previous text.

- `docs/publish-prep.md` moved all 23 `0.3.23` occurrences to `0.3.24` (the prose version line, the 21 table rows, and the command line that pins the version). No package was added or removed: `node scripts/verify-version.mjs 0.3.24` reports that all 21 packages and the root aggregate pin match `v0.3.24`, and the published inventory already listed exactly those 21.
- `docs/architecture.md` corrected the built-in skin count from 38 to 42 in both places that carried it — the prose sentence and the mermaid node — after recounting the catalog three independent ways (42 `skin.json` directories, 42 manifest ids, and the `skin-center:check` output). The neighbouring mermaid claim of `19 个家族子包` was re-verified rather than changed: `packages/dsh-web-all/aggregate.yml` lists exactly 19 `patchFrom` entries (18 packages under `packages/` plus `skins/skin-center`), and `dsh-web-all` and `dsh-client-ui-session-id` are the two of the 21 family packages outside that list.
- Both LiangShen V4.1 records moved into `docs/archive/` with `git mv`, so git keeps them as renames. Only what a move invalidates was rewritten: the community-feedback record's parent-relative links deepened by one level (`../packages/` to `../../packages/`, `../.agents/` to `../../.agents/`), and the backticked inbound references in the two Agent Note pairs that cite them updated from `docs/liangshen-v41-*.md` to `docs/archive/liangshen-v41-*.md`. The Flash record had no parent-relative links and stayed byte-identical.
- The 24 PR evidence PNGs moved into `docs/archive/pr-evidence/`, joining the 11 images already there, and the now-empty `docs/pr-evidence/` directory was removed. One Agent Note pair — the wallpaper-exclusive better-sidebar containment record — was updated to say the images are filed in `docs/archive/pr-evidence` rather than still sitting in `docs/pr-evidence`.
- Every note pair touched by a move had its `.i18n.yaml` sidecar re-recorded with fresh `git hash-object` values, because the sidecar is the machine-checkable statement of pair consistency. Three pairs were updated this way.
- Frozen archive records were left untouched, including `docs/archive/pr-task-board-execution-targets.md`, which names a `docs/pr-evidence/…png` path that was never committed, and `docs/archive/pr-review-1601-wallpaper-exclusive-workbench.md`, whose recommendation to file PR evidence under `docs/archive/pr-evidence/` this pass implemented. Archived notes are snapshots; the pass makes reality match the recommendation instead of editing the historical text.
- Root-level scratch material stayed where it is. `REVIEW-PROMPT.md` (a 2026-08-14 review request for the 0.1.3–0.1.5 range) is git-ignored by [.gitignore](../../../../.gitignore), carries no inbound reference, and has no tracked counterpart, so moving it into the docs tree would produce no committable change; `gui-test-screenshots/` and `test-results/` are ignored in the same way. Removing local scratch data is not authorized by a documentation maintenance request.

The pass landed as four documentation commits on `dev` — `f8e26404`, `72231df6`, `cc5912a5`, `655ebdf9` — with this note recording the pass, and none of them was pushed.

## Alternatives considered

The whole `docs/pr-evidence/` directory could have been split by date, keeping the most recent screenshots in `docs/` as "current evidence" and archiving the rest. Rejected: the contract gives `docs/` no recency exception, all 24 images are the same kind of PR-attached one-off validation snapshot, and a date-based split would need a rule that no document owns.

The two LiangShen records could have been rewritten or retitled to announce their archived status. Rejected: archiving is freeze-by-move; the only edits a move justifies are the ones that would otherwise break a link or a recorded fact.

The stale path mention in `docs/archive/pr-task-board-execution-targets.md` and the recommendation in `docs/archive/pr-review-1601-wallpaper-exclusive-workbench.md` could have been corrected in place. Rejected: archived records are frozen historical snapshots, and the pass leaves the cosmetically stale mention rather than rewriting history for a path that was never committed.

The seven long-lived documents could have been re-audited wholesale, with every version string regenerated from `package.json`. Rejected as YAGNI: the pass checked the specific claims the request named and the ones a version bump can falsify, and the remaining documents (`plugins.md`, `development.md`, `telemetry.md`, `i18n.md`, `multi-agent-resources.md`, `AGENTS.md`) carry no skin count and no stale cohort claim.

The record could have been folded into the concurrent nineteenth PR maintenance pass note written in the same shared checkout. Rejected: that note owns PR alignment onto `dev` across contributor forks, a different decision with a different owner, and a shared slug would make two unrelated passes look like one record.

## Consequences

`docs/` now contains only the long-lived documents (`AGENTS.md`, `architecture.md`, `development.md`, `i18n.md`, `multi-agent-resources.md`, `plugins.md`, `publish-prep.md`, `telemetry.md`) plus the asset directories, `release-notes/`, and `archive/`; every one-off record found by the pass has a home under `docs/archive/`. Readers of the moved LiangShen records reach them through the archive path, and inbound references and pairing sidecars agree with the new locations.

The cost is that three Agent Note pairs were edited outside their own topic, purely to keep the moved paths and pairing hashes truthful; a future move of an archived record has the same ripple. The gate set does not close this: `pnpm docs:check` does not scan `.agents/notes`, so the pairing sidecars and the note-link depth are enforced by convention and were verified by hand here, and no gate compares the built-in skin count quoted in prose against the catalog, so `docs/architecture.md` drifting back to a stale number would not fail CI. That drift class — a doc fact that no gate owns — remains the pass's named coverage gap.

## Testing

The full documentation and standards set was run after the changes, and every gate exited 0.

- `pnpm docs:check`: `verify-docs: all documentation gates passed`.
- `pnpm i18n:check`: `[i18n-audit] OK: 17 namespaces, 1435 zh keys, 1435 ru keys, 2 exemption(s), 41 host-half warning(s)`.
- `pnpm emoji:check`: `[emoji-audit] OK: 3053 hand-written file(s) scanned, no pictographs`.
- `pnpm aggregate:check`: `check OK: packages/dsh-web-all (20 row(s), 19 dep(s), 16 client child(ren))`.
- `pnpm market:check`: `tryon/ verified against hash manifest (756 files)` and `dist up to date (3230 files)`.
- `pnpm skin-center:check`: `check OK (42 repo catalog skins; package ships blue-fantasy only)`.
- `pnpm libs:check`, `pnpm community:check` (119 entries), `pnpm sync-shared:check`, and `pnpm runtime-deps:check` (4 scanned packages) all passed.
- Move integrity: after both archive moves `git status` showed the tracked files as renames, `docs/pr-evidence/` had no remaining entries, and the same `pnpm docs:check` gate was re-run green.

Not verified: no GUI or rendering behavior was exercised, since the pass changes documentation only. Nothing was pushed, so `origin/dev` does not yet carry these commits. The pairing and link rules under `.agents/notes` were checked by hand and by `git hash-object`, not by a gate. The stale `docs/pr-evidence/…png` mention inside the frozen `docs/archive/pr-task-board-execution-targets.md` is knowingly left in place.