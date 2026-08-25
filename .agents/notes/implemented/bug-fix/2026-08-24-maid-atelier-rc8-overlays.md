# Agent Note: maid-atelier rc.8 attachments and overlays

Status: implemented

## Problem

DeepSeek Harness rc.8 renders draft attachments through the
`conversation.input.attachments` Slot and renders settings selectors through
portaled Menu surfaces. The maid-atelier composer frame established a stacking
context above the nested attachment branch, so decoded `blob:` previews stayed
hidden behind the ornate card even though the remove control remained visible.
The skin's sidebar chrome also allowed conversation code-block headers to paint
above the settings modal. Raising the entire sidebar to an unbounded z-index
fixed that symptom but then placed the settings panel above DSH's portaled
menus, making agent-preset and permission selectors unclickable. Cordis approval
buttons had the same ancestor/hit-target conflict with the ornate sidebar.

## Decision

Keep the fixes in `packages/skins/skin-center/skins/maid-atelier/patches.css`
and preserve DSH's existing overlay scale instead of inventing a higher one.
The complete attachment Slot branch is promoted locally above the composer
frame, and every CSS-module fallback selector is anchored below
`[data-slot="conversation.input.attachments"]`. Cordis enters the ordinary menu
range (`80` for the necessary sidebar context and `100` for the panel).
Settings enters the modal range (`900` for its sidebar ancestor and `1000` for
the full-viewport presentation layer), leaving DSH's portaled Menu at its
official `1100` above the modal. Icon children do not capture approval-button
pointer events, while the actual action buttons remain hit-testable.

The built-in skin acceptance test locks the attachment Slot scope, modal layer,
and a maximum custom numeric z-index of `1000`. The skin version advances from
`0.3.1` to `0.3.2` so Workshop installations can receive the compatibility
fixes.

## Alternatives considered

Raising the settings and Cordis ancestors to `214748xxxx` values was tested and
rejected. It hid code-block chrome and made approval circles visible, but broke
the host's `modal 1000 < portaled Menu 1100` contract, so controls inside the
settings panel could no longer open usable menus.

Raising only the attachment `<img>` was also tested and rejected. A child cannot
escape its parent's lower stacking context, so the browser reported the
`blob:` image as loaded while the ornate composer frame still covered it.

## Consequences

Future maid-atelier compatibility selectors for generated CSS-module names must
remain under a semantic Slot or plugin anchor. Future modal fixes must preserve
the host overlay scale rather than using unbounded z-index values. The repair
was verified in the live DSH Web GUI with visible attachment thumbnails,
clickable settings selectors, settings above markdown code headers, and usable
Cordis approval controls.
