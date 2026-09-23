# Agent Note: Pet bubble typography follows the sprite's scale

Status: implemented

## Problem

Issue #1549: the status, whisper, and usage bubbles were pinned at `font-size: 12px` with fixed padding and a fixed maximum width. A user who shrank the pet from the default 160px to 100px kept a full-size bubble over a smaller sprite, so the proportions read top-heavy, and `PetDisplayConfig` had no typography field to correct it.

## Decision

`PetDisplayConfig` gains `bubbleScale` (0.5–2, default 1), persisted and clamped exactly like the other display fields — load-time in `persist.ts`, on both write paths in `service.ts`, and declared in the settings schema so the card can edit it. `bubbleScaleFor(display)` turns size and multiplier into one CSS ratio, `(size / 160) * bubbleScale`, bounded by `BUBBLE_FONT_MIN_PX` (10) and `BUBBLE_FONT_MAX_PX` (24) and rounded to two decimals so one configuration always paints the same.

`PetSprite` writes that ratio as `--pet-bubble-scale` on the floating container, and `pet.module.css` multiplies the bubble's font size, padding, and the status bubble's maximum width by it (the existing `calc(100vw - 24px)` viewport guard stays in the `min()`). The pet therefore scales its own bubble by default, the multiplier rides on top, and text never leaves the readable band.

## Alternatives considered

A plain `bubbleFontSize` in pixels was rejected: it would freeze the bubble at one size and reproduce the same mismatch for every other pet size, which is the defect being reported.

Following the size with no user knob was rejected: the reporter explicitly asked for a way to correct the result, and the bubble is the pet's main text surface.

A separate switch between "follow the pet" and "locked size" was rejected as a third state to explain; one multiplier over the automatic following covers both readings without a mode.

Scaling only the font and leaving padding and the status width fixed was rejected: the bubble would keep the old footprint around smaller text and look loose rather than proportional.

## Consequences

Existing installs are unchanged (the default multiplier is 1 and a 160px pet still renders 12px text). A shrunk pet now also gets a proportionally narrower status bubble, so long status copy wraps earlier than before; the text is truncated with ellipsis either way. `bubbleScale` is part of the settings schema, so the pet settings section must accept it on deployments whose card runs an older build.
