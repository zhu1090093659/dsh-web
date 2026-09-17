# Kaleido (万象镜)

English | [中文](README.zh.md)

A dsh skin whose backdrop is **a different anime illustration on every load**,
fetched from a third-party random-image API, with a fully transparent shell on
top of it. The skin cannot choose colours that suit the art — it does not know
the art — so the design budget sits in the *shell* instead: one neutral scrim,
one prism accent, and two fading rails.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full
  `--dsw-alias-*` token remap) + `patches.css` (L3 free selectors) +
  `hooks.mjs` (the trusted escape hatch) + four generated SVGs. No
  `package.json`, no build step.
- **The wallpaper is not in this directory.** It is fetched at runtime from
  `https://api.elaina.cat/random/`. Nothing from that service is redistributed
  here — see "Third-party content" below.

## Why the wallpaper URL can only come from hooks

Two fail-closed walls stand in the way, both verified against the shipped code:

1. `contributes.backgroundMedia.src` must be a path inside the skin directory
   (`core/manifest-v2/validate.ts`, `checkRelPath` rejects any protocol URL).
2. A remote `url()` inside a stylesheet is rejected **wholesale**. Measured with
   a remote URL in `patches.css`:

   ```
   GET /api/skin-center/v2/skins/kaleido/patches
   HTTP 422  {"error":"css-whitelist-violation",
              "violations":["patches.css: remote URL \"https://…\" is not allowed;
                             ship the asset in the skin directory"]}
   ```

   The entire sheet is dropped — the browser receives no rules at all, and
   nothing surfaces in the UI. So the address is injected by `hooks.mjs` as an
   inline custom property (`--kl-art` on `body`), which the whitelist does not
   govern.

## What the screen shows while it loads

Measured on the real GUI (`Page.addScriptToEvaluateOnNewDocument` sampler, one
frame per tick) for a refresh:

```
first paint 72ms · shell boots · hooks writes --kl-art 744ms
random image download 764→1878ms · wallpaper painted 1889ms
```

That is ~1.9 s before the art can possibly exist, so **whatever is painted in
the meantime reads as "a default background"**. The skin therefore paints a
plain base (a colour that follows light/dark) rather than a motif, and the
prism plate is demoted from "loading screen" to "failure screen": it is only
painted when `hooks.mjs` sets `data-kaleido-plate` after three consecutive
fetch failures. Normal loads go straight from a bare base to the picture, with
no fade-in on the first image.

Rotating to the *next* image is a true cross-fade — the outgoing art is parked
on `body::before` (`--kl-prev`) while the incoming one fades in above it, so no
frame ever shows a flat colour.

## The shell

- The two side columns are a **veil that fades to zero** toward the middle, not
  a panel: text stays readable on the left, the artwork is uncovered on the
  right, and the wallpaper runs continuously from edge to edge (the Workspaces
  block is see-through too).
- No column carries a `backdrop-filter`. It would make the column the
  containing block for `position: fixed` descendants, and the settings dialog
  lives inside the sidebar subtree. Real blur is used only on leaves: the
  composer card and the floating layers.
- One prism accent (violet → cyan) appears only on focals: the CTA, the caret,
  the focus ring, the composer's border and its two viewfinder brackets.

## Rotation

The image is **preloaded before it is shown**, so the swap never happens on a
half-downloaded picture.

| Trigger | Interval |
| --- | --- |
| Timer | 4 minutes |
| Page load / skin switch | every time (cache-busted with `?v=`) |
| Tab hidden longer than 45 s, then shown again | on return |
| `Ctrl+Alt+K` | manual (2.5 s cooldown) |

Measured contrast over a real wallpaper, sampled from rendered pixels:
7.8–13.4:1 for body text and 7.8–13.4:1 in the rail, against a 4.5 floor.

## Third-party content

The wallpaper comes from a **third-party random-image API**
(`https://api.elaina.cat/random/`). Each request returns an arbitrary
illustration whose provenance and licensing this skin cannot verify. Nothing is
redistributed in this repository — the images are fetched by the browser at
runtime, one per view — but a reviewer should weigh that dependency
deliberately. If the API is unreachable, the skin falls back to its own prism
plate, so the UI never renders empty.

## Preview

`preview/light.jpg` and `preview/dark.jpg` are two real renders (different
wallpapers, because the wallpaper is random).
