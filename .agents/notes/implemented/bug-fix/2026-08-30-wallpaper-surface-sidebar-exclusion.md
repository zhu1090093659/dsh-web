# Agent Note: Wallpaper Surface Sidebar and Details Exclusion Guard

Status: implemented

## Problem

When a Wallpaper Engine (WE) wallpaper was active, the wallpaper controller's shell-surface detector (`defaultWallpaperSurface` in `packages/skins/skin-center/src/client/wallpaper.ts`) tagged full-viewport background surfaces with `data-dsh-wallpaper-surface` to neutralize opaque backgrounds. However, the exclusion detector `isExcludedWallpaperSurface` did not exclude sidebar and details surfaces (`[data-slot="sidebar"]`, `[data-dsh-surface="sidebar"]`, `[data-slot="sidebar.workspaces"]`, `[data-pane="sidebar"]`, `aside`, `[data-slot="details"]`, `[data-dsh-surface="details"]`, `[data-pane="details"]`, `[class*="detailsCol"]`, `.aionui-root`, `[data-aionui-explorer-col]`, `[data-aionui-preview-col]`). Because these panels span the full viewport height in desktop view and carry translucent glass backgrounds, cold-boot page reloads tagged them as wallpaper surfaces and applied `background-color: transparent !important`, erasing their frosted glass backdrop masks.

## Decision

1. In `packages/skins/skin-center/src/client/wallpaper.ts`, updated `isExcludedWallpaperSurface` to exclude sidebar and details slots and semantic surfaces.
2. In `packages/skins/skin-center/skins/wallpaper-exclusive/patches.css`, ensured details column selectors (`[data-slot="details"]`, `[data-dsh-surface="details"]`, `[data-pane="details"]`, `[class*="detailsCol"]`) are explicitly included in the fixed glass panels rule.
3. Updated unit tests in `packages/skins/skin-center/tests/wallpaper.spec.ts` to assert that sidebar and details elements are never tagged as wallpaper surfaces.

## Alternatives considered

Filtering surfaces by bounding client width in addition to height. Rejected because full-viewport column split layouts can have varying widths across screen sizes and zoom levels, whereas semantic exclusion (`isExcludedWallpaperSurface`) directly preserves intentional UI panels by design contract.

## Consequences

Both sidebar and details panels retain their intended translucent glass backdrop and background styling when WE wallpapers are enabled, across both initial activation and cold page reloads.

## Testing

`node shared/node_modules/vitest/vitest.mjs run packages/skins/skin-center/tests/wallpaper.spec.ts` (63 passed), `node scripts/skin-center-catalog-check --check`, and `node scripts/verify-docs.mjs`.
