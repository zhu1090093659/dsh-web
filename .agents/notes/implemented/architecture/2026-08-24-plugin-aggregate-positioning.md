# Agent Note: Aggregate-plugin positioning and the skins naming

Status: implemented

## Problem

The repository presented skins as a product pillar peer to plugins: the tagline said "plugin and skin ecosystem", the root README gave skins a top-level chapter beside feature plugins, and the loader surfaced as "Skin Center". The actual product is an aggregate plugin package — every capability, including skins, is one Cordis plugin — and the Workshop (dsh-market.com) is the distribution direction. The peer framing mis-states the hierarchy, and "Skin Center" names a surface after its container rather than its content.

## Decision

The product is positioned as the aggregate plugin ecosystem for DSH Web, and the skin surface is named simply "skins" (皮肤):

- Root README pair: the skins chapter demotes from a peer chapter to the last subsection of feature plugins; tagline, intro, capability table, package table, and troubleshooting prose now describe skins as pure asset packs of the skins plugin, distributed through the Workshop. The Chinese surface name is 皮肤 and the English one is skins — "皮肤中心 / Skin Center" no longer appears as a display name in the root README pair.
- GitHub About description and homepage (dsh-market.com) match this positioning; AGENTS.md and docs/development.md opening lines state the same hierarchy.
- Identifiers stay frozen: the npm package @linxin666/dsh-client-ui-skin-center, the packages/skins/skin-center directory, the web-ui-skin-center bundle id, and the skin-center/wallpapers path keep their technical names; only display prose changed.
- The Workshop storefront keeps its skins / pets / plugins merchandise taxonomy — those are goods categories in a store, not product pillars.
- Cross-link: [product rename](2026-08-24-product-rename-dsh-web.md) covers the dsh-web-ui to dsh-web naming this positioning rides on.

## Alternatives considered

- Keep the peer "plugins and skins" framing: rejected by product decision; it contradicts the aggregate-package reality and the Workshop direction.
- Rename the technical identifiers too (skin-center package, directory, bundle id): rejected for the same reason as the product rename freeze — published npm names and profile-persisted ids cannot move without breaking installs.
- Rename the GUI settings section display string in the same change: deferred; it is user-visible runtime copy inside the skin-center package's locales and needs its own rebuild-and-verify pass, so it is tracked as a follow-up scope question rather than folded into a documentation edit.

## Consequences

- Readers meet one hierarchy everywhere in current docs: the aggregate package contains plugins; the skins plugin owns skin assets; the Workshop distributes all of it.
- The name "skin-center" persists in technical identifiers; docs prose must not present "Skin Center" as a product surface name anymore.
- Verification: pnpm docs:check passes (bilingual structure mirror intact after the heading demotion); GitHub About verified via gh repo view.
- Follow-up: applying the 皮肤/skins naming to the GUI settings section title and market storefront copy requires a skin-center locale change plus market rebuild and redeploy, and is pending explicit scope confirmation.
