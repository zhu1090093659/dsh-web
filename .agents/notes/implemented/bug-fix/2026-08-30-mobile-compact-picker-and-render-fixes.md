# Agent Note: Mobile compact model picker, conversation clipping fix, overlay suppression, verified whale toggle

Status: implemented

## Problem

Four defects on the portrait phone surface of `dsh-remote-web-ui` (reproduced in the live GUI at 390x844 with touch emulation):

1. **Assistant message text clipped.** The first line of every message was cut horizontally (glyph tops missing). Measured geometry: the message row is a shrinkable flex column whose body measured 38 px against 48 px of text, bottom-anchored, so the first line overflowed the row top. A rule bisect over the injected stylesheet isolated the culprit: the ported dsh-LAN rule `[class$="_scrollBody"] [class$="_body"]{gap:6px}`.
2. **Model picker unusable on phones.** The picker menu anchors `right: 0` to its ~170 px trigger, so both the menu and the 286 px model list flew past the left viewport edge (`x = -42` at 390 px); model names were unreadably cut.
3. **Desktop workbench covers the phone.** The official workbench (Files / source control) mounts into a full-viewport portal layer (`[class$="_overlayLayer"]`) with no `data-dsh-plugin` root and a persisted open state. On a phone it covered the entire conversation with no close control — a paired device showed a "dead" screen.
4. **The whale could not open the sidebar.** The official `LayoutController` mounts but its bound store actions never attach on the running cohort: `layout.toggleSidebar()` returned normally and flipped nothing, so the whale, the outside-tap fold, and the swipe-open gesture were all dead.

## Decision

1. **Do not port the `_body` gap rule.** The compaction is cosmetic; correctness wins. With it removed the body wraps its content naturally (verified: `clippedTop` went from +10 px to 0 on every probed message).
2. **Bottom-sheet picker.** The identity transform on `_composerSeat` would still become the containing block for fixed children, so it is freed on portrait, and every seat menu (picker, model list, effort list, permission presets) pins to the viewport bottom (`left/right: 8px`, `bottom: calc(8px + env(safe-area-inset-bottom))`, `max-height: 70dvh`, scrollable) with 44 px cells.
3. **Compact icon entries instead of desktop text triggers** (user's design): the context ring keeps its official semantics, and two synthesized buttons in the tools row — cube = model list, level bars = effort list — forward to the official trigger and drill straight into the matching menu cell (polling up to ~1.2 s for the sheet mount). The original text trigger hides only while the wired buttons exist (body class gate), so a failed wiring degrades back to the usable text trigger. The buttons sit inline parallel to the permission trigger; the trailing line collapses and the context ring shifts right (44 px) so no hit box overlaps.
4. **Verified whale toggle.** `toggleSidebarVerified()` reads the frame state, calls the wired face, and 150 ms later falls back to clicking the official rail/logo toggle (which owns its own store actions) when the frame did not flip. Works for expand and collapse; jsdom-tested against an inert face and a healthy face.
5. **Workbench suppression, scoped.** `body.dsh-remote-portrait [class$="_overlayLayer"] [class$="_workbench"]{display:none !important}` hides the workbench panel only. The first cut suppressed the whole layer and broke the settings modal, which mounts into the same portal — caught in the GUI QA round and rescoped.

## Alternatives considered

- Re-anchoring the picker menu `left: 0` to its trigger: rejected — it still overflows on 320-360 px screens and keeps cramped 40 px rows.
- Synthesizing a full second UI for the composer: rejected — the official responsive collapse plus two forwarded icon buttons reaches the user's design with no duplicated state.
- Suppressing the whole `_overlayLayer`: rejected after the settings modal regressed in QA (see Decision 5).
- Fixing the layout face server-side: out of scope — the face lives in the DSH host checkout, which this repository must not modify; the fallback keeps working across cohorts where the face does attach.

## Consequences

- Assistant messages render full-height on phones; the composer drops from two text-trigger lines to one icon row; model and effort selection are one tap from anywhere.
- The workbench is unreachable on portrait by design (it is desktop-oriented and had no close control); rotating to landscape or opening on a desktop restores it.
- The verified toggle adds at most a 150 ms delay to sidebar opening on healthy cohorts (no-op check) and restores the whale on cohorts with an inert face.
- The runtime evidence was collected against the running local build `0.1.2-alpha.1-cd5ef81`; the layout-face fallback is what makes the whale cohort-proof, not a fix for the host-side controller wiring, which remains worth an upstream report.

## Verification

- `pnpm vitest run` in the package: 296 tests pass, including three new ones (sheet/suppression/compact CSS contract, inert-face fallback, healthy-face no-fallback).
- Repo gates: `pnpm typecheck`, `pnpm test` (20 packages), `pnpm docs:check`, `codegraph sync`.
- Live GUI QA at 390x844 (touch emulation, Chromium, `http://127.0.0.1:3080/`): message text unclipped (`clippedTop` 0 across probed messages); model list and effort list open as full-width bottom sheets with `fits` geometry checks passing; whale tap opens the sidebar on the inert-face build; outside tap folds it; settings modal still opens; workbench overlay stays suppressed.
