# Agent Note: Skin glass must not become the containing block of a plugin's fixed panel host

Status: implemented

## Problem

With the wallpaper-exclusive skin active, the bottom workbench of dsh-better-sidebar was completely unusable: expanding it painted nothing and its picker cards could not be hit-tested. dsh-better-sidebar appends a wrapper div to document.body and marks it with the bare attribute [data-dsh-better-sidebar]; the viewport-sized panel host [data-dsh-panel-host] is a DESCENDANT of that wrapper. The host is the only fixed element in the stack (position: fixed, inset: 0, z-index: 25, overflow: clip) and every panel inside it is position: absolute. The skin's fixed-glass set painted the wrapper itself with backdrop-filter, and a non-none backdrop-filter makes the element the containing block of its position: fixed descendants. The wrapper is a static, zero-height node, so the host resolved against an empty box and measured 1600x0 pinned to the viewport's bottom edge; the host's own overflow: clip then removed every panel from painting and hit testing. The right sidebar was affected by the same collapse but kept painting its own content, which is why the defect first surfaced as an empty bottom bar.

## Decision

The wallpaper-exclusive patches never paint the two host shells. [data-dsh-better-sidebar] and [data-dsh-panel-host] are positioning layers, not surfaces: the fixed-glass set starts one level down, on the panel chrome ([class*="_panel"], [class*="_bottomPanel"], [class*="_pane"], [class*="_paneCard"] and their siblings), which stays unaffected because those elements carry no fixed-position descendants. No bypass rule such as a neutralised backdrop-filter or an explicit overflow override is kept; the wrapper simply drops out of every selector list.

The same change collapses the workbench and the trajectory view onto one glass layer: the panel root and the trajectory view root carry the frosted fill plus the fixed 10px blur, while every nested wrapper (_panelBody / _pane / _paneContent / _paneTab / _tabBar / _tabList / _terminalWrap inside the bottom panel, and _split / _ledger / _table / _plot / nested _root inside [data-conversation-composer-overlay]) is reset to transparent with no blur. Painting the fill on each wrapper stacked the same translucent colour three to four deep and read as a far darker slab than the single-layer glass the rest of the skin uses. Two surfaces are re-materialised instead of merely reset: the task-board search field and the trajectory toolbar search take the shared hover glass over the shell's flat fill, and the terminal canvas keeps its dark frosted fill for text legibility.

## Alternatives considered

Neutralising the plugin's own overflow: clip on the panel host was rejected because the host box itself still collapsed to zero height: the panel geometry and hit testing depend on the host being viewport-sized, so hiding one symptom would have left a second defect behind.

Fixing the wrapper in dsh-better-sidebar (giving it a non-static position or a viewport size) was rejected as out of scope: dsh-better-sidebar is a third-party npm package mounted into $DSH_HOME, not part of this repository, and a skin must not require a dependency bump to render correctly.

Keeping the wrapper glass and adding an exclusion for the panel host attribute alone was rejected because the containing block comes from the wrapper the host sits in, so the collapse returns as soon as any other skin rule re-matches the wrapper (and any future skin author copying this file would inherit the trap).

Painting the frosted fill on each nested wrapper (the pre-change behaviour) was rejected because three to four stacked translucent fills composite to roughly 0.63 opacity over the wallpaper and multiply the backdrop-filter cost, which is the opposite of the skin's stated single-layer material.

## Consequences

The invariant for this skin and for any skin that paints glass over plugin chrome: a selector may style a plugin panel, but never a node that is only an ancestor of fixed-position plugin content. The danger set is any property that creates a containing block for fixed descendants (backdrop-filter, filter, transform, perspective, will-change on those, contain: paint/layout) or that changes their box. The two host shells stay untouched, so panels mounted by dsh-better-sidebar and by any other plugin using the same host pattern keep their viewport geometry.

The other skins that reference these hosts (maid-atelier, phoebe-atelier, orca-link) only set CSS custom properties on them and inherit no collapse, so no further change was needed.

Named coverage gap: nothing in the gate set catches this class of defect. The review of PR #1601 recorded it as a follow-up, together with two smaller items - the new [data-dsh-taskboard-view] input rule is broader than its comment (it also re-fills task-form and schedule inputs and type=checkbox) and the PR evidence images sit in docs/pr-evidence rather than docs/archive/pr-evidence. The review and its measurements are recorded in [PR #1601 review record](../../../../docs/archive/pr-review-1601-wallpaper-exclusive-workbench.md).

## Testing

Review of PR #1601 (merged as 2d92b900) re-verified the mechanism from the plugin bundle rather than from the description: dsh-better-sidebar 0.19.x creates the wrapper with host.setAttribute('data-dsh-better-sidebar', '') and document.body.appendChild(host), and renders the panel host as a descendant with data-dsh-panel-host. The merged patches.css contains no selector whose subject is either host attribute (scanned selector by selector) and no property from the containing-block danger set. The committed market artifacts were compared by git blob rather than by timestamp: market/dist/assets/skins/wallpaper-exclusive/{patches.css,skin.json,README.md,README.zh.md} match the authored files, the packaged zip carries the same patches.css and skin version 0.2.1, market/dist/styles.js inlines the same patches text, tryon-assets carries the transformed copy, and market/dist/manifest/skins.json changes only 0.2.0 to 0.2.1. docs:check and i18n:check pass at the merged head. The author's live evidence (1600x950 host box at y=0, no data-dsh-panel-host-degraded marker, picker cards hit-testable, terminal panel openable) is attached to the PR.

Related records: [wallpaper-exclusive native queue dock chrome](2026-08-24-wallpaper-exclusive-queue-dock-chrome.md) and [Wallpaper Surface Sidebar and Details Exclusion Guard](2026-08-30-wallpaper-surface-sidebar-exclusion.md) cover the other wallpaper-exclusive glass surfaces.
