# Pink Sakura

English | [中文](README.zh.md)

Pink Sakura is a restrained cream-pink developer skin for the dsh web GUI,
shipped as a pure asset directory inside the Skin Center package.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (token remap).
  No package.json, no build step; the skin-center package is the only loader.
- **Token-first**: light values on `:root`, dark values under
  `body[data-ds-dark-theme]`; the loader scopes every selector under
  `html[data-dsh-skin="pink-sakura"]`.
- **Plugin-aware**: stable semantic attributes cover the task board, Git graph,
  SSH, settings cards, community marketplace, and pet bubble.
- **Wallpaper-ready**: panels become translucent while the built-in Wallpaper
  Engine bridge is active, without shipping or redistributing wallpaper media.

## Preview

```sh
node scripts/gallery-build                   # register into gallery/manifest.js + styles.js
open gallery/preview.html?skin=pink-sakura&theme=light
node scripts/capture-previews pink-sakura       # re-shoot preview/{light,dark}.png
```

## Known limitations

- Presentation-only: the skin mutates browser styles and never touches a
  model request.
- Plugin-specific polish requires the plugin to expose the Skin Center v1
  semantic attributes; other plugins still receive the shared token palette.
