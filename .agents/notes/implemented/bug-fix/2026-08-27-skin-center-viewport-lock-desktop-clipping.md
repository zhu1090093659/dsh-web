# Agent Note: Avoid Root Container Clipping in Skin Center Viewport Lock

Status: implemented

## Problem

In `packages/skins/skin-center/src/client/runtime/shell-rendering.ts` (#1225):
A rigid `[id="root"]` lock was previously declared with `overflow: hidden !important;`, `height: 100% !important;`, and `width: 100% !important;`.
In DSH Desktop 2.0.3 Compatibility Mode (and embedded electron window containers with top titlebars), this caused `#root` to be clipped by a few pixels, cutting off the bottom settings gear and profile row in the left sidebar.

## Decision

- Retained the viewport lock on `html` and `body` (`height: 100% !important; width: 100% !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important;`), which completely prevents outer page scrollbar displacement and focus shifts.
- Removed the rigid `[id="root"]` rule block from `shellRenderingCss()`.

## Consequences

- The left sidebar bottom settings button is fully visible and no longer clipped in desktop compatibility mode (#1225).
- Side panel column pushing (e.g. `dsh-better-sidebar` #1222) continues to function naturally.
- The outer viewport remains locked without outer scrolling.

## Testing

Updated `packages/skins/skin-center/tests/skin-runtime.spec.ts`. All 585 tests in `skin-center` and all monorepo test suites passed.
