# Agent Note: maid-atelier light-scheme composer text contrast

Status: implemented

## Problem

Issue #1085: with the maid-atelier (Abyssal Maid Atelier) skin active in the
light scheme, text typed into the conversation composer is unreadable. The
composer card deliberately keeps its deep-navy abyssal lace fill in BOTH
schemes (`patches.css` sets the card background unconditionally, dark scheme
only re-tints it). The shell paints typed text through a highlight backdrop
div inside the card (the textarea overlays it with a transparent
`-webkit-text-fill-color` and contributes only caret and selection;
`[data-input-mirror]` is a `visibility:hidden` measuring copy), and the
light-scheme overrides never set the backdrop color: it inherited the
light-scheme ink `#172347`, rendering dark navy text on the dark navy card.
The light-scheme caret (`#405a99`) and placeholder (`#4d5d7f`) had the same
dark-on-navy defect.

## Decision

Treat the composer card as a scheme-invariant dark surface and pin its text
colors on the light porcelain scale for both schemes in
`packages/skins/skin-center/skins/maid-atelier/patches.css`: backdrop (and
mirror) text `#eef3fc`, caret `#bcd2ff`, placeholder `#b6c2e0`. The
now-redundant `body[data-ds-dark-theme]` caret and placeholder overrides
were removed — the dark scheme previously shipped equivalent light values
(backdrop inherited the dark body ink `#e5eaf6`), so unifying them changes
nothing in dark mode and fixes light mode. Skin version bumped 0.3.0 to
0.3.1; gallery manifest and market dist regenerated in the same change.

Rejected alternative: making the composer card cream/porcelain in the light
scheme (a light card matching the light scheme). That would dissolve the
skin's signature abyssal lace composer — the deep-navy card with the lace
frame art is the designed centerpiece in both schemes, and the defect was
only the missing text colors.

## Consequences

Any future composer-card background change must re-audit the pinned text
colors, since they no longer track the scheme tokens by inheritance. Verified
against the live Web GUI (light scheme, hero and docked composer phases) with
screenshots; dark-scheme rendering confirmed unchanged.
