# dsh-pet-maid — Whale-maid pet plugin

English | [中文](README.zh.md)

> A Clawd-style whale maid who works alongside you in DeepSeek Harness.

She follows the whole DSH ecosystem's state and switches poses — thinking, working (tiered by concurrent sessions), error, celebration, sleeping; her gaze follows your cursor, a single click makes her jump, a double-click makes her wave, and dragging her to the right edge tucks her into a mini form that peeks out on hover. You can also pat her head, feed her dried fish, and watch her grow from a baby whale into your deep-sea bond.

The feature shape references [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) desktop pets, implemented as an official DSH plugin shape (cordis bundle: host half + client half in one package); the state is driven natively by DSH's public session events.

## Features

| Feature | Description |
|---|---|
| State animation | DSH session events → 12 poses: `thinking`, `tool` working, `done` jumping celebration, `failed` error, no-session `idle` breathing, idle sleep `sleeping` |
| Working tiers | 1–4 by concurrent session count; a "Parallel ×N" badge appears when several sessions run at once |
| Eye tracking | Idle poses follow the cursor (max 4px offset, toggleable) |
| Sleep and wake | Falls asleep after 60s without activity (static frame); any mouse movement wakes her |
| Click reactions | Single click jumps + affinity +1 (10s cooldown); double-click waves |
| Mini mode | Dragging to the right edge (≤24px) tucks her in; hover peeks, click pops out (toggleable) |
| Head-pat interaction | Click the whale maid → bubble feedback + affinity +1 |
| Feeding | Hover panel "Feed" → consumes 1 dried fish + affinity +5 (30s cooldown) |
| Treat economy | Dried-fish stock (cap 20): +1 every 3 rounds of work, +1 every 30 minutes |
| Affinity | +1 per completed turn; 4 ranks: baby whale → companion → close friend → deep-sea bond (capped at 100) |
| Custom naming | Hover panel "Rename" → 1–20 characters, persisted, echoed in the summon button/panel |
| Dragging | Hold and drag to reposition; position persisted |
| Hide/Summon | Hover panel "Hide"; after hiding, a "Summon {name}" button appears in the input selector row |
| Status bubble | Shows the model's current status phrase while working |

## Animation preview

The atlas is an 8-column × 9-row grid (192×208 cells). The previews below are the **bundled fallback atlas** (the whale shown when no local maid theme is installed); installing the local Maid-DeepSeek-Whale theme switches the pet to the whale maid:

| idle | waiting | running | jumping |
|---|---|---|---|
| ![idle](assets/whale/previews/idle.gif) | ![waiting](assets/whale/previews/waiting.gif) | ![running](assets/whale/previews/running.gif) | ![jumping](assets/whale/previews/jumping.gif) |

| waving | review | failed | move left/right |
|---|---|---|---|
| ![waving](assets/whale/previews/waving.gif) | ![review](assets/whale/previews/review.gif) | ![failed](assets/whale/previews/failed.gif) | ![running-left](assets/whale/previews/running-left.gif) ![running-right](assets/whale/previews/running-right.gif) |

## Architecture

