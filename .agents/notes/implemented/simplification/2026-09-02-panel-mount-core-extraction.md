# Agent Note: One center-column panel-mount core for ssh and task-board

Status: implemented

## Problem

dsh-ssh `src/client/mount.tsx` and dsh-task-board `src/client/board-mount.tsx` each carried the full center-column takeover lifecycle — container injection into the single-occupant conversation column, sibling eviction, remount resilience, sidebar click-out — and the two copies were ~100 of ~130 lines identical modulo seven parameters (panel tree, view dataset key, semantic plugin name, CSS class, the two html active attributes, event detail names, controller open/close). The duplication was not hypothetical cost: the same behavioral fixes landed twice, as separate issues and commits — the rc.6 centerCol fallback as #243 (ssh, 61153871f) and #107 (task-board, 2ea4f965a), mutual exclusion and sidebar click-out as c0a98c715 (both files), the SDK locale routing as 170b3df31 (both), and the L2 semantic attributes as d73bffc2a (both). The sidebar-entry pair had already moved its shared logic into `shared/client/sidebar-entry-core.ts` (synced copy); the mount pair never got the same treatment.

## Decision

The takeover lifecycle now lives exactly once in `shared/client/panel-mount-core.ts`: `mountCenterPanel(options)` owns the column selector, the MutationObserver remount, the eviction-and-activate sequence, the sidebar click-out listener, and the disposer order; the `CenterPanelMountOptions` contract carries the seven per-plugin parameters plus the controller subscribe and the optional locale source. The file joins the sync-shared manifest with two generated copies (`packages/dsh-ssh/src/client/panel-mount-core.ts`, `packages/dsh-task-board/src/client/panel-mount-core.ts`); the sync-shared test's copy-count buckets move 112→114 total and 41→43 client. Both wrappers shrink to the parameter wiring (~45 lines each) and keep their public exports (`mountPanel` + `PANEL_VIEW_SELECTOR`, `mountBoard` + `BOARD_VIEW_SELECTOR`), so consumer code and tests are untouched. The rebuilt aggregate client bundle (`packages/dsh-web-all/lib/client.js`) ships the same behavior inlined from source.

Container attribute names stay wrapper-supplied parameters: they are pinned by each package's CSS (`panel.module.css` / `board.module.css` cross-reference the sibling's html attribute), the wallpaper-exclusive skin patches, and the semantic-attributes contract, so the extraction deliberately changes none of them.

## Testing

Both packages' suites pass unchanged in the isolated worktree: dsh-ssh 20 files / 150 tests, dsh-task-board 33 files / 314 tests (+1 skipped), including the `mountPanel` (panel-shell, #506) and `mountBoard` (board-view, #506/#1233) lifecycle specs that exercise eviction, remount, and click-out through the extracted core. Workspace gates: `pnpm -r typecheck` (22 projects), full `pnpm -r test`, `node --test scripts/*.test.mjs` 238/238, `node scripts/sync-shared.mjs --check`, `node scripts/aggregate.mjs --check`, `verify-docs`, and `i18n-audit --check` all pass.

## Alternatives considered

- Leave the duplication and rely on review to keep the copies in sync: rejected — the four-tandem-fix history above shows review does not catch it; the next fix lands twice or the copies drift.
- Extract a runtime npm package imported by both plugins: rejected — client bundles must stay self-contained per the browser bundle purity rules; the sync-shared committed-copy pattern is the repo's established mechanism (same as the settings trio and sidebar-entry-core).
- Parameterize only the attribute names but keep two `ensure`/observer implementations: rejected — the remount and eviction logic is exactly the part that needed the paired fixes; a half-extraction keeps the risky half duplicated.

## Consequences

A future behavioral fix to the takeover lifecycle lands once in `shared/client/panel-mount-core.ts` plus a `node scripts/sync-shared.mjs` run. A third panel adopting the takeover pattern adds a generated copy and a wrapper instead of copying 100 lines. Raw committed line count rises slightly (one shared source plus two generated copies) — the accepted sync-shared trade: single editable source, self-contained packages. Behavior, CSS selectors, html attributes, event names, and the semantic-attributes contract are unchanged; [the remount-resilience fix](../../bug-fix/2026-08-27-task-board-return-button-and-remount-resilience.md) is now carried by the one core.
