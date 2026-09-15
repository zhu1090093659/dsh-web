# @linxin666/dsh-skin-binary-veil

English | [中文](README.zh.md)

Binary Veil (二进制面纱) — a code-rain skin for the dsh web GUI, shipped as a
pure asset directory inside the skin-center package. A black-and-white
silhouette film is re-rendered frame by frame into a 0/1 field: the bright
areas become a falling code rain, the silhouettes stay on top of it.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full token remap) +
  `patches.css` (L3 atmosphere and shell) + `assets/binary-veil-loop.mp4`
  (852x480, 30 fps, 3:52, H.264 + AAC, muted loop) + `preview/` (screenshots).
  No package.json, no build step; the skin-center is the only loader.
- **Backdrop**: a pre-baked video, declarative through
  `contributes.backgroundMedia` (light/dark scrims owned by the skin-center
  background control). It is centred and cover-fitted on purpose: the crop
  only ever eats the source film's own pillarbox bars, never the composition.
- **Token-first**: the twelve palette colours remap every `--dsw-*` alias;
  accent `#6bff9e` is the code green itself, panels are dark-green glass so
  the rain stays visible edge to edge.
- **Shell**: monospace chrome (sidebar, composer, tabs), 10 px uppercase
  section labels, a 2 px code-green marker on the selected row, a hairline
  green composer ring.
- **Hook-safe selectors**: every rule targets the skin-center's semantic hooks
  (`data-dsh-part`, `data-dsh-surface`, `data-dsh-plugin`) or standard ARIA
  (`[role="treeitem"]` for the workspace list). No CSS-Modules hash is
  matched, so official rebuilds cannot break the skin.
- **No hooks.mjs**: the skin is purely declarative; nothing executes.

## Preview

```sh
pnpm market:build
# then open market/dist/preview.html?skin=binary-veil&theme=dark
```

## Regenerating the backdrop

The clip is baked offline from a black-and-white source film; the effect is
not computed at runtime, so the skin costs the renderer nothing per frame.

## License

The skin CSS (skin.css, patches.css) is released under
[CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
The backdrop clip is contributed by the skin author, who holds the rights to
the source material; see the `author` field in `skin.json`.
