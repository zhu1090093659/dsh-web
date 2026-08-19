# dsh-pet — Multi-pet companion plugin

English | [中文](README.zh.md)

> A registry-driven Web and desktop companion for DeepSeek Harness — the built-in whale girl plus any pet you drop in.

While the model thinks, you wait — your pet swims. It follows official session activity and switches animations while waiting, thinking, using tools, composing a reply, celebrating completion, or reporting failure; you can also pat its head, feed it dried fish, and watch its affinity grow. Pets are registry entries, not code: every pet is one `pet.json` manifest plus one atlas image, and the host discovers them at startup.

Re-implemented from the pet feature of the Codex desktop app, as an official DSH plugin shape (cordis bundle: host half + client half in one package).

## Features

| Feature | Description |
|---|---|
| Multi-pet registry | The host scans built-in `assets/`, the hatch-pet custom pets directory, and composed config entries; each pet is a manifest plus an atlas |
| Browser pet selection | The plugin settings card lists every pet in the Host Web registry; switching persists the browser `petId` and swaps the browser sprite immediately |
| Browser per-pet naming | Rename from the browser hover panel; the Host keeps one browser name per Web-registry pet id (migrated from the legacy flat name) |
| State animation | Official session activity → manifest-defined sequences of 9-state tracks; each track finishes its full duration before the sequence advances and the complete sequence loops |
| Head-pat interaction | Click the pet → bubble feedback + affinity +1 (10s cooldown) |
| Feeding | Hover panel 喂食 (Feed) → consumes 1 dried fish + affinity +5 (30s cooldown) |
| Treat economy | Dried-fish stock (cap 20): +1 every 30 rounds of work, +1 every 300 minutes (5 hours) — 10x rarer than the original cadence |
| Affinity | +1 per round completed; 9 levels: 幼鲸 → 伙伴 → 挚友 → 深海羁绊 → 心有灵犀 → 传说羁绊 → 神话羁绊 → 永恒之契 → 鲸生共渡 (capped at 999,999,999) |
| Dragging | Hold and drag the pet to reposition; position persisted |
| Hide/Summon | The hover panel sits below the pet (lifted above the status bubbles when there is no room below) and provides 隐藏 (Hide); after hiding, a 召唤{name} (Summon {name}) button appears |
| Witty remarks | Built-in remark library (10 lines per event) plus per-pet custom lines; success lines rotate by persisted success counts and cooldown lines by persisted rejection counts |
| Status bubbles | Only the most recently active top-level session speaks by default — when several sessions run at once, the rest collapse behind a +N badge on the main bubble instead of stacking a tall column; hover the bubble (or tap the badge, for touch) to fan every session's bubble out above it and click one to jump to its session; subagent sessions report through their spawning conversation and never occupy a bubble of their own; transient interaction feedback temporarily takes priority. Bubble copy comes from generous rotating pools per scene (waiting / thinking / writing / done / failed...), tool calls map onto per-family witty lines carrying the real argument hint (e.g. 跑跑 npm test), and a long-lived scene re-phrases itself every few seconds |
| Inner whispers | 碎碎念: while the model streams, the pet occasionally speaks its inner voice through its own bubble — a fresh whisper takes over the display session's bubble and marks it with 「」 quotes — sharing the same DeepSeek-blue glass as every status bubble, so stacked bubbles never clash — instead of stacking a second bubble — keyword moods woken by the model output (errors, test greens, plans, victories...) plus ambient whispers earned by output volume; paced by a cooldown, the status copy returns after a few seconds |
| Multi-session activity | The pet is host-global: the most recent meaningful event drives the sprite animation while every active top-level session reports its own state in a separate bubble; completed turns from every session (subagents included) contribute affinity and treats |
| Web + desktop coexistence | The browser pet remains available while an optional managed Electron pet runs beside it; their visibility and lifecycle controls are independent |
| Shared companion data | Browser and desktop interactions call the same Host-owned `PetService`, so affinity, dried-fish stock, interaction cooldowns, session and whisper bubbles, and completed-turn rewards have one source of truth; browser `petId`/`names` and Electron-local `modelId`/`modelAliases` remain separate |
| Managed desktop lifecycle | The desktop pet is off by default; after it is enabled, it starts and stops with the WebServer-backed DSH Host and quitting it from the tray writes the switch back to off; consecutive startup or crash failures are retried up to 3 times with backoff, then the persisted switch is set back to off |
| On-demand Electron runtime | Installing the plugin does not download Electron. First enable opens a confirmation dialog with official, npmmirror, or custom HTTPS sources, progress, cancellation and retry; the desktop switch is persisted only after the checksum-pinned runtime is ready |
| Desktop ergonomics | Scale is limited to 100%–200% to prevent clipping; controls open toward available screen space, status and whisper bubbles overlay the sprite without enlarging its window, and position, visibility, lock and always-on-top preferences persist |

