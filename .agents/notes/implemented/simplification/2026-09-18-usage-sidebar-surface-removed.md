# Agent Note: Usage sidebar surface removed

Status: implemented

Supersedes [usage sidebar controls seat on the entry row](2026-09-17-usage-sidebar-controls-on-entry-row.md) and the #1592 sidebar surface recorded in [issue batch 1587-1600](2026-09-16-issue-batch-1587-1600-fixes.md): the sidebar usage entry, its collapsible panel, and the entry-core machinery built only for it are gone. Usage stays reachable through its first-level settings section.

## Problem

The sidebar usage surface never earned its place. It occupied a permanent navigation slot — competing with the family plugin entries and the workspace browser for the narrow strip under New Session — to duplicate an overview the settings section already renders in full. The user's own verdict on the shipped row was that it could simply be removed. Keeping it also carried a standing cost beyond its own files: the shared entry core had grown an `actions` array, a composite container/main-button structure, an `entryAction`/`entryMain` CSS contract, and a `data-dsh-entry-action` hook, all of which existed to seat this one row's refresh and collapse controls.

## Decision

1. dsh-usage keeps only its settings surface. `packages/dsh-usage/src/client/sidebar-entry.ts`, `sidebar-entry-core.ts`, `sidebar-panel-mount.tsx`, `UsageSidebarPanel.tsx`, and the `body-mutations.ts` copy are deleted; `src/client/index.ts` no longer mounts an entry row or panel. The first-level 使用统计 settings section, the host service, the ledger, the routes, and the shared family trust fence are untouched.
2. The shared sidebar-entry core drops the `actions` API with its only consumer. `SidebarEntryAction`, the `actions` option, the composite branch of `createEntry`, the `setOpen` return, and the action-button wiring are removed, so every row is again the classic single button. The `active` bridge stays: dsh-ssh and dsh-task-board still use it for their row highlight.
3. The `sidebar-entry-core.ts` and `body-mutations.ts` sync-manifest targets for dsh-usage are removed, and the dictionary keys under `usage.sidebar.*` are deleted from the zh/en dictionaries and the ru language pack together.
4. The semantic-attribute contract drops the `sidebar-panel` and `sidebar-summary` part rows (owner `usage`); `sidebar-entry` stays as the family rows' part. The usage README pair loses its sidebar bullet and the summary sentence in both languages.

## Preserved rationale from the superseded note

The removed surface went through one control-layout revision whose reasoning is kept here, because a future sidebar row may face the same choices even though this row is gone. The revision moved the panel's refresh and collapse controls onto the entry row itself, replacing a panel header that duplicated the row's 用量 title and a second, unpersisted collapse path (clicking the row hid the container; the header's button collapsed only the body). That design rejected restyling the duplicate header (two headers for one small surface stay confusing), appending action buttons inside the single-button row (buttons inside a button are invalid HTML and click routing gets fragile against shell re-renders), forking the entry core inside dsh-usage (generated copies drift by design), and text buttons on the row (the sidebar idiom is icon buttons; text crowds a 36px nav row). Its consequences were that the collapsed rail hid the action buttons, the refresh control stayed available while collapsed, and the collapse choice survived a reload through one `localStorage` key. One environment fact it recorded is also now moot with the spec: under Node >= 23 the runtime's flag-less `localStorage` shadows jsdom's Storage in vitest, so a spec touching `window.localStorage` must install a standards-shaped in-memory Storage to pass locally while CI (Node 22) stays green.

## Alternatives considered

- Seating the row at the sidebar foot, below the footer actions and above Settings. Rejected after implementing it: the row is still a permanent duplicate of a settings page the user can already reach, so moving it traded one crowded slot for another instead of answering the complaint.
- Removing the whole dsh-usage package. Rejected by the user: the settings section, the ledger, and the token bank remain wanted.
- Keeping the panel and hiding it behind a setting. Rejected: an opt-in flag would preserve the maintenance cost of the row, the panel mount, and the entry-core `actions` API for a surface with no committed user.
- Leaving the now-unused `actions` API in the shared core for future rows. Rejected under YAGNI: it is dead code in four synced copies whose only justification was this row, and a future row can reintroduce it in the change that needs it.

## Consequences

- The sidebar no longer carries a 用量 row in either the wide column or the collapsed rail; the previous change to seat it above Settings is reverted with it.
- The family rows (dsh-task-board, dsh-ssh, dsh-skill-explorer) keep the panel-row geometry they now share: the shell's 2px inset, 12px radius, 8px content padding, 36px row, 14/22 type, primary ink, and a 16px glyph box (18px in the collapsed rail). Rows without `actions` were already byte-identical, so this removal does not change their rendering.
- Usage overview polling is now driven solely by the settings section's mount cycle; nothing polls while that section is closed. The pet's usage bubble was already decoupled from this surface (see [the pet-decoupling note](../simplification/2026-09-17-usage-pet-decoupling-collapsed-summary.md)) and is unaffected.
- `dsh-usage.sidebar.collapsed` is no longer read or written; a stale `localStorage` value is inert.

## Testing

- `packages/dsh-usage/tests/`: the sidebar specs (`sidebar-entry.spec.ts`, `sidebar-entry-layout.spec.ts`, `sidebar-panel-mount.spec.ts`, `sidebar-panel.spec.tsx`) are deleted with the surface; the remaining suites (settings section, routes, ledger, pricing, adapters, voucher, service) pass unchanged.
- `shared/tests/sidebar-entry-core.spec.ts`: covers the classic single-button row — placement, semantic attributes, idempotency, locale refresh, and the active highlight — with the `actions` cases removed along with the API.
- The three family packages' `sidebar-entry-layout.spec.ts` specs assert the shared panel-row geometry across all four row stylesheets.
- Live GUI evidence (Edge via Playwright against the running host): zero `[data-dsh-usage-entry]`, `[data-dsh-usage-view]`, `[data-dsh-part="sidebar-panel"]`, and `[data-dsh-part="sidebar-summary"]` nodes; the task-board row and the official panel row report identical 14,124 vs 14,160 boxes with `glyphX` 30, `labelX` 46, 16px glyph, 12px radius, `7px 8px` padding, `0px 2px` margin, and 14px/22px type; the collapsed rail reports 36px/12px boxes with 18px glyphs at the same x.
- Gates: `pnpm typecheck`, `pnpm build`, `pnpm libs:check`, `pnpm aggregate:check`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm emoji:check`, `pnpm test:standards` (baseline re-recorded down), and `node scripts/sync-shared.mjs --check`.
