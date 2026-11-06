# Agent Note: Remote control adapts the wide desktop foot row

Status: implemented

Extends [remote control reuses the official UI](2026-08-29-remote-control-reuses-official-ui.md): the plugin's shell adaptation is no longer portrait-only — the wide desktop foot is laid out by the same semantic-suffix CSS layer.

## Problem

The official sidebar foot stacks two rows: `sidebar.footer.action` (the update and remote triggers) above `sidebar.settings` (a Settings trigger that stretches across the whole column). On the desktop column the Settings trigger therefore owns a full-width line whose right half is empty, while the two triggers that belong to the same cluster sit on a line of their own above it. The user asked for the three controls to share one line.

## Decision

1. `remote.module.css` lays the wide foot out as one wrapping row, scoped to the uncollapsed frame (`[data-dsh-frame]:not([data-sidebar-collapsed])`). The Settings seat opens the bottom line (`order: 3`, `flex: 1 1 auto`) and the family's own footer triggers close it at their intrinsic width (`flex: 0 0 auto`, `order: 4`), so the Settings trigger and the action pair share one line and the Settings trigger narrows to the space left for it.
2. Every other foot child — the usage glance card, another plugin's block — claims a full row of its own (`flex: 1 1 100%`) above that line, so the shared row is stable without knowing which plugins append children.
3. **The action seat carries no box (issue #1710).** The seat is a *shared* container, not this plugin's own icon row: since 0.1.6/0.1.7 the shell collects every `sidebar.footer.action` registrant into one `footerActions` div whose slot host is `display: contents`. Giving that seat a box therefore scaled with whatever a third party registered — a 339 px balance stack turned the seat into a 417 px column, squeezing the Settings trigger (a shell element this plugin does not own) to 102 px and centring it vertically inside that column (`y534 = 351 + (417-50)/2`), with the footer 515 px tall over the session list. The seat is now `display: contents`, so its occupants answer to the foot's own wrapping layout: a registrant that is not a family trigger takes a full line of its own (`flex: 1 1 100%`, `order: 1`), and the family triggers (`[data-dsh-part='entry']`, this plugin's own `entryRow`) keep the bottom line. Ordering those two as `3`/`4` rather than `1`/`2` is what leaves room for the foreign row above the shared one.
4. The collapsed-frame rail keeps the shell's stacked foot: the rules never apply under `[data-sidebar-collapsed]`, where the circles stack by design and a 56 px column has no room for a shared line.
5. **The rail seat itself is stacked (issue #1678).** Leaving the rail entirely to the shell was wrong once a second registrar exists: the shell renders `sidebar.footer.action` as a *centered horizontal row* in the rail too, so two 36 px circles made the seat 78 px wide against a 35 px icon column and pushed the outer circles to `x=-11` and `x=31` while every other rail row sits at `x=10`. A rule scoped to the collapsed frame and anchored on this plugin's own `data-rail='rail'` occupant (`[class*='footerActions']:has([data-rail='rail'])`) turns the seat into a centered column with a 4 px gap, so each occupant keeps the 36 px rail column. The wide column never matches it, and a shell that stacks the foot itself makes the rule an equal-value no-op. Because the rail rule anchors on the seat's own box, it is the one place the `display: contents` decision above does not reach: it stays a box in the rail, where the shell gives the seat a box of its own.

## Alternatives considered

- Overlaying the triggers on the Settings row with absolute positioning. Rejected: the Settings trigger would stay full width (the width was the complaint) and the placement would depend on the Settings seat being the foot's last child.
- Moving the footer-action node into the Settings row. Rejected: the slot renderer owns that node's position; re-parenting DOM under React reconciliation is the trap the usage foot card avoids by owning its own root.
- Doing it in the usage plugin, whose card already sits in the foot. Rejected on ownership: the triggers belong to this package, and the layout must hold when the usage plugin is not installed.
- Making the shared row unconditional (no rail scope). Rejected: the shell's rail is a 56 px column; a shared row there overflows and clips both circles.
- **Guarding the seat box with `:has()` instead of removing it (issue #1710).** The reporter's more conservative alternative was to keep the box and add a precondition, e.g. apply the shared-row layout only while the seat holds nothing but this plugin's icon row (`:has(> [data-slot='sidebar.footer.action'] > :not([class*='entryRow']))`). Rejected: it concedes the design in exactly the configuration that broke — the intended "Settings and the trigger pair on one line" would silently stop applying as soon as a third party registers, and the layout would depend on a hash-suffixed class of an element this plugin does not own. Removing the box keeps the intent under every registration set and leaves the seating order to the foot, which is where it belongs.
- **Dropping the shared-row intent entirely and returning the whole foot to the shell's stacked layout.** Rejected on the original request: the reason this layer exists is that the Settings trigger would otherwise own a full-width line with an empty right half.
- **Painting the settings column with a fixed width so the seat cannot squeeze it.** Rejected: it trades one hard-coded number for another and breaks the rail and narrow columns.

## Consequences

- The Settings trigger no longer occupies a full row on the desktop; the footer-action occupant (the remote trigger) sits beside it. In the rail the seat now stacks its occupants inside the icon column instead of overflowing it.
- The shared bottom line survives an arbitrary third-party registration into `sidebar.footer.action`: an unfamiliar registrant takes a full row above it, and the Settings trigger keeps its width instead of being squeezed into a column. The plugin's rules no longer depend on owning that container.
- The layout depends on the official suffix classes `footArea` / `settingsArea` / `footerActions`, the frame's `data-sidebar-collapsed` marker, and the family's `data-dsh-part='entry'` / `entryRow` markers — the same survival contract as the portrait layer, re-verified on every GUI QA round.
- Any plugin that appends a block to the foot gets a full row for free; a plugin that wants to join the shared line has to opt into the same order/basis contract.

## Testing

- `packages/dsh-remote-web-ui/tests/foot-row-css.spec.ts`: the wide row's direction and wrap, the Settings seat's grow/order, the action seat carrying no box (`display: contents`, and no `flex: none` / `align-items`), the full-row rule for other foot children, the full-row rule for a non-family seat registrant, the family trigger's intrinsic width and bottom-line order, the collapsed-frame scoping of every wide rule, and the rail seat's column direction when a rail occupant is present.
- Live GUI: wide column with the Settings trigger and the action pair on one line, the Settings trigger measured at 182 px (was 260 px), the usage card on its own row above; the rail keeps `flex-direction: column` with the actions stacked.
- Still owed: a GUI measurement of the wide foot with a third-party tall registrant in the seat (the configuration issue #1710 reports). The CSS contract is pinned by the spec above, but no screenshot or computed-geometry capture of that arrangement was produced in this change.