## Config

The `pet` settings namespace is shared by aggregate and standalone installation modes, not by the two presentations' model identities. The browser card edits the Host-owned browser selection and layout plus desktop lifecycle/window controls; browser renames live in the Host's `$DSH_HOME/pet.json`. The desktop drawer writes window controls back through the authenticated Host bridge, while its selected `modelId` and model-list `modelAliases` remain Electron-local preferences.

| Field | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Master switch for pet activity and presentation routes |
| `petId` | Registry default | Pet selected from the Host Web registry for the browser presentation; a removed id falls back to the registry default and does not change the desktop model |
| `visible` | `true` | Browser-pet visibility |
| `size` | `160` | Browser sprite height in pixels (`32`–`512`) |
| `right` | `24` | Browser inset from the viewport right edge |
| `bottom` | `20` | Browser inset from the viewport bottom edge |
| `desktopEnabled` | `false` | Managed desktop-pet lifecycle switch |
| `desktopVisible` | `true` | Desktop-window visibility while its presentation remains enabled |
| `desktopAlwaysOnTop` | `true` | Keep the desktop window above ordinary windows |
| `desktopLocked` | `false` | Prevent pointer dragging of the desktop window |
| `desktopScale` | `1` | Desktop scale (`1`–`2`, or 100%–200%) |

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
|   |-- service.ts           # PetService: Web-pet selection + shared state/economy + config
|   |-- state.ts             # pet state machine: projected session activity → 9 state animations
|   |-- core/                # renderer-neutral activity, intent and narration contracts
|   |-- presentation/        # presentation resolver, controller and production coordinator
|   |-- adapters/standalone/ # explicit runtime installer, launcher and Standalone adapter
|   |-- remarks.ts           # witty-remark library: built-in pools + per-pet overrides + counted picker
|   |-- affinity.ts          # affinity ledger (pure functions + cooldowns)
|   |-- treats.ts            # dried-fish stock ledger
|   |-- persist.ts           # persistence ($DSH_HOME/pet.json: Web selection/names + shared economy + browser display)
|   |-- routes.ts            # /api/pet/* JSON API + /pet/<id>/* asset routes
|   `-- client/             # browser half
|       |-- index.ts         # global mount (createRoot → body) + registry fetch + polling + wiring
|       |-- PetDockEntry.tsx # global floating entry (document.body, always shown)
|       |-- PetSprite.tsx    # definition-driven floating sprite (portal + rAF + dragging)
|       |-- PetSettingsCard.tsx # settings card: pet selector + display layout
|       |-- sequences.ts     # full-track scene sequence timing
|       |-- spritesheet.ts   # atlas geometry helpers + track trimming
|       `-- pet.module.css
|-- desktop/                 # optional managed Electron presentation Host
|-- assets/whale/            # built-in whale-girl (pet.json + spritesheet.webp + previews)
`-- cordis.patch.yml         # bundle patch: inserts the pet plugin row
```

### Data flow

```text
official session events (turn/step/chunk/tool) ----\
                                                    > PetService (host) <-- Web registry (assets + custom pets)
optional legacy activity/status ------------------/
                                          |                         |
                               /api/pet/* JSON      authenticated loopback SSE (shared companion state)
                                          |                         |
                         pet-client (browser)              Electron desktop pet
                                  |                                  ^
                 PetSprite floating layer (portal + rAF)             |
                                                     Electron model catalog + local modelId/aliases
```

