# Blue-throated Bee-eater

English | [中文](README.zh.md)

蓝喉蜂虎 (Blue-throated Bee-eater, *Merops viridis*) — a nature-themed skin
for the dsh web GUI, shipped as a pure asset directory inside the Skin Center
package. Throat azure (#2b87d8) drives brand and interaction, teal-green
surfaces echo the upperparts, chestnut (#b26a3b) is reserved for warnings —
the same palette the bird wears on its crown — and a CC BY-SA 4.0 flight
photograph fills the backdrop behind frosted panels.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (token remap) +
  `assets/blue-throated-bee-eater.jpg` (background photo) + bilingual README
  and NOTICE. No package.json, no build step; the skin-center package is the
  only loader.
- **Token-first**: light values on `:root`, dark values under
  `body[data-ds-dark-theme]`; the loader scopes every selector under
  `html[data-dsh-skin="blue-throated-bee-eater"]`.
- **Declarative backdrop**: the bird photo is painted through
  `contributes.backgroundMedia` (light/dark share the photo, different scrim
  strength) onto the shell's backdrop layer. A Wallpaper Engine wallpaper or
  a user manual background always wins over it, and the skin stays correct
  without either.
- **Frosted glass**: while any backdrop is visible (the unified
  `data-dsh-backdrop-active` marker), the composer, settings, dialogs, side
  panels and pet bubble switch to translucent frosted surfaces (backdrop blur
  + azure inner highlight); without a backdrop the skin stays opaque and
  restrained. Environments without `backdrop-filter` fall back to a stronger
  translucent veil.
- **Themed semantics**: error / warn / success / business state colors are
  kept distinct in both themes, and filled primary buttons use the
  primary-action token contract (fill + hover + foreground).

## Preview

```sh
pnpm market:build                              # refresh market/dist
open market/dist/preview.html?skin=blue-throated-bee-eater&theme=light
node scripts/capture-previews blue-throated-bee-eater       # re-shoot preview/{light,dark}.jpg
```

## Known limitations

- Presentation-only: the skin mutates browser styles and never touches a
  model request.
- Plugin-specific polish requires the plugin to expose the Skin Center v2
  semantic attributes; other plugins still receive the shared token palette.
- The try-on simulator (preview.html) does not execute skin hooks (this skin
  ships none) and paints the photo backdrop statically; frosted glass appears
  at runtime or in the simulator once a backdrop is reported.

## License and attribution

- Skin code: Apache-2.0 (see `LICENSE`).
- Background photo: Kriangsak Hongchumpae, Wikimedia Commons, CC BY-SA 4.0
  (downscaled and re-compressed). Full provenance chain in `NOTICE` and
  `skin.json` (`license` / `noticeUrl` / `sourceUrl` / `attribution`).
