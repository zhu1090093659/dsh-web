# Agent Note: maid-atelier Composer Backing, Character Stage, and Stats Strip

Status: implemented

## Problem

Three rendering defects reported against the maid-atelier port (#1501, transferred from
`Small-tailqwq/dsh-deep-whale#128`). All three reproduce only in DSH Desktop (Electron) and are
correct in Chrome on the same machine and stylesheet:

1. `[data-composer-card]:after` — the backing layer that inherits the card's background — sat at
   `z-index: 0`. Once a conversation started, the layer painted above the typed text, so the input
   looked empty (placeholder, caret and sending all still worked).
2. `[data-skin-chrome="character-stage"]` positioned both maids with `z-index: -1` plus
   `contain: strict`. Whether a negative-z layer is painted depends on the root background being
   painted on that path; Electron dropped the layer, leaving the maids nearly invisible. The skin's
   own `:has()` rule also disables the `body::before/:after` fallback whenever the stage node
   exists, so both routes were closed at once.
3. The session statistics strip — the official `StatsPills` root, marked `data-composer-stats`
   (`packages/client/ui-chat/src/client/chat/StatsPills.tsx`) — renders under
   `[data-slot="conversation.composer"]`, not inside the `.dock` slot. The composer color pairs the
   skin already ships therefore never matched it, and the text kept
   `--dsw-alias-label-tertiary` (#6f7c99 in light) over a light surface.

## Decision

1. The composer backing moves to `z-index: -1`. The card already isolates its stacking context
   (`patches.css` `[data-composer-card] { isolation: isolate }`), so the layer still paints above the
   background it inherits from the card, but it can no longer sit above the card's content — text
   cannot be covered by it in any engine.
2. The character stage drops `contain: strict` and moves from `z-index: -1` to `z-index: 0`. The
   stage is `body.prepend`ed (`hooks.mjs`), so same-level positioned app surfaces still paint after
   it in DOM order, while it no longer depends on whether the root background is painted.
3. The statistics strip gets its own color pair — `#33415f` with `#7d8aa6` separators in light,
   the skin's existing `#aebdde` (and `#aebdde80`) in dark — keyed on the official
   `data-composer-stats` attribute. Only the foreground changes: the official root is
   `background: transparent`, so a background here would fight the skin's own composer layers.

## Verification

- `node scripts/market-build` regenerated `market/dist` for the changed asset
  (`assets/skins/maid-atelier/patches.css`, `assets/skins/maid-atelier.zip`, `styles.js`,
  `tryon-assets/skins/maid-atelier/patches.css`) and `pnpm market:check` passes, so the stylesheet
  still parses and transforms through the market pipeline.
- `pnpm --filter @linxin666/dsh-client-ui-skin-center test` (39 files, 637 tests) and
  `pnpm skin-center:check` pass. `tests/maid-atelier-patches.spec.ts` pins all three fixes inside the
  stylesheet: the backing layer's `z-index: -1`, the card's `isolation: isolate` precondition, the
  stage's `z-index: 0` with no `contain`, and the four statistics-strip rules.
- A Playwright probe against the system Edge (Chromium 152) loaded the real `patches.css` over a
  composer fixture and reported: the strip computes to `rgb(51, 65, 95)`, so the new rule matches; the
  strip is **not** inside `[data-slot="conversation.composer.dock"]`, and that dock selector matches
  only the dock row, so the old rule could never have reached it; the stage computes to `z-index: 0`,
  `contain: none`, `pointer-events: none`. Two screenshots of the same card differing only in the
  backing layer's z-index show the mechanism: with `-1` the bare in-flow text renders, with the
  previous `0` it disappears under the inherited opaque gradient.
- **No DSH Desktop or live-GUI evidence exists yet.** The running GUI serves this checkout, but it
  answers 401 without its per-process token and that token was deliberately not used; the Electron
  compositor cannot be reproduced here. Item 2 therefore still rests on the reporter's own
  Desktop-verified bypass rather than a local reproduction, and the residual risk under Consequences
  stands.

## Alternatives considered

Lifting `#root` to `z-index: 1` so the stage could never paint above app content was rejected: it
creates a new stacking context, and any later body-level surface with `auto` or a low `z-index`
(third-party plugin chrome such as the pet) would drop below the app. The official overlays use
1000+, but the set of body-level nodes is not enumerable from here, so the smaller assumption -
stage prepended, same-level panels later in DOM order - was preferred.

Deleting the stage and keeping only the `body::before/:after` fallback was rejected: both routes are
fixed, full-viewport layers with the same negative-z dependency, so the fallback does not solve the
Desktop case, and the `:has()` suppression rule would lose its meaning.

Keeping `z-index: -1` and only dropping `contain: strict` was rejected: it preserves the root cause
(whether the root background is painted) and the reporter's Desktop-verified bypass covered only the
raised-z-index combination.

Giving the statistics strip its own background as well was rejected: the official root is transparent
and the surface beneath it comes from the skin's composer layers, so a background here would fight
them; the reported defect is text contrast.

## Consequences

Typed text can no longer be hidden by the composer backing in Desktop, the maids no longer depend on
root-background painting, and the statistics strip carries an explicit foreground in both themes. The
stage now lives at `z-index: 0`, so in theory non-positioned in-flow content could be painted under
its two bottom-corner images (the stage itself is `pointer-events: none`, so nothing becomes
unclickable). Closing that residual risk is what the pending Desktop and Chrome screenshot comparison
is for.