- **Status source**: the host projects official `turn/start`, `step/start`, `assistant/chunk`, `assistant/message`, `tool/call`, `tool/result`, and `turn/end` events into waiting/thinking/tool/review/done/failed states. Optional legacy `activity/status` events remain a compatibility input.
- **Registry**: the host normalizes every manifest into a full render definition (geometry, per-row frame counts, per-track durations) and serves it over `/api/pet/pets`; the browser half renders any entry from that definition and carries no per-pet code.
- **Selection & naming**: browser `petId` lives in the settings namespace; browser per-pet names live in the Host's `$DSH_HOME/pet.json` under `names`, edited through the browser hover-panel rename of the active Web-registry pet. Legacy installs migrate their flat `name` onto the whale girl. These fields neither select nor rename the desktop model: Electron persists its own `modelId` and model-list `modelAliases` in local desktop preferences.
- **Multi-session semantics**: the API and browser mount are host-global and expose no foreground-session identity. Concurrent sessions each keep their own projected state: the most recent meaningful event drives the sprite animation, while every active TOP-LEVEL session reports its stage in its own bubble (the state view's sessions list, capped at 12 most-recent). Subagent children are tracked for animation, rewards, and the single display bubble but render no bubble of their own, so N conversations never multiply into an N-plus-subagents stack. Every session's completed turns are still rewarded independently; disposing a session removes its bubble, and disposing the display session falls back to the most recent remaining one.
- **Mount point**: `document.body` (global React root, always shown: no session / new session / mid-session — the old mount point `conversation.composer.dock` only rendered in an active session, hiding the pet in new sessions); the component uses `createPortal` internally to render the global floating layer.
- **Rendering**: CSS sprite (background-position) per-frame animation; frame durations and optional scene sequences come from the served definition. The hover panel is anchored below the pet with a pointer bridge across the gap; when the viewport leaves no room below, it flips above the pet and is lifted clear of the status bubble stack so the two never overlap.
- **Communication**: browser ↔ host uses same-origin `/api/pet/*` JSON endpoints and each atlas loads from `/pet/<id>/<spritesheetPath>`. A standalone install falls back to the loopback-only `/api/pet/settings` pair when the primary settings scope is unavailable; `/api/pet/runtime` exposes status, explicit install and cancellation to the settings dialog. The managed child uses token-authenticated `/api/pet/native/*` state, interaction and SSE routes for shared affinity, treats, cooldowns, session bubbles and turn rewards; it never reads or writes the Host's `$DSH_HOME/pet.json`, and its model choice and aliases stay in Electron-local preferences.
- **Presentation isolation**: `visible` controls only the browser pet, while `desktopEnabled` controls the managed Electron lifecycle. Desktop visibility, scale, lock and always-on-top remain separate, so hiding either surface does not hide the other.

## Install

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
### From npm (recommended)
dsh plugin --profile web add @linxin666/dsh-pet@latest

### From the repository (development)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet

```

After installing, **restart `dsh web`** — the browser pet appears at the bottom-right of the interface. Installation itself does not download Electron. To use the desktop pet, open **Settings → Pet**, enable it, choose a download source and confirm the first-use installation; the pinned runtime is stored below `$DSH_HOME/cache/dsh-pet/electron`, and cancellation or failure leaves the browser pet unaffected. In link mode, run `pnpm build` and refresh after a code change; no reinstall is needed.

## Development

```sh
pnpm build          # Host/browser bundles plus the managed Electron presentation
pnpm test           # Host/Web tests followed by Electron main/renderer tests
pnpm desktop:dev    # run the Electron presentation in development mode
pnpm desktop:smoke  # bounded real-Electron smoke test
pnpm typecheck      # Host, browser, tests and desktop type checking
```

`electron` is a source-development dependency, not a runtime payload installed with the plugin. End users receive it only after explicit confirmation in the settings dialog.

The browser bundle rides the `window.__ModuleLoader__.load` contract; React/cordis and so on resolve from the loader's module table (external); CSS Modules are inlined by lightningcss as `<style data-plugin>`.

## Security model

- Browser settings and runtime-control routes accept only direct loopback, same-site requests. They expose only the `pet` namespace and allowlisted single-field mutations.
- Each WebServer attachment creates a fresh 256-bit bearer token for the native bridge. The token and origin are passed in the child environment rather than command-line arguments; state changes use authenticated loopback SSE.
- Electron download starts only after explicit user confirmation. Official, npmmirror and custom HTTPS sources all resolve to the platform artifact pinned by version and SHA-256 checksum before extraction is accepted.
- The Electron process consumes Host APIs and stores native window preferences plus its own model selection and model-list aliases locally. `PetService` remains the source of truth for affinity, dried-fish stock, interaction cooldowns, session and whisper bubbles, and completed-turn rewards; browser `petId` and per-pet `names` remain separate Host Web-registry state.

## Known limitations

- The managed desktop presentation requires an interactive Windows, macOS or Linux session and a WebServer-backed DSH Host. CI, containers, headless sessions and Hosts without the Web bridge keep the core active but do not launch Electron.
- The initial Electron download can be large and depends on the selected mirror. Closing or refreshing the browser does not start a second installation; reopening the dialog reconnects to the Host-owned progress.
- The embedded desktop-host contract is available for future providers, but this package currently ships the managed Standalone presentation. Custom pet registry changes still require a DSH Host restart.

## Sprites and animation-track calibration

The built-in whale-girl atlas is generated by the hatch-pet pipeline as 9 states × 8 columns: `assets/whale/spritesheet.webp` (1536×1872, 8 columns × 9 rows of 192×208 cells) + `assets/whale/pet.json`. The frame count, rhythm, and scene rotation live in that manifest's `frames`, `tracks`, and `sequences` fields; pets without overrides follow the hatch-pet contract rhythm and canonical single-track scene mapping. Redoing artwork therefore only edits `assets/whale/pet.json` (row-order contract: 0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review).

## License

[BSD-3-Clause](LICENSE)
