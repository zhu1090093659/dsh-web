# Agent Note: Root README SEO pass and signature feature sections

Status: implemented

## Problem

The root README no longer presented two signature capabilities of the family bundle: rescue mode (dsh-doctor) survived only as a one-line entry under "More Plugins" with a stale "off by default" claim (the plugin has been on by default since install or upgrade), and LiangShen Mode (dsh-liangshen) was absent entirely, including from the single-plugin install commands, the npm package table and the license-attribution table. The entry document also carried few of the bilingual search keywords (DeepSeek Harness Web GUI, task board, mobile remote, image understanding, rescue mode) that users actually query.

## Decision

The bilingual root README pair gains dedicated feature sections for LiangShen Mode and Rescue Mode under "Feature Plugins" (after Git Graph), drops the rescue-mode one-liner from "More Plugins", restores dsh-liangshen in the single-plugin install block, the npm package table and the license-attribution table, and corrects the doctor default to "on by default". The H1 and the opening paragraph carry the full product keywords in both languages, and every H3 under "Feature Plugins" carries a bilingual keyword parenthetical. The skins heading keeps its plain form because the top navigation anchors to it.

## Alternatives considered

- Extend the capability comparison table as well: declined by the user in this scope; the table stays as is.
- Update the tagline chips line alongside the new sections: declined by the user in this scope.
- Add a whale-girl pet section using the idle pet screenshots: declined by the user; pets stay discoverable through the Workshop, per [root README simplification](../simplification/2026-08-24-root-readme-workshop-simplification.md).
- Cover dsh-session-id as a family feature: declined; the package is not part of the aggregate bundle, so the root README must not present it as a family capability.

## Consequences

- Partially supersedes [root README simplification](../simplification/2026-08-24-root-readme-workshop-simplification.md): its LiangShen Mode removal is reversed (feature section, install command, npm table row and license row are back), while its skins and pets catalog simplification still stands. Both notes stay cross-linked.
- The root README pair remains manually mirrored outside the packages/docs triplet gate; heading order and counts were verified identical across both sides after this change.
- Doctor's default-on behavior is now stated consistently in the feature section, the install block and the npm table.

## Testing

`pnpm docs:check` passes; heading lists diffed between README.md and README.en.md show identical count and order.
