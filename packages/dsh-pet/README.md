# dsh-pet — Multi-pet companion plugin

English | [中文](README.zh.md)

> A registry-driven desktop companion for DeepSeek Harness — the built-in whale girl plus any pet you drop in.

While the model thinks, you wait — your pet swims. It follows official session activity and switches animations while waiting, thinking, using tools, composing a reply, celebrating completion, or reporting failure; you can also pat its head, feed it dried fish, and watch its affinity grow. Pets are registry entries, not code: every pet is one `pet.json` manifest plus one atlas image, and the host discovers them at startup.

Re-implemented from the pet feature of the Codex desktop app, as an official DSH plugin shape (cordis bundle: host half + client half in one package).

## Features

| Feature | Description |
|---|---|
| Multi-pet registry | The host scans built-in `assets/`, the hatch-pet custom pets directory, and composed config entries; each pet is a manifest plus an atlas |
| Pet selection in settings | The plugin settings card lists every registered pet; switching persists and the sprite swaps immediately |
| Per-pet naming | Rename from the hover panel; each pet keeps its own name (stored per pet id, migrated from the legacy flat name) |
| State animation | Official session activity → manifest-defined sequences of 9-state tracks; each track finishes its full duration before the sequence advances and the complete sequence loops |
| Head-pat interaction | Click the pet → bubble feedback + affinity +1 (10s cooldown) |
| Feeding | Hover panel 喂食 (Feed) → consumes 1 dried fish + affinity +5 (30s cooldown) |
| Treat economy | Dried-fish stock (cap 20): +1 every 30 rounds of work, +1 every 300 minutes (5 hours) — 10x rarer than the original cadence |
| Affinity | +1 per round completed; 9 levels: 幼鲸 → 伙伴 → 挚友 → 深海羁绊 → 心有灵犀 → 传说羁绊 → 神话羁绊 → 永恒之契 → 鲸生共渡 (capped at 999,999,999) |
| Dragging | Hold and drag the pet to reposition; position persisted |
| Hide/Summon | The hover panel sits below the pet and provides 隐藏 (Hide); after hiding, a 召唤{name} (Summon {name}) button appears |
| Witty remarks | Built-in remark library (10 lines per event) plus per-pet custom lines; success lines rotate by persisted success counts and cooldown lines by persisted rejection counts |
| Status bubbles | Each concurrently active top-level session gets its own bubble, stacked above the pet (up to 12); subagent sessions report through their spawning conversation and never occupy a bubble of their own; click a bubble to jump to its session; transient interaction feedback temporarily takes priority |
| Multi-session activity | The pet is host-global: the most recent meaningful event drives the sprite animation while every active top-level session reports its own state in a separate bubble; completed turns from every session (subagents included) contribute affinity and treats |
| Working indicator | The native `Deep diving...` turn status carries an aria-hidden whale that spouts water while the model works; reduced-motion preferences keep the whale static |

## Pet contract

A pet is a directory holding one `pet.json` manifest and one atlas image. Nothing else is required — no host or client code changes.

```jsonc
{
  "id": "whale-girl",                     // unique lowercase kebab id
  "displayName": "鲸鱼娘",                 // shown in the settings selector and panel
  "description": "A soft healing whale-girl.", // optional
  "spritesheetPath": "spritesheet.webp",   // atlas, relative to the manifest
  "cell": { "width": 192, "height": 208 }, // optional; defaults to the Codex contract
  "columns": 8,                            // optional; default 8
  "spriteVersionNumber": 1,                // optional; 2 marks an 11-row v2 atlas (9 animation rows + 2 look rows)
  "frames": [6, 8, 8, 4, 5, 8, 6, 6, 6],   // optional per-row frame counts
  "tracks": {                              // optional per-track rhythm overrides
    "idle": { "durations": [400, 400, 500, 400, 400, 500] }
  },
  "sequences": {                           // optional per-scene track sequences (at least 5 items each)
    "thinking": ["running", "running-right", "running", "running-left", "waiting"]
  },
  "remarks": {                             // optional witty remarks (one line or a pool per slot)
    "pet": "摸摸水獭的头～",
    "feed": ["小鱼干真香", "再来一条～"]
  }
}
```

