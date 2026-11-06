# Agent Note: narrow-screen drawer hits land on the drawer, not the frame

English | [中文](2026-11-06-mobile-drawer-hit-testing.zh.md)

Status: implemented

## Problem

At 768px and below the aggregate compat layer turns the sidebar column into a floating drawer: the `[data-pane="sidebar"]` rules in `RESPONSIVE_CSS` position it absolutely, give it `z-index: 1100`, and paint a `::after` mask at `z-index: 1050` over the frame. The drawer and its dimming were verified visually, never as a hit target.

The official layout has a drawer mode of its own. `.frame[data-sidebar-drawer] .sidebarCol` ships `position: absolute; z-index: 71` and `.drawerMask` ships `z-index: 70`, and the ui-layout client module injects that stylesheet at runtime through `document.head.appendChild`, i.e. after the compat tag. The compat selector `[data-dsh-frame] [data-pane="sidebar"]:is([data-pane="sidebar"])` and the official `.frame[data-sidebar-drawer] .sidebarCol` are both 0-3-0, so the cascade resolves the tie on document order: the officially injected sheet won every plain declaration. `position` survived only because it carried `!important`; `z-index: 1100` did not, so the drawer computed **71**. The compat mask, unimportantly declared at 1050 and left interactive, then painted over the drawer it was dimming.

A pseudo-element's hit reports its originating element, so `document.elementFromPoint` inside the open drawer answered the frame. The reported shape was exactly that: the drawer visible, its rows unresponsive behind a grey cast, and the drawer folding on the first tap because the tap landed on the mask and the dismiss handler folded it (#2013). The phone mirror reported the same interaction through the remote package (#2012/#2014): there the aggregate mask was present too, while `mobile-adapt.ts`'s `ADAPT_CSS` declared no drawer layer at all and silently inherited whatever the official sheet happened to put on top.

## Decision

The layer contract is decided by the declaration that owns it, not by the order two injected stylesheets load in.

`packages/dsh-web-all/src/client/index.ts` keeps the 0-3-0 selector and declares the drawer's layer important: `z-index: 1100 !important` next to the already-important `position: absolute`. The `:is()` still exists only to lift specificity above a skin's 0-2-2 / 0-2-3 shape; `!important` is what settles an equal-weight tie with the official sheet.

The compat mask stays as the drawer's dimming and never becomes a hit surface: `pointer-events: none` on the same `::after`. Dismissal keeps its two existing owners, unchanged: the official `.drawerMask` that the layout paints under its own drawer, and the capture-phase click handler in `installMobileSidebarDismiss` that folds the drawer on any click outside the sidebar ([the 1716 dismissal note](2026-09-25-issue-batch-1716-1719-and-ci-unblock.md)).

`packages/dsh-remote-web-ui/src/client/mobile-adapt.ts` states the same ladder in `ADAPT_CSS`: `[class*="_sidebarCol"]{z-index:1100 !important}` and `[class*="_drawerMask"]{z-index:1050 !important}`. The portrait surface therefore does not depend on the aggregate compat sheet — this package also ships alone — and the official dimming stays under the drawer it dims and above the content it darkens. No node is portalled: both layers stay where React owns them.

## Verification

Both edges of the ladder are covered by a focused test in each package: `packages/dsh-web-all/tests/responsive-contract.spec.ts` asserts the important drawer layer, the inert mask, and that the mask's layer sits under the drawer's; `packages/dsh-remote-web-ui/tests/mobile-adapt.spec.ts` asserts the two rules the adaptation sheet itself injects and their order.

The cascade itself was measured in a real CSS engine (headless Chromium, 390x844, portrait, coarse pointer), with the three sheets loaded in the order the running GUI serves them: the compat sheet from this package's source, the official layout sheet exactly as `@deepseek-ai/dsh-client-ui-layout` injects it at runtime, then the remote `ADAPT_CSS`. Five drawer rows measured at their centers:

| Sheets installed | Drawer `z-index` | Compat mask | Rows hit by `elementFromPoint` |
| --- | --- | --- | --- |
| before: compat + remote | 71 | 1050, interactive | 0/5 - every row resolved to `_frame` |
| before: compat only | 71 | 1050, interactive | 0/5 - every row resolved to `_frame` |
| before: remote only | 71 | absent | 5/5 - correct only because the official 71/70 ladder happened to hold |
| after: compat + remote | 1100 | 1050, inert | 5/5 |
| after: compat only | 1100 | 1050, inert | 5/5 |
| after: remote only | 1100 | absent (official 1050) | 5/5 |

After the fix the backdrop tap resolves to the official `.drawerMask` in all three variants, which is the dismiss surface the issue asked to keep.

Not verified here: a live 390x844 GUI pass. The running host serves its URL behind the launch token and its profile does not mount the compat row, so the aggregate half of the matrix is engine-level evidence only; the after-state GUI acceptance runs in the change's own round, after the client bundles are rebuilt.

## Alternatives considered

Portal the drawer and the mask to `body` (one of the issue's suggestions). Rejected: the compat layer writes attributes only and must not move React-owned nodes — re-parenting the sidebar column breaks the layout's `insertBefore`/`removeChild` anchors, and `inset`/animation contracts are written against the frame as containing block.

Make the frame leave the hit path while the drawer is open (`pointer-events: none` on `[data-dsh-frame]`), also suggested in the issue. Rejected: the drawer is a descendant of the frame, so the frame's hit suppression freezes the drawer with it, and it would change the hit surface of every plugin mounted inside the frame.

Give the frame `z-index: 0` / `isolation: isolate` so it stops outranking the drawer. Rejected: that keeps the decision inside an order-dependent tie. Any later sheet that declares a layer would re-open the same failure, and the compat layer must keep working beside sheets it does not control.

Raise the ladder to the reporter's probe numbers (`2147483001` / `2147483000`) instead. Rejected: those are the timers a reporter picked to debug, not a boundary. The aggregate already owns one deliberate ceiling (0-3-0) and a caption that a future skin outranking it is that skin's bug; a second ad-hoc number scale would turn the arms race into numeric inflation.

Leave the mask interactive and only fix the drawer's layer. Rejected: the row hit test would then pass, but the dimming would still answer every tap meant for the conversation underneath (the same shape #1829 fixed inside the composer), and a stale mask on a profile whose official drawer is not mounted would be the only thing closing the drawer.

## Consequences

The compat drawer now actually sits on the layer the contract always claimed, which means it paints above the official overlay layer inside the frame — the intended drawer ladder, and the first time it is real on a host that injects the layout sheet after the compat tag. The dimming no longer absorbs taps on the conversation: those taps reach the content they were aimed at while the capture-phase handler still folds the drawer.

Two rules in two packages now state the same numbers; a future change to the ladder has to move both. The remote sheet's rules carry the second half of that sentence in their comment, next to the aggregate's own `BOUNDARY` note.

The aggregate commits its built `lib/`, so the compat half reaches a page only after `pnpm build` refreshes it: `pnpm libs:check` reports the committed output as stale until `pnpm libs:write` re-records the fingerprints, and that rebuild is part of shipping this change, not an optional extra.

The remaining ceiling is unchanged: a skin whose rule outranks 0-3-0 still wins, and the correct repair is still that skin, not this rule.
