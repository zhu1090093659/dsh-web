# Agent Note: Remote presence hides and restores the pet through its own visibility switch

Status: implemented

## Problem

The phone mirror was still showing the pet: the CSS suppression of `[data-dsh-plugin="pet"]` depended on the sprite being inside that root, and even with the portal fix a root-keyed CSS path is indirect — the user's requirement is explicit: use the pet's own hide facility on remote connect and its show facility when the remote ends. The pet is host-global (no session dimension), so during a phone-mirror session the page also rendered the pet's floating bubbles over the conversation, and during the phone's app boot (which takes tens of seconds through the tunnel) the pet was the only thing on screen — read as a broken app.

## Decision

**The remote plugin now drives the pet's own visibility switch from presence.** A new host link (`src/remote-presence-pet.ts`) subscribes to the pairing snapshot stream:

- When the first paired device becomes `online` (phase `connected`), it reads the pet's current display and calls `PetService.setVisible(false)` — the same RPC the pet's hide button uses — only when the pet is currently visible.
- When the last device has stayed offline past a grace window (120 s default; the presence sweep flips a device offline after ~25 s, and a briefly backgrounded phone must not flicker the pet), it calls `setVisible(true)` — but only if this link performed the hide.
- A manual user hide is respected: visibility already `false` at connect records nothing and restores nothing. Re-connecting inside the grace window cancels the pending restore; a second online device does not re-hide.

The pet service is resolved per transition through `ctx.get('pet')` with a structural seam (no package edge) and every failure degrades to a no-op: the remote-control feature never depends on the pet being installed. The CSS suppression and the sprite-portal fix stay (they keep the surface semantically single-rooted), but they are no longer the mechanism the user relies on.

## Alternatives considered

- **Keep refining the CSS suppression.** Rejected by the user: the visible failure mode (pet + its bubbles on the phone, pet-only blank-looking boot screen) showed CSS hiding is too easy to break and too late to act — it cannot hide the pet during the boot window, when the pet monts before the app UI.
- **Hide via the pet's `enabled` setting instead of `visible`.** Rejected: `enabled` is the plugin master switch (it stops polling and the whole surface); `visible` is the hide-the-pet affordance the user means, and it keeps the summon path available.

## Consequences

- Connects hide the host-global pet everywhere (the desktop and the phone share one pet); when the last mirror ends (grace elapsed) the pet comes back.
- The pet is tucked away during the phone boot window as well: the device touches as soon as the gated mux opens, which precedes the app UI.
- If the pet plugin is absent the link is inert; the pairing flow is unchanged.

## Testing

- Unit (`tests/remote-presence-pet.spec.ts`, 5 cases): hide on first online + restore after last offline, grace cancel on reconnect, manual-hide respect, no-pet no-op, no double-hide on a second device.
- Live (QA :3191): before the phone connects the pet display is `visible: true`; an emulated phone scan flipped it to `visible: false`; closing the phone (offline flip + grace) restored `visible: true`. Pet package: 463 tests / 39 files green; remote package: 288 tests / 26 files green.
