# Agent Note: Desktop second-instance launch crash and maid-atelier top-trim occlusion fixes

Status: implemented

## Problem

### 1. Desktop crashes with Object has been destroyed when relaunched immediately after close (Issue #1465)
When closing the DSH desktop window, the main process enters its `before-quit` phase, waiting up to 5 seconds for `stopHost` to shut down the internal DSH host process. If the user clicks the application shortcut again within this 5-second window, the second instance emits a `second-instance` event to the primary instance. `desktop/src/main.cjs` only checked `mainWindow !== null` without checking `mainWindow.isDestroyed()`, and failed to short-circuit when `quitting === true`, resulting in an uncaught `TypeError: Object has been destroyed` exception thrown from `mainWindow.isMinimized()`.

### 2. maid-atelier top decorative trim covers titlebar controls and right sidebar lacks solid background (Issue #1471)
In the Workshop package for `maid-atelier`, `patches.css` styled `[data-skin-chrome="top-trim"]` with `position: fixed; z-index: 20`, causing the fixed top trim to cover the right sidebar toggle and other essential controls in the conversation header. Furthermore, the skin lacked background palette overrides for `dsh-better-sidebar`, causing the expanded right panel to appear transparent over the background wallpaper.

## Decision

### 1. Desktop lifecycle and second-instance guard
- Export a pure helper `shouldRaiseWindowOnSecondInstance(argv, state)` from `desktop/src/runtime.cjs` that filters out quitting states (`state.quitting`), null/undefined windows, destroyed windows (`state.window.isDestroyed()`), and programmatic CLI launches.
- Guard the `second-instance` handler in `desktop/src/main.cjs` with this helper, and clear `mainWindow` on window `closed` in `createWindow()`.
- Add comprehensive unit test coverage in `desktop/tests/runtime.test.mjs`.

### 2. maid-atelier trim and sidebar styles correction
- Update `[data-skin-chrome="top-trim"]` in `packages/skins/skin-center/skins/maid-atelier/patches.css` to `position: absolute; z-index: 1; inset: 0 0 auto; top: 0;`, completely unblocking titlebar controls.
- Add palette overrides for `[data-dsh-better-sidebar]` (light and dark themes) so the right sidebar panel renders with a clean, opaque porcelain background.
- Bump `maid-atelier/skin.json` version to `0.3.2`, regenerate `reviewed-hooks.generated.ts`, and refresh the Workshop distribution via `scripts/market-build`.

## Testing

- Desktop unit tests: `node --test desktop/tests/*.test.mjs` passed (20 tests passed).
- Skin Center and Workshop checks:
  - `pnpm skin-center:check` passed (31 skins and hooks validated).
  - `pnpm market:check` passed (dist artifacts matched hash manifest).
- Scripts tests: `pnpm test:scripts` passed.
