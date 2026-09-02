# Agent Note: Session-archive section UI realigned to the official token contract

Status: implemented

## Problem

The session-archive settings section rendered with broken colors under every
theme, and dramatically changed appearance when a dialog opened. Two user
screenshots of the same skin in light mode showed the section washed out and
translucent in the list view, and the whole settings panel turning dark grey
with dialog text floating on it when the physical-delete confirmation opened.

Root cause: `archive.module.css` was written against six tokens that do not
exist in the official token contract
(`skins/skin-center/contracts/official-tokens-v1.json`) — `--dsw-alias-bg-primary`,
`--dsw-alias-bg-hover`, `--dsw-alias-bg-danger`, `--dsw-alias-label-danger`,
`--dsw-alias-border-primary`, `--dsw-alias-label-link`. At runtime the custom
properties resolve to nothing, so every declaration built on them alone became
"invalid at computed-value time": backgrounds and borders fell back to
transparent (invisible cards, inputs, modal surface) and `color:
var(--dsw-alias-label-danger)` inherited the body text color (danger actions
lost their red). On top of that the modal scrim hardcoded
`rgba(0,0,0,0.45)`, a token-independent black veil that darkened the entire
viewport regardless of skin and theme.

## Decision

`archive.module.css` now uses only official contract tokens, each with a
literal fallback (`var(--token, #fallback)`) so an uncovered token can never
again produce a transparent surface:

- Surfaces: `bg-layer-1` (list card, inputs, buttons), `bg-layer-2`
  (selection bar, auto-maintenance panel), `bg-base` (dialog card), with
  `border-l1`/`border-l2` hairlines and `shadow-lv1`/`shadow-lv3` elevation.
- Scrim: `bg-mask-1` plus `backdrop-filter: var(--dsw-mask-blur, blur(10px))`,
  matching the `dsh-task-board` modal convention; skins remap the mask so the
  dialog cast stays inside the skin's palette.
- Semantics: the `state-*` family — `state-error-primary` (danger text, solid
  danger fill paired with `label-primary-inverted`, warning callout),
  `state-warn-primary` (running chip, out-of-filter hold note),
  `state-success-primary` (normal chip), `state-business-primary` (archived
  chip), all tinted through `color-mix` for soft chip/callout backgrounds so
  each skin's own state remap recolors the section end to end.
- Status chips changed from the old ok/warn/muted trio to
  success/warn/danger/business/neutral tonal pills; the row accent for
  selection is an inset `button-primary-fill` bar plus a brand-tinted wash.

UX polish shipped in the same pass: segmented-control filter tabs, focus-visible
rings and hover/press transitions on every control, `accent-color` on
checkboxes, horizontal row actions, monospace chip for session ids, a red top
accent and title on the danger dialog, the irrecoverable warning as a callout
box, a dashed acknowledgement row for strong deletes, kind-aware batch progress
fill (brand for archive/unarchive, error for delete), and a wide preview modal
with role-tinted excerpt bubbles. Dialogs animate in (fade/scale) and honor
`prefers-reduced-motion`.

A same-day follow-up round, driven by real-usage feedback: the workspace
quick-select chip bar below the list duplicated the toolbar workspace filter
and was removed (component block, CSS, and the `arch.select.workspace` /
`arch.select.workspaceClear` keys in zh/en and the dsh-i18n ru pack); both
native `<select>` controls were replaced by a themed dropdown
(`client/Select.tsx`: trigger + listbox popup, grouped headers for the sort
menu, arrow/Home/End/Enter/Esc keyboard support, outside-pointer close,
`listbox`/`option` roles with `aria-activedescendant`); and the popup surface
uses `bg-overlay` plus a strong `backdrop-filter` because glass skins keep
every layer token translucent — on whale-song the layer-1 popup was
transparent enough for list rows to bleed through behind the option text,
while `bg-overlay` is the near-opaque elevated surface those skins remap.

## Testing

`pnpm --filter @linxin666/dsh-session-archive build/typecheck/test` (77 tests)
plus repo `typecheck`, `test`, `docs:check`, `i18n:check`. Verified in the live
Web GUI on the whale-song skin in light mode: the list card, tonal chips,
red danger links and the auto panel read correctly; the delete confirmation
renders as a solid card over a gentle skin-tinted blurred scrim with the
warning callout and solid confirm button; the preview dialog renders meta and
excerpt bubbles; the custom dropdowns render opaque grouped popups and picking
a workspace filters the list. Evidence: session screenshots of the section, the
delete confirm, the preview, and both dropdowns.

## Alternatives considered

- Define the six missing aliases as derived tokens in the skin-center fallback
  layer, keeping the old class names. Rejected: it would institutionalize
  non-contract tokens, and `bg-danger`/`label-danger` semantics are already
  covered by the `state-*` family that skins actively remap.
- Hardcode a light/dark pair with `@media (prefers-color-scheme)`. Rejected:
  the GUI theme is not the OS scheme under skins; contract aliases already
  carry both themes and every skin's remap.
- Keep the old layout and only swap token names. Rejected: the report asked
  for UI/UX polish, and the same pass fixes the flat hierarchy (no surfaces,
  stacked row actions, unstyled warnings) that made the section look broken
  even where colors were technically correct.

## Consequences

- The section is skin- and theme-proof by construction: every color resolves
  through the contract token table with literal fallbacks, so a skin that
  remaps `state-*`/`bg-layer-*`/`bg-mask-1` recolors it fully, and an
  uncovered token degrades to a sane literal instead of transparency.
- Other packages still referencing non-contract tokens (`dsh-plugin-manager`
  uses `bg-danger`/`label-danger`/`label-on-danger`/`bg-warning`/`bg-brand`;
  `dsh-doctor` uses `label-error`) have the same transparent-or-inherited
  failure mode and need the same realignment when their turn comes.
- `backdrop-filter` depends on `--dsw-mask-blur`, which some skins define as a
  color; there the declaration is dropped and the scrim stays tinted but
  unblurred — a graceful degradation, not a regression.
