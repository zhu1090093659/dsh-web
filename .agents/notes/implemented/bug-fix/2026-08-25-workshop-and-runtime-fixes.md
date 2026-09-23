# Agent Note: Workshop and Runtime Bug Fixes

Status: implemented

## Problem

Six bug reports were identified and verified across the ecosystem:
1. **#1141 (Pet 404 in Workshop)**: `scripts/market-build` exported pet assets using the raw subdirectory name (`whale`, `whale-refined`) instead of `meta.id` (`whale-girl`, `whale-girl-refined`), causing the manifest URL assembly in `dsh-market` to fail with HTTP 404 during installation.
2. **#1145 (Workshop skin one-click install did not auto-activate)**: Installing a skin from the Workshop placed files into `~/.dsh/skins/<id>/` but did not persist or apply the new skin, leaving the user on the previous skin (or an empty default if the previous directory was removed).
3. **#1154 (Wallpaper Engine 404 disabled skin background and opacity slider)**: `suppressBackgroundMedia` returned true even when WE media failed to load (404), causing skin-center to execute an empty background branch and force surface transparency, resulting in a white void.
4. **#1155 (Native image request enable toggle did not persist)**: `setNativeImageEnabled` hardcoded the `llm-deepseek` namespace and failed on custom model providers or revision conflicts without displaying the error reason.
5. **#1153 (Chat recovery retry button silent failure)**: In the host retry countdown window or interrupted states, clicking the retry button silently hit early returns without UI feedback or disabled states.
6. **#1149 (Liangshen preset run_code error)**: When transitioning from phase 1 to PTC mode, the prompt lacked explicit guidance to write tool invocations inside `run_code`, causing direct `bash` tool call rejections.

## Decision

1. In `scripts/market-build`, export pet assets to `assets/pets/${meta.id}/` matching `manifest/pets.json`.
2. In `packages/dsh-market/src/client/MarketCard.tsx`, auto-persist and dispatch `dsh-skin-applied` event on successful skin install; add fallback handling in `boot.ts` and `routes-v2.ts`.
3. In `packages/skins/skin-center/src/client/wallpaper.ts`, track media loading failures to gracefully degrade `data-dsh-wallpaper-active` and bind `suppressBackgroundMedia` to `wallpaper.isDisplaying()`.
4. In `packages/dsh-tool-describe-image/src/native-images.ts`, dynamically resolve model provider settings namespaces and retry on revision conflict.
5. In `packages/dsh-chat-recovery/src/client/TurnActionsView.tsx`, disable retry button and display status when `hostRetryPending` is active, and add supervisor diagnostic logs.
6. In `packages/dsh-liangshen/presets/liangshen/tool-bootstrap.mjs`, append clear PTC transition instructions when promoted to `code` presentation mode. The presentation mode itself is retired ([LiangShen mode as a minimal persona plus an injected standard tool catalog](../feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.md)), so this decision no longer has a subject in the shipped preset.

## Consequences

- Pet installation from the Workshop succeeds for all built-in pets.
- Newly installed skins take effect immediately and missing skins fall back gracefully to `blue-fantasy`.
- Broken Wallpaper Engine wallpapers automatically fall back to the skin's art background without leaving transparent voids.
- Native image settings work across model providers with conflict resilience.
- Chat recovery retry button accurately reflects host retry states.
- Liangshen preset models understand PTC mode requirements.

## Testing

All workspace packages pass `pnpm typecheck` (20/20), `pnpm test`, `pnpm test:scripts` (203/203), `pnpm market:check`, `pnpm skin-center:check`, `pnpm aggregate:check`, `pnpm gallery:check`, and `pnpm docs:check`. CodeGraph index synced with 15,779 nodes.
