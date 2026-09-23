# Agent Note: Combined-plugin DOM mutation cost (shared body observer and coalesced shell syncs)

Status: implemented

Supersession check: no active note owns the family plugins' DOM-observation cost. The retired dsh-perf notes ([render pipeline batch 2](../feature/2026-08-26-dsh-perf-render-pipeline-batch2.md), [attribution scoreboard](../feature/2026-08-27-dsh-perf-plugin-attribution-scoreboard.md)) optimised the official render pipeline and attributed cost; they record the ranking layer this note acts on but do not cover observation fan-out or the skin shell syncs. [panel-mount-core extraction](../simplification/2026-09-02-panel-mount-core-extraction.md) created the shared core this note re-plumbs.

## Problem

Family plugins mount at the DOM level, so each one watches `document.body` to notice when the shell re-renders around its injected node. `sidebar-entry-core` (ssh, task-board, skill-explorer), `panel-mount-core` (ssh, task-board), and the aggregate's compat shim each installed their own `MutationObserver` with `{ childList: true, subtree: true }`. A page carrying N family plugins therefore paid N native observers and N callback invocations for **every** mutation batch the app produced; with the shipped combination plus the optional rows a user can enable, that is five to seven body subtree observers, and the count grows with the number of installed plugins. Chat token streaming produces many batches per second, so this is per-frame work during exactly the interaction users read as smoothness.

The skin shell added per-batch work on top. `installShellRenderingAdapter` (`packages/skins/skin-center/src/client/runtime/shell-rendering.ts`) re-ran `document.body.querySelector(COMPOSER_SEAT_SELECTORS)` and `composer.getBoundingClientRect()` for every mutation batch and then wrote `--dsh-composer-height` on `document.documentElement` even when the measured value was unchanged. `startContentObserver` (`backdrop-scene.ts`) re-ran a body-wide `querySelector` for every batch to maintain the `data-dsh-conversation-content` marker.

Measured with a controlled Chromium harness (real modules bundled by tsdown from these sources, 400 seeded message rows, three real sidebar entries plus the shell-rendering adapter and the backdrop content observer, 5 s storm at 301 frames, three runs): the five body observers fired 1503 times per 5 s and spent 237 ms inside their callbacks; `ScriptDuration` was 69.6 ms and `TaskDuration` 984 ms. A layout-free storm variant (mutations inside a `display:none` container, so the page needs no paint work) still spent 67 ms in observer callbacks and 71 ms in script.

## Decision

- **`shared/client/body-mutations.ts`** owns one `document.body` childList observer per page. The hub is registered on `globalThis` under `Symbol.for('dsh-web.body-mutation-hub')`, so the per-package generated copies (`scripts/sync-shared.mjs`) and separately bundled plugins reach the same instance instead of one hub per module copy. Subscribers get the records accumulated since the last flush and run at most once per animation frame; without `requestAnimationFrame` the flush runs synchronously, and without a DOM or `MutationObserver` the subscription is an inert disposer. The last subscriber to leave disconnects the observer. A throwing subscriber cannot stop the others.
- **`sidebar-entry-core`, `panel-mount-core` and the aggregate shim** subscribe to the hub instead of constructing their own body observer. Their callbacks were already idempotent re-checks, so coalescing only removes duplicate work; the user-visible contract becomes "self-heals by the next frame" instead of "in the same microtask checkpoint", which is imperceptible because both land before paint.
- **`installShellRenderingAdapter`** caches the resolved composer while it stays connected, re-resolving only on first resolve or after disconnection (ResizeObserver retargeting preserved), skips the `--dsh-composer-height` write when the value is unchanged, and coalesces mutation-driven measurement to one per frame. The ResizeObserver-driven path stays synchronous to preserve same-frame resize response.
- **`startContentObserver`** coalesces its content check to one per frame, cancels a pending frame on teardown, and writes the `data-dsh-conversation-content` and `data-dsh-backdrop-active` markers only when the attribute differs.
- **The aggregate's `ensureMobileDismiss`** caches the `[data-dsh-frame]` element and re-queries only when the cached one is disconnected, removing a document-wide query per mutation batch.

## Measured effect

The follow-up [idle resources in plugin combinations](2026-09-12-plugin-composition-idle-resources.md) adds record-free invalidation subscriptions, pending-frame cleanup, and a single shared-frame shim pass. The original record-delivery API remains available. The measurements below describe this note's original observer consolidation.

Same harness, same three runs, visible storm (301 frames per 5 s):

