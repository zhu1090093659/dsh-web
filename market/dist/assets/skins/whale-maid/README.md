# Whale Girl · Sea Gaze (鲸鱼娘·望海)

English | [中文](README.zh.md)

A dual-theme dsh skin built on a **pair of matched illustrations**: a sunlit
coast for light, the same scene re-lit as a moonlit deep for dark. The chrome is
drawn in cel/animation conventions — flat fills, ink keylines, hard offset
drops — but every surface is a translucent "white gauze" so the artwork stays
visible behind the panels.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full
  `--dsw-alias-*` token remap) + `patches.css` (L3 free selectors) + generated
  SVGs and two backdrops. No package.json, no build step, no hooks.
- **A matched pair of backdrops**: `assets/whale-day.webp` (2715x1500 source,
  shipped at 2560x1414) and `assets/whale-night.webp`. Both frames are the same
  composition, so a layout tuned against the day frame still holds at night.
  Neither is colour-graded: they were drawn as a pair, and re-grading one would
  break the pairing.
- **Panels are gauze, not walls**: the renderer's own surfaces are replaced so
  the illustration shows through — the sidebar, details pane, composer card and
  the tool/context rows all read as tinted glass with a solid ink keyline. The
  app-frame coat is dropped to 0.16 in light and removed entirely in dark.

## Palette

| role | light | dark |
| --- | --- | --- |
| canvas | `#EAF4FD` | `#050E20` |
| panel | `#FFFFFF` | `#0C1A33` |
| ink | `#17294A` (deepened to `#0E192C` for body text) | `#E6F2FF` |
| brand | `#2E6FD0` | `#4E9AF0` |
| accent | `#4FB4EE` | `#5AD8F2` |

Two "readable information" hues are shared by the sidebar workspace rows and the
tool-call rows: **deep blue** `mix(brand, ink, 0.55)` in light, **gold**
`#F2C879` in dark. Measured against the real composited background (not the
nominal panel): light 7.27 / 5.72:1, dark 11.26 / 7.35:1.

## Sea motifs

Only three, each drawn rather than filtered:

- **Lace netting** — two dot grids offset by half a period, on every panel
  surface. A single grid reads as grey or a screen door; two interleaved ones
  read as netting.
- **Seigaiha arcs** — two offset rows of half-circles, `repeat-x`, used only as
  an *edge* (sidebar hem, hero bottom). Textures here are faces or edges, never
  full-bleed fields: an early revision tiled the arcs across the whole hero and
  the illustration disappeared under a fish-scale wallpaper.
- **Rising bubbles** — generated SVG tiles on the loader's own background layer,
  two tile sizes animating at different speeds for parallax. Movement is
  `background-position`, so the loop is seamless by construction.

## Chrome

- **Brand lockup** — the stock inline SVG wordmark is hidden and replaced with a
  two-part lockup: `DSH` (small, letter-spaced, muted) plus the skin name in a
  brand gradient, split by a hairline rule. The stock whale mark is recoloured
  through CSS `fill` — the DSH mark is itself a whale, so it matches the
  plush in the artwork.
- **Workspace rows** — a soft plate per workspace row, with a stronger plate and
  a brand spine on the expanded one.
- **New session** — a designed plate instead of the stock white pill: a deep-sea
  gradient with a white wave hem, a white whale (the sticker used as a
  `mask-image`, so it is the same drawing as everywhere else), and a lace ring.
  Light mode uses a sea-glass variant with deep-blue text.
- **Code blocks** — paper-white in light (which raises every syntax colour, since
  shiki's light themes assume a white background), deep-sea in dark.

## Accessibility notes

Contrast is measured against the **composited** background (illustration + scrim
+ gauze + panels), by hiding the text and sampling the screenshot:

- body text: light 4.67:1 minimum over 30 sampled segments, dark 7.14:1, zero
  below the 4.5:1 threshold;
- sidebar workspace names: 7.52:1 light, 8.58:1 dark;
- tool-call rows: 6.67 / 5.41:1 light, 7.47 / 5.43:1 dark.

Markdown tables get their own thin surface because table cells have no panel of
their own and were the only place where text over the darker part of the
artwork fell short.

## Preview

`preview/light.jpg` and `preview/dark.jpg` are rendered from the market preview
harness (`node scripts/capture-previews whale-maid`).

## License

The skin engineering (`skin.json` / `skin.css` / `patches.css` and the palette
remap) and every asset in `assets/` — the matched day/night backdrops and the
generated SVG decorations — are the author's original work, released under
[CC BY-NC-SA 4.0](LICENSE): attribution required, non-commercial, share-alike.
