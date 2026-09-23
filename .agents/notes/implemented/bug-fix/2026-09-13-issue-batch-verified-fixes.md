# Agent Note: 2026-09-13 issue batch — seven verified fixes

Status: implemented

## Problem

On 2026-09-12 the tracker gained thirteen new issues. Triage against `dev` (`d56328c7`) read every cited source location instead of trusting the report: two had already been fixed by the maintainer (#1500, #1501), one cannot happen, one needs GUI evidence, one is a feature request, and the remaining seven are real and reachable. Those seven are fixed here, each local to the package that owns the defect.

## Decision

1. Session archive size sort (#1503): `core/selection.ts` treats a missing `sizeBytes` like the time keys — unknown last in either direction — instead of substituting `-1`, which sorted unknown rows first ascending and last descending.
2. Session archive skip list (#1504): `core/cascade.ts` `planDelete` records each skipped id once through a `skippedIds` set, and a directly selected protected id keeps its own reason rather than the coarser `family-protected` entry. Duplicates had inflated the confirm-dialog count, repeated rows in the result list, and left the batch progress bar short of its total because the store deduplicates by id while `total` counted the duplicates.
3. Pet ornament timing (#1506): `client/PetSprite.tsx` re-reads `decoration.durations[index]` after every catch-up step, so both the subtraction and the next wake use the frame the tick landed on. The built-in whale ornament uses one duration for every frame, but the decoration contract and parser accept a per-frame `durations` array.
4. Auto isolation (#1507): `client/auto-isolation.ts` keeps a per-target in-flight set that absorbs a second `startSession` while the first is routing (the sidebar button has no disabled state and the official `startSession` is fire-and-forget), and the rollback drops the workspace registration through the optional `workspaces.delete` before removing the worktree directory, so a failed start no longer leaves a workspace row pointing at a deleted path.
5. Describe-image orphan attachments (#1508): `client/send-hook.ts` reads every file before uploading any, so a local read failure returns to the original send with nothing stored on the host. Upload failures can still strand earlier uploads: the official attachment service exposes no delete and never collects unreferenced objects.
6. Ice-princess tooltip (#1515): the skin sets a dark tooltip chip (`--dsw-alias-tooltip-bg: #1d315a`, `--dsw-alias-tooltip-fg: #eaf3ff`) in both theme blocks. The official tooltip paints its label with the static white `--dsw-static-neutral-bluish-00`, so a light background makes every hint unreadable and the skin's own `-fg` token is inert.
7. Remote access hint (#1517): `status.lanRequiredHint` names the surface the LAN toggle actually lives on (Settings → Web Plugins → Remote access) in zh, en, and mirrored ru, instead of pointing at a settings card that does not exist inside the pairing panel.
8. Collapsed rail versus the settings dialog (#1510): the official settings panel renders inside the sidebar foot, which the aggregate's narrow-screen collapse rule hides (`display: none !important`) while the collapsed pane also sets `pointer-events: none`. The responsive shell now restores exactly the sidebar subtree carrying an open dialog (`:has([role="dialog"], [aria-modal="true"])`, `display: flex !important` plus `pointer-events: auto`), leaving the collapsed rail untouched when no dialog is open.

Records that own a subset of these decisions were kept current in the same change: [the session archive manager](../feature/2026-08-31-session-archive-manager.md) (delete-plan rules), [git worktree parallel sessions](../feature/2026-08-26-git-worktree-parallel-sessions.md) (auto-isolation), and [the capability cache invalidation note](2026-08-25-native-image-capability-cache-invalidation.md) (#1509).

## Rejected alternatives

- Ice-princess tooltip via `patches.css`: a `[role="tooltip"]` colour override (the pattern several light skins use) would also work, but keeping the fix in the token layer keeps the skin a pure token pack and matches the reporter's proposal.
- Deleting the orphaned attachments in the send hook: there is no delete API and the store deliberately never garbage-collects, so the hook can only avoid creating them.
- Debouncing the second `startSession` into the official path: falling back would start a second session in the main checkout, which is worse than dropping the duplicate click.
- Guarding `createSequenceTimeline` against zero-length input (#1505): unreachable through every current caller, because `registry.ts` rejects a pet whose sequences are shorter than five animations or whose track durations are not positive. Recorded as defensive-only rather than fixed.

## Deferred

- #1498 (taskbar flash plus audio): an enhancement, already largely covered by the community `dsh-notifier` plugin; taskbar flashing needs the Electron shell rather than a web plugin.
- Narrow-viewport GUI validation for #1510: the mechanism is proven from source (the official sidebar snapshot places `.footArea` — which hosts the `sidebar.settings` slot and the settings overlay — as a non-first child the collapse rule hides, and the overlay is `position: fixed` with `role="dialog"`), and the shell contract is unit-tested, but this checkout cannot drive a real phone-width GUI, so the reporter still has to confirm the fix on a device.

## Consequences

Every fix carries a regression test that fails against the previous code: unknown-last size sorting and single-entry skip lists, per-frame ornament durations across a catch-up, one worktree per double click plus a released registration, zero attach requests after a local read failure, an in-flight capability verdict that is not republished, tooltip contrast against fixed white, and the settings path in the LAN hint.

## Testing

`pnpm --filter @linxin666/dsh-session-archive test` (86 passed), `pnpm --filter @linxin666/dsh-pet test` (512 passed), `pnpm --filter @linxin666/dsh-client-ui-git-graph test` (151 passed), `pnpm --filter @linxin666/dsh-tool-describe-image test` (388 passed), `pnpm --filter @linxin666/dsh-remote-web-ui test` (358 passed, 1 skipped), `pnpm --filter @linxin666/dsh-client-ui-skin-center test` (638 passed), plus the repository gates `pnpm typecheck`, `pnpm test`, `pnpm i18n:check`, `pnpm aggregate:check`, `pnpm skin-center:check`, `pnpm market:check`, and `pnpm libs:check`.
