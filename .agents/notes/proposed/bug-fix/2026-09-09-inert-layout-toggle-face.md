# Agent Note: Host layout toggle is inert on the installed cohort (upstream report pending)

Status: proposed

## Problem

The official layout service is a silent no-op on the installed cohort, so the documented way for a plugin to open or close the sidebar does not work. Measured on the running `dsh web` host (0.1.2 cohort via npm, profile `web`, Chrome 152, portrait 390x844 with touch emulation):

- A plugin that wires `ctx.get('layout').toggleSidebar()` (the path `dsh-remote-web-ui` uses) calls it after mount and it returns normally, without throwing.
- Sampling `document.querySelector('[data-dsh-frame]').hasAttribute('data-sidebar-collapsed')` on `requestAnimationFrame` for 800 ms (about 50 samples) shows the attribute keeping its value throughout — the state never moves in either direction.
- In the same page, clicking the official logo-row toggle (the button whose `aria-label` is the open/collapse sidebar string) flips the same attribute immediately, in both directions.

Impact: any plugin or gesture that drives the documented service cannot open or close the sidebar. `dsh-remote-web-ui` had to invert its own control order — it now drives the official logo-row toggle first and keeps the wired face as the fallback (see [the phone adaptation note](../../implemented/bug-fix/2026-09-09-mobile-remote-tap-and-adaptation-fixes.md)). The defect itself lives in the DSH host, which this repository must not modify, so no code here can fix it.

## Proposal

1. **Record the reproduction and its evidence here** instead of filing upstream yet: the user asked to keep this as our own record until a target repository and authorization exist.
2. **Keep the shipped workaround** (official toggle first, wired face as the verified fallback). It is cohort-proof: where the face does work, the toggle also works; where no logo-row toggle exists, the face is called directly.
3. **If the host is fixed**, simplify the layer back to a single face call and move this note to `implemented/` (or `rejected/` if the service is intentionally inert and the toggle is the documented control).
4. **Never** patch the host checkout, monkey-patch the layout service from a plugin, or depend on host internals beyond the public `ctx.layout` face.

## Context & Efficiency Impact

No runtime or prompt cost: the workaround already exists and is covered by tests (`mobile-adapt.spec.ts`: "drives the official toggle first and never waits on the inert layout face" and "falls back to the wired face when the official toggle does not flip the frame"). This note only preserves the measurement so a future reader does not re-discover it, and so the upstream report can be written without re-running the investigation.

## Evidence

- Repro: call the wired face, then rAF-sample `[data-dsh-frame]`'s `data-sidebar-collapsed` for 800 ms — value unchanged in every sample.
- Control: the official logo-row toggle flips the same attribute immediately in the same page (verified twice: collapsed → expanded and expanded → collapsed).
- Consumer: `packages/dsh-remote-web-ui/src/client/mobile-adapt.ts` `toggleSidebarVerified()`; the wiring lives in `src/client/index.ts` (`ctx.get('layout')`, boot-order throw tolerated by contract).

## Alternatives considered

- **Filing the report upstream now.** Not authorized and no target repository was given; the user asked for a local record first.
- **Patching the host checkout or the layout service from the plugin.** Forbidden: this repository must never modify a DSH checkout, and monkey-patching the service would break the plugin boundary and the next cohort.
- **Dropping the fallback and trusting the face.** Rejected: measured inert, so the phone's sidebar entry would be dead.
- **Dropping the face and keeping only the toggle click.** Rejected as the sole path: a composition without a logo-row toggle would have no control at all; the face stays as the fallback for exactly that case.
- **Filing a duplicate note per consumer.** Rejected: this is one host defect with one workaround contract; the phone adaptation note links here.

## Acceptance criteria

The note moves to `implemented/` when the installed cohort's wired face flips `data-sidebar-collapsed` (or the documented state) within one frame of the call and the layer can drop the toggle-first ordering with its two specs updated. It moves to `rejected/` if the service turns out to be intentionally inert and the logo-row toggle is declared the supported control — in that case the workaround becomes the documented path rather than a fallback.

## Risks

- The workaround depends on the official logo-row toggle's `_toggle` class (with the row's last button as the fallback selector); a cohort that renames both would leave only the inert face, i.e. a dead sidebar entry. The package spec covers the selection logic, but not a future cohort's markup.
- Until an upstream report exists, other plugin authors will keep re-discovering the same inert call and each will build its own workaround.
