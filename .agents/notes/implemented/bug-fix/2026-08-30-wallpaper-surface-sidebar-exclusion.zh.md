# Agent Note: 壁纸表面侧边栏与详情面板排除保护

Status: implemented

## Problem

在 Wallpaper Engine（WE）壁纸激活期间，壁纸控制器的全视口表面检测器（`packages/skins/skin-center/src/client/wallpaper.ts` 中的 `defaultWallpaperSurface`）会将全视口背景表面标记为 `data-dsh-wallpaper-surface` 以中和不透明背景。然而排除检测器 `isExcludedWallpaperSurface` 未排除侧边栏与右侧详情面板表面（`[data-slot="sidebar"]`, `[data-dsh-surface="sidebar"]`, `[data-slot="sidebar.workspaces"]`, `[data-pane="sidebar"]`, `aside`, `[data-slot="details"]`, `[data-dsh-surface="details"]`, `[data-pane="details"]`, `[class*="detailsCol"]`, `.aionui-root`, `[data-aionui-explorer-col]`, `[data-aionui-preview-col]`）。由于这些面板在桌面端占满视口高度且自带半透明玻璃背景，页面冷启动刷新时被错误打标为壁纸表面并被应用 `background-color: transparent !important`，导致其磨砂毛玻璃背景遮罩丢失。

## Decision

1. 在 `packages/skins/skin-center/src/client/wallpaper.ts` 中更新 `isExcludedWallpaperSurface`，增加对左侧边栏与右侧详情面板插槽与语义表面的排除保护。
2. 在 `packages/skins/skin-center/skins/wallpaper-exclusive/patches.css` 中将详情列选择器（`[data-slot="details"]`, `[data-dsh-surface="details"]`, `[data-pane="details"]`, `[class*="detailsCol"]`）显式纳入固定毛玻璃规则。
3. 在 `packages/skins/skin-center/tests/wallpaper.spec.ts` 中增加断言，确保侧边栏与详情面板元素绝不会被标记为壁纸表面。

## Alternatives considered

除高度外额外按元素宽度筛选全视口表面。未采纳的原因是不同屏幕尺寸和缩放级别下的分栏布局宽度多变，而语义插槽排除（`isExcludedWallpaperSurface`）从契约设计上直接保护了预期的 UI 面板。

## Consequences

无论是在初次激活壁纸还是页面冷启动刷新后，左侧边栏与右侧详情面板都能在启用 WE 壁纸时完整保留预期的半透明毛玻璃遮罩和背景样式。

## Testing

`node shared/node_modules/vitest/vitest.mjs run packages/skins/skin-center/tests/wallpaper.spec.ts`（63 passed）、`node scripts/skin-center-catalog-check --check` 与 `node scripts/verify-docs.mjs`。
