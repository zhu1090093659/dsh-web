# Deep Current

English | [中文](README.zh.md)

Deep Current gives the dsh web GUI an oceanographic observatory character: an abyss-green sidebar frames a pearl workspace while an organic bathymetric contour field gathers around the composer.

## What it does

- **Split-depth palette**: the light theme pairs a dark sidebar with a pearl canvas; the dark theme descends into a complete low-luminance abyss palette.
- **Horizontal-current signature**: a locally authored SVG bathymetric field and a soft current band flow horizontally at layered speeds on the empty-session home, then settle as soon as the conversation has content; they never move beneath message text.
- **Small structural patch**: token remapping carries the full interface while a narrow CSS patch uses structural data, semantic data, and ARIA attributes only; it contains no hashed class selectors or script.

## Install

Deep Current ships inside @linxin666/dsh-client-ui-skin-center. Install the Skin Center, open Settings → Skin Center, then try on or apply Deep Current.

~~~sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
~~~

## Configuration

The skin follows the GUI light/dark setting automatically and has no skin-specific controls. The Skin Center enable switch and global background controls remain available. The home current motion is disabled when the operating system requests reduced motion.

## Preview

~~~sh
pnpm market:build
open market/dist/preview.html?skin=deep-current&theme=light
open market/dist/preview.html?skin=deep-current&theme=dark
node scripts/capture-previews deep-current
~~~

## Known limitations

- Presentation-only: the skin changes browser styles and never touches model requests or stored data.
- The split sidebar and composer treatment use the high-sensitivity CSS patch surface, limited to stable structural and semantic attributes and disclosed by the Skin Center.
- The contour field is bundled locally with the skin; it makes no network request and uses no third-party artwork.
