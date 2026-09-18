# Paper Ink

English | [中文](README.zh.md)

A sheet of paper and a bottle of ink. Hierarchy comes from lightness, not from
hue; separation comes from whitespace, not from borders or shadows — a skin for
the dsh web GUI, shipped as a pure asset directory inside the skin-center
package.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (token remap) +
  `patches.css` (the small escape hatch). No package.json, no build step; the
  skin-center package is the only loader.
- **Token-first**: light values on `:root`, dark values under
  `body[data-ds-dark-theme]`. Every one of the 278 official `--dsw-*` semantic
  tokens is remapped — 97 colour and 181 type — plus the 50 `--dsw-static-*`
  palette entries the shell's own components read directly. Nothing falls
  through to the loader's derived fallback tint and nothing keeps the stock
  blue.
- **One ink, four opacities**: text levels are the same ink at 100 / 78 / 70 /
  56 percent. No second hue is invented to make a hierarchy.
- **Seven solid grays**: fills use `--pi-l1`…`--pi-l7`, graded geometrically in
  relative luminance so neighbouring steps stay about 1.57:1 apart and a
  monochrome chart is still readable.
- **Three status colours**: ok, warn, risk. The "business" state and the link
  token resolve to ink and the info button borrows warn, because a fourth
  colour is how a monochrome system stops being one.
- **No glow, no gradient, no glass, no shadow.** The two `--dsw-linear-*` band
  tokens resolve to a flat tone, `--dsw-mask-blur` is 0, and the whole shadow
  group is a zero-size transparent shadow.

## Background

`assets/paper-ink-light.jpg` and `assets/paper-ink-dark.jpg` are declared as
`contributes.backgroundMedia`, one per theme. Each is a sheet of paper grain
with a single ink stroke swept across it: the mark is the swept area of a round
nib whose width and ink load vary along one gesture, so both ends taper instead
of ending in a cut-off capsule. The dark variant is the same sheet inverted —
paper ink on an ink ground. Nothing in either image is a gradient or a glow;
the tonal variation inside the stroke is the nib's ink load.

## Typefaces

`assets/fonts/` ships Inter, IBM Plex Sans Thai and IBM Plex Mono, referenced
by relative path through `@font-face` (27 subset files, 424 KiB). Latin and
Latin-Extended carry the UI text and Thai carries the Thai UI; Chinese is left
to the platform stack at the end of the family list, because a CJK subset is
several megabytes and every desktop already has a better one. The three
families are **SIL Open Font License 1.1**; the skin's own code and assets are
MIT (`license` in `skin.json`).

## Patches

`patches.css` is kept to five rules, each one naming the surface it exists for:
the composer's default frost is turned off while a skin background is on screen
(by driving `--dsh-input-card-blur` to zero rather than by fighting the blur),
the official wallpaper surfaces are made transparent, the empty-state hero glow
is hidden (this skin has no glow), and two shell tints that live outside the
token table are re-pointed — the file-type icon colour and the composer's send
button, which is the one filled control in the shell that reads
`button-info-fill` instead of the primary-action set.

## Preview

```sh
pnpm market:build                            # refresh market/dist
open market/dist/preview.html?skin=paper-ink&theme=light
node scripts/capture-previews paper-ink       # re-shoot preview/{light,dark}.jpg
```

## Known limitations

- Presentation-only: the skin mutates browser styles and never touches a model
  request.
- No `hooks.mjs`. The skin is purely declarative.
- The Chinese UI keeps the platform face. That is a deliberate budget decision,
  not an oversight; the family list ends with the platform CJK stack so nothing
  falls back to a serif default.
