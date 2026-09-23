# Ember Fall · 余烬

Gunmetal · weld seams · hazard stripes · ash haze

## Palette

| Role | Dark |
| --- | --- |
| Canvas | `#0a0c0f` |
| Panel | `#101418` |
| Raised | `#171c21` |
| Body text | `#e8e6e1` |
| Muted text | `#9ba1a8` |
| Border | `#2a3138` |
| Brand | `#c9793a` |
| Accent | `#e8a860` |
| Spark | `#8a63c9` |

**This is a dark-only skin.** The same values are declared on `:root`, `body` and
`body[data-ds-dark-theme]`, so the shell renders identically regardless of the system
colour setting, and `:root { color-scheme: dark !important }` pins native controls.
The filled primary button keeps a 5.6:1 contrast ratio between its label and fill.

## Motif

A wreckage recovery site. The sidebar seam is a weld bead: two rails, a dashed bead
line and sparse violet sparks. The session header carries a smoke veil over a weld-dash
rail with a rivet at each end, and an ember glow seam underneath that fades at both
ends. The composer is plated with 45-degree gusset rays fired from each corner and a
weld-bead dash chain on its top edge. The workspace list is an ammo crate with a
crossing strap. Approval cards wear the hazard stripe.

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

Copy this directory to `$DSH_HOME/skins/ember-fall/` and select it in Skin Center, or install
it from the Workshop.

## License

Background artwork is original to the author and released under CC0-1.0 together with
the skin code. See `LICENSE`.
