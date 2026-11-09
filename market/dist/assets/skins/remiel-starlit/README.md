# remiel-starlit (Remiel Starlit)

English | [中文](README.zh.md)

A fan skin themed on a Zenless Zone Zero character: cherry-pink, ice-blue and
night-indigo translucent glass. Pale morning light in light mode (the `calm`
scene) and a nocturne indigo stage in dark mode (the `nocturne` scene), with the
full `--dsw-*` palette remapped in both states (static / alias / specific / aion).

## Install

The skin center is the only loader: install it (or the all-in-one aggregate),
then install this skin from the [Creative Workshop](https://dsh-market.com) into
`$DSH_HOME/skins/remiel-starlit/`, and try it on or apply it in
"Settings -> Skins". Switching is atomic and needs no restart.

## Layout

- `skin.json` — v2 manifest: `contributes.stylesheet` / `patches` / `backgroundMedia`
  (light -> `assets/remiel-calm.jpg`, dark -> `assets/remiel-nocturne.jpg`, each with its own scrim)
- `skin.css` — L1: base colour plus the full `--dsw-*` palette remap (light on `:root`, dark on `body[data-ds-dark-theme]`)
- `patches.css` — L3: scrollbars / selection / links / focus, the aion right panel,
  the composer, and the square settings-dialog backdrop (`[role="dialog"]` over `assets/remiel-settings-*.jpg`)
- `assets/` — scene art and the settings-dialog squares
- `NOTICE` — character provenance and artwork notice

This skin is declarative only: it ships no `hooks.mjs`; the backdrop and the dialog
square ride `contributes` and plain CSS.

## Changes

### 0.1.1

- Read contrast fix, dark and light. The dark block no longer mirrors the
  `--dsw-static-neutral-*` ramp: those tokens are a theme-independent absolute
  palette in the official theme, and surfaces the shell paints from them (the
  deliverables / plan / schedule / forge / changed-files cards take their plate
  from `--dsw-static-neutral-850`) stayed dark-plate with a light label, which
  rendered white text on a light plate. `--dsw-static-neutral-00` is kept white
  because the shell uses it as a white overlay (icon plates, elevation glow, the
  sidebar flash highlight).
- Light surfaces are less transparent (`bg-base` 0.42 to 0.62, `sidebar-fill`
  0.60 to 0.74, `layer-1..3`, bubble, input, selector) so tertiary and caption
  text stays readable over the darker regions of the calm backdrop; those three
  label tiers are correspondingly deeper.
- `--dsw-alias-link` and `--dsw-alias-toast-label` are now declared. They were
  never remapped, so links resolved to the official washed-out pink over this
  skin's surfaces.

Measured: the dark card plate against `label-primary` goes from 1.28:1 to
11.07:1, and every surface/label/theme combination now clears WCAG AA 4.5:1.

## Preview

Light ([preview/light.jpg](preview/light.jpg)) · Dark ([preview/dark.jpg](preview/dark.jpg))

## Copyright

The character and the artwork are from Zenless Zone Zero, (c) miHoYo / HoYoverse.
The backdrop and dialog images in `assets/` are taken from official material
published by miHoYo (downloaded from the official website); the skin author claims
no rights to them. Their use here is personal, non-commercial fan display only, and
is not affiliated with or endorsed by miHoYo.

The skin engineering (`skin.json` / `skin.css` / `patches.css` and the palette remap)
is the author's work, released under CC BY-NC-SA 4.0 — that license does NOT extend to
the official artwork above. See [NOTICE](NOTICE).

Per the official Zenless Zone Zero notice on asset use and fan creation, this is
non-commercial personal use, and the required copyright mark and legal notice are
reproduced here:

> © All rights reserved by miHoYo
>
> Other properties and any right, title, and interest thereof and therein
> (intellectual property rights included) not derived from 《絕區零》 belong to
> their respective owners.
