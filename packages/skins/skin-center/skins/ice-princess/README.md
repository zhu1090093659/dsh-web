# Ice Crystal Princess (冰晶公主)

English | [中文](README.zh.md)

A dark-only dsh skin built to match a desktop-pet character. Both colour
schemes resolve to the same treatment, so `preview/light.jpg` and
`preview/dark.jpg` are the same render by construction (measured: 0% pixel
difference between the two states).

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full `--dsw-alias-*`
  token remap) + `patches.css` (L3 free selectors) + in-directory SVG ornament
  and one WebP backdrop. No package.json, no build step, no hooks.
- **Dark-only by construction**: the palette is declared on both `:root` and
  `body[data-ds-dark-theme]`, every L3 rule drops its light/dark branch, and
  `:root { color-scheme: dark !important }` pins native widgets.
- **Player-decoration tokens written under the names the shell actually reads**
  (`--dsw-specific-bubble`, `--dsw-specific-sidebar-fill`, …) — the
  `--dsw-alias-specific-*` spelling looks equivalent but is never read, which
  leaves the stock light values in force.

## Palette

Taken from the character's own design sheet, so the GUI and the desktop pet are
the same person:

| Role | Colour | What it paints |
| --- | --- | --- |
| Deep navy | `#1A4B94` | coat and bow; the deep end of every rule |
| Sapphire | `#3277D8` | trim and gems: CTA, links, selection |
| Sky blue | `#63B8F0` | hair highlights: snowflake/gem stickers, hero rays |
| White | `#FFFFFF` | the dress body: panels |
| Silver | `#D6E4F5` | belt and edging: every hairline |
| Eye blue | `#589CE6` | folded into the sapphire step |
| Skin | `#F9DDD0` | the only warm colour — one small disc at the hero's centre |

## Ornament

Four frost-corner florets (one motif mirrored four times), a hexagonal seal, a
hairline double rule down the sidebar edge, corner ticks on the composer, a
frost-turn divider, and a faceted ice-gem CTA. The hero is a six-fold
snowflake rosette; the workspace panel is an ice wall.

## Backdrop and wind

The character art is composited into `assets/bingjing-bg.webp`: the figure at
0.85 scale centred at 65% of the frame, feathered with an elliptical mask, over
a structureless colour field built from the artwork's own tonal ramp — a
blurred copy would leave a ghost of the figure in the margins, and it cannot be
moved to coincide because aligning it shrinks it below frame size.

Two snow tiles animate across the loader's background layer with a `linear`
`background-position` loop. They use different tile widths (1400px / 900px), so
one 46s cycle runs them at different speeds — parallax. `prefers-reduced-motion`
removes the layer entirely.

## Preview

`preview/light.jpg` and `preview/dark.jpg` are identical — the skin is dark-only
by design.
