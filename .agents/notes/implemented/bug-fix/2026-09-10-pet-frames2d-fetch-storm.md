# Agent Note: frames2d warm pass flooded the browser with 1100+ concurrent frame fetches

Status: implemented

## Problem

The GUI console at the running instance showed two failures together: pet
frame requests (`/pet/jyn/thumb/bingjing-gongzhu-staff/*.webp`) dying with
`net::ERR_INSUFFICIENT_RESOURCES`, and two uncaught
`cannot get property "remote.session" without inject` errors from the host
GUI bundle.

The pet half is a dsh-web defect. The installed `jyn` pet declares 16 tracks
totaling 1134 frames, and the frames2d warm pass fetched every frame of every
track in one synchronous loop with no concurrency cap. Instrumenting the live
page measured 2320 fetches with a peak of 2271 in-flight and 821 failures on
a single page load — past the browser's per-renderer in-flight limit, so
whole batches of frames failed, the page's own requests starved with them,
and each failed fetch fell back to `new Image()`, re-requesting the same URL
while the storm was still draining. Failed decodes were also memoized
forever, so those frames stayed missing from every track that touched them
until a remount.

## Decision

All frame fetches in the frames2d renderer now funnel through a bounded
pool (8 concurrent):

- The warm pass enqueues phase-reachable tracks first, then the rest of the
  library, preserving the decode-once-no-stall contract behind the pool.
- Playback demand (`paintCanvas`) loads jump to the queue front, ahead of
  the warm backlog. The jump runs before the memo lookup because
  warm-enqueued frames already carry their memo.
- A failed decode drops out of the memo, so a later playback retries instead
  of remembering the failure forever.
- Dispose drains the queue, releasing gated jobs as no-ops so the bitmap
  release barrier can settle.

The tracked aggregate artifact (`packages/dsh-web-all/lib/client.js`) was
rebuilt with the fix.

Observation recorded, not fixed here: the `remote.session` inject errors
reproduce on every fresh page load — before and after this fix — and their
frames land entirely in the host's own `assets/index-*.js` bundle plus the
official `dsh-client-ui-renderer` / `dsh-client-ui-model-selection` clients;
no `@linxin666` frame appears. This is an upstream boot-time issue in the
installed host cohort (the composer model seat still renders and works), not
dsh-web code.

## Testing

- Live GUI, instrumented reload of the running instance: before, 2320
  fetches / 2271 peak in-flight / 821 failed; after, 1189 fetches / peak 19 /
  0 failed, pet canvas mounted once, no console errors.
- `frames2d.test.ts` gains three canvas-path specs: the pool cap holds under
  a 24-frame warm pass, a playback demand jumps ahead of the backlog, and a
  failed frame is retried instead of memoized. Package suite 492 tests pass.
- `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check` pass.

## Alternatives considered

- **Dropping the warm pass entirely (decode on demand only).** Rejected: the
  warm pass is a measured design decision behind the renderer's zero-stall
  contract; the pool keeps it while removing the browser-limit breach.
- **Raising the cap instead of a queue.** Rejected: any fixed cap high
  enough to warm 1100 frames quickly reproduces the limit breach; low caps
  without a queue serialize demand loads behind warm ones.
- **Retrying failed frames with backoff.** Rejected as speculative: after
  the cap, failures vanish (0 in verification); retry-on-demand through memo
  deletion already covers transient failures without extra machinery.

## Consequences

- Large pets mount without starving the page; frames that do fail (server
  down, broken asset) self-heal on the next playback pass instead of staying
  blank until remount.
- The pool bounds per-mount pressure, but a remount still re-walks the whole
  library through the HTTP cache; a pet remounting in a tight loop would
  still churn — the single-mount guard remains the structural defense.
- The upstream `remote.session` boot errors remain visible in the console on
  every load; they are host-side and harmless to the composer seat, but they
  will keep showing up in user reports until fixed in the host cohort.
