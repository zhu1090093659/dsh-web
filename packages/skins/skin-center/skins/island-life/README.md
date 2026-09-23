# Island Life

English | [中文](README.zh.md)

An original cozy island skin paying homage to the Animal Crossing vibe: a sunny beach in light mode and the
same scene as a starry night in dark mode. Cream panels, warm brown text, a mint accent, and game-key style
3D buttons, shipped as a pure asset directory inside the Skin Center package.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (`--dsw-alias-*` token remap) + `patches.css`
  (component shaping) + `assets/`. No package.json, no build step, no hooks.
- **Day / night backdrops**: light mode uses a daytime beach illustration, dark mode uses the same composition
  at night (lit windows, fireflies, moonlit sea); each has a theme-aware scrim to keep text readable.
- **Token-first**: light values on `:root`, dark values under `body[data-ds-dark-theme]`; panel alpha follows
  the Skin Center background veil slider.
- **Pointer-hand selection**: sidebar workspace / session rows and popup menus (workspace picker, agent preset,
  model list) turn orange on hover with a hand cursor popping in from the left; the selected item is a
  leaf-green pill.
- **Game keys**: the new-session button and the send / stop button carry a solid bottom shadow, lifting on
  hover and sinking on press; the composer is a rounded cream card with a yellow focus ring.

## Palette

- Light: panels `#f8f8f0` / `#f7f3df`, text `#5a3d22`, accent `#19c8b9`, selected leaf `#d8ecc6`,
  hover orange `#f59b26`.
- Dark: panels `#1b2038`, text `#f1e8d0`, accent `#3dd4c6`, selected green `#2f4a2a`, hover orange `#ffb85c`.

## Preview

```sh
pnpm market:build                                # refresh market/dist
open market/dist/preview.html?skin=island-life&theme=light
node scripts/capture-previews island-life         # re-shoot preview/{light,dark}.jpg
```

## Known limitations

- Presentation-only: the skin mutates browser styles and never touches a model request.
- The workspace menu's selected item and the composer send button expose no semantic attribute, so they are
  matched with `[class*=...]`; an official class-name rebuild may drop those two styles (everything else keeps
  working).

## Source and copyright

- Stylesheets: wertyq111, released with this repository under Apache-2.0.
- Background illustrations `assets/island-day.webp`, `assets/island-night.webp`: original AI-generated artwork
  (gpt-image-2.5-sunburst); no third-party characters, logos, or game assets are used.
- Hand cursor `assets/select-cursor.png`: original work by wertyq111.
- "Animal Crossing" is a trademark of Nintendo; this skin is a stylistic homage and is not affiliated with
  Nintendo.
