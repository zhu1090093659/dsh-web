# Agent Note: Conversation scroll creep on composer keystrokes — row-level scroll-margin clearance

Status: implemented

## Problem

While reading history (conversation scrollport scrolled up, not at the bottom), every keystroke into the composer crept the conversation scroll position downward a little. The scroll never settled, so typing while reading older messages constantly dragged the view away from what the user was reading. The bug appeared whenever a catalog skin, custom theme or wallpaper was active — i.e. whenever the shared shell-rendering adapter installed its stylesheet.

## Decision

The shared shell-rendering adapter (`packages/skins/skin-center/src/client/runtime/shell-rendering.ts`) no longer reserves bottom clearance with `scroll-padding-bottom` on the conversation scrollport (`[data-conversation-scroll]`, `[data-dsh-part="scrollport"]`). Clearance now lives on the flow rows themselves (`[data-chat-anchor-key]`, the `*_Row` class fallbacks mirrored from backdrop-scene) as `scroll-margin-bottom: var(--dsh-composer-height, ...)`, still without any physical `padding-bottom` on the port.

### Why port-level scroll padding creeps

The official shell's composer seat is `position: sticky; bottom: 0` — the final in-flow child of the conversation scrollport. Its caret therefore always renders inside the port's bottom band. After each keystroke the browser runs caret-reveal ("scroll the focused caret into the visible region"); with `scroll-padding-bottom` reserving the composer-height band, the caret is judged *not revealed* inside that reserved band, and the browser scrolls down to satisfy it — once per keystroke, for as long as the user types. Replacing port-level scroll padding with row-level scroll margin keeps `scrollIntoView()` clearance (the #978 goal: rows land readable above the sticky composer) while leaving caret-reveal geometry untouched, because scroll-margin only applies to scroll snap/scrollIntoView targets, never to focus reveal.

## Alternatives considered

Keep `scroll-padding-bottom` and suppress caret-reveal some other way (e.g. re-focus tricks or canceling scroll events). Rejected: fighting the browser's focus reveal from JS is fragile across engines and would break genuine caret visibility when the composer textarea itself grows (multi-line drafts).

Physical `padding-bottom` on the port instead of scroll padding. Rejected earlier (#978 already removed it): it lifts the active dock by one composer height and shifts the hero above center.

Remove the clearance entirely. Rejected: it regresses #978 — `scrollIntoView()`-style navigation would park rows behind the sticky composer.

## Testing

A Playwright minimal reproduction (sticky composer seat inside an overflowing scrollport) confirmed the mechanism: with `scroll-padding-bottom: var(--dsh-composer-height)` each keystroke crept scrollTop by a fixed step (456 -> 680 over 8 keystrokes); with row-level `scroll-margin-bottom` instead, scrollTop stayed pinned (456 across all 8 keystrokes) while `scrollIntoView({ block: 'end' })` still landed the last row exactly above the sticky seat. Unit gates: `tests/skin-runtime.spec.ts` now asserts the port rule carries no scroll padding and the row rule carries the scroll-margin clearance (36/36 passing); package typecheck passes; `verify-docs` pair re-recorded.
