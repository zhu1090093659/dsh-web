# @linxin666/dsh-skin-tokyo-night

English | [中文](README.zh.md)

Tokyo Night (东京夜行) — a Tokyo night-city skin for the dsh web GUI, shipped
as a pure asset directory inside the skin-center package, paying homage to
the classic Tokyo Night developer palette.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full token remap) +
  `patches.css` (component patches) + `assets/` (Tokyo night-city backdrop
  art) + `preview/` (light/dark screenshots). No package.json, no build step;
  the skin-center package is the only loader.
- **Backdrop**: an anime-style Tokyo night cityscape (Tokyo Tower glowing
  warm orange under a deep indigo-violet sky) is declarative via
  `contributes.backgroundMedia` (light/dark scrims), owned by the skin-center
  background control; the scrim flips live with the light/dark theme.
- **Token-first**: light values on `:root` (Tokyo Night Day variant), dark
  values under `body[data-ds-dark-theme]` (Tokyo Night Night classic); the
  loader scopes every selector under `html[data-dsh-skin="tokyo-night"]`.
  Deep indigo `#1a1b26` base, tokyo blue `#7aa2f7` primary, sunset orange
  `#ff9e64` accent, magenta/purple touches — the blue/indigo family replaces
  the blue/deepseek tokens throughout.
- **No hooks**: `hooks.mjs` is deliberately absent — a declarative-only skin
  with no runtime scripts.

## Preview

```sh
pnpm market:build                              # refresh market/dist
open market/dist/preview.html?skin=tokyo-night&theme=light
```

## License

The skin code follows the repository license (Apache-2.0). The backdrop
artwork is created by the contributor with MiMo image generation; the
contributor owns the output and hereby releases it under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public
domain), so it can be redistributed freely with the skin. See the
`license` / `licenseUrl` / `attribution` fields in `skin.json`.
