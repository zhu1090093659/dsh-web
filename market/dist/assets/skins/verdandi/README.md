# Verdandi · White Vow (薇儿丹蒂 · 纯白圣誓)

English | [中文](README.zh.md)

A portrait skin for the dsh Web GUI built around Verdandi and the White Vow:
deep crimson carries navigation and session chrome, bridal white carries
reading and editing surfaces, and soft gold is reserved for knight crests and
interaction hairlines. Light and dark schemes are both first-class.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (L1 token layer,
  including the five official `--dsw-alias-*` aliases the v1 plugin installed
  through `theme.overrideTokens`) + `patches.css` (L3 free selectors) +
  `hooks.mjs` (one documented escape hatch) + `assets/`. No package.json, no
  build step.
- **Ported from the v1 plugin skin** (`@hjbztlbr/dsh-client-ui-skin-verdandi`)
  with `scripts/dsh-skin-migrate-v2.mjs`. The 19 raster artworks shipped here
  are byte-identical to the constants the v1 bundle inlined; the 6 SVG
  ornaments stay inline data URIs inside `hooks.mjs` for the same reason.
- **Raster art is served from `assets/`**: the v2 pipeline inlines served CSS
  into a `<style>` tag without rewriting relative `url()`, so a relative
  `assets/...` reference would resolve against the document base and 404. The
  hooks therefore set the 27 `--vd-art-*` body variables from `ctx.assetBase`,
  exactly where the v1 plugin set them from inline data URIs.
- **Class names are stable**: the v1 build baked CSS-module hashes
  (`DqQE8W_characterStage`) into the stylesheet and the runtime. Here they are
  the skin-owned names `vd-characterStage`, `vd-characterFigure`,
  `vd-figureLeft`, `vd-figureRight`, used by both `patches.css` and the hooks.
- **No `contributes.backgroundMedia`, on purpose**: v1 paints the light/dark
  scene inside the conversation pane from `--vd-art-workspace-*`, so the
  backdrop shrinks with the chat column when a side panel opens.
  `backgroundMedia` fills a fixed full-viewport layer, so declaring it would
  paint the same art twice and spread it under the sidebar and details panes.
  The scene stays where v1 put it.
- **Wide tables stay inside the card**: for four or more columns the host draws
  the table wider than the message column and keeps the overflow hidden until
  hover. That assumes a borderless message; this skin draws a bordered paper
  card, where the bleed reads as content escaping the card. `patches.css` pulls
  the wrapper back to `width: 100%` and lets the cells wrap, so a wide table
  renders inside the card exactly like a narrow one. The host's full-bleed
  behaviour is given up in exchange.

## Artwork

19 WebP/JPEG files under `assets/`, resolved at runtime through
`ctx.assetBase`. The left and right character figures, the light and dark
workspace scenes, the sidebar bridal CG, the assistant avatar pair, the
composer rings and the detail-pane easter egg are game-derived; see
`NOTICE` for the rights boundary. The three bridal corner ornaments and the
invitation folder icon are original to this project.

## Motion and decoration

`hooks.mjs` is the only executable part, and it is a direct port of the v1
plugin's client effects:

- decoration nodes (`data-verdandi-decoration`) mounted on official anchors
  (sidebar, session header, composer card, details pane, assistant markdown
  rows), plus a character stage inside the conversation pane;
- projected state on `body` and the conversation pane
  (`data-verdandi-workspace` / `modal-open` / `sidebar-size` / `phase` /
  `view`, `data-verdandi-header`, `data-verdandi-slip`);
- one MutationObserver on the document element, one ResizeObserver over the
  measured targets and one animation frame per change, with every effect
  retracted through `ctx.onCleanup`.

## Palette

- Navigation: deep crimson `#8e2438` (deep `#681626`, dark `#4e0f1d`)
- Reading surfaces: bridal ivory `#fffdfb`, warm paper `#f8f2ed`
- Accent: soft gold `#c7a86b` (light `#e6d5a9`)
- Dark scheme: crimson lifts to `#9d2d43`, ivory becomes `#21151a`

## Rights

Code and the original ornaments are MIT. The game-derived artwork is not
covered by that license and stays non-commercial; the full boundary and the
attribution chain live in `NOTICE`. This skin is unofficial and is not
affiliated with the game's rights holders or with DeepSeek Harness.

## Preview

`preview/light.png` and `preview/dark.png` are the try-on renders used by the
Workshop gallery.
