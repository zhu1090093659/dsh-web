# Pixel Whale Sea

[中文](README.zh.md) | English

A top-down pixel ocean. A whale girl floats on her back and swims a slow S-curve; the
sidebar is raining.

The water is computed, not painted: twelve sea tones, broken crest lines and drifting
spray are resolved per pixel on a 256×144 canvas and upscaled with nearest-neighbour, so
every cell on screen stays hard-edged. The whale girl is a pixel cut of an illustration
— forty pixels long, ten colours, one dark outline — lying flat on the water, her body
rolling with each stroke.

## What this is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full `--dsw-alias-*` token
  remap) + `patches.css` (L3 selectors) + generated GIF/SVG. No package.json, no build
  step, no hooks.
- **A single-look dark skin**: there is no light variant. `skin.json` points **both**
  `contributes.backgroundMedia` entries at the same `assets/sea.gif` with the same scrim,
  and `skin.css` pins all 96 official alias tokens to the deep-sea palette, so a shell in
  light mode still renders the night sea — the two modes cannot drift apart because there
  is only one look. It also covers the menu / document-preview / diff tokens the shell
  added later plus the `--dsw-specific-*` family (see Contrast). This is the light-only
  precedent read the other way round, and it is declared here and in the manifest rather
  than left for a reader to infer from two identical previews.

## Layers

| Layer | File | Notes |
| --- | --- | --- |
| Sea | `assets/sea.gif` | 256×144, 500 frames, 16.7 fps, 30 s loop |
| Settings | `assets/sea-plain.gif` | same sea without the swimmer, 192×108 |
| Rain | `assets/rain-a.gif`, `rain-b.gif` | 160×220 transparent GIFs, 4 s loops, offset |
| Workspace | `assets/*.svg` | dither grid, waterline, whale mark, corner brackets, bubbles |

The loop is arithmetically seamless: wave phases, the swim path and the stroke beat are
all integer multiples of the 500-frame cycle, so frame 501 is frame 1. Each raindrop
completes a whole number of falls in its 4 s loop, splash included.

## Size

The two main GIFs are the whole weight of the skin:

| File | Bytes | MiB | What it is |
| --- | --- | --- | --- |
| `assets/sea.gif` | 5,711,209 | 5.45 | 256×144, 500 frames, 30 s — the sea and the swimmer |
| `assets/sea-plain.gif` | 3,250,096 | 3.10 | 192×108, the same sea without the swimmer |
| `assets/rain-a.gif` | 18,582 | 0.02 | 160×220 transparent, 4 s |
| `assets/rain-b.gif` | 18,295 | 0.02 | 160×220 transparent, 4 s |
| `assets/*.svg` | 11,344 | 0.01 | eight workspace parts |

The directory is 9,750,392 bytes (9.30 MiB) over 20 files. Rebaking the sea at the
settings sheet's 192×108 would land near 2.6 MiB; this version keeps 256×144 so the
crest lines and the swimmer stay legible.

## Palette

| Role | Value |
| --- | --- |
| Deepest water | `#050C15` |
| Crest | `#55A3AC` |
| Spray / highlight | `#86CDC9` |
| Character base | `#245AB4` |
| Outline | `#0A1522` |
| UI accent | `#3FB3A9` |

Twelve sea tones, twelve character tones and four vignette levels fill 96 palette slots,
well inside the 256-colour GIF ceiling.

## Workspace

The sidebar carries an 8 px dither grid, a stepped waterline along its bottom edge and a
20×10 pixel whale mark in the corner — all on the element's own `background-image`, so
they always sit behind the content. The composer card is squared with a 1 px teal border,
a 3 px hard drop shadow and four corner brackets; scrollbars become 6 px rails; every SVG
drops its anti-aliasing and squares its stroke caps.

## Contrast

This is a single-look dark skin, so every surface the shell still takes from the light
theme has to be pinned by hand. Three places do that in the current DSH build:

| Where | What the shell uses | Fix |
| --- | --- | --- |
| Menu surface (model picker, command palette) | `--dsw-menu-surface-fill` = `#f8f9fa94` plus `blur(40px)` in light | set to `#0a1826f5` on `body` from `patches.css`, with `--dsw-menu-backdrop-filter: none`. Neither token carries the `alias` / `specific` prefix, so the loader's `:root → body` clone drops them — writing them in `skin.css` lets the shell's body value win |
| Sidebar / composer / bubbles | `--dsw-specific-*`. The `--dsw-alias-specific-*` spelling occurs 0 times in the official theme, so it never applied | remapped under the correct names in `skin.css` |
| Deliverables / changes / plan / schedule cards | the components branch on `body[data-ds-dark-theme]` instead of tokens and fall back to `neutral-50` in light | `patches.css` mirrors the dark branch into both modes, anchored on `data-presented-file` / `data-changed-files` / `data-plan-card` / `data-tool="schedule_create"` |

Measured with WCAG on the composited background: menu 1.59:1 → 14.17:1, group header
2.77:1 → 5.50:1, sidebar 1.18:1 → 10.51:1, composer 1.23:1 → 12.60:1, bubble
1.11:1 → 7.13:1, file cards 1.18:1 → 12.53:1.

## Evidence

`preview/{light,dark}.jpg` and the two files under `evidence/` are **the same capture**,
not a frame of the background animation: a DSH shell with this skin applied through the
skin center, one short conversation in it, the preview-notice dialog dismissed, once with
`data-ds-dark-theme` absent and once with it set, and the frame sampled out of the live
`<img>` to confirm the GIF was playing when the shot was taken. The committed file is
2048×1152 pixels, saved exactly as captured — no downscale and no resampling — and both
themes land on the same night sea because that is what the skin is.

## Notice

The character "Whale-chan" is a line the contributor owns — the same character as
whale-fantasy, rainy-night, shuimo-danqing and whale-watercolour — and not a character
from any published work. The illustration is AI-generated: produced by the contributor on
a local ComfyUI with an open image model, from self-written prompts and self-supplied
references, not reposted, no third-party material. Only the downsampled 40×30 pixel
sprite ships here; the artwork itself is outside the CC BY-NC-SA 4.0 grant, and this skin
is for personal, non-commercial use only. It is unofficial and unrelated to DeepSeek
Harness or this repository. Copyright and compliance responsibility for this contribution
rests with the contributor (stushansusu), who declares the provenance above and answers
for it. See [NOTICE](NOTICE).