- The atlas is an 8-column × 9-row grid (192×208 cells by default); rows are fixed in this order: 0 idle, 1 running-right, 2 running-left, 3 waving, 4 jumping, 5 failed, 6 waiting, 7 running, 8 review. Unused cells stay fully transparent. v2 Codex atlases declare `"spriteVersionNumber": 2` and hold 11 rows — the same 9 animation rows plus 2 trailing look rows; the plugin renders the 9 animation rows and ignores the look rows.
- The optional remarks block overrides the reaction bubbles the pet speaks on pet / petCooldown / feed / feedCooldown / noTreats events. Each slot accepts one line or a pool of lines; a declared slot replaces the built-in pool for that slot only. Success and cooldown pools use the corresponding persisted success or rejection count, while noTreats cycles independently. This is how community contributions give their pet its own witty voice.
- `frames` counts the used columns per row (defaults to the hatch-pet contract table `[6, 8, 8, 4, 5, 8, 6, 6, 6]`); `tracks` overrides per-frame durations (cycled to the row's frame count), `loop`, and `fallback` per animation (defaults: everything loops; `jumping` and `failed` hold their last frame, then fall back to `idle`).
- `sequences` optionally maps activity scenes (`idle` / `waiting` / `thinking` / `tool` / `review` / `done` / `failed`) to at least 5 animation tracks. Each item plays every frame for the durations in `tracks`, then the next item starts; the complete sequence loops. An omitted scene keeps its canonical single-track playback.

Where pets come from (later sources override earlier ones on id collision):

1. **Built-in**: `assets/<dir>/pet.json` in this package.
2. **Custom pets**: `${CODEX_HOME:-~/.codex}/pets/<pet>/pet.json` — the hatch-pet pipeline stages its output there, so a hatched pet appears in the selector with no further wiring.
3. **Composed**: `PetConfig.pets` manifest entries passed to the plugin by the embedding application.

The registry is built once at host startup; add or change a pet, then restart `dsh web`.

## Animation preview

The sprites are an 8-column × 9-row atlas (192×208 cells) generated by the [hatch-pet](https://github.com/dsh2026) pipeline; below are previews of each state:

| idle | waiting | running | jumping |
|---|---|---|---|
| ![idle](assets/whale/previews/idle.gif) | ![waiting](assets/whale/previews/waiting.gif) | ![running](assets/whale/previews/running.gif) | ![jumping](assets/whale/previews/jumping.gif) |

| waving | review | failed | move left/right |
|---|---|---|---|
| ![waving](assets/whale/previews/waving.gif) | ![review](assets/whale/previews/review.gif) | ![failed](assets/whale/previews/failed.gif) | ![running-left](assets/whale/previews/running-left.gif) ![running-right](assets/whale/previews/running-right.gif) |

## Architecture

```text
dsh-pet/
|-- src/
|   |-- index.ts             # host half: plugin entry (registry build, settings section, routes)
|   |-- registry.ts          # multi-pet contract: manifest scan + normalization (assets + custom pets)
|   |-- service.ts           # PetService: pet selection + state machine + affinity + config
|   |-- state.ts             # pet state machine: projected session activity → 9 state animations
|   |-- remarks.ts           # witty-remark library: built-in pools + per-pet overrides + counted picker
|   |-- affinity.ts          # affinity ledger (pure functions + cooldowns)
|   |-- treats.ts            # dried-fish stock ledger
|   |-- persist.ts           # persistence ($DSH_HOME/pet.json: selection + names + interaction counts)
|   |-- routes.ts            # /api/pet/* JSON API + /pet/<id>/* asset routes
|   `-- client/             # browser half
|       |-- index.ts         # global mount (createRoot → body) + registry fetch + polling + wiring
|       |-- PetDockEntry.tsx # global floating entry (document.body, always shown)
|       |-- PetSprite.tsx    # definition-driven floating sprite (portal + rAF + dragging)
|       |-- PetSettingsCard.tsx # settings card: pet selector + display layout
|       |-- sequences.ts     # full-track scene sequence timing
|       |-- working-whale.ts # self-healing ornament for the native turn status
|       |-- spritesheet.ts   # atlas geometry helpers + track trimming
|       `-- pet.module.css
|-- assets/whale/            # built-in whale-girl (pet.json + spritesheet.webp + previews)
`-- cordis.patch.yml         # bundle patch: inserts the pet plugin row
```

### Data flow

```text
official session events (turn/step/chunk/tool) ----\
                                                    > PetService (host) <-- registry (assets + custom pets)
optional legacy activity/status ------------------/
                                                              | /api/pet/* JSON
global React root (createRoot → document.body) <-- polling 2s -- pet-client (browser)
                                                              |
                                       PetSprite floating layer (portal + rAF)
```

- **Status source**: the host projects official `turn/start`, `step/start`, `assistant/chunk`, `assistant/message`, `tool/call`, `tool/result`, and `turn/end` events into waiting/thinking/tool/review/done/failed states. Optional legacy `activity/status` events remain a compatibility input.
- **Registry**: the host normalizes every manifest into a full render definition (geometry, per-row frame counts, per-track durations) and serves it over `/api/pet/pets`; the browser half renders any entry from that definition and carries no per-pet code.
- **Selection & naming**: `petId` lives in the settings namespace; per-pet names live in `pet.json` under `names`, edited through the hover-panel rename of the active pet. Legacy installs migrate their flat `name` onto the whale girl.
- **Multi-session semantics**: the API and browser mount are host-global and expose no foreground-session identity. Concurrent sessions each keep their own projected state: the most recent meaningful event drives the sprite animation, while every active TOP-LEVEL session reports its stage in its own bubble (the state view's sessions list, capped at 12 most-recent). Subagent children are tracked for animation, rewards, and the single display bubble but render no bubble of their own, so N conversations never multiply into an N-plus-subagents stack. Every session's completed turns are still rewarded independently; disposing a session removes its bubble, and disposing the display session falls back to the most recent remaining one.
- **Mount point**: `document.body` (global React root, always shown: no session / new session / mid-session — the old mount point `conversation.composer.dock` only rendered in an active session, hiding the pet in new sessions); the component uses `createPortal` internally to render the global floating layer. The client also observes the native semantic turn-status row, adds one decorative working whale ahead of its text, and removes it with the plugin effect.
- **Rendering**: CSS sprite (background-position) per-frame animation; frame durations and optional scene sequences come from the served definition. The hover panel is anchored below the pet with a pointer bridge across the gap.
- **Communication**: browser ↔ host over the same-origin `/api/pet/*` JSON endpoints (state/pets/interact/set-visible/set-config/set-name/set-pet); each pet's atlas loads from `/pet/<id>/<spritesheetPath>` — the plugin self-sufficiently provides its own API and assets (the same pattern as dsh-remote-web-ui's `/api/pair`).

## Install

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
### From npm (recommended)
dsh plugin --profile web add @linxin666/dsh-pet

### From the repository (development)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet

```

After installing, **restart `dsh web`** — your selected pet appears at the bottom-right of the interface. In link mode, `pnpm build` and refresh the page after a code change; no reinstall needed.

## Development

```sh
pnpm build        # tsc -b (types+declarations) && tsdown (node half + browser bundle)
pnpm test         # vitest unit/component tests (registry / event projection / state / UI / ledgers)
pnpm prepare      # transpile-only build (no type checking, for consumer installs)
pnpm typecheck    # type check only
```

The browser bundle rides the `window.__ModuleLoader__.load` contract; React/cordis and so on resolve from the loader's module table (external); CSS Modules are inlined by lightningcss as `<style data-plugin>`.

## Sprites and animation-track calibration

The built-in whale-girl atlas is generated by the hatch-pet pipeline as 9 states × 8 columns: `assets/whale/spritesheet.webp` (1536×1872, 8 columns × 9 rows of 192×208 cells) + `assets/whale/pet.json`. The frame count, rhythm, and scene rotation live in that manifest's `frames`, `tracks`, and `sequences` fields; pets without overrides follow the hatch-pet contract rhythm and canonical single-track scene mapping. Redoing artwork therefore only edits `assets/whale/pet.json` (row-order contract: 0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review).

## License

[BSD-3-Clause](LICENSE)
