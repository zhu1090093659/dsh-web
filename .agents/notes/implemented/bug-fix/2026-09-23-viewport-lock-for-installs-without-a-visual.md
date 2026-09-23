# Agent Note: Unconditional viewport lock for installs with no active visual

Status: implemented

## Problem

An install with no catalog skin, custom theme or wallpaper has no viewport lock on the scrolling root. The official shell pins `html`, `body` and `#root` to `height: 100%` with `margin: 0` (`packages/client/web/src/base.css` of the harness checkout), and the frame the compat shim stamps `[data-dsh-frame]` onto is the host's `height: 100%; overflow: hidden` grid, so a stock install normally has nothing to scroll — but nothing declares `overflow` on the root either, so the document becomes scrollable the moment anything measures taller than the viewport.

The skin center already ships that lock ([viewport scroll lock on workspace select](2026-08-26-viewport-scroll-lock-on-workspace-select.md)), yet its selectors are scoped to `html[data-dsh-skin]`, `html[data-dsh-custom-theme]:not([data-dsh-skin])` and `html[data-dsh-wallpaper-active]`, so the stylesheet is inert in exactly the configuration that reports the stretched page.

Two paths made the document taller than the viewport there. On the mobile path the aggregate's responsive layer pins `[data-dsh-frame]` to `height: 100dvh; min-height: 100dvh` next to `padding-bottom: env(safe-area-inset-bottom)`; under the default content-box sizing that inset sat outside the pinned height, so the frame measured `100dvh` plus the inset and any device with a home indicator carried the difference as document overflow. And any overflow at all is enough for the settlement to become visible: the conversation disclosure controls (the tool/step-process collapse bar carrying the step summary, and the whole-turn process bar) call `focus()` on themselves when toggled, and a focused element below a scrollable document scrolls the page to it — the titlebar and sidebar top leave the viewport and the page reads as stretched downward into a blank band, which is issue #1135's symptom reachable with no visual active.

## Decision

The aggregate compat layer owns the unconditional lock; the skin center keeps the active-visual-scoped variant.

- `packages/dsh-web-all/src/client/index.ts` (`RESPONSIVE_CSS`) declares `html:has([data-dsh-frame]), html:has([data-dsh-frame]) > body { height: 100%; width: 100%; overflow: hidden; }`. The rule is scoped through `:has()` so it stays inert until the shell frame exists, and it deliberately never touches the app root element, whose own lock was removed for clipping the sidebar foot and overriding sidebar column push ([avoid root container clipping](2026-08-27-skin-center-viewport-lock-desktop-clipping.md), [release the root width lock](2026-08-27-skin-center-root-width-lock.md)).
- The mobile block of the same stylesheet adds `box-sizing: border-box` and `max-height: 100dvh` to `[data-dsh-frame]`, so the existing safe-area padding sits inside the pinned `100dvh` height instead of extending it.
- The skin center rules keep their present shape (active-visual scope, `!important`): identical declarations, so an install with an active visual behaves the same with both stylesheets installed.

## Alternatives considered

- **Leave the lock to the skin center.** Rejected: it is inert without an active visual, which is the reported configuration, so a stock install cannot be repaired from that stylesheet.
- **Lock the app root (`[id="root"]`) instead.** Rejected: that lock clipped the sidebar's bottom settings row and overrode the side-panel column push (`#root { width: calc(100% - …) }`) in issues #1222 and #1225.
- **Use `overflow: clip` rather than `overflow: hidden` on the locked elements.** Rejected: `hidden` keeps the locked box programmatically scrollable, which is how the browser reveals focused content that is legitimately taller than the viewport, and the aggregate copy stays on the recipe the skin center has shipped since 0.3.5. The measured difference is narrow — with a frame made taller than the viewport on purpose, `focus()` moved `body` by that overflow under `hidden` and by 0 under `clip`, while the document offset stayed 0 under both.
- **Raise the aggregate copy to `!important`.** Rejected: nothing in a stock install outranks `html:has([data-dsh-frame])`, and leaving the aggregate copy non-important keeps a single `!important` owner for the installs where both stylesheets apply.
- **Drop the safe-area padding from the frame rather than fix its box model.** Rejected: that padding is what keeps the composer clear of the home indicator; `border-box` removes the overflow without giving the clearance up.

## Consequences

- The document of an install with no active visual is no longer a scroll target, so a focused disclosure control cannot displace the page and the titlebar, sidebar top and composer stay inside the viewport.
- The lock removes the document as a target, not every scroll container: `html` and `body` keep `hidden` semantics, so a body-level box that is genuinely taller than the viewport stays programmatically scrollable and a `focus()` can still shift it by that overflow. The mobile box model removes the known source of such an overflow; reaching the residual case now needs a body-level element taller than the viewport, which nothing in the delivered install produces.
- Applying the lock also recovers an already displaced page: when the root turns non-scrollable the browser clamps an existing document scroll offset back to zero, so the compat layer needs no scripted `scrollTo(0, 0)` companion.
- Content that overflows the viewport is clipped rather than scrollable, which is the behavior an install with an active visual already has today.
- Desktop geometry is untouched: the desktop path only gains the root lock, and the frame keeps the host's `height: 100%`.
- Installs with an active skin, custom theme or wallpaper are unaffected; the skin center declarations carry the same values and win by `!important`.

## Testing

- `packages/dsh-web-all/tests/responsive-contract.spec.ts` asserts the lock's shape and scoping (`overflow: hidden`, `height: 100%`, the `> body` half, no app-root selector) and the mobile box model (`box-sizing: border-box`, `height` / `min-height` / `max-height: 100dvh`, the safe-area padding); `pnpm --filter @linxin666/dsh-web-all test` runs 11 tests green.
- Chromium probe against the official frame structure (frame `height: 100%; overflow: hidden` with the mobile recipe, 700px viewport, `env()` forced to an inset): with content-box sizing the frame measured 720px, the document reported 720px and `focus()` on an element at 1300px scrolled the document by 20px; with `box-sizing: border-box; max-height: 100dvh` the document height equals the viewport and `focus()` leaves `scrollTop` at 0; with the root lock alone the 720px frame is clipped and the document reports 700px, and a document already scrolled to 20px is clamped back to 0 when the lock applies.
- The same probe run with the stylesheet read from the tree rather than retyped — `git show HEAD:…/src/client/index.ts` against the worktree file, with the inset forced to 34px — reports the frame at 734px and the document at 734px before the change, and the frame and document at 700px after it.
- Live scratch `dsh web` host (isolated `DSH_HOME`, the packed aggregate installed, no skin, custom theme or wallpaper active, Playwright on the injected Chrome): the served `style[data-dsh-compat="responsive"]` carries the lock and the box model; at 1280x800 and 390x844 the document equals the viewport, computed `html` / `body` overflow is `hidden`, and `focus()` on an element placed below the fold leaves the document offset at 0 with no page or console errors; deleting exactly the two new rule sets on the loaded page restores `overflow: visible` and the same `focus()` scrolls by the regained 34px, and with a 34px bottom inset forced the frame measures 844px in an 844px viewport against 878px with the rules deleted.
- `pnpm libs:check` passes against the rebuilt `lib/client.js` and the refreshed `scripts/lib-artifact-fingerprints.json`.
