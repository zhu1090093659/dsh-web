# Agent Note: the compat mobile contract mirrors the official drawer eligibility

English | [中文](2026-11-16-compat-mobile-eligibility-mirrors-official-drawer.zh.md)

Status: implemented

## Problem

The aggregate compat layer (`web-ui-compat`, `packages/dsh-web-all/src/client/index.ts`) applies its mobile layout at `@media (max-width: 768px)` — inclusive of the boundary — on every platform. The official layout decides drawer mode differently: `ui-layout`'s `AppFrame` computes `drawer = viewport < SIDEBAR_DRAWER_BREAKPOINT && !windowsTitlebar` with `SIDEBAR_DRAWER_BREAKPOINT = 768`, where `windowsTitlebar` is `document.documentElement.hasAttribute('data-windows-titlebar')`. The Windows desktop shell therefore keeps the three-column desktop grid at exactly 768 CSS px, and at every width below it.

A Windows 125%-scaling split window at exactly 960 physical px (768 CSS px) hits the inclusive query: the compat sheet forces `grid-template-columns: minmax(0, 1fr) !important`, turns the sidebar into an absolutely positioned drawer, and rewrites the conversation header grid. With the sidebar collapsed the frame keeps a 1fr empty track (~454px), the conversation column is squeezed to ~314px against the right edge, and the header's new-session button disappears (#2054). Disabling `web-ui-compat` restores the official layout; widths above 768px are unaffected. The same mismatch applies below 768px on the Windows desktop shell, where the official layout never enters drawer mode at all.

## Decision

The compat mobile contract mirrors the official eligibility in both halves, CSS and JS.

- **The breakpoint is strictly below 768.** Both mobile media blocks use `@media (max-width: 767.98px)`. The 0.02px spelling is the sub-pixel-safe form of `< 768` within this sheet's existing browser floor: the sheet already requires `:has()` (Safari 15.4+), while the range syntax `(width < 768px)` would raise the floor to Safari 16.4. At the common Windows scaling factors the CSS width steps land on 768.0 exactly, so the 0.02px band is never the reported boundary.
- **Every mobile rule carries the desktop-titlebar guard.** Each selector head in both blocks is prefixed with `:where(html:not([data-windows-titlebar]))`. `:where()` contributes zero specificity, so the 0-3-0 ceiling owned by [the drawer hit-testing note](2026-11-06-mobile-drawer-hit-testing.md) is intact and the cascade against skins and the official sheet is unchanged. The guard covers the whole mobile contract — grid, drawer, collapsed rail, details overlay, header rows, composer and touch targets — because the official desktop shell keeps its desktop layout at every width, not just at the boundary.
- **The dismissal handler asks the same question.** `installMobileSidebarDismiss` returns early when `document.documentElement.hasAttribute('data-windows-titlebar')`, and its `matchMedia` gate uses `(max-width: 767.98px)`. The capture-phase fold therefore never folds a desktop sidebar, mirroring the CSS.

## Alternatives considered

- **Only tighten the breakpoint.** Leaves the Windows desktop shell forced into the drawer layout at every width below 768px, where the official layout keeps three columns.
- **Only add the titlebar guard.** Leaves the inclusive boundary firing at exactly 768px on non-Windows narrow viewports, where the official `viewport < 768` is false.
- **`html:not([data-windows-titlebar])` without `:where()`.** Adds 0-1-1 to every mobile rule, breaking the documented 0-3-0 ceiling and re-opening the skin/official cascade fights the drawer note settled.
- **A CSS nesting wrapper.** Nesting needs Chromium 112+/Safari 16.5+, above this sheet's `:has()` floor; the explicit zero-specificity prefix uses only features the sheet already relies on.
- **A higher-specificity reset block under the titlebar.** The neutralizer arms race the drawer note explicitly rejects; the guard keeps one owner per declaration.

## Consequences

- The compat mobile layout applies exactly when the official layout enters drawer mode: below 768px and never under the Windows desktop titlebar. Phone and narrow-browser behavior below the boundary is unchanged, including the `dsh-web-mobile` yield (`:where(:not([data-mobile-nav]))`) and the drawer layer ladder.
- `dsh-web-all` commits its built `lib/`, so the fix reaches a page only after `pnpm build` refreshes it and `pnpm libs:write` re-records the fingerprints; that rebuild is part of shipping this change.
- Two media blocks and the JS gate state the same eligibility; a future breakpoint change has to move all three, and `responsive-contract.spec.ts` pins each.

## Verification

`pnpm --filter @linxin666/dsh-web-all typecheck` and `test` (`responsive-contract.spec.ts`, 20 cases): the strict query and its count, every mobile selector head carrying the titlebar guard, the dismissal handler yielding under the titlebar attribute, and the gate asking the strict query.

The cascade is measured in headless Chromium against a shell-shaped frame carrying the official desktop inline grid `260px minmax(0, 1fr) 300px`, with the compat sheet extracted from this package's source (After) and from `git show HEAD:` (Before), deviceScaleFactor 1:

| Viewport | `data-windows-titlebar` | Before grid | After grid | Official drawer |
| --- | --- | --- | --- | --- |
| 768 | no | `768px` single | `260px 208px 300px` | false |
| 768 | yes | `768px` single | `260px 208px 300px` | false |
| 767 | no | `767px` single | `767px` single | true |
| 767 | yes | `767px` single | `260px 207px 300px` | false |
| 700 | no | `700px` single | `700px` single | true |
| 700 | yes | `700px` single | `260px 140px 300px` | false |

The sidebar computes `position: absolute` in every Before row and in the After rows where the mobile contract applies; it stays `static` in the three-column After rows. Screenshots of the reported scenario (768px, titlebar, collapsed) show the single-column drawer layout Before and the intact desktop grid After. A live GUI pass needs the rebuilt aggregate mounted (a host restart), so it is handed to the user rather than claimed here.
