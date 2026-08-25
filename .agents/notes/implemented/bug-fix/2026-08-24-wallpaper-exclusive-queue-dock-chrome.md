# Agent Note: wallpaper-exclusive native queue dock chrome

Status: implemented

## Problem

The native queue dock (the `data-queue-dock` element rendered by QueueDock in dsh-client-ui-conversation) stacks two boxes inside the conversation.input.dock slot: a root whose class contains `_dock` and therefore receives the skin input-card material, whose horizontal padding reads as a halo ring around the content, and an inner panel that paints its own near-opaque `--dsw-specific-tip` fill with a top-only border radius plus an ::after bottom highlight that reads as a bright seam above the composer card. With wallpaper-exclusive active the queued message renders as three visible layers instead of one.

## Decision

The wallpaper-exclusive patches collapse the stack onto one surface. The `[data-queue-dock]` root drops its background, backdrop filter and border radius so the halo disappears. The inner panel receives the input-card material (`--dsw-wallpaper-glass-fill`, fixed 10 px blur, full 12/8 px radius) so queued rows keep a readable frosted backing. The panel ::after seam highlight is hidden. In the same change the skin pins the shell composer accessory token set (`--dsh-composer-accessory-*`) to pure frosted values (transparent fill, no border, no radius, no shadow), so accessory surfaces mounted into the dock float bare instead of re-introducing boxed chrome. Because idle sends route through the queue state for a few frames, the dock fades in through a delayed keyframe animation and never renders during transient mounts, and a short transition on the composer card turns the Task0 chrome toggle into a crossfade.

## Testing

gallery:check, market:check and skin-center:check pass; the gallery styles bundle and the market dist assets are regenerated in the same change. Live verification path: queue a message while the skin is active and confirm a single glass box with no halo ring and no seam line above the composer.

## Alternatives considered

Remapping only the panel token (`--dsw-specific-tip`) toward translucency loses because the halo ring comes from the root-level material applied by the existing `_dock` rule, not from the panel color alone, and a global token remap would leak into unrelated consumers of that token. Dropping the root material rule for all `_dock` children loses because plugin docks such as chat-recovery genuinely need the input-card backing for text legibility; the narrower `[data-queue-dock]` attribute anchor scopes the exception to the native component. Relying solely on the future `--dsh-composer-accessory-*` contract loses because the installed shell build does not emit or consume those tokens yet; the explicit selectors work on both the current and forward shells.

## Consequences

The queue card renders as exactly one frosted box tightly wrapping its rows. If the upstream shell later moves QueueDock out of the input.dock slot the attribute anchor keeps the rules working, while a rename or removal of the `data-queue-dock` attribute would require re-anchoring. The `[data-phase="active"]` gate from the earlier round matched no shipped shell build and is removed as dead code; if a future shell reintroduces per-phase attributes, revisit the anchor then. The entrance delay keeps a mount shorter than roughly 200 ms invisible, so ultra-fast send flows show no queue feedback at all, which is accepted because nothing user-visible happens inside that window.
