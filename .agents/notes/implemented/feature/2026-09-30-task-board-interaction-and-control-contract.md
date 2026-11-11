# Agent Note: Task board interaction and control contract

Status: implemented

## Problem

The board's transient surfaces had no reversal. The task detail overlay and every
dialog above it (create, edit, edit-labels, link-subtask, confirm-delete) were
mounted by a boolean and vanished on the same React tick that cleared it: the
surface appeared and disappeared with no enter/exit pair, Escape did nothing,
focus stayed on whatever was behind the overlay, Tab walked the cards underneath,
and the dialog was not declared modal. Keyboard and assistive-technology users
had no way in or out of a surface that covered the board.

The toolbar had the same problem in miniature. Each control carried its own
padding and font arithmetic, so the back control, the project picker, the search
box, the two view toggles and the create button sat on five different heights in
one row; both toggles swapped their whole class between the outlined and filled
button recipes when pressed, which moved their neighbours. Several controls drew
their mark from text: a `‹`, a `×`, a `+` and a `⌁` stood in for the back,
close, add and session glyphs.

## Decision

Cards retain multi-line previews and visible metadata rather than a fixed single-line row, which sacrifices readability. Markdown previews are plain text; details use the marked lexer and safe React nodes, with raw HTML and automatic remote images disabled. This presentation does not modify stored task content.

The board's client half owns one interaction and control contract, in
`src/client/board/`:

- **`overlay.tsx` governs every transient surface.** `usePresence(open)` keeps a
  surface mounted through its exit leg and paints `data-state="closing"`, so
  enter and exit are one motion pair in `board.module.css` (backdrop fade plus an
  8px/98% rise that reverses on the way out, 160ms in and 140ms out, opacity only
  under `prefers-reduced-motion`). `useDialog(onClose, phase)` owns the keyboard:
  focus enters the surface on open and returns to the control that opened it on
  unmount, Tab wraps inside it, Escape asks the owner to close, and a
  document-wide stack makes only the topmost surface answer — a modal opened from
  the task detail swallows Escape instead of closing both layers. Each surface
  declares `aria-modal="true"` and carries `tabIndex={-1}`.
- **The board root declares the geometry and motion tokens**, and every
  single-line control takes its height from them: `--dsh-tb-control-h` (30px),
  `--dsh-tb-control-radius`, `--dsh-tb-control-gap`, `--dsh-tb-icon-size`,
  `--dsh-tb-hit-size` (44px), `--dsh-tb-motion-enter`, `--dsh-tb-motion-close`
  and `--dsh-tb-ease`. The header's tools therefore share one track, and the
  mobile block's `min-height: 44px` still wins over the fixed height.
- **Selection is a variant, not a substitution.** A view toggle keeps the
  outlined control and expresses its pressed state through `data-active`, which
  changes role colour only. Filled actions use the matched primary-action set
  (`button-primary-fill` / `button-primary-hover` / `label-primary-foreground`);
  the danger action takes its text colour from `label-primary-foreground` instead
  of a literal.
- **Marks are vector glyphs.** `icons.tsx` draws the back, close, add, session
  and schedule glyphs on a 16-unit viewBox with `currentColor` and a 1.3 stroke —
  the recipe the sidebar panel glyph already uses. Icon-only controls keep their
  accessible name, and the icon control expands its pointer target to 44px with a
  pseudo-element while keeping its 30px box.
- **The header is identity plus tools.** The controls live in one `.boardTools`
  group (plain class, no new `data-dsh-part` value) so the title/host block and
  the toolbar read as two groups, and the card meta line wraps rather than
  clipping the update stamp on a narrow column.

## Constraints

- The contract is browser-half only: no protocol, ledger, host, cron or power
  behavior changes, and no new runtime dependency — the glyphs are hand-drawn
  paths, not a new icon package.
- Presence must not change the surface's dimensions in either leg, so nothing
  behind an overlay reflows while it arrives or leaves.
- Accessibility is preserved, never traded: every icon-only control keeps its
  `aria-label` and `title`, the toggle keeps `aria-pressed`, and the dialog keeps
  its accessible name.
- The toolbar wrapper deliberately adds no `data-dsh-part` enum value: the part
  enum is owned by the cross-repository semantic-attribute contract, and a
  structural wrapper does not justify a contract change there.

## Testing

`tests/board-overlay.spec.tsx` covers focus entry, focus return, the Tab wrap,
topmost-only Escape across two stacked surfaces, and the presence leg (mounted and
`closing` after the close request, gone after `OVERLAY_EXIT_MS` under fake
timers). The add-row finders in `tag-view.spec.tsx` and `subtask-view.spec.tsx`
locate the control by its label and assert the glyph's viewBox, and
`task-detail-edit.spec.tsx` waits for the exit leg with `vi.waitFor`.

## Alternatives considered

**CSS transitions alone, with `@starting-style`.** Rejected: React removes the
node on the tick that clears the mount boolean, and no transition runs on a node
that has left the DOM. The exit leg has to be owned by the component that keeps
the node alive, which is what presence does.

**Keep every surface mounted and toggle visibility.** Rejected: the collapsed
content would stay in the document, hidden focusables would remain tabbable
without an explicit `inert` discipline, and the form's own contract (a collapsed
region does not render its body) would have to change for a cosmetic reason.

**Adopt a headless dialog/overlay dependency.** Rejected on the repository's
no-new-dependency rule, and because the whole contract is about 150 lines that
must match this board's own presence model.

**Keep the text glyphs.** Rejected: emoji/punctuation-as-icon is a stated law
violation, the stroke weight could not match the shell, and a screen reader
announces a "`×`" as a multiplication sign.

**Swap the toggle's class between the outlined and filled recipe.** Rejected: the
two recipes carried different padding and font metrics, so every press resized
the control and moved its neighbours. A variant on one control keeps the box.

**Add a `data-dsh-part="board-tools"` anchor for skins.** Rejected for now: it is
an enum addition owned by `satellites/dsh-skins/contracts/semantic-attrs-v1.md`,
and the toolbar wrapper is not yet a surface a skin needs to address.

## Consequences

- A closing overlay stays in the DOM for its exit leg, so assertions that a
  surface is gone run after the motion rather than on the closing tick.
- One document-level capture listener is installed per open surface and ordered
  by a module-level stack; the stack is per module instance, which is one board
  per page.
- The collapsible form sections still mount and unmount their body without a
  transition. Their content is intentionally unmounted (the collapsed summary
  replaces it, and tests assert the fields are absent), so the surface contract
  stops at the overlay; a height transition would keep hidden fields in the DOM.
- The shared settings-card chrome (`shared/client/settings/`) is untouched. It is
  one component for six packages and needs its own change and evidence; this
  board's settings card moved its custom styling onto tokens in
  `board-settings.module.css` (the historical verification block itself was later removed in [2026-11-11](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md)).

The [card surface contract](2026-10-20-task-board-card-surface-contract.md) owns the type scale, outcome slots and fold behaviour of these surfaces.
