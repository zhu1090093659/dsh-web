# Agent Note: Root README simplification and Workshop asset discovery

Status: implemented

## Problem

The root README expanded multiple skins, pet screenshots and the Liang Shen Mode explanation in one entry document. That made the README carry catalog and feature details owned by the Workshop and the individual plugin READMEs, while the classic Blue Fantasy skin shipped with the package was not given a focused presentation.

## Decision

The bilingual root README pair keeps only one dark Blue Fantasy screenshot and a short description. Catalogs, previews and source links for other skins, Wallpaper Engine wallpapers and whale-girl pet assets point to the Workshop. The README no longer presents or explains Liang Shen Mode; its install command, npm table entry and license-attribution row are also removed from this aggregate README. Pets and skins remain separate Workshop categories so the whale-girl pet is not described as a skin.

## Alternatives considered

- Keep every skin screenshot and delete only the montage: rejected because the issue concerns the overall volume of skin images and per-skin explanations; individual entries would still make the README a catalog.

- Remove every skin visual: rejected because Blue Fantasy is the classic default shipped with the package, and one screenshot communicates its ready-to-use appearance.

- Fold the whale-girl pet into the skins section: rejected because pets are a separate Workshop asset type with different installation directories and runtime registry behavior.

- Keep a short Liang Shen Mode link in the README: rejected because this scope explicitly removes its presentation and explanation; the plugin remains independently documented by its own package contract.

## Consequences

- The README is shorter, while dsh-market.com owns complete skin and pet previews and source entry points.
- Blue Fantasy remains the only skin shown in the root README and continues to ship with the skins-center package; other skins install on demand from the Workshop.
- The root README pair is maintained manually and is outside the packages/docs triplet gate, so both sides still require manual comparison of headings, tables, links and images before delivery.
- Skin image assets and existing generators remain unchanged; documentation simplification does not remove any skin or Workshop asset.
- Partially superseded by [root README SEO pass and signature feature sections](../../archived/process/2026-08-25-root-readme-seo-feature-sections.md): LiangShen Mode returned to the root README (feature section, install command, npm table row and license row); the skins and pets catalog simplification still stands.
- Further superseded in part by [root README feature focus and the DSH Desktop section](../process/2026-09-10-root-readme-feature-focus-and-desktop.md): the reassembled LiangShen Mode presentation was removed again together with the rescue-mode and external-archive sections; the skins and pets catalog simplification still stands.

## Testing

This change only edits the root README.md and README.en.md. A full-text review confirms that Liang Shen Mode, per-skin catalog blocks and redundant skin screenshot references are removed while the Blue Fantasy screenshot and Workshop link remain.
