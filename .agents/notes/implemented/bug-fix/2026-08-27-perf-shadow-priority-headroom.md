# Agent Note: dsh-perf assistant shadow reserves priority headroom below third-party shadow renderers

Status: implemented

Supersession check: no active Note owns the assistant-step shadow priority contract. [better-session-replaces-chat-recovery](../architecture/2026-08-27-better-session-replaces-chat-recovery.md) records the ingestion of `@morlay/ui-conversation-message-actions`, whose hard-coded `-1` claim is the trigger for this Note; this file owns the priority band from here on.

## Problem

The keyed client slot `conversation.chat.node` enforces uniqueness per `(key, priority)` pair: registering an entry that collides on both throws, and the throwing plugin fails to apply ("keyed slot ... already has an entry ... registered by ...").

Two shadow renderers want the lowest position of key `assistant-step` under the "lowest renders" projection rule:

- `dsh-perf`'s P1 assistant shadow registers at `min(existing priorities) - 1`. With upstream official registration at 0 (or absent), it computed `-1`.
- The external `@morlay/ui-conversation-message-actions@0.0.11` shadows all twelve chat-node keys with a hard-coded `priority: -1`.

Loading the family bundle together with better-session therefore failed client boot: dsh-perf claimed `assistant-step` at `-1` first (registration order depends on apply order), and message-actions then threw on the same `(key, priority)`. Whichever order the two apply in, one of them dies while both compute or pin exactly `-1`.

## Decision

dsh-perf's assistant shadow keeps its adaptive "always below everything present" strategy but leaves a reserved headroom band below the current minimum instead of landing one step below:

```ts
const SHADOW_PRIORITY_HEADROOM = 8
const floor = (existing.length === 0 ? 0 : Math.min(...existing)) - 1 - SHADOW_PRIORITY_HEADROOM
```

With the official renderer at 0 the shadow now registers at `-9`; if another shadower applies first (minimum becomes `-1`), it registers at `-10`. Third-party replacement renderers using small fixed negatives (`-1` today) land inside the reserved band and never collide with the shadow. Order-independent: both apply orders produce strictly distinct values with the shadow lowest.

The existing lazy capture stays untouched and composes the chain: entries are sorted lowest-first, the capture skips the shadow itself and takes the next-lowest entry, so the shadow forwards through message-actions' `AssistantNodeView` when it is mounted, and through the official view otherwise. The heavy-message flip logic mutates only `node.data.status`, which flows into whichever captured component renders next — the visual contract ("all output through the effective downstream renderer") is unchanged.

## Alternatives considered

- **Pin a large sentinel constant** (for example `-1000`) unconditionally: rejected - it abandons the adaptive derivation entirely, and two adaptive plugins would still collide if any other plugin copied the same sentinel idea.
- **Yield instead of register**: skip the shadow whenever another negative-priority claimant exists - rejected - presence detection is order-dependent (the shadow may apply before message-actions and see nothing yet), so the yield silently flaps across boot orders.
- **Drop the perf shadow when better-session is installed**: rejected - the features compose without conflict once priorities differ (shadow flips status before message-actions' renderer runs); disabling loses the flip-queue load-leveling that a heavy session still needs.
- **Patch the morlay package's hard-coded `-1`** via the aggregate harness rows: rejected - we do not carry local overrides for external npm packages; upstream owns that value and a fork would drift immediately.

## Consequences

- Client boot with the full family bundle plus better-session succeeds; no `(key, priority)` collision exists between the two packages' chat-node claims.
- The reserved band is eight wide; a future third-party renderer that hard-codes a value below `-9` would collide again. If that happens, widen `SHADOW_PRIORITY_HEADROOM`; the error message names both registrants and is the diagnosis path.
- Two stacked shadows mean heavy assistant messages render via the morlay view twice-indirected (shadow -> AssistantNodeView -> official children). Any visual difference there comes from message-actions itself, not from dsh-perf.
- Other eleven keys shadowed by message-actions (`user`, `context`, `command`, ...) have no second claimant in the profile tree besides the official renderer at 0; no other collisions exist after this fix.

## Testing

- `packages/dsh-perf`: `pnpm typecheck` clean, `pnpm test` 40/40 pass, lib rebuilt via tsdown and picked up by the profile link.
- Conflict inventory re-derived by grepping every package under `~/.dsh/profiles` (symlink-following) that mentions `conversation.chat.node`: only official conversation (0), dsh-perf (headroom band), and morlay message-actions (-1) contribute entries.
- Runtime confirmation requires reloading/restarting `dsh web` (user action); static evidence above guarantees no equal-value pair remains.
