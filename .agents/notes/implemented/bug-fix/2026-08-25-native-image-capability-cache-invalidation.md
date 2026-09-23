# Agent Note: Native Image Capability Cache Invalidation on Toggle

Status: implemented

## Problem

When sending messages in a session, the describe-image send hook caches the model image capability verdict per session for 30 seconds (`DEFAULT_CAPABILITY_TTL_MS`). When a user switched the "Native image requests" setting in the settings panel, `setNativeImageEnabled` updated the host catalog and called `resolver.invalidate(route)` on the host side, but the client-side `createImageCapabilityChecker` cache lacked an invalidation seam. As a result, subsequent sends in the same session within 30 seconds of toggling continued using the stale capability verdict (rewriting images when enabled, or sending raw image blocks to text-only models when disabled).

## Decision

1. In `packages/dsh-tool-describe-image/src/client/capability.ts`, maintain a live-checker registry (`activeStores`; each entry holds that checker's verdict cache and its in-flight probes) and export `invalidateImageCapabilityCaches(sessionId?: string)` to flush cached session capability verdicts.
2. In `packages/dsh-tool-describe-image/src/client/NativeImageSection.tsx`, call `invalidateImageCapabilityCaches()` upon a successful toggle before updating local React state.
3. Invalidation drops the session's in-flight probe entry as well, and a settling probe publishes its verdict only while it is still the live entry for that session. A probe that started before the toggle therefore answers its caller but never repopulates the cache (issue #1509).
4. Extended `client-capability.spec.ts` with tests for global and per-session cache invalidation, and for an in-flight probe that settles after an invalidation.

## Consequences

Toggling the native image requests setting now immediately clears client-side capability caches, ensuring the next message send immediately fetches the fresh capability verdict from the host. A probe already in flight can no longer write its pre-toggle verdict back afterwards, so the 30-second window cannot be re-opened by that race.

## Testing

`pnpm --filter @linxin666/dsh-tool-describe-image test` (388 passed), `pnpm typecheck`, `pnpm test`, and `pnpm test:scripts` all pass cleanly.
