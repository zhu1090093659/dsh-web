# Equation Sea

[中文](README.zh.md) | English

Turns the DSH Web GUI into a sea of equations: a black-hole accretion disk with
floating Euler formulas and Möbius strips behind the interface, with panels made
of glass whose thickness you can change. A pure asset directory — no
`package.json`, no build step; the skin center is the only loader.

![dark](preview/dark.jpg)

## What it is

- **The backdrop stays visible, the text stays readable** — not by dimming the UI,
  but by trading "glass thickness" for legibility
- **Dark = black glass**: the canvas lays down one 46% scrim, then conversations
  and panels stack another 40–54% on top of it; the scrim slider deepens both
- **Light = parchment**: the same image turned into an ink line drawing on aged
  paper, with 26–44% white glass and near-black body text
- **The scrim slider drives everything**: every alpha is written as
  `calc(base + var(--dsw-skin-scrim) × delta)`, so the skin center's background
  scrim control keeps working on top of the skin, across the full 0–100% range
- **Code blocks are forced opaque** — the star field must not bleed into syntax
  highlighting
- **No `backdrop-filter` on the composer card** — per the host contract, adding it
  pushes tooltips into the scroll area; this skin uses a hairline inner shadow
  instead

## Readability

Computed with WCAG relative luminance from the token alphas in `skin.css` and the
host's own nesting — the shell paints `--dsw-alias-bg-base` on the frame and the
centre column, and the surfaces inside it paint `--dsw-alias-bg-layer-1..4`. The
backdrop therefore reaches text through two composited layers, not one. Numbers
are for the worst layer of each stack:

| Mode | Backdrop behind the panel | Body | Secondary |
|---|---|---|---|
| Dark | typical star field (90% of pixels, ≤ #4f4f4f) | ≥ 13.0 : 1 | ≥ 7.7 : 1 |
| Dark | brightest pixel of the accretion disk (#ffffff) | 6.0 : 1 | 3.6 : 1 |
| Light | brightest pixel of the parchment (#f6f6f6) | ≥ 11.2 : 1 | ≥ 5.6 : 1 |

AA asks for 4.5 : 1. Body copy clears it everywhere, including directly on the
brightest pixel of the image. Secondary text is the only thing that dips below it,
and only over the disk's specular highlight (3.6 : 1); `patches.css` gives text a
contrast-preserving shadow there, and the skin center's background-scrim slider
takes it back over AA at roughly 20%.

## Preview

![light](preview/light.jpg)

## Files

```
skins/equation-sea/
├── skin.json      v2 manifest (light/dark backdrops + scrims)
├── skin.css       light/dark --dsw-* tokens + glass treatment
├── patches.css    hairlines, opaque code blocks, frosted settings modal
├── NOTICE         asset and license statement
├── assets/        backdrop.jpg / backdrop-parchment.jpg
└── preview/       dark.jpg / light.jpg
```

## License and assets

- Stylesheets (`skin.css` / `patches.css` / `skin.json`): CC0-1.0
- Backdrop imagery: provided by the skin author and distributed with the skin;
  provenance and terms are in [NOTICE](NOTICE)

Upstream repository: https://github.com/Chenjiangwen/dsh-skin-equation-sea
