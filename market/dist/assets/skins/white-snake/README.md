# white-snake (White Snake)

English | [中文](README.zh.md)

A fan skin themed on Light Chaser Animation's oriental fantasy epic *White Snake* (2019) and *White Snake: Afloat* (2024): the romantic encounter under oil-paper umbrellas at the West Lake Broken Bridge in light mode, and destiny at the snowy Yongzhou ridges in dark mode. Features silk parchment, jade emerald, and cyan aura tones with WCAG AAA contrast (> 14:1).

## Install

The skin center is the only loader: install it (or the all-in-one aggregate),
then install this skin from the [Creative Workshop](https://dsh-market.com) into
`$DSH_HOME/skins/white-snake/`, and apply it in "Settings -> Skins". Switching is atomic and needs no restart.

## Layout

- `skin.json` — v2 manifest: `contributes.stylesheet` / `patches` / `backgroundMedia`
  (light -> `assets/broken-bridge.jpg`, dark -> `assets/snake-destiny.jpg`, each with its own calibrated scrim)
- `skin.css` — L1: base colour plus the full `--dsw-*` palette remap (light on `:root`, dark on `body[data-ds-dark-theme]`)
- `patches.css` — L3: oriental silk frosted panels, jade hairpin accents, custom SVGs (`assets/white-snake-emblem.svg` and `assets/white-snake-hero.svg`)
- `hooks.mjs` — runtime enhancement: dual wallpaper auto-adaptation and music player
- `assets/` — canonical scene wallpapers, SVG icons, and Public Domain stereo ambient piano tracks (Erik Satie's Gnossienne No. 1 & Gnossienne No. 3)
- `NOTICE` — artwork provenance and copyright notice
- `LICENSE` — CC BY-NC-SA 4.0 license text

## Preview

Light ([preview/light.jpg](preview/light.jpg)) · Dark ([preview/dark.jpg](preview/dark.jpg))

## Copyright

The animated films, characters, and concept artwork are from *White Snake* and *White Snake: Afloat*, (c) Light Chaser Animation Studios.
The backdrop images in `assets/` are taken from official promotional stills and posters; the skin author claims no rights to them. Their use here is personal, non-commercial fan display only, and is not affiliated with or endorsed by Light Chaser Animation.

The skin engineering (`skin.json` / `skin.css` / `patches.css` / `hooks.mjs` and the palette remap)
is the author's work, released under CC BY-NC-SA 4.0 — that license does NOT extend to the official artwork above. See [NOTICE](NOTICE).

> © Light Chaser Animation Studios
