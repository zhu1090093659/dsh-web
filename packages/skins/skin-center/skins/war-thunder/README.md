# War Thunder Frontline (战争雷霆 · 钢铁前线)

English | [中文](README.zh.md)

A military theme inspired by the War Thunder game art — in-game login
backdrops, olive-drab frosted panes and the amber accent of the launcher
mark — shipped as a pure asset directory inside the skin-center package.
Readability first: the app columns stay near-opaque so conversation text
never fights the artwork; the battlefield breathes through the frame edges
and the theme scrim.

## What it is

- **Pure assets**: `skin.json` (v2 manifest), `skin.css` (L1 token remap,
  light values on `:root`, dark values under `body[data-ds-dark-theme]`),
  `patches.css` (L3 component patches), `hooks.mjs` (favicon, pinned title,
  live background-variant swap, parallax, hold-to-peek), `assets/`
  (backgrounds + launcher badge) and `preview/` (market screenshots).
  No package.json, no build step; the skin-center package is the only
  loader.
- **Dual artwork**: light theme rides the bright day battle login
  background, dark theme rides the night-battle background; both are
  prescribed in `contributes.backgroundMedia` and painted by the skin-center.
  The skins' hooks subscribe to theme flips and swap the painted variant in
  place (the controller only installs the activation-time variant).
- **Readability**: the three app columns wear near-opaque olive tokens, so
  text never fights the artwork. Deliberately NO backdrop-filter on panes:
  a filter ancestor becomes the containing block for fixed-position
  descendants, which would trap overlays like the settings dialog inside a
  column. The outer frame wrappers stay transparent so the artwork shows
  around the columns.
- **Hold to peek**: hold the **Alt** key anywhere — the whole frosted
  layer stack (sidebar, conversation, details, composer) fades toward
  transparent so the battlefield shows through; releasing restores the
  readable state.
- **Peek parallax**: while the peek is held, the 108% overscanned artwork
  drifts gently with the pointer (clamped to the overscan margin, eased by
  a CSS transition); outside the peek the artwork rests and drifts back to
  center on release.
- **Palette**: olive paper + ink + amber in light, near-black olive stone +
  amber in dark; the amber accent (`#d9a441`) runs through buttons and
  selections.

## Preview

```sh
pnpm market:build                              # refresh market/dist
open market/dist/preview.html?skin=war-thunder&theme=light
node scripts/capture-previews war-thunder    # re-shoot preview/{light,dark}.png
```

## Artwork & license

The background artwork is extracted read-only from the local War Thunder
game client login page assets; the launcher badge comes from the client's
launcher.ico. All artwork is copyrighted by Gaijin Entertainment and is
used here for personal, non-commercial purposes only. The skin's own code
follows the repository license. See `license` and `attribution` in
`skin.json`.

## Known limitations

- Presentation-only: the skin mutates browser styles and never touches a
  model request.
- No window chrome (no custom title/status bars): the v1 bars overlaid the
  shell's own header/footer, so the v2 port keeps only the favicon, the
  pinned title and the live background swap.
- Peek starts and stops with the Alt key — no click-to-hold, so normal UI
  interactions (buttons, links, composer) keep working untouched.
