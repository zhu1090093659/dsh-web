# Hive Maw · 虫巢

Chitin walls · egg-sac glow · tunnel ribs · shell-edge kit

## Palette

| Role | Dark |
| --- | --- |
| Canvas | `#060a07` |
| Panel | `#0b120c` |
| Raised | `#121b14` |
| Body text | `#e2eadf` |
| Muted text | `#93a694` |
| Border | `#24352a` |
| Brand | `#63a871` |
| Accent | `#8fe3a6` |
| Danger | `#c4544a` |

**This is a dark-only skin.** The same values are declared on `:root`, `body` and
`body[data-ds-dark-theme]`, so the shell renders identically regardless of the system
colour setting, and `:root { color-scheme: dark !important }` pins native controls.
The filled primary button keeps a 6.7:1 contrast ratio between its label and fill.

## Motif

The nest interior is the motif, not a texture overlay. Chitin double seams run down
the sidebar and details edges with a column of glowing egg-sac dots; the session
header is a hatch beam with an egg dot at each end and a scalloped shell fringe below;
the composer is wrapped in a double carapace arc at each corner with an egg chain
along its top edge. The workspace list reads as an egg chamber: dot matrix, frame and
corner framing marks. Red appears exactly once, on the approval card, as the queen's eyes.

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

Copy this directory to `$DSH_HOME/skins/hive-maw/` and select it in Skin Center, or install
it from the Workshop.

## License

Background artwork is original to the author and released under CC0-1.0 together with
the skin code. See `LICENSE`.
