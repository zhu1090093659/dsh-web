# Whale Girl · Clear Watercolour (鲸鱼娘 · 清透水彩)

English | [中文](README.zh.md)

A **light-only** dsh skin painted on a single watercolour illustration: a blue-haired
girl with white roses and a silver pendant chain in her hair, emerald eyes, drifting
petals over a pale blue wash. The chrome is not drawn *on* the picture — it is a
**translucent cream veil, and the picture shows through from behind the paper**.
Every colour in the palette was measured out of that illustration; nothing was picked
by eye.

## What it is

| | |
| --- | --- |
| id | whale-watercolour (order 54, accent `#1B5D9A`) |
| theme | **light-only** — the dark half renders the same palette, enforced (see below) |
| background | `assets/bk-bg.webp` — 2560x1437, WebP q80, 343,426 B, **AI-generated** (ComfyUI on a local open-source image model, from the author's own prompts and reference images) — **scaled only, not graded** (PSNR 37.27 dB) |
| fonts | Noto Serif SC for headings (variable weight), Noto Sans SC / DengXian for text |
| hooks | none — pure CSS assets, nothing executes |

## The palette is measured, not chosen

The illustration is bright (luminance median 198) and almost unsaturated (saturation
median 0.10), so "low-saturation watercolour" is a statement about the data, not a
style applied on top. Nothing is filtered or re-graded.

| role | colour | where it came from |
| --- | --- | --- |
| cream (panel / veil base) | `#FAF9F5` | **34.6 %** of the picture is this |
| ink (body text) | `#0D2045` | mean of the darkest 0.2 % (`#0E2249`), pressed one step deeper |
| sky (brand / interactive edge) | `#1B5D9A` | mean of the most saturated 2 % (`#1E66A9`), pressed one step deeper |
| ice blue (decorative rules only) | `#B0C8D8` | the cloud band |
| jade (state only) | `#186654` | the measured eye green `#6F9C8F`, washed out by the watercolour, deepened in the same hue |
| mist (hover surface) | `#E7EEF4` | between cream and ice blue |

Body text on the panel is **15.22:1** in both halves of the manifest.

## Design language: a sheet of watercolour paper

| element | treatment |
| --- | --- |
| surfaces | translucent cream veil with `backdrop-filter`; paper edges are a `0 1px 0` highlight, not a `border` |
| rules | **tapered**: every horizontal line is a `linear-gradient` that fades out at both ends, never a full-width hairline |
| state | jade only: focus ring, the 2 px bar on the current row, `[aria-selected]`, link hover |
| solid fills | exactly one in the chrome: send. New session is a veil under a sky hairline ring, and send drops to that same outline while disabled |
| type | headings in Noto Serif SC, text in Noto Sans SC / DengXian |
| glow | small text inside cards and body text each carry a one-directional white `text-shadow` — the paper looking thicker under the ink |
| radii | five steps: 4 / 8 / 12 / 18 / 24 px, plus 999 px pills |

Two things that must not be merged back together: **decorative rules are ice blue,
interactive edges are sky/jade.** Ice blue over any of these veils measures only
1.65-2.18:1, so it can never reach the 3:1 WCAG wants for an interactive boundary.

## The five veil knobs

| token | value | picture retained | where |
| --- | --- | --- | --- |
| `--bk-veil-sidebar` | 0.56 | 44 % | sidebar / masthead panel / workspace list |
| `--bk-veil-head` | 0.56 | 44 % | conversation header |
| `--bk-veil-card` | 0.52 | 48 % | composer / new session (carries `blur(12px)`) |
| `--bk-veil-sheet` | 0.38 | 62 % | conversation sheet (the blur sits on its `::before`) |
| `--bk-veil-menu` | 0.80 | 20 % | overlays |

## Composition: the picture stays, the interface moves aside

The illustration is 2560x1437 and the shell sits near 16:9, so `object-fit: cover`
has **no slack on either axis** - `object-position` cannot move her. Landing at the
shell's aspect puts the character exactly where the interface is densest: the
empty-session title crosses her eyes, the branch chip sits on the left iris, the
composer cuts through her nose (2026-10-28 intake note).

Re-framing the asset is the other way out and the wrong one: her face is the densest
area of this 2.1 MB illustration, so moving it anywhere in the viewport only swaps one
high-detail region for another under the text - a zoomed-out recentre still leaves
65 % of the face inside the interface column and opens an unfilled band at the edges.

So the picture keeps its composition and the **interface gets its own local scrim**:
the conversation column, the composer and the header band carry one extra cream layer
(radial 0.62 -> 0.42 -> 0.10 -> 0, over a 0.30 / 0.14 / 0.34 vertical wash).

The layer is a **band, not a wash over the frame** (2026-11-05 intake note: the first cut
faded out too late, so the picture-only columns either side of the interface were veiled
too and the illustration went milky). The band is 980 px wide, centred like the shell's
content column, and dies inside a 10 % ramp at each end. Measured on the running shell at
1280x800 under a Laplacian high-pass (mean `|4N - N|` per pixel over the region), same
layout, same frame:

| region | no scrim | this band | the first full-frame wash |
| --- | --- | --- | --- |
| interface band, 250-1030 px | 27.58 | 16.27 | 15.98 |
| picture column, left 0-150 px | 9.53 | 9.56 | 7.74 |
| picture column, right 1140-1280 px | 4.88 | 4.94 | 3.96 |

The conversation sheet and its frost sit on that same band (2026-11-07 intake note: a
full-width sheet and a full-width `backdrop-filter` turned the two picture columns into
blue-white fog and hid the scrim boundary). Measured on the same frame, same viewport,
high-pass per pixel: picture column left 0-150 px `6.59 -> 12.04` (home frame `10.77`),
right 1140-1280 px `0.81 -> 5.10` (home frame `4.80`).

The interface lands at the same softening the review accepted, while the picture columns
sit on the no-scrim baseline instead of losing a fifth of their detail, and the scrim's
own edge is now visible in the frame.

Each value was **reverse-solved** against real pixels, and the sampling method
matters: taking "the darkest 1 % of the box" as the paper reads **the text itself**
(or the dark mass of her hair) rather than the paper under the glyphs, which forced
every face one tier too thick. The values above come from **per-cell paper
sampling** instead — 14x48 px cells, the p75-luminance pixel of each cell taken as
the paper, then solved back through `under = (P - a*VEIL) / (1 - a)` so any
candidate alpha can be re-composited and checked per sample. Worst 5 % of cells:
sidebar body text **9.14:1**, header **8.18:1**, sheet **7.8:1**, composer
**10.67:1**, every secondary and state tier at 5.2:1 or better. The sheet is the thinnest
face on purpose - 62 % of the picture comes straight through, her dark blue hair sitting
right under the text; 0.34 is where body text starts touching the 7:1 edge. No text colour was
changed for this. (The absolute floor, before margins, is: fold every real-shell box back onto the source
image, measure the darkest 1 % under it, then solve for the smallest alpha that keeps
the secondary text at 4.5:1. The compositing space is **sRGB (gamma-encoded)**, not
linear light — measured: `rgba(250,249,245,0.678)` over `rgb(38,60,100)` lands on
`rgb(182,188,198)`, which the sRGB prediction hits per channel (181.7 / 188.2 / 198.3)
while the linear-light prediction is off by 29. Solving in linear light over-estimates
every surface by about one tier. Blur is not a substitute: the sheet sits on a large
dark area of her hair, and taking blur from sigma 0 to 26 only lifts the worst ratio
from 0.79 to 0.96 — it smears thin strands but cannot lift a large dark mass.

## Light-only: the palettes match, and the pixels are pinned to match

`light` and `dark` are written with **byte-identical values** (no `darkOnly`): this is
daylight watercolour, and a night version of it would be a different picture.

Equal palettes are not enough, because four things in the shell still produce a second
set of values under `body[data-ds-dark-theme]`:

| source | count | how it is pinned |
| --- | --- | --- |
| the atmosphere engine's own dark branch for `--sk-*` | 5 | re-declared on `body:not(:root)` with the same expression the light half uses |
| shell tokens the skin never remaps (outside the official 299-token contract, or inside it but outside this skin's 95-token remap) | 22 | re-declared with the shell's own light values |
| two dark rules that are not tokens (the tool-icon tile's fill, the right-pane guide glyph's colour) | 2 | pinned in the shard by semantic hook plus structure |
| `color-scheme: dark` — which makes every author-unstyled native control paint white text | 1 | `body:not(:root)[data-ds-dark-theme] { color-scheme: light }` |

Because the skin is light-only, a store's dark tier shows two preview images that
are **the same bytes** — `preview/light.jpg` and `preview/dark.jpg` share a sha256
(`F586C5C2…EDF705`) — and a dark-mode user who switches to it gets the same light
interface. That is the intent, not a missing file.

## Evidence

Four files under `evidence/`, all captured on the running shell (:19387) at a
**1280x800 viewport, device pixel ratio 1**, committed as captured — no scaling, no
resampling:

| file | what it shows |
| --- | --- |
| `whale-watercolour-home.jpg` | the empty-session home page — the welcome title (in this capture the shell's Chinese UI, "探索未至之境"), the workspace and preset chips and the centred composer over her face, i.e. the composition the 2026-10-28 note named, now under the local scrim |
| `whale-watercolour-light.jpg` | a session with a real question and answer, long text sitting on her dark blue hair |
| `whale-watercolour-dark.jpg` | the light capture, byte for byte — see the note below |
| `whale-watercolour-theme-parity.png` | three labelled panels: light, dark, and the absolute difference of the two scaled by 16 |

`preview/light.jpg` and `preview/dark.jpg` are byte-identical to `evidence/whale-watercolour-home.jpg`:
the store cover is the clean home frame, not the session frame.

All four images were re-shot after the 2026-11-05 review with **the desktop-pet plugin closed and
the host's "background blur when there is content" slider at zero**, so no floating pet window sits
over the answer text or the message toolbar, and the image columns beside the column are the
unblurred artwork — the scrim's edge is visible.

**The dark entry is the light file itself, and it is declared rather than passed off as a
second theme.** This skin pins every token to the light palette, so a dark-theme render can
only come out as the same pixels; the parity panel says so in one labelled line
(`0 of 1,024,000 sampled pixels differ`) instead of leaving the reader to guess. The store's
dark tier therefore shows one image, which is the intent already recorded in the manifest.

## Verification

Everything above was measured on the running shell (:19387) and on the official
market try-on page, not estimated:

| measurement | result |
| --- | --- |
| every custom property the shell declares on `body`, light vs dark | **0 / 553 differ** |
| every visible element's computed style, light vs dark, on the live shell (8 scenes: hero, session, right pane, settings, menu, composer focus, composer menu, hover card) | **0 differences** (the only residuals were rows of new streaming output the live session created between the two snapshots, plus one entry animation caught mid-flight) |
| the light side, after pinning vs before pinning | **36 / 36 token values unchanged** |
| official try-on page render, light vs dark, 1280x800 | **0 of 1,024,000 pixels differ** |
| control: the same harness on a dual-theme skin | 99.999 % of pixels differ (so the harness really switches themes) |

## Attribution and licence

- **Skin engineering** (skin.css, patches.css, the palette, the geometry and the
  watercolour decoration language): original work by the author, stushansusu.
- **Background illustration (`assets/bk-bg.webp`): AI-generated material.** The
  author produced it locally with ComfyUI on an open-source image model, from
  prompts and reference images written and supplied by the author. It is not a
  repost and contains no third-party material; the shipped file is that material
  scaled and re-encoded, with no grading. Rights remain with the author, who
  carries the copyright and compliance responsibility for it.
- **Character and work:** the blue-haired girl is the author's own "whale girl"
  character line (the same character as `whale-fantasy`, `rainy-night` and
  `shuimo-danqing`). No character, mark or trademark from an existing work is
  depicted, and the name **bears no relation to the visual novel
  《千恋＊万花》 (Senren * Banka)** or to any other published work.
- Licensed under CC BY-NC-SA 4.0 (see [LICENSE](LICENSE)).
- **Personal, non-commercial use only. Unofficial work, not affiliated with this
  repository.**
