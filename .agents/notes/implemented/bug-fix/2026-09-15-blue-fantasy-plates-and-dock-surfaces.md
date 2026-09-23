# Agent Note: Blue Fantasy readability plates, queue dock surface and right panel

Status: implemented

## Problem

Three defects reported on 2026-09-14 (#1571, #1572, #1573) trace back to work shipped after the Blue Fantasy readability layer landed on 2026-09-11 (`75bd994e`, `5c7c9c92`, `48984e6d`). That layer shipped without a decision record — its rules live as comments inside `skins/blue-fantasy/patches.css` — so the constraints they encode were never written where a later change would look for them.

1. **Tooltips flew off their buttons (#1571).** `patches.css` painted the turn-tail action row (copy / like / dislike / regenerate) with `background` plus `backdrop-filter`. The shell renders each icon's tooltip as a `position: fixed` span *inside* that row: `ui-primitives/Tooltip.tsx` drops the portal on purpose ("Fixed positioning lets the bubble escape ancestor overflow clipping without a portal"). `backdrop-filter`, like `filter` or `transform`, makes the element the containing block for its fixed-position descendants, so the bubble was laid out against the row instead of the viewport — measured 719px from a button, with a viewport only 874px tall, which put the bubble off-screen.
2. **The queue dock painted two surfaces (#1572).** The shared shell adapter paints every direct child of `conversation.input.dock` as an accessory (`--dsh-composer-accessory-bg`, falling back to `--dsw-specific-tip`). The native `QueueDock` root only supplies the dock inset (`padding: 0 var(--dsh-composer-dock-inset)`, 8px) while the panel inside paints the same `--dsw-specific-tip` fill, so the wrapper added a second opaque plate 8px wider than the panel on each side.
3. **The right panel painted twice, and its divider sat one rung off (#1573).** `[class*="rightbarCol"] [class*="panel"]` is a substring match, and the shell's `panelBody` is a nested element whose class carries the same substring, so two 0.75 fills stacked to an effective 0.94. The shell also paints the left spine with `--dsw-alias-border-l3` but this panel's `border-left` with `--dsw-alias-border-l4`, so the two vertical rules read as different weights.

## Decision

1. The turn-tail plate moves to a `::before` layer (`position: absolute; inset: 0; z-index: -1`); the row keeps `position: relative`, its padding, radius and `fit-content` width. `inset: 0` reproduces the padding box the background used to fill, so the plate, the row geometry and the icon positions are unchanged, and the row no longer establishes a containing block. **Carrying rule: a plate that wraps shell-rendered tooltip anchors is painted by a pseudo-element, never by the element itself.** The turn-status plate already had this shape.
2. `shell-rendering.ts` gains a `[data-queue-dock]` exception that resets the accessory surface (background, border, radius, shadow, backdrop-filter) for that child alone — the same shape as the existing goal-dock exception. The queue panel stays the single layer and the wrapper keeps its inset, so the panel remains aligned with the composer card. Todo and statistics docks are untouched: they either paint their own surface on the same element or rely on the accessory fill.
3. `patches.css` excludes `panelBody` from the substring selector in both themes and gives the right panel's `border-left-color` the left spine's `--dsw-alias-border-l3`. The l4 token is left alone because other consumers share it.
4. The two constraints the readability layer relied on but never recorded are stated here as shipped reality: the pseudo-element rule above, and the fixed window-chrome density (the conversation header and the right panel keep a fixed 0.75 base instead of riding `--dsh-skin-bubble-alpha`, because they are frame, not bubble).

Deliberately unchanged: the plates themselves (they keep icons and prose legible over the illustration) and the chrome density.

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-skin-center test`: 648 tests pass across 40 files, including a new assertion that the adapter emits the queue-dock reset.
- `pnpm typecheck`; `pnpm -r --workspace-concurrency=1 test`; `pnpm test:scripts`; `pnpm docs:check`; `pnpm i18n:check`; `pnpm sync-shared:check`; `pnpm runtime-deps:check`; `pnpm aggregate:check`; `pnpm libs:check`; `pnpm skin-center:check` (which also runs `skin-hooks:check`) and `pnpm market:check` all pass. The parallel `pnpm test` is timing-flaky here — two runs failed in different packages' timing-sensitive specs (`dsh-doctor` lock heartbeat, `dsh-task-board` claim provenance), both of which pass alone and in the serial run — which is unrelated to this change: it touches no code those packages load.
- `pnpm build` rebuilt the committed bundles; `node scripts/market-build` regenerated `market/dist` (skin zip, `styles.js`, try-on assets); `pnpm libs:write` re-recorded the four `lib/` fingerprints.
- GUI evidence was not captured for this change. Two environment facts decide how the fix reaches a running GUI: an installed copy of the skin under `$DSH_HOME/skins/<id>` shadows the built-in asset the package ships, so a GUI holding an older install keeps the old CSS until that copy is reinstalled or removed; and the queue-dock rule lives in the client bundle, which a running host serves from the installed package. Visual verification therefore needs the installed copy refreshed plus a GUI reload (restart the host if the bundle does not reload), checking the turn-tail tooltip, the queue dock above the composer, and the right panel against the left spine in both themes.

## Alternatives considered

- Dropping the turn-tail plate instead of moving it. Rejected: the icons sit on the whale illustration and the plate is what keeps them legible, so removing it trades a positioning defect for the readability defect the layer exists to fix.
- Excluding the tooltip bubble by selector. Rejected: `position: fixed` is the bubble's own declaration; no rule on the wrapper can undo the containing block the wrapper establishes.
- Remapping `--dsw-specific-tip` toward translucency to remove the queue halo. Rejected for the reason already recorded in [the wallpaper-exclusive queue dock note](./2026-08-24-wallpaper-exclusive-queue-dock-chrome.md): the halo comes from the wrapper's own surface, and a global remap leaks into unrelated consumers of that token.
- Fixing the queue dock inside the Blue Fantasy skin alone. Rejected: the second plate is skin-independent (the wrapper surface is always redundant next to the panel fill), so the shared adapter owns it.
- Setting `--dsw-alias-border-l4` equal to l3. Rejected: l4 is shared with other edges, and the mismatch is one panel's `border-left`, so the override is scoped to that.
- Frosting the ask and plan-review cards, uniting the composer-accessory blur and the top bar with the scrim, and re-theming the tooltip and hover card (issues #1569, #1570, #1574). Declined on the tracker with source evidence; the rationale lives in those threads.

## Consequences

- Plates that still carry `backdrop-filter` on the element itself — markdown blocks, code blocks, tool rows, disclosure rows, turn-process, the deliverables row, the user bubble — are a latent repeat of #1571. The audit for this change found no shipped tooltip anchor inside them: in the inspected shell, `Tooltip` is used inside conversation rows only by `ui-chat` `MessageIconActions` and `ui-message-feedback` `MessageFeedbackActions`, both inside the action row fixed here, and the markdown, tool, deliverable and question packages render none. Anything that later puts a tooltip inside a plated row must move that plate to a pseudo-element first.
- The substring plate selectors stay substring matches; a future shell class that merely contains one of those substrings would be plated too, which is exactly the #1573 failure mode. New plate rules should anchor on a direct-child relationship or an exact attribute.
- The two vertical rules now match. The 1px of the bottom dock panel that overlaps the right panel's edge (the rest of #1573) is upstream docking-kit layout and is left alone.
