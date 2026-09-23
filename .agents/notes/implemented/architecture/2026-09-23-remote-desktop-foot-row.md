# Agent Note: Remote control adapts the wide desktop foot row

Status: implemented

Extends [remote control reuses the official UI](2026-08-29-remote-control-reuses-official-ui.md): the plugin's shell adaptation is no longer portrait-only — the wide desktop foot is laid out by the same semantic-suffix CSS layer.

## Problem

The official sidebar foot stacks two rows: `sidebar.footer.action` (the update and remote triggers) above `sidebar.settings` (a Settings trigger that stretches across the whole column). On the desktop column the Settings trigger therefore owns a full-width line whose right half is empty, while the two triggers that belong to the same cluster sit on a line of their own above it. The user asked for the three controls to share one line.

## Decision

1. `remote.module.css` lays the wide foot out as one wrapping row, scoped to the uncollapsed frame (`[data-dsh-frame]:not([data-sidebar-collapsed])`): the Settings seat opens the row (`order: 1`, `flex: 1 1 auto`) and the footer-action seat takes its tail (`order: 2`, `flex: none`), so the Settings trigger and the action pair share one line and the Settings trigger narrows to the space left for it.
2. Every other foot child — the usage glance card, another plugin's block — claims a full row of its own (`flex: 1 1 100%`) above that line, so the shared row is stable without knowing which plugins append children.
3. The collapsed-frame rail keeps the shell's stacked foot: the rules never apply under `[data-sidebar-collapsed]`, where the circles stack by design and a 56 px column has no room for a shared line.

## Alternatives considered

- Overlaying the triggers on the Settings row with absolute positioning. Rejected: the Settings trigger would stay full width (the width was the complaint) and the placement would depend on the Settings seat being the foot's last child.
- Moving the footer-action node into the Settings row. Rejected: the slot renderer owns that node's position; re-parenting DOM under React reconciliation is the trap the usage foot card avoids by owning its own root.
- Doing it in the usage plugin, whose card already sits in the foot. Rejected on ownership: the triggers belong to this package, and the layout must hold when the usage plugin is not installed.
- Making the shared row unconditional (no rail scope). Rejected: the shell's rail is a 56 px column; a shared row there overflows and clips both circles.

## Consequences

- The Settings trigger no longer occupies a full row on the desktop; the update and remote triggers sit beside it. The rail is untouched.
- The layout depends on the official suffix classes `footArea` / `settingsArea` / `footerActions` and the frame's `data-sidebar-collapsed` marker — the same survival contract as the portrait layer, re-verified on every GUI QA round.
- Any plugin that appends a block to the foot gets a full row for free; a plugin that wants to join the shared line has to opt into the same order/basis contract.

## Testing

- `packages/dsh-remote-web-ui/tests/foot-row-css.spec.ts`: the wide row's direction and wrap, the Settings seat's grow/order, the action seat's tail position, the full-row rule for other foot children, and the collapsed-frame scoping of every rule.
- Live GUI: wide column with the Settings trigger and the action pair on one line, the Settings trigger measured at 182 px (was 260 px), the usage card on its own row above; the rail keeps `flex-direction: column` with the actions stacked.
