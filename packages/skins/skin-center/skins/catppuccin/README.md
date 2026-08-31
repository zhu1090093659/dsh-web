# Catppuccin

English | [中文](README.zh.md)

The well-known Catppuccin palette ported to a dsh skin — a soft, flat,
solid-color theme with a Latte light scheme and a Mocha dark scheme, shipped
as a pure asset directory inside the skin-center package. Low-saturation colors
and flat panes keep it comfortable for long reading sessions.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full
  `--dsw-alias-*` token remap) + `patches.css` (a few free-selector refinements).
  No package.json, no build step; the skin-center package is the only loader.
- **Token-first**: light values on `:root` (Latte), dark values under
  `body[data-ds-dark-theme]` (Mocha); the loader scopes every selector under
  `html[data-dsh-skin="catppuccin"]`.
- **Dual palette**: the light theme rides the Catppuccin Latte palette, the
  dark theme rides the Catppuccin Mocha palette, so text never fights the
  colors in either mode.
- **Flat surfaces**: every pane and panel is a solid Catppuccin tint instead of
  a gradient or image, keeping contrast predictable and the UI calm.

## Palette

- Light (Latte): lavender base `#eff1f5`, crust text `#4c4f69`, mauve accent
  `#8839ef`.
- Dark (Mocha): base `#1e1e2e`, text `#cdd6f4`, mauve accent `#cba6f7`.

## Preview

```sh
pnpm market:build                            # refresh market/dist
open market/dist/preview.html?skin=catppuccin&theme=light
node scripts/capture-previews catppuccin       # re-shoot preview/{light,dark}.jpg
```

## Known limitations

- Presentation-only: the skin mutates browser styles and never touches a
  model request.
- Flat, image-free look: there is no background artwork (this is intentional —
  the theme is a solid-color palette, not an art skin).
