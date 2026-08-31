# Agent Note: Release Root Width Lock in Skin Center Shell Rendering

Status: implemented

## Problem

Skin Center 0.3.5 added viewport and root lock rules to `shellRenderingCss()` (#1135) to prevent outer page scrollbar displacement. However, it placed `width: 100% !important;` on `[id="root"]`.
This broke third-party sidebar plugins like `dsh-better-sidebar` (#1222), which resize `#root` via `#root { width: calc(100% - var(--dsh-sidebar-width, 0px)) }` to push conversation content to the left when opening side panels. The `!important` rule forced `#root` to remain at 100% width, causing the right sidebar panel to float over and obscure chat messages.

## Decision

In `packages/skins/skin-center/src/client/runtime/shell-rendering.ts`:
- Replaced `width: 100% !important;` on `[id="root"]` with `max-width: 100% !important;`.
- Maintained `height: 100% !important;`, `max-height: 100% !important;`, `overflow: hidden !important;` and `box-sizing: border-box !important;` on `[id="root"]`, as well as the full viewport locks on `html` and `body`.

## Consequences

- `[id="root"]` can be dynamically narrowed and pushed by sidebar panels (e.g. `dsh-better-sidebar`) without being overridden.
- The outer viewport and page body remain locked against displacement and outer scrollbars.

## Testing

Updated `packages/skins/skin-center/tests/skin-runtime.spec.ts` with assertions verifying that `max-width: 100% !important` is applied while `width: 100% !important` is not. All 585 tests in `skin-center` and all monorepo test suites passed.
