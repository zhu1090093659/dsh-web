# Agent Note: Visual Defects and Alignment Fixes for Miku, Windows XP, and Maid Atelier Skins

Status: implemented

## Problem

### 1. Hatsune Miku Skin Art Lost in Dark Mode
In `miku/skin.css`, `body[data-ds-dark-theme]` specified an opaque `background-image` (multi-stop radial and linear gradients) and solid `#0a1430` background, with solid `--dsw-alias-bg-base` and `--aion-bg-base` values. This occluded the background character art (`assets/miku-art.webp`), leaving only a blank dark blue background.

### 2. Windows XP Luna Skin Blank Canvas and Missing Components
- The Windows XP Bliss desktop wallpaper was completely occluded by multi-layered solid backgrounds across the host shell (`[id="root"]`, `[data-pane="conversation"]`, `[class*="frame"]`, `[class*="-l6A3q_root"]`), turning the workspace into a pitch black screen in dark mode and solid white in light mode.
- Fixed 30px titlebar and 24px statusbar overlapped the host header, Logo, and bottom utility buttons.
- Sidebar footer discovery in `xp/hooks.mjs` was rigid and failed when host DOM elements changed, preventing the classic green Start button from mounting.
- Chat composer card lacked XP Luna dialog borders and elevation.

### 3. Maid Atelier Skin Character Overlap and Headline Misalignment
- In `maid-atelier/hooks.mjs`, `isBetterSidebarOpen()` measured the full-screen container (`rect.width = 1920 > 80`), falsely identifying the drawer as expanded even when collapsed, tagging `data-maid-better-sidebar-open` and pushing the right maid character 460px leftward into the center composer.
- In `maid-atelier/patches.css`, the headline selector only matched `[class*="headlineText"]`, while modern host versions wrapped title text inside `span.CuLr4G_titleGroup`, leaving the title left-aligned at X=901.5 while the whale crest was centered at X=1095, creating an unsightly 193.5px horizontal misalignment.

## Decision

### 1. Miku Art Transparency and Layer Protection
- Reset `body[data-ds-dark-theme]` in `miku/skin.css` to `background-image: none; background-color: transparent;`.
- Configured translucent dark-mode tokens for `--dsw-alias-bg-*` and `--aion-bg-*`.
- Enhanced `skin-controller.ts` `setBackgroundLayer` to clear and restore `body.style.backgroundImage`.

### 2. Windows XP Classic Bliss Wallpaper and Chrome Non-Interference
- Defined classic Windows XP Bliss desktop wallpaper (daytime blue sky & rolling green hills in light mode, deep twilight Bliss in dark mode).
- Forced transparency (`background: transparent !important;`) on host frame, conversation pane, and center columns to let Bliss wallpaper shine through.
- Added `body { padding: 30px 0 24px 0 !important; box-sizing: border-box !important; }` to eliminate titlebar and statusbar occlusion.
- Styled composer card with authentic Luna 3D borders and classic background tones.
- Upgraded `findSidebarFoot` in `xp/hooks.mjs` to mount the iconic green Start button reliably.

### 3. Maid Atelier Component Alignment
- Updated `isBetterSidebarOpen()` to check active drawer visibility (`:not([class*="Hidden"])`) and filter out full-viewport root containers, ensuring the right maid stays pinned at the right screen boundary (X=1920).
- Restructured title and crest CSS rules to target `:is([class*="headlineText"], [class*="titleGroup"])`, assigning `grid-area: 2 / 1 / auto / -1; justify-self: center;` to achieve 0px offset coaxial alignment with the crest.

## Testing

- Unit tests: `packages/skins/skin-center/tests/xp-hooks.spec.ts` and `maid-atelier-hooks.spec.ts` passed.
- Monorepo test suites: `pnpm test` passed (36 suites, 619 skin-center tests).
- Automated typecheck & static checks: `pnpm typecheck`, `pnpm skin-center:check`, `pnpm market:check`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm aggregate:check` all passed.
- Headless Playwright real browser tests: captured native rendered screenshots for all three skins across light and dark modes, confirming pixel-accurate alignment and correct visual presentation.
