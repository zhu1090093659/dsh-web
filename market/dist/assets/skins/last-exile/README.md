# last-exile (Last Exile)

English | [中文](README.zh.md)

A fan skin themed on GONZO's 20th-anniversary sci-fi masterpiece *LAST EXILE* (2003): Claus and Lavie's Vanship cruising across the skies of Anatoray and the Grand Stream storm. Features olive-brass cockpit tones in light mode and deep Claudia cyan in dark mode, with WCAG AAA contrast (> 14:1).

## Install

The skin center is the only loader: install it (or the all-in-one aggregate),
then install this skin from the [Creative Workshop](https://dsh-market.com) into
`$DSH_HOME/skins/last-exile/`, and apply it in "Settings -> Skins". Switching is atomic and needs no restart.

## Layout

- `skin.json` — v2 manifest: `contributes.stylesheet` / `patches` / `backgroundMedia`
  (light -> `assets/vanship.jpg`, dark -> `assets/grandstream.jpg`, each with its own calibrated scrim)
- `skin.css` — L1: base colour plus the full `--dsw-*` palette remap (light on `:root`, dark on `body[data-ds-dark-theme]`)
- `patches.css` — L3: Victorian industrial frosted panels, vanship gauge styling, custom emblem (`assets/vanship-emblem.svg`)
- `hooks.mjs` — runtime enhancement: dual wallpaper auto-adaptation and music player
- `assets/` — canonical scene wallpapers, SVG icons, and Public Domain / Creative Commons stereo classical piano tracks (Claude Debussy's Clair de Lune & 2nd Arabesque)
- `NOTICE` — artwork provenance and copyright notice
- `LICENSE` — CC BY-NC-SA 4.0 license text

## Preview

Light ([preview/light.jpg](preview/light.jpg)) · Dark ([preview/dark.jpg](preview/dark.jpg))

## Copyright

The anime series, characters, and Vanship mechanical designs are from *LAST EXILE*, (c) 2003 GONZO / DIGIMATION - FlyingDog, character concepts by Range Murata.
The backdrop images in `assets/` are taken from official promotional stills and artwork; the skin author claims no rights to them. Their use here is personal, non-commercial fan display only, and is not affiliated with or endorsed by GONZO.

The skin engineering (`skin.json` / `skin.css` / `patches.css` / `hooks.mjs` and the palette remap)
is the author's work, released under CC BY-NC-SA 4.0 — that license does NOT extend to the official artwork above. See [NOTICE](NOTICE).

> © 2003 GONZO / DIGIMATION - FlyingDog
