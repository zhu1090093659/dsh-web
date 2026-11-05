# 居家模型娘

English | [中文](README.zh.md)

A room flooded with sunset light — the whiteboard compares Z.ai / GLM, DeepSeek, Qwen and Gemini; laptops, cameras, mugs and a whale plush are strewn across the sofa, and the anthropomorphised model characters are each curled up somewhere. A skin for the dsh Web GUI, kept as a pure asset directory.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (L1 token remap) + two baked background images. No `package.json`, no build step, no `hooks.mjs`; the skin-center package is the only loader.
- **Token-first**: light values on `:root`, dark values under `body[data-ds-dark-theme]`; the loader scopes every selector under `html[data-dsh-skin="model-dorm"]`.
- **Presentation-only**: it mutates browser styles and never touches a model request.

## The palette was measured, not chosen

This skin follows the official method: **sample the artwork first, then decide the language**. Results:

| Measurement | Value | What it decided |
|---|---|---|
| Median luminance | **0.145** | This is a dark-ground image |
| Share of pixels with L<0.15 | **50.9%** | Dark is the home theme; light must swap the image, not veil it |
| Share of highlights (L>0.60) | **4.0%** | Highlights are rare enough to be accents only |
| Dominant family (frame mean) | `#7f5f57` `#836771` `#947269` | Dark panels = warm plum glass |
| Deepest shadows | `#32272b` / `#231a1c` | Near-black is warm brown, never pure black |
| Sunset highlights | `#fbd9b3` / `#fccc9c` | The cream gold of the light theme |
| Red+orange share of saturated pixels | **80%** (peak `#903f12`) | Accent = ochre `#b4551a` |
| Cool counterpoint | deep blue `#0e4d76`, violet `#472b65` | Not decoration: reserved for info and selection |

Design language: **"a sunset room held behind one sheet of warm glass."** Dark panels are thin glass (α 0.58–0.62) that lets the room keep glowing behind them; light panels are glass too (α 0.60–0.68), veiling the artwork into a warm haze while keeping it visible. The only solid fill on screen is the ochre primary button.

## Why there are two background images

With the original artwork, dark text reaches only **3.02:1** — below the 3:1 gate — and pushing a cream veil over it to fix that flattens the artwork's luminance variation, which reads as "the image is gone". So:

| Image | Median luminance L | Dark-text contrast |
|---|---|---|
| Original | 0.145 | 3.02:1 ← unusable |
| `model-dorm-room-night.webp` (γ1.25, +3% warm white) | 0.217 | 3.77:1 |
| `model-dorm-room-day.webp` (γ2.10, +20% warm white, sat 0.88) | 0.462 | 8.31:1 |

Both are **exposure versions of the same artwork**, not different material (official `maid-atelier` does the same with `palace-day-v4` / `palace-night-v4`). As a result the dark panels' effective luminance rose from 0.078 to 0.139–0.157, the artwork shows through at 38–42%, and body text holds above 4.5:1.

**A real tradeoff**: the more transparent the artwork, the lower the text contrast. In the dark theme the artwork's bright regions (p95=0.676, the sunset outside the window) show through the glass and drop text contrast below its typical value — this skin chooses "the artwork is visible" over "worst-case legibility".

## Contract notes

1. **The primary-action set is matched.** `--dsw-alias-brand-primary` is an accent, **not a button fill** — using it as fill with white text renders black-on-black. In the dark theme the button fill is bright amber `#e39a55` and its label is **dark** `#231a1c`.
2. **The occlusion slider changes panel thickness live.** The loader writes the Background occlusion control (0–100) onto `document.body` as `--dsw-skin-scrim` (a 0..1 alpha); every surface alpha here hangs off it, baselined at 0.05 in both themes.
3. **Deliberately uncovered tokens** — three left: `--dsw-corner-shape` (the superellipse is the shell's own geometry), `--dsw-mask-blur` and `--dsw-menu-backdrop-filter` (frosted glass is this skin's signature; changing it would break the thing).

## Floating-surface depth: taking the missed non-font tokens from 104 to 115

The first cut left 14 non-font tokens to the loader's derivation, on the reasoning that they were "structural, not chromatic". Tracking every consumer in the installed build showed that reasoning was half right:

| The original call | What the build says |
|---|---|
| `--dsw-shadow-lv1/2/3` and `--dsw-elevation-stroke-color` are structural | **No.** Their values are `#000000xx` — they are the *colour of the shadow*, and a neutral cold black. A pure-black shadow over this painting is exactly the "something is off, it looks dirty" feeling |
| `--dsw-linear-gradient-think` / `-think-select`: format unverifiable offline | **Now resolvable.** The real format is `linear-gradient(180deg, <page base> 20.19%, <same colour, transparent> 100%)` |
| The three `--dsw-elevation-*` recipes are structural, leave them | Half right. The *structure* should stay — but the recipes carry pure black **inside** them (`soft = ..., 0 4px 16px 0 #00000008`), and `soft` is what the composer card and other high-traffic nodes use |
| `--dsw-mask-blur` / `--dsw-menu-backdrop-filter` should stay | **Correct**, they stay |

Result: **115 of the 118** chromatic non-font tokens declared; the three remaining are the ones listed above.

### A counter-intuitive cascade finding

`--dsw-elevation-stroke` / `-panel` / `-prominent` / `-soft` **cannot be overridden from `:root`**. The official theme declares that family on `body, body *` — that is, it re-declares the variable on *every element in the document*. A skin's `:root` value wins on `html` and `body` only; the moment you descend into the tree, that `body *` cuts the inheritance.

Measured with CDP `getMatchedStylesForNode` on the composer card node:

- skin rule `html[data-dsh-skin="model-dorm"] body` → correct value, carries `!important`, but **`matchesCard: false`** (it only selects `body`)
- official rule `body, body *` → **`matchesCard: true`**

So `!important` alone does not help: the problem is not insufficient priority, it is that **the rule never matched the element**. The only way in is to make the rule match every element, with `*`. This skin uses `*` in exactly one place, because this is the only token family with that shape:

```css
* {
  --dsw-elevation-soft: 0 0 0 .5px #6b4a3f5c,
                        0 4px 16px 0 #3a2a2612,
                        0 0 24px 0 #3a2a2612 !important;
}
```

The value keeps the official shape — hairline stroke plus two blurred drops, offsets and blur radii copied verbatim — with the hue moved from pure black to the warm brown measured out of the painting, and the alphas nudged up because a warm shadow has to be slightly heavier to read as equal weight.

### Runtime tokens the contract never listed

The official component CSS also consumes a second set of tokens that `contracts/official-tokens-v1.json` does not carry at all — which means **no skin can see them, and none can control them**. By consumer count: `--dsw-radius-sm` (118 declarations), `--dsw-focus-ring-color` (113), `--dsw-radius-md` (88), `--dsw-radius-lg` (71), `--dsw-focus-ring-width` (52). The focus ring and every corner radius in the app were outside skin control. They are declared here from this skin's own warm palette and radius scale (4/8/10/14/18px — deliberately **not** flattened: rounded corners are part of the glass language).

## Artwork and licensing

The background illustration was generated by the author with an AI image tool and then composed by hand; the characters are the author's **original anthropomorphised designs** for various large language models (Z.ai / GLM, DeepSeek, Qwen and Gemini appear only as capability-comparison text on the whiteboard — nothing here traces any real character). The skin engineering (token remap, palette and veil rules in `skin.css`) is the author's own work.

## License

MIT. The background illustration and the anthropomorphised character designs are the author's original work; see LICENSE and the ttribution field in skin.json.
