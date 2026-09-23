# Agent Note: Usage foot card above the Settings row

Status: implemented

Supersedes the placement half of [usage sidebar foot card](2026-09-23-usage-sidebar-foot-card.md): the card is the same DOM-mounted glance, now seated directly above the Settings row instead of below it.

## Problem

The shipped card hung off the sidebar floor below Settings: the only foot element carrying its own border and fill, 2-6 px off the row grid the shell gives the action and Settings rows, 29 px tall against the Settings row's 42 px, and seated under the entry that is conventionally the sidebar's terminal anchor. The user reported the placement as wrong.

## Decision

1. `foot-card-mount.tsx` inserts the container into the foot area directly before the Settings seat, so the foot reads action icons, usage glance, Settings, and Settings stays last. Self-heal follows the anchor (`container.nextElementSibling === settingsArea`), with the foot tail as the fallback when a shell stops exposing the Settings area.
2. The card adopts the shell's row geometry instead of card chrome: no border, 12 px radius, the shell's hover fill (`--dsw-alias-interactive-bg-hover`), 8 px padding, and a 36 px minimum height in the collapsed strip. Only the expanded body keeps a faint surface, because it holds four lines.

## Alternatives considered

- Keeping the card below Settings and restyling it only. Rejected: the placement was the complaint, and a card below Settings leaves the Settings entry off the sidebar floor.
- Registering into `sidebar.footer.action` (inside the action row). Rejected: the expanded state is a multi-line block that no 36 px icon row can hold.
- Inlining the collapsed strip in the action row and expanding to a block elsewhere. Rejected: state-dependent placement moves the control under the user's cursor and doubles the mount logic.

## Consequences

- Settings is the bottom anchor again; the usage glance reads as a native foot row rather than a card pasted onto the foot.
- The card loses its bordered card chrome; the expanded body is separated by a faint surface only.
- The README pair, the package description, and the foot-card note's placement facts move with the change.

## Testing

- `packages/dsh-usage/tests/foot-card-mount.spec.tsx`: placement directly above the Settings seat, self-heal when a node lands between the card and Settings, pane-rebuild re-anchoring, duplicate-mount no-op, dispose, and the settings-navigation replay.
- `packages/dsh-usage/tests/foot-card.spec.tsx`: the content rules and the collapsed spending-provider naming.
- Live GUI evidence: recorded in the delivery report of the change.
