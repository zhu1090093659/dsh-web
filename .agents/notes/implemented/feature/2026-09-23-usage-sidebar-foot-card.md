# Agent Note: Usage sidebar foot card

Status: implemented

Superseded in part by [usage foot card above the Settings row](2026-09-23-usage-foot-card-above-settings.md): the card now seats above the Settings row; the DOM-mount decision stands.

Partially supersedes [usage sidebar surface removed](../simplification/2026-09-18-usage-sidebar-surface-removed.md): the sidebar entry row, its collapsible panel, and the entry-core `actions` API stay removed, but the sidebar carries a usage surface again — a compact glance card seated below the shell's Settings row, added at the user's explicit request.

## Problem

The 2026-09-18 removal left the usage overview reachable only through the settings section: no price signal lives in the sidebar any more, and the user asked for the card back, redesigned, at the bottom-left below Settings. The challenge is answering that request without re-introducing what the removal rejected: a permanent navigation row duplicating the settings page, a standing collapsible panel, and the entry-core `actions` machinery that existed only for that row.

## Decision

1. New surface, new shape: `packages/dsh-usage/src/client/UsageFootCard.tsx` renders one quiet card with two persisted states — expanded (default): a price-first headline (today's estimated spend in CNY, falling back to today's tokens while nothing priced is recorded, else a zero line), a tokens/calls line, up to two configured-provider balances with a +N overflow marker, and an updated-at footer; collapsed: a one-line strip with the gauge glyph, the spending provider's resolved name, the label, and the headline value (the provider row carrying today's cost, else the current session route). The corner chevron toggles the state through one `dsh-usage.foot-card.collapsed` localStorage flag. The card body is a single `<button>`; clicking replays the user's own settings path (`openUsageSettings` in `foot-card-mount.tsx`: activate the sidebar Settings trigger, then click the nav row carrying the section's localized label — an already-open panel is never toggled shut, and a missing row leaves the panel on its default section). Detail lives in the settings section only: the card carries no refresh button and no tabs. The body button and the chevron are siblings — buttons inside a button are invalid HTML, the trap the retired entry row's composite actions API grew from.
2. Placement below Settings (superseded in part: the container now inserts directly above the Settings seat): the shell's foot area exposes no slot below `sidebar.settings` (`sidebar.footer.action` stacks above it), so `foot-card-mount.tsx` appends the container as the foot area's last child and self-heals through the shared body-mutation hub — re-seating on a shell re-render, re-anchoring after a whole-pane rebuild. The container is plain DOM with its own React root and never disturbs shell reconciliation; DOM-level idempotency keeps duplicate applies single. The dsh-usage `body-mutations.ts` target returns to the sync-shared manifest (the sidebar-entry-core target does not — no entry row exists).
3. Shared data, relaxed cadence: the card reads the same store and poll path the apply body wires for the section (the sequence guard absorbs interleaved calls) and runs its own 30 s visible-tab poll, because the sidebar foot is permanently mounted. It renders null while `enabled` is false and while the overview endpoint answers 404 (host half off); other transport failures keep the last snapshot, or a quiet error line before the first one.
4. The collapsed 56 px rail hides the card through the `data-sidebar-collapsed` ancestor gate, matching the old strip's rail behavior.
5. Semantic attributes: the card outputs `data-dsh-plugin="usage"` / `data-dsh-part="foot-card"` plus bare `foot-card-main` / `foot-card-toggle` / `foot-card-strip` / `foot-card-usage` / `foot-card-balances` part rows; the contract gains those rows, and the stale `data-dsh-usage-entry` / `data-dsh-usage-view` anchors leave the usage plugin row.
6. Copy: five new zh keys (`usage.foot.cost`, `usage.foot.noData`, `usage.foot.open`, `usage.foot.collapse`, `usage.foot.expand`) with en mirrors and ru language-pack entries; everything else reuses existing keys.

## Alternatives considered

- Registering into the `sidebar.footer.action` slot (above Settings). Rejected on placement: the user asked for below Settings, and the slot only stacks above the settings seat; the DOM mount also keeps the card independent of slot-registration ordering, at the price of owning its self-heal.
- Reviving the removed entry row plus collapsible panel as a git revert. Rejected: that design is exactly what the removal note retired — a permanent navigation slot duplicating the settings page, plus the entry-core `actions` machinery. The glance card answers the same want without the duplicate surface.
- A refresh action on the card, like the old row's. Rejected: that control was why the entry core grew a composite actions API; the whole-card click-through to the section, where Refresh lives, plus the 30 s loop covers the need. The collapse toggle survives this rule because it is a sibling of the body button, not a child.
- Reusing the retired panel's `dsh-usage.sidebar.collapsed` storage key for the strip flag. Rejected: the removal note declared that value inert, and reviving it would silently inherit a September collapse choice onto a surface with different semantics; the new `dsh-usage.foot-card.collapsed` key starts clean.
- A compact badge in the collapsed rail instead of hiding. Rejected as noise: a 56 px rail fits no legible price text, and the rail already crowds every plugin into icons.

## Consequences

- The sidebar carries usage again as a glance plus gateway: above Settings in the wide column, absent in the rail. The removal note's no-entry-row fact still stands; its "nothing polls while the section is closed" consequence ends — the foot card polls at 30 s while visible whenever the plugin is enabled.
- `openUsageSettings` is a shell-DOM replay (trigger click plus a localized nav-row match), not an SDK API: a shell that renames the settings-area class or the nav structure degrades the click to opening nothing, never to an error.
- The card container stays mounted-but-empty while disabled or host-off; re-enabling repaints it without a reload.
- The README pair, the package description, the semantic-attrs contract, and the ru language pack moved with the change.

## Testing

- `packages/dsh-usage/tests/foot-card.spec.tsx`: content rules (spend headline, tokens fallback, zero-day line, balance cap with overflow, unconfigured-provider exclusion), click-through, locale switch, the collapse round-trip (strip content, spending provider naming and its token-fallback absence, persisted flag, remount restore, strip click-through, collapsed loading placeholder), and the visibility gates (disabled, 404, error line, stale snapshot kept).
- `packages/dsh-usage/tests/foot-card-mount.spec.tsx`: placement above the Settings seat, duplicate-mount no-op, self-heal when a node lands between the card and Settings and on a whole-pane rebuild, dispose, and the settings-navigation replay (opens the panel onto the usage row; never toggles an open panel shut; no foreign row clicked).
- Live GUI evidence: recorded in the delivery report of the change.