```
dsh-pet-maid/
|-- src/
|   |-- index.ts        # host half: plugin entry (cordis apply, route registration)
|   |-- service.ts      # PetService: state machine + session-count tiers + affinity + config (HTTP API service face)
|   |-- state.ts        # pet state machine: session-event phases → 12 pose animations + working tiers
|   |-- asset-source.ts # atlas resolution: assetDir override → local Codex Pet theme → bundled fallback
|   |-- affinity.ts     # affinity ledger (pure functions + cooldowns)
|   |-- treats.ts       # dried-fish stock ledger
|   |-- persist.ts      # persistence ($DSH_HOME/pet-maid.json, atomic write)
|   |-- routes.ts       # /api/pet-maid/* JSON API + /pet/maid/* static asset routes
|   `-- client/         # browser half
|       |-- index.ts    # global mount (createRoot → body) + polling (800ms) + interaction wiring (fetch)
|       |-- PetDockEntry.tsx  # global floating entry (document.body, always shown: no session / new session / mid-session)
|       |-- MaidPet.tsx       # floating component (portal + rAF frame animation + drag + eye tracking/sleep/click/mini)
|       |-- spritesheet.ts    # atlas geometry + per-state animation tracks (frames/duration)
|       `-- pet.module.css
|-- assets/whale/       # bundled fallback atlas (pet.json + spritesheet.webp + animation previews)
`-- cordis.patch.yml    # bundle patch: inserts the pet-maid plugin row
```

### Data flow

```
session/created + session/event + session/disposed (DSH public session events) --> PetService (host)
                                                                              | /api/pet-maid/* JSON
global React root (createRoot → document.body) <-- poll 800ms -- pet-maid-client (browser)
                                                                              |
                                                                   MaidPet floating layer (portal + rAF)
```

- **Status source**: natively subscribes to DSH's public session events — `session/created` counts concurrent sessions, `session/event`'s `turn/start` / `step/start` / `tool/call` / `turn/end` derive the phase (completed → done, anything else → failed), `session/disposed` decrements and falls back to idle at zero. No extra plugin needed.
- **Atlas resolution**: resolved in order — plugin config `assetDir` override → `~/.codex/pets/maid-deepseek-whale` (the local Codex Pet maid theme) → the bundled `assets/whale` fallback. The local theme and the fallback share the same 8×9 atlas contract, so `TRACKS` needs no change.
- **Mount point**: `document.body` (global React root, always shown: no session / new session / mid-session); the component uses `createPortal` internally to render the global floating layer.
- **Rendering**: CSS sprite (background-position) per-frame animation, frame durations from the track definitions in `spritesheet.ts`.
- **Communication**: browser ↔ host over the same-origin `/api/pet-maid/*` JSON endpoints (state/interact/set-visible/set-config/set-name); the atlas loads from `/pet/maid/spritesheet.webp` — both the RPC domain and the `/plugins/` static service are platform-registered, and the plugin self-sufficiently provides its own API and assets (the same pattern as dsh-remote-web-ui's `/api/pair`).

## Install

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
### From npm (recommended)
dsh plugin --profile web add @linxin666/dsh-pet-maid

### From the repository (development)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet-maid

```

After installing, **restart `dsh web`** — the whale maid appears at the bottom-right of the interface. In link mode, `pnpm build` and refresh the page after a code change; no reinstall needed.

## Assets and licensing

- The **bundled fallback atlas** (`assets/whale/`) is the repo's whale artwork, distributed with the package under Apache-2.0;
- The **whale-maid theme** (Maid-DeepSeek-Whale) is a community Codex Pet (author DeaDumB, <https://codexpet.xyz/pets/community/maid-deepseek-whale/>) and is **not distributed with this package**: install it to `~/.codex/pets/maid-deepseek-whale` and the plugin loads it automatically (or point plugin config `assetDir` at any Codex Pet atlas directory). The artwork's license terms are governed by its source page.

## Development

```sh
pnpm build        # tsc -b (types+declarations) && tsdown (node half + browser bundle)
pnpm test         # vitest unit tests (state / resolvePose / affinity / treats / persist / service)
pnpm prepare      # transpile-only build (no type checking, for consumer installs)
pnpm typecheck    # type check only
```

The browser bundle rides the `window.__ModuleLoader__.load` contract; React/cordis and so on resolve from the loader's module table (external); CSS Modules are inlined by lightningcss as `<style data-plugin>`.

## Sprites and animation-track calibration

The atlas is an 8-column × 9-row grid of 192×208 cells (1536×1872), row-order contract: 0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review; `thinking` / `sleeping` / `attention` alias rows 8 / 0 / 4. The actual frame count and rhythm of each row are defined in `TRACKS` in `src/client/spritesheet.ts`. If the artwork is redone and the frame count changes, only that table (plus the `frames` field of `assets/whale/pet.json`) needs updating.

## License

[Apache-2.0](LICENSE)
