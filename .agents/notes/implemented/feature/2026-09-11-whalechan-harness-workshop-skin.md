# Agent Note: Whale-chan Harness Workshop skin

Status: implemented

## Problem

The Whale-chan Harness community theme is distributed as a standalone static frontend overlay, so Skin Center users cannot discover, try on, apply, or remove it through the Workshop workflow.

## Decision

The Workshop catalog includes `whalechan-harness` as a declarative Skin Center v2 asset directory with local image assets, light and dark token palettes and character backdrops, high-sensitivity CSS patches, bilingual user documentation, preview images, and explicit CC BY-NC-SA 4.0 attribution.

The skin does not declare client hooks. Fine-grained icon replacement remains in `patches.css`, while Skin Center owns selector scoping, path validation, activation, persistence, and teardown.

## Compatibility boundary

The patch layer retains generated-class selectors where no stable semantic or ARIA anchor exposes the target icon. Skin Center reports those selectors as compatibility warnings, and an upstream frontend rebuild can require maintenance without invalidating the manifest or the declarative fallback palette.

## Testing

The skin passes `node scripts/dsh-skin validate packages/skins/skin-center/skins/whalechan-harness`. Market and Skin Center generators include the new catalog entry and validate its local assets, manifest, stylesheets, previews, and documentation.

## Alternatives considered

Keeping the theme only in its standalone repository avoids duplicated assets, but it excludes Skin Center's try-on, atomic activation, catalog diagnostics, and Workshop discovery.

Adding `hooks.mjs` would reproduce the standalone dynamic permission-text tagging, but executable skin facets require a stricter reviewed identity and are unnecessary for the primary visual result; declarative ordered fallbacks cover the standard permission menu.

Reducing the skin to token remapping would eliminate generated-class warnings, but it would also discard the dedicated Whale-chan icon system that defines the theme.

## Consequences

Workshop users receive the theme through the ordinary skin lifecycle and no `index.html` modification. The market package becomes larger because the skin includes its referenced raster assets. Maintainers must revalidate generated-class selectors after official frontend rebuilds.
