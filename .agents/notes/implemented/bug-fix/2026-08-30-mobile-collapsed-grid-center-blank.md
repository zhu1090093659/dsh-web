# Agent Note: Mobile portrait collapse left the conversation column zero-width (blank skins)

Status: implemented

## Problem

On a portrait phone, every token-remapping skin (whale-song, blue-fantasy and the stock look) rendered a **fully blank conversation surface** — the whole app frame showed only the backdrop art and a floating whale button, with no sidebar, no chat scroll, no composer. The blank was intermittent: the same URL sometimes laid out the conversation and sometimes collapsed it, so it looked like the whale-song skin was "randomly" resetting to empty.

The defect was in the host shell's 3-column frame, not in any skin. `AppsFrame` renders `grid-template-columns: {sidebar}px minmax(0,1fr) {details}px`. On narrow viewports the official host auto-collapses the sidebar to a **fixed absolute overlay rail**: the host rule `[data-dsh-frame] [data-pane="sidebar"] { position: absolute; z-index: 1100 }` takes the sidebar out of the grid flow. The `dsh-remote-web-ui` mobile-adapt layer then pins the frame to `grid-template-columns: 0 minmax(0,1fr) 0 !important` (mobile-adapt.ts:96) so the conversation reclaims the full width — **but it never placed the columns** (`grid-column`). With the sidebar absolutely positioned (out of flow) and `detailsCol` `display:none`, the only remaining in-flow child is `centerCol`, which auto-placed into the grid's **first (0px) track** → `centerCol` width 0 → blank. When the sidebar happened to still be `position:relative` (in-flow, before the host mounted the overlay rail), `centerCol` auto-placed into the 1fr track and the content showed. The sidebar's relative↔absolute flip is the source of the intermittency; a skin with a painted backdrop just made the blank most visible.

## Decision

**Pin the three frame columns to explicit tracks in the collapsed-portrait state.** In `mobile-adapt.ts`, after the existing `grid-template-columns: 0 minmax(0,1fr) 0 !important` override for `[class$="_frame"][data-sidebar-collapsed]`, add:

- `[class$="_sidebarCol"]{grid-column:1/2}`
- `[class$="_centerCol"]{grid-column:2/3}`
- `[class$="_detailsCol"]{grid-column:3/4}`

With explicit placement, `centerCol` always owns the 1fr track regardless of whether the sidebar rail is `relative` (in-flow) or `absolute` (out of flow). The conversation surface can no longer collapse to zero width; the whale-art skins render their backdrop behind a real conversation UI on every portrait load.

## Alternatives considered

- **Pin the grid to a single `minmax(0,1fr)` track instead of `0 minmax(0,1fr) 0`.** Rejected: it drops the columns entirely, so the absolutely-positioned sidebar rail and the `overlayLayer` lose their intended tracks; a three-track frame with explicit column placement keeps each sibling's cell stable and matches the host's own desktop geometry.
- **Force the sidebar rail `position:relative` again.** Rejected: the absolute rail is the host's collapsed-sidebar contract (and the whale button replaces it); overriding the sidebar's position would fight the host and could break the floating-rail/whale-entry UX.
- **Add a `grid-column:2/3` only on `centerCol`.** Rejected on completeness: pinning all three is symmetric, costs nothing, and makes the intended column map explicit so a future sibling added to the frame cannot inherit a wrong auto-placement.

## Consequences

- On portrait phones the conversation column renders at full width for every skin including whale-song and blue-fantasy; the reported "random blank" no longer occurs.
- Desktop and wide viewports are untouched (the fix is scoped to `[data-sidebar-collapsed]`).
- No behavior change to the whale button, gesture layer, or other mobile-adapt rules.

## Testing

- `mobile-adapt.spec.ts`: added an assertion that the collapsed-frame CSS includes `grid-column:2/3` on `_centerCol`; all 11 tests green.
- `pnpm typecheck` for `dsh-remote-web-ui` (tsc -b) clean; `tsdown` build clean, `lib/client.js` contains the new pins.
- Live (local web :3080, 390×844 iPhone-emulated context): both whale-song and a skin-off load report `centerCol` width 390 (was 0), `[data-conversation-scroll]` present, no console errors; the whale-song screenshot shows the conversation header, mode row and composer over the backdrop art.
