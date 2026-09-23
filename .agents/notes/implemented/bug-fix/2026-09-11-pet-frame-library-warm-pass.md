# Agent Note: Pet frames2d warm pass decoded the whole frame library

Status: implemented

Supersession check: no active note owns the pet renderer's frame loading. [Combined-plugin DOM mutation cost](2026-09-11-combined-plugin-mutation-cost.md) covers per-mutation observer fan-out and leaves the pet's own boot cost untouched; the retired dsh-perf notes measured the official render pipeline, not plugin asset loading.

## Problem

`frames2d` warmed its decode cache by iterating every track of the served config at mount (`Object.keys(config.tracks)` after the phase-reachable ids). A shipped pet's track set is not a handful of loops: the bundled `jyn` pet carries 16 tracks / 1164 frames / 82.6 MB of 512x683 webp thumbs, and 7 of those tracks belong to skins that never play until the user selects them.

Measured on a scratch DSH Web host (local workspace profile, OS-assigned port, headless Chromium 1440x900, pet `jyn` with the `orca-link` skin active, resource-timing buffer raised to 8000 entries): in the first 5 seconds after mount the page fetched **1145 pet frames / 78.9 MB**, and the whole page payload reached **96.0 MB decoded**. The count kept creeping up with playback traffic. Every warmed frame stays in the decode cache for the life of the page, so the retained set is over a thousand 512x683 images (about 1.4 MB each before browser-side eviction), and the pass lands inside boot: the two boot long tasks (65 ms, 192 ms) contain the renderer's `createImageBitmap`/`decodeFrame` work.

## Decision

- **`prefetchAhead` replaces the whole-library warm pass** in `packages/dsh-pet/src/client/renderers/frames2d.ts`. Each drawn frame enqueues at most the next `PREFETCH_AHEAD` (12) frames of the track that is actually playing; the existing pool still keeps at most 8 decodes in flight.
- **Unplayed tracks and unselected skins are never fetched up front.** A phase switch, gameplay override, or skin selection plays immediately: `paintCanvas` demands its first frame with `jump = true`, which pulls that frame ahead of the prefetch backlog, and the look-ahead window then follows the new track.
- The classic `<img>` path keeps the same bounded behaviour (its `loadFrame` decodes through the `Image` fallback), so neither mode falls back to an unbounded pass.

## Measured effect

Same scratch host and same page, pet-frame traffic in the first 5 seconds after `[data-dsh-frame]`:

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Pet frame requests | 1145 | 98 | -91% |
| Pet frame bytes (decoded) | 78.9 MB | 5.26 MB | -93% |
| Whole-page decoded payload | 96.0 MB | 22.4 MB | -77% |

The residual 5.3 MB is the visible animation itself: playback walks the 78-frame idle track and the look-ahead window follows it, so the idle loop stays warm while the other 15 tracks stay on disk. Traffic is flat from 5 s to 30 s (1145 to 1158 before, 98 to 111 after).

Behaviour check on the same page: `canvas[data-dsh-pet-frames2d]` renders at 512x683 and its pixel hash changes across three samples 1.5 s apart, so playback still advances; no `pageerror` and no console error.

## Alternatives considered

- **Keep the full warm pass.** Rejected: it is the measured cost, and 7 of the 16 tracks cannot play without a skin selection.
- **Warm only the phase-reachable and gameplay-reachable tracks.** Rejected as insufficient: it still warms about 44 MB / 605 frames for this pet, and the gameplay/override track set is resolved from the manifest and the selected skin at play time, so a statically "reachable" set is not knowable at mount.
- **Keep the warm pass but defer it to `requestIdleCallback`.** Rejected: it moves the burst off the critical path without reducing it - the same 82 MB and the same thousand retained bitmaps still arrive.
- **Evict decoded bitmaps through an LRU cap.** Rejected for this change: the renderer's stated hot-path property is "decode exactly once, then draw", and eviction would re-decode frames on every loop pass. Retained memory is now bounded by the tracks that actually play; a playing track that is itself too large remains a follow-up.
- **Warm the next phase's track during idle.** Not needed at this window size: a switch demands its first frame immediately and the 12-frame look-ahead covers the frames behind it.

## Consequences

- Pet boot cost is now proportional to the animation on screen, not to the size of the installed pet library.
- A track that has never played pays one fetch plus decode for its first frame at switch time (same-origin, served from the HTTP cache after the first play). The queue jump keeps that frame ahead of the prefetch backlog, and the look-ahead window covers the frames after it.
- `packages/dsh-pet/lib` and `packages/dsh-web-all/lib` (the aggregate embeds the family client sources) were rebuilt. The running DSH service keeps serving the previous bundle until it is restarted.
- Measurement harness: a scratch `dsh --profile web --port 0` host whose `DSH_HOME` points at a temp directory with `profiles/web` symlinked to the real profile, plus copied `pet.json` / `skin-center-active.json` and a symlinked `skins/` directory. The running service on port 3080 was never touched.

## Testing

- `packages/dsh-pet/src/client/renderers/frames2d.test.ts`: the bounded-window case now asserts frame 0 plus the 12-frame look-ahead (13 bitmaps) instead of the whole 24-frame track; a new case asserts that a mount fetches only the playing track and that selecting a skin pulls only that skin's track; the jump-ahead and failure-retry cases keep their assertions with updated comments. `packages/dsh-pet` runs 41 files / 493 tests green, and `pnpm typecheck` passes.

Limitations: the harness drives a headless scratch host rather than the running GUI, and GPU texture memory for the retained bitmaps is not measured directly - only fetch/decode volume is.
