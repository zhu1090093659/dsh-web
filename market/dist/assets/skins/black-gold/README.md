# Black Gold Gilded (暗夜鎏金)

English | [中文](README.zh.md)

A dark-only dsh skin: warm black lacquer and champagne gold, gilded SVG
ornament, and a feathered character backdrop. Both colour schemes resolve to
the same treatment, so `preview/light.jpg` and `preview/dark.jpg` are the
same render by construction.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full
  `--dsw-alias-*` token remap) + `patches.css` (L3 free selectors) + 13
  in-directory SVGs. No package.json, no build step, no hooks.
- **Dark-only by construction**: the palette is declared on both `:root` and
  `body[data-ds-dark-theme]`, every L3 rule drops its light/dark branch, and
  `html { color-scheme: dark !important }` pins native widgets. The market
  renderer injects the skin without running the loader's `:root` → `body`
  token clone, so the palette is declared on `body` as well.
- **Structural tokens written out**: the 14 tokens the official fallback never
  derives (button / state / mask / shadow / inverted-label groups) are declared
  explicitly. Without them a light scheme falls back to the stock light values
  and the back-to-bottom pill renders as a white circle.

## Palette

- Ground: warm black lacquer `#0a0806` .. `#221b15`
- Ink: pale champagne `#f2e9d4`
- Accent: champagne gold `#c9ab6e` (highlight `#f5e9cf`, deep `#9c8045`)
- Attention: vermilion `#c9402f` — the only red in the skin, reserved for the
  pending-approval panel

## Ornament

Scrollwork corner ornaments on the viewport frame, a meander band along the top
edge, a double gilt rule, gold-leaf flecks over brushed metal, a gilded double
rule down the sidebar edge, a whale seal stamped on a hairline, cloud-pattern
turn dividers, a gilded plaque for the workspace row, composer corner ticks with
a focus glow, and a gilded brand lockup (double-ring medallion, lozenge
separator, rule under the wordmark).

## Backdrop

The illustration is placed right-bottom at `auto 88%` and feathered with a
whole-layer `blur(1.7px)`; the layer is `inset: -48px` so the blur's soft edge
falls outside the viewport. A horizontal scrim keeps the text column readable
over the bright hair.

## Preview

`preview/light.jpg` and `preview/dark.jpg` are identical — the skin is
dark-only by design.
