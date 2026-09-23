# Agent Note: orca-link wide sidebar made the New Session button click-proof

Status: implemented

## Problem

In the orca-link skin's expanded (wide) sidebar, clicking the top-left DSH
wordmark area did nothing. The host mounts its New Session button as the first
control of the sidebar logo row; the skin hides the button's own visuals and
overlays the DSH wordmark on it, so that wordmark area is the only affordance
users see for starting a session — and it was dead. The collapsed sidebar kept
working, which is why the skin otherwise looked and behaved fine.

Root cause: `patches.css` shipped `body[data-orca-sidebar-wide]
[data-orca-link-brand] { pointer-events: none; }` from the original v2 port.
The rule outlived its host layout: the current host puts the New Session
button in that row, so the rule silently cut the primary action off the UI
while every decorative overlay around it (wordmark, signal chip) was already
`pointer-events: none` and thus blameless.

## Decision

The rule is deleted. The brand button keeps the host's own click semantics
(`aria-label="新建会话"`) in both sidebar widths; the skin's chrome layered on
top of it stays non-interactive, so the whole wordmark area hits the button.
As a side effect the wide-mode hover frame the skin already drew for that
button (`:hover:before` stage frame and corner mark) becomes reachable again,
which is the feedback the design intended for the action.

A static guard (`tests/orca-link-hit-targets.spec.ts`) now fails if either
orca-link stylesheet targets `[data-orca-link-brand]` with
`pointer-events: none`, so the same hit-test class of regression cannot
reenter through this selector.

## Testing

- Live GUI (running host on port 3080, orca-link active): with the broken
  sheet, `elementFromPoint` at the wordmark center resolved to the logo row
  div, never the button. After serving the fixed sheet, the same point
  resolves to the button; opening an existing session first and then clicking
  the wordmark returns the UI to the hero new-session screen with `新会话`
  selected in the sidebar (screenshots captured).
- The pricing lamp overlapping the button's lower edge keeps its hover
  tooltip; it covers only a few pixels of the hit area.
- New guard spec plus the existing `orca-link-hooks.spec.ts` pass;
  `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check`,
  `pnpm skin-center:check` pass.

## Alternatives considered

- **Moving the New Session affordance elsewhere.** Rejected: the host already
  owns the placement and semantics; the skin should not rebuild shell chrome.
- **Keeping the area non-interactive to avoid accidental new sessions.**
  Rejected: the user explicitly expects the click to create a session, and the
  hero screen is non-destructive; the accidental-session risk belongs to the
  decorative frame (already fixed with `pointer-events: none` on the `:before`
  in the mobile-tap note), not to the button itself.
- **Re-enabling pointer events only on the wordmark overlay.** Rejected: the
  overlay is a child of the row, not of the button; hit-testing through it
  requires the button itself to accept pointer events, so the narrower rule
  does not exist.

## Consequences

- The wide sidebar's largest fixed affordance works again; the fix ships with
  the skin assets, so installed skins pick it up on the next skin update or
  reinstall (no host restart needed — a page reload after the skin files
  change is enough, as verified live).
- The guard is textual: a rule that disables pointer events on the brand
  button through a different selector spelling (for example a renamed
  attribute) would slip past it. The selector is skin-contract stable, so the
  exposure is small.
