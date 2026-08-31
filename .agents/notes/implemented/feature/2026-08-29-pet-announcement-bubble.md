# Agent Note: Pet announcement bubbles (pet.announce contract)

Status: implemented

## Problem

The pet's bubble surfaces are all internally driven: interaction feedback, per-session activity projection, and whispers. A sibling plugin had no way to put a fact on the pet — the only caller-supplied-text hook was the legacy `activity/status` session event, which competes with real session activity, follows the activity vocabulary, and disappears when the machine settles. The usage statistics plugin needed exactly that: a dedicated, specially designed bubble showing the current provider's balance or plan quota (see [the usage statistics plugin](2026-08-29-usage-statistics-plugin.md)).

## Decision

`dsh-pet` grows a plugin-facing, in-process announcement contract:

- **Host**: `ctx.pet.announce(input)` (service method on `PetService`, not an HTTP route) validates the payload through `src/announce.ts` into a bounded `PetAnnouncement` — required `source`/`kind`/`title`, `balance` requires `amount`, `plan` requires `percent` (clamped 0-100), text truncates, unknown fields drop, TTL clamps to 1-60 s (default 10 s); a malformed payload resolves `{ ok: false }` and renders nothing. Exactly the freshest announcement is kept, in memory only; `view()` includes it while fresh, so an expired one stops rendering on the next poll tick without any timer.
- **Client**: the announcement renders as its own styled bubble (`styles.bubbleUsage`) riding the top of the session bubble stack — glass style in the pet's family, tone accent (`ok`/`warn`/`low`), a mini meter for plan percents, and it persists for its TTL instead of riding the 2.6 s feedback pop. It coexists with session bubbles (column-reverse puts it farthest from the sprite) and yields to interaction feedback. Marked `data-dsh-pet-announcement` (semantic-attrs contract updated).

## Alternatives considered

- **The legacy `activity/status` event**: emit a synthetic session event with the balance line. Lost: it needs a real session to ride, its bubble drops when the machine settles (idle/done/failed), and it would re-tint the pet's own voice — an account fact is not session chatter.
- **An HTTP route (`POST /api/pet/announce`)**: would let browser-half plugins push announcements too. Lost for now: no consumer exists, the loopback/pair guard would add an auth surface for a one-line feature, and the family rule routes cross-plugin collaboration through cordis services; adding the route later is additive.
- **A generic slots-based bubble slot** (`pet.bubble` list slot others register into): more general, but it drags in slot lifecycle and ordering questions for a single-fact surface. The announce method keeps the pet authoritative over its own surface; a slot can still be layered on if a second consumer appears.

## Consequences

- Announcements are best-effort by design: an absent pet service makes `ctx.get('pet')` undefined and the caller skips silently; a malformed payload never surfaces as pet breakage.
- One announcement slot means a second announcing plugin would displace the first's bubble; if that happens, promote to a keyed map or a slot before stacking hacks.
