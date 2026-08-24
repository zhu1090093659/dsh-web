# Agent Note: Stable semantic anchors for the sidebar launcher group

Status: implemented

## Problem

Skins that style the sidebar new-session action cannot safely select it through its localized accessible name. A selector such as `button[aria-label="New session"]` silently stops matching in Chinese and in any future locale, while the official shell does not yet expose a dedicated slot or semantic part for this action. The Skyrail Cabin launcher cushion also depended on a fixed 256px width and a shell wrapper hierarchy, so it could disappear in the Gallery facade or outgrow a resized/collapsed sidebar.

## Decision

The Skin Center L2 compatibility adapter stamps `data-dsh-part="new-session"` on the official `button[class*="newSession"]` seam. `semantic-attrs/v1` owns this value, and skins select only the semantic part; localized text remains an accessibility concern and never becomes a styling API. The Gallery and Workshop preview facades stamp the same part after mounting their official shell snapshot so preview behavior matches the real Skin Center runtime. Skyrail Cabin anchors its single three-row cushion to the stable task-board launcher, inherits that row's width, keeps launcher content above the decorative image, and hides the image whenever the sidebar is collapsed. A small bottom margin on the last launcher reserves the cushion seam without selecting or styling the workspace region.

## Alternatives considered

- Keep the English `aria-label` selector and add translated variants: rejected because every new locale or copy edit would require a skin update and omission fails without diagnostics.
- Select the button only by sibling order or the presence of injected plugin rows: rejected because sidebar composition and plugin installation order are not properties of the new-session action.
- Add the attribute only inside the Skyrail Cabin skin through a hook: rejected because community skins are pure asset packs by default and the semantic contract belongs to Skin Center, not to one skin.
- Keep the cushion on the shell wrapper at a fixed 256px width: rejected because wrapper depth is not a skin contract and a fixed bitmap box does not follow launcher width or collapse state.

## Consequences

- Skins can style the action consistently in Chinese, English, and other locales through one documented selector.
- The adapter still depends internally on the current shell class seam until the official shell emits a first-party semantic attribute; that dependency is isolated in one rule and can be removed when the upstream seam lands.
- The runtime test uses a Chinese accessible label to prove that stamping is independent of localized copy, while preview facades expose the same contract for visual evidence.
- The cushion scales with the launcher row and is absent from the collapsed rail; launcher-owned spacing keeps its seam clear of the workspace without applying skin styles to the workspace section.
