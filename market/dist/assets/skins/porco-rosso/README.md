# porco-rosso (Porco Rosso)

English | [中文](README.zh.md)

A fan skin themed on Studio Ghibli's classic animation *Porco Rosso* (1992): the Savoia S.21 soaring across the Adriatic Sea, with warm parchment and racing red in light mode and deep indigo stratosphere in dark mode. Complete `--dsw-*` palette remapping with WCAG AAA contrast (> 14:1).

## Install

The skin center is the only loader: install it (or the all-in-one aggregate),
then install this skin from the [Creative Workshop](https://dsh-market.com) into
`$DSH_HOME/skins/porco-rosso/`, and apply it in "Settings -> Skins". Switching is atomic and needs no restart.

## Layout

- `skin.json` — v2 manifest: `contributes.stylesheet` / `patches` / `backgroundMedia`
  (light -> `assets/porco001.jpg`, dark -> `assets/porco002.jpg`, each with its own calibrated scrim)
- `skin.css` — L1: base colour plus the full `--dsw-*` palette remap (light on `:root`, dark on `body[data-ds-dark-theme]`)
- `patches.css` — L3: frosted glass panels, composer styling, custom icons (`assets/savoia-hero.svg` and `assets/porco-emblem.svg`)
- `hooks.mjs` — runtime enhancement: dual wallpaper auto-adaptation and music player
- `assets/` — canonical scene wallpapers, SVG icons, and Public Domain stereo classical piano tracks (Erik Satie's Gymnopédie No. 1 & Chopin's Nocturne Op. 9 No. 2)
- `NOTICE` — artwork provenance and copyright notice
- `LICENSE` — CC BY-NC-SA 4.0 license text

## Preview

Light ([preview/light.jpg](preview/light.jpg)) · Dark ([preview/dark.jpg](preview/dark.jpg))

## Copyright

The film, characters, and mechanical designs are from *Porco Rosso*, (c) Studio Ghibli / Hayao Miyazaki.
The backdrop images in `assets/` are taken from official stills published by Studio Ghibli; the skin author claims no rights to them. Their use here is personal, non-commercial fan display only, and is not affiliated with or endorsed by Studio Ghibli.

The skin engineering (`skin.json` / `skin.css` / `patches.css` / `hooks.mjs` and the palette remap)
is the author's work, released under CC BY-NC-SA 4.0 — that license does NOT extend to the official artwork above. See [NOTICE](NOTICE).

> © Studio Ghibli
> © 1992 Studio Ghibli - NN
