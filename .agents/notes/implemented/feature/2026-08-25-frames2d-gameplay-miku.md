# Agent Note: frames2d renderer and the gameplay contract (dsh-pet, miku generalization)

Status: implemented

## Problem

New community pets and skins kept requiring a new plugin package or a plugin release: the miku pet shipped as its own package (dsh-miku-pet), each future pet would repeat that shape (see [Re-add dsh-miku-pet](../feature/2026-08-25-readd-dsh-miku-pet.md)). The standing design rejected that: anything new (pet, skin, plugin) should flow through the Workshop, and miku features should live inside the pet plugin as a generalized subsystem instead of a parallel package.

## Decision

Two contract extensions in dsh-pet plus a Workshop-first delivery path:

- frames2d renderer: directory-style frame sequences (`thumb/<track>/<frame>.webp`) with per-frame durations (frameMs list > filename `_<ms>` tail > defaultFrameMs 200), an `idle`-mandatory phase map, non-loop fallback chains, a drag track, and natural-sort by trailing frame index (eat10 after eat9). Caps: 64 tracks / 64 frames / 16-5000 ms.
- gameplay block (frames2d only, all sub-blocks optional, fail-closed): stat decay bars (with working and idle variants), named currencies, weighted idleDirector with maxMiss, touch zones in a hitBox with probability branches (effects + track holds + phrase bubbles), a host-adjudicated work loop with result holds, a sleep loop with lazy restore, passive income, and a shop with effects / currency swaps / tiered lotteries. All rolls are host-authoritative (`POST /api/pet/gameplay/touch|mode|work-tick|buy`); state persists per pet and settles lazily on the treats-economy discipline. The client renders the menu card (bars, work/sleep, shop grid, wallet) automatically for any pet that declares the block.
- Workshop-first distribution: `packages/dsh-pet/assets/<id>` is the market source; the npm files whitelist stays built-in-only (miku excluded), `scripts/market-build` gained a frames2d scan path (no spritesheet required; card rides previews, install downloads the files list), and market/dist is regenerated. deploy-market.yml deploys on dev pushes, so a new pet ships to the Workshop with no release.
- miku became the reference implementation: assets transcribed into `assets/miku` with the original gameplay constants (decay rates, idle weights, touch probabilities and phrases, work/sleep/shop/lottery), Piapro boundary and contributor attribution moved into THIRD_PARTY_NOTICES.md, and the dsh-miku-pet package removed from the workspace, the aggregate (regenerated), and the sync-shared tables. It was never published to npm, so no deprecation is needed.

## Alternatives considered

- Another plugin for miku: rejected by the standing design; the generalized subsystem makes future pets manifest-only.
- Atlas-style frames2d (repurposing sprite2d): rejected; the directory contract keeps the original miku assets byte-identical and community authors need no atlas tooling.
- Client-authoritative gameplay: rejected; the host settles and persists so offline decay and multi-view state agree, matching the petting/treats discipline.

## Consequences

Any future pet is one assets directory plus a manifest (contract + gameplay), delivered through the Workshop on the next dev push; the dsh-web-pet-developer skill documents both extensions and the Workshop path. The dsh-miku-pet package is gone (aggregate 18 rows / 17 deps; sync-shared 96 entries / 44 host copies); the removal and re-add notes remain as history. The gameplay design note is superseded in part by this implemented contract (cross-linked above).