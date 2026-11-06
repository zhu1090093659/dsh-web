# Material 3 · Violet (md3)

A **Material Design 3** skin for dsh. Both modes use the official MD3 **Baseline** palette;
every `--dsw-*` token is remapped onto MD3 colour roles, with no invented colours.

## Role mapping

| MD3 role | Light | Dark | dsh token |
| --- | --- | --- | --- |
| surface | `#fef7ff` | `#141218` | `--dsw-alias-bg-base` |
| surface-container-low → highest | `#f7f2fa` → `#e6e0e9` | `#1d1b20` → `#36343b` | `bg-layer-1…4` |
| primary | `#6750a4` | `#d0bcff` | `brand-primary` / filled button / link |
| on-primary | `#ffffff` | `#381e72` | `label-primary-foreground` |
| primary-container | `#eaddff` | `#4f378b` | user bubble `specific-bubble` |
| secondary-container | `#e8def8` | `#4a4458` | active nav item / inline code |
| tertiary | `#7d5260` | `#efb8c8` | code keyword colour (preview) |
| error | `#b3261e` | `#ffd6d2` | `state-error-*` |
| outline / outline-variant | `#79747e` / `#cac4d0` | `#938f99` / `#49454f` | `border-l1…l4` |
| inverse-surface | `#322f35` | `#e6e0e9` | tooltip / toast |

## The three MD3 rules, and where they land

1. **Elevation is tonal, not shadow** — five surface containers carry the hierarchy: drawer, card, input each sit on their own step.
2. **State layers** — hover overlays 8% of the foreground, press 12% (`linear-gradient(currentColor …)` in `patches.css`).
3. **Shape scale** — radii 4 / 8 / 12 / 16 / 28: small controls 4, cards 12, bubbles 20, overlays and the composer bar 28.

## Install

```sh
cp -r md3 ~/.dsh/skins/md3          # standard install
cp -r md3 <PACK_HOME>/skins/md3     # packaged desktop client (profile carries its own DSH_HOME)
```

Then try / apply it in **Settings → Skin Center**; no restart, a page refresh picks it up.

## Layout

```
md3/
├── skin.json      v2 manifest (accent = #6750A4)
├── skin.css       MD3 roles → dsh tokens, light and dark
├── patches.css    state layers, 3px focus indicator, heading weights, inline-code foreground
└── preview/       light and dark previews
```

## Artwork (backgroundMedia · 20s floating loop)

The plate is a 1440×810 / 10fps / 20-second **seamless video loop** in which the wireframe geometry drifts slowly.

| File | Use | Content |
| --- | --- | --- |
| `assets/float-light.mp4` (188KB) | light plate | base surface `#fef7ff`; linework `#79747e`; fields `#eaddff` / `#e8def8` / `#ffd8e4` |
| `assets/float-dark.mp4` (204KB) | dark plate | base surface `#141218`; linework `#cac4d0`; fields `#4f378b` / `#4a4458` / `#633b48` |
| `assets/bg-*.png` | static fallback (= first frame) | point `src` back at it and set `type: image` to freeze the plate |
| `tools/float.html` | animation render page | `?theme=dark&t=12.3` yields that exact instant |

**Why it loops seamlessly**: every displacement is a sinusoid with an integer number of cycles over `T = 20s` (1× on x, 2× on y), so `t = 20` reproduces `t = 0` exactly. The seven wireframes carry distinct phases and ±12–26px amplitudes plus a ±0.09rad slow yaw and ±3% breathing; the three tonal fields move less and slower (background), and the primary ring follows them for a light parallax. Measured seam difference `YAVG 0.167` against a normal frame step of `0.161` — the join is invisible.

**Rebuild**:

```sh
# 1) render frames (200 frames = 20s × 10fps)
chrome --headless=new --window-size=1440,810 \
  --screenshot="frames/dark-007.png" "file:///…/tools/float.html?theme=dark&t=0.70"
# 2) encode the loop
ffmpeg -framerate 10 -i frames/dark-%03d.png -c:v libx264 -crf 30 \
  -pix_fmt yuv420p -movflags +faststart -an assets/float-dark.mp4
```

**Host side**: `type: "video"` makes the Skin Center fill the background layer with `<video muted loop autoplay playsinline object-fit:cover>` on its own compositor layer; each clip is ~200KB at 10fps of near-static content, so decode cost is negligible. The base colour is still the surface token, so the composited canvas stays the exact `#fef7ff` / `#141218`.

**To stop the motion**: swap both `src` values back to `assets/bg-light.png` / `bg-dark.png` and set `type: image`; or push the Skin Center scrim slider to full, which buries the plate.

(`tools/float-*.html` is the authoring-side frame renderer and is not shipped; the package keeps only the manifest-referenced media plus the still fallback frames.)

## Notes

- 1.1.0: the plate is now a 20-second seamless video loop (`backgroundMedia.type: video`) with slowly drifting geometry; the still version remains in `assets/bg-*.png`.
- 1.0.1: fixed the hover/press state layer painting the whole row in solid foreground (`currentColor 8%` is a gradient stop position, not an alpha); it now layers an alpha colour, and uses `color-mix` on foreground at 8% / 12% where supported.

- No `hooks.mjs`: the plate is a pre-rendered 20-second loop and every colour is a static value, so scrolling and session switches cost nothing.
- MD3 typography wants Roboto; fonts belong to dsh's font settings, so this skin never overrides your choice.
- Tokens not remapped are derived by the loader from the base colour `#6750a4`, keeping new official surfaces in the purple family.