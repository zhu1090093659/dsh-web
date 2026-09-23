# Astral Choir · 星辉教团

Night violet · aurora ribbons · floating halos · vigil lights

## Palette

| Role | Dark |
| --- | --- |
| Canvas | `#090714` |
| Panel | `#100d1d` |
| Raised | `#171228` |
| Body text | `#e6e1f4` |
| Muted text | `#9c93ba` |
| Border | `#2c2545` |
| Brand | `#8672d6` |
| Accent | `#9fe4f0` |
| Danger | `#c4665a` |

**This is a dark-only skin.** The same values are declared on `:root`, `body` and
`body[data-ds-dark-theme]`, so the shell renders identically regardless of the system
colour setting, and `:root { color-scheme: dark !important }` pins native controls.
The filled primary button keeps a 4.8:1 contrast ratio between its label and fill.

## Motif

A pilgrimage at night. Vertical aurora ribbons sweep the canvas and the details edge;
the sidebar seam is a violet rail with one cyan ribbon and a column of vigil lights.
The session header is a halo arc with a vigil light at each end and a curtain of small
halo arcs below. The composer carries a floating halo ring with a cyan core at each
corner and an aurora ribbon across its top edge. The workspace list is a shrine niche
with an arched glow. Cyan is reserved for signal.

## Contract compliance

- `skin.json` validates against `contracts/skin-manifest-v2.schema.json` with no extra keys.
- `skin.css` remaps all 97 non-font tokens from `contracts/official-tokens-v1.json`,
  including `--dsw-shadow-lv1/lv2/lv3`, and declares the full primary-action token set
  (`button-primary-fill` / `-hover` / `-dimmed` / `label-primary-foreground`).
- `patches.css` uses only hooks listed in `contracts/semantic-attrs-v1.md` plus the
  documented stable anchors. No hashed class names, no `:global`.
- Every colour literal is hex or 8-digit hex plus the `transparent` keyword, because the
  skin whitelist rejects colour functions.
- Follows `contracts/performance-guidelines-v1.md`: no hooks (`facets.client` omitted),
  no `will-change`, no animated `background-position`, no self-declared `backdrop-filter`.
- `body::after` (the ground plate) steps aside under `body[data-dsh-wallpaper-active]`
  and `body[data-dsh-backdrop-active]` so wallpapers and `backgroundMedia` win.
- Slot outlets are `display: contents`, so all decoration is applied to `> *`.

## Files

- `skin.json` — v2 manifest
- `skin.css` — L1 token layer
- `patches.css` — L3 atmosphere and edge kit
- `assets/` — background artwork plus three line-art SVGs (plate, sleeve, hero)
- `preview/` — try-on previews

## Install

Copy this directory to `$DSH_HOME/skins/astral-choir/` and select it in Skin Center, or install
it from the Workshop.

## License

Background artwork is original to the author and released under CC0-1.0 together with
the skin code. See `LICENSE`.
