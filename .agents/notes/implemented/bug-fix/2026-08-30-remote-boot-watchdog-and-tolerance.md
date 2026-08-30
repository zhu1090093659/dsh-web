# Agent Note: Remote boot watchdog and boot-failure tolerance on the phone surface

Status: implemented

## Problem

A paired phone could open the remote surface on a fully blank page: theme background plus the floating exit toggle and the pet summon button, with no sidebar, conversation, or composer. Reproduced on WebKit against the live tunnel (pixel-identical to the user's phone screenshot), while Chromium on the same page booted fine every time. Instrumented runs caught the mechanics:

- One failing load received a HTTP 429 on a boot-critical request ~500 ms into the load (Cloudflare's quick-tunnel edge rate-limits bursts; a phone re-pairing while the desktop panel refreshes fires exactly such a burst). When a boot-critical request dies, the SPA mounts nothing and nothing ever retries — the blank state is permanent for that page load.
- Independent of the blank state, the mobile-adapt stylesheet tag was observed missing while the `dsh-remote-portrait` body class stayed (external DOM cleanup; the remover could not be attributed). With the tag gone, the desktop-only suppressions die — the pet's summon button shows on the phone (the dark box in the user's screenshot) and the whale/rail compaction logic degrades.
- The official layout face throws by contract when the root entry has not mounted yet (`layout: panel actions not wired (root entry not mounted)`); the remote client calls it at apply time (`flushCloseDetails`) and from gestures, so a slow remote boot can surface that throw inside a plugin apply world or a store subscriber.

## Decision

**Boot resilience is added at the parse-time boot script, and the plugin stops trusting the boot order.**

1. **Boot watchdog** (`buildBootWatchdogScript`, spliced into `buildRemoteChannelBootScript`'s IIFE behind the same non-loopback gate): poll every second for the app's conversation surface (`[data-conversation-scroll]` or `[data-slot="conversation"]`); after 15 s without it, reload the page once. A sessionStorage latch (`dsh-remote-boot-reload`) allows exactly one self-reload per session while the boot stays broken; a successful boot clears the latch, so a later failure can recover again. The watchdog never arms on loopback origins and never throws (every step is guarded).
2. **Tolerant layout calls** (`client/index.ts`): the `layout.toggleSidebar/closeDetails` closures and the boot-time `flushCloseDetails` replay swallow the layout face's boot-order throw — the panel action is a no-op before the root entry mounts, and a plugin apply world must not die on it.
3. **Stylesheet re-assert** (`client/mobile-adapt.ts`): the tag-creation logic is extracted into `ensureAdaptStyle()` and the 600 ms sync tick re-runs it while the layer is active, so a lost tag returns within one tick instead of silently dropping the suppressions.

## Alternatives considered

- **Retry the failed boot requests client-side.** Rejected: the failure can hit any of dozens of boot requests (bundle scripts included, where no app code exists yet to retry), and a generic fetch retry layer would fight the channel rewrite and the module system's transport.
- **Reload unconditionally on any error event.** Rejected: the GUI logs benign per-plugin errors (403 noise from local-only bridges is pre-existing); only the missing app surface is a reliable "boot is dead" signal, and the latch prevents a reload loop on a genuinely broken deployment.
- **Fix the adapt tag remover.** Investigated, not attributable: no repo or official code path removes a `style[data-plugin-css]` tag outside HMR (which is inactive here and matches by bundle id, not this tag's value). The re-assert makes the mechanism irrelevant; the symptom is covered by tests.

## Consequences

- A transient remote-boot failure now costs one automatic reload (second load rides warm caches) instead of a dead page the user must discover and manually refresh.
- The watchdog rides the host-served inline script, so it reaches the phone only after the DSH service restarts (the host holds the script constant in memory); the client-side tolerance and the style re-assert ship as plain bundle changes and apply on the next page load.
- The suppressor list itself is unchanged — the phone mirror stays desktop-decoration-free per [the mux note](2026-08-30-remote-gateway-stream-mux.md); the re-assert only keeps its stylesheet present.

## Testing

- Unit (`tests/remote-channel-boot.spec.ts`): the watchdog is embedded in the served script with the probe markers; stays unscheduled on loopback; reloads exactly once after the wait and latches; a second booted session with the latch set never reloads; a successful boot clears a stale latch.
- Unit (`tests/mobile-adapt.spec.ts`): removing the stylesheet tag externally is repaired within one 600 ms sync tick (single tag restored, body class intact).
- Package suite: 293 tests / 27 files green after the change.
- Live tunnel (WebKit, iPhone emulation): the failing shape (429 at ~500 ms, blank shell) was reproduced and characterized before the fix; post-fix live verification of the re-assert path ran against the real tunnel.