| Metric (mean of 3) | Before | After | Change |
| --- | --- | --- | --- |
| Body-observer callbacks | 1503.3 | 902.0 | -40% (five observers to three) |
| Time inside observer callbacks | 237.0 ms | 2.9 ms | -98.8% |
| `ScriptDuration` | 69.6 ms | 13.6 ms | -80% |
| `TaskDuration` | 983.9 ms | 725.3 ms | -26% |
| `LayoutDuration` | 148.5 ms | 124.3 ms | -16% |
| `LayoutCount` / `RecalcStyleCount` | 301.7 / 301.7 | 301.7 / 301.7 | unchanged |

Per-run observer time was 191-268 ms before and 2.3-3.4 ms after, so the ranges do not overlap. `LayoutCount` is unchanged on purpose: the visible storm mutates the DOM every frame, so one layout per frame is the paint's own work, not the plugins'. The layout-free variant isolates the self-inflicted part (observer callback time 67.1 ms to 3.0 ms, `TaskDuration` 151.6 ms to 87.8 ms).

Limitations: the harness drives the real modules in a controlled page, not the full GUI, and the aggregate bundle change only reaches the running GUI after a DSH restart. Real-GUI verification is deferred to that restart.

## Considered and declined

The aggregate shim's `stampSemanticParts` ignores the `changed` flag its pass already computes, so the four whole-frame `querySelectorAll` sweeps (`composer`, `pre`, `menu`, `treeitem`) re-run every animation frame even when every attribute is already stamped. Measured cost on a 1365-node frame: 0.087 ms for the whole pass (composer sweep 0.044 ms, menu 0.019 ms, treeitem 0.007 ms, `pre` 0.004 ms). That is roughly 0.5% of a frame, and scoping the sweeps to added subtrees would rework the compat shim every DOM-mounting plugin depends on without visual verification. Declined as not worth the risk at this measured size; the finding stays here so it can be re-priced if frames grow much larger.

## Alternatives considered

- **Keep one observer per plugin and only coalesce each callback.** Half the fix: the per-batch native callback count still scales with the plugin count, and the hub's cross-bundle sharing is what makes the family cost flat as rows are enabled. Rejected.
- **Share the observer through a cordis service instead of `globalThis`.** The right long-term vocabulary, but the browser halves of folded children mount as nested client plugins and the DOM-mounting cores are deliberately framework-free (plain DOM, no cordis context) so they can run before the shell settles; a service would force a context dependency into files that currently have none. Deferred, not rejected.
- **Flush the hub on a microtask instead of an animation frame.** Preserves the old same-checkpoint timing and would not have required the task-board test adjustment. Rejected because per-frame coalescing is the property that bounds work during streaming; a microtask flush can still run several times per frame when React commits in separate tasks.
- **Make the composer height ResizeObserver-driven and drop `getBoundingClientRect` from the mutation path.** Removes the last forced layout read, but writing a custom property from inside a ResizeObserver callback re-invalidates layout in the same frame and risks the observer loop limit; it also needs visual verification this task could not run. Left as a follow-up.
- **Resurrect the retired `dsh-perf` plugin.** It measured and shaped the official pipeline, not the family plugins' own observation cost, and it is tombstoned from the aggregate. The cost here is removable at the source.

## Consequences

- Family DOM-observation cost is now flat in the number of installed plugins: one native body observer per page regardless of how many family rows are enabled, and each subscriber runs once per frame.
- `body-mutations.ts` becomes a shared contract with four generated copies; adding a consumer means adding a `scripts/sync-shared.mjs` target, and the copies are gated by `sync-shared --check`.
- Mutation-driven self-heal, composer height, and backdrop marker updates can be deferred by up to one animation frame. Nothing changes before paint in the normal case; a page that mutates after its frame's animation callbacks have run heals on the next frame.
- A bug in the hub degrades several plugins at once instead of one. The failure policy is deliberately fail-open: no DOM, no `MutationObserver`, or a throwing subscriber leaves the remaining consumers working.
- The aggregate's `lib/client.js` embeds the family client sources, so any child client change requires rebuilding `@linxin666/dsh-web-all`; this change rebuilds it.

## Testing

- `shared/tests/body-mutations.spec.ts`, 5 cases: one native observer for many subscribers, records delivered to every subscriber coalesced per frame, a throwing subscriber cannot block others, the hub is dropped and re-created around the last subscriber, and an inert disposer without `MutationObserver`.
- `packages/skins/skin-center/tests/shell-rendering.spec.ts` and `backdrop-scene.spec.ts`, 8 cases: unchanged height written once across many bursts, a real height change written, a replaced composer re-resolved and re-observed, dispose cancels pending work, the body query skipped while the cached composer stays connected, the content marker coalesced without redundant writes, appearing/disappearing rows updated once per frame, and the last scene source clearing cancels and cleans up.
- `packages/dsh-task-board/tests/board-view.spec.tsx` remount case updated to await the coalesced frame.
- Gates: `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm aggregate:check`, `pnpm skin-center:check`, `node scripts/sync-shared.mjs --check` all pass.
