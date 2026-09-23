# Agent Note: Preset categories on the market surfaces

Status: implemented

## Problem

Community plugins carry a `category` and an optional second-level `subcategory`, and both market surfaces render them as filter pills: the Workshop card filters its grid, dsh-market.com renders a chip row plus a second-level row under it. Presets had no classification at all. The preset manifest carried only id, name, rank, files and market metadata, so a store listing could not tell a role-play preset from a coding preset, and with 32 role-play entries in the catalog the first batch would have shipped as one undifferentiated list. `scripts/market-build` also had no vocabulary to validate a preset catalog entry against, so a mistyped category could reach the manifest unchallenged.

## Decision

Preset catalog entries take a `category` from a preset-specific vocabulary, and both market surfaces render it as a filter pill exactly where the plugin category pills live.

### Vocabulary

- The canonical set lives in `scripts/market-build` as `PRESET_CATEGORIES` (`roleplay` today) and is mirrored by the Workshop card's `PRESET_CATEGORY_IDS` and by `market/src/app.js`'s `CAT_LABEL` — the same three-place mirror the plugin vocabulary already uses (`scripts/community-index`, `packages/dsh-market/src/client/categories.ts`, the site).
- The manifest always carries `category`; an entry that omits the field lands in `other`, matching the plugin path. `market-build` rejects any other unknown id, so a typo fails the build instead of publishing an unclassifiable preset.
- There is no second level yet: `PRESET_SUBCATEGORY_IDS` maps `roleplay` to an empty list, which makes the card render a single filter row and the site hide its subcategory row. A second level is a vocabulary entry plus catalog data, with no code change in either surface.

### Surfaces

- **Workshop card** (`MarketCard.tsx`): the filter rows are generic over the active tab. `facetKind` selects the visible catalog kind, `facetItems` its records and `facetVocab` its label and subcategory maps; the plugin tab and the preset tab therefore share one implementation. The preset records handed to the contributed panel are filtered through the same `byCategory`/`bySubcategory` helpers the plugin grid uses, so the panel renders the filtered set without knowing categories exist.
- **Market site** (`market/src/app.js`): `renderCatFilter` reads the records of the current kind instead of always reading plugins, and hides the subcategory row when the selected category has no second-level records — which is what keeps the preset tab to one row.
- **Labels**: `category.roleplay` (角色扮演 / Roleplay) is declared in the market package's zh and en dictionaries and mirrored in `dsh-i18n`'s Russian market dictionary, so `pnpm i18n:check` stays the parity gate.

## Alternatives considered

**Reusing the plugin category vocabulary for presets.** Rejected: plugin categories describe implementation surface (ui, tools, integration), and a preset's category describes its purpose. Sharing the list would have forced role-play into a plugin bucket and made the two vocabularies drift together.

**Deriving the preset category from the existing `tags`.** Rejected: tags are free-form and already carry `modern`/`fantasy`/`historical` facet words; classification that drives a store filter needs a closed set and a build-time validation, which tags deliberately do not have.

**Filtering inside the preset panel instead of the card.** Rejected: the panel is a contributed slot that receives records, and the card already owns the tab-level filter state and vocabulary for plugins. Filtering in the card keeps one filter implementation and one reset rule (switching tabs clears both levels).

**Shipping a second level now (splitting the 32 characters into modern / fantasy / historical).** Rejected for the same reason the plugin vocabulary is a closed set: the level should appear when the content needs it. The theme split is already recorded in each entry's `tags`, so promoting it later is a vocabulary entry plus data.

## Consequences

- The preset tab shows one category row (全部 / 角色扮演) with counts, and the plugin tab keeps its two rows. Both render from the same code, so a future preset category needs no UI change.
- `market-build` now fails on an unknown preset category, which is a new way a catalog edit can break the build — deliberately, because the alternative is publishing a preset no filter can reach.
- The site's category chips are built from the data that is present, so a category with no entries simply does not appear; the card behaves the same way through `categoryCounts`.
- Presets still have no second-level vocabulary, so the manifest, the card and the site agree on one level; nothing checks that they will agree after a second level is added beyond the mirrored list itself.
- The plugin tab's subcategory row is now hidden when the selected category has no second-level records (previously it rendered an empty "全部 0" row for uncategorized plugins). That is a small behavior change in the plugin path, covered by the existing card tests.

## Testing

- `packages/dsh-market` covers the new path: the preset tab renders 全部 / 角色扮演 / 其他 chips, filters the records handed to the contributed panel (including the uncategorized bucket), renders no second-level row, and resets the filter when tabs switch; the category label test asserts every preset category id has a zh and en label.
- `scripts/market-layout.test.mjs` asserts every `presets.json` item carries a non-empty `category` and that the built site carries the preset category label.
- `pnpm market:check` re-runs `market-build` in check mode against the committed `market/dist`, so the regenerated `manifest/presets.json` and `app.js` are the reviewed artifacts.
