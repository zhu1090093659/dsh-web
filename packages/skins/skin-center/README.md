# Skin Center (in-GUI skin center)

English | [中文](README.zh.md)

`@linxin666/dsh-client-ui-skin-center` (cordis plugin id `ui-skin-center`) is the single skin package of the dsh Web GUI: it puts the skin list / try-on / apply into the real GUI as a first-level settings section (settings → 皮肤中心 / Skin Center), and it is the only loader and renderer for skins. A skin is a pure asset directory — no package.json, no npm publish, no cordis wiring — that couples only to the skin-center contract (`contracts/`); the skin center absorbs every official-DSH coupling behind that contract. The card carries its own enable switch (off disables try-on, apply and the background controls).

- List: shows "官方默认" (official default) plus every skin in the catalog with its name, tagline and accent color; the currently active target carries the Active marker. The catalog merges two sources: built-in skins shipped inside this package (`skins/<id>/`) and user skins dropped into `$DSH_HOME/skins/<id>/` (a user skin with the same id shadows the built-in one). Skins whose `skin.json` fails validation are excluded fail-closed and reported as catalog diagnostics.
- Try-on / Apply: both go through the same atomic switch engine (`src/client/runtime/skin-controller.ts`). One switch is one new activation identity: fetch the scoped stylesheet, install it plus the background media and optional hooks, flip `html[data-dsh-skin="<id>"]`, then dispose the previous activation (append-only effect ledger, idempotent teardown). The latest request always wins; a failed or superseded switch leaves the previous skin fully intact. Try-on is the same switch without persistence — "Exit try-on" restores the committed skin. Apply persists the selection (`POST /api/skin-center/v2/active`). No page reload, no `cordis.patch.yml` rewrite, no boot-graph regeneration.
- First paint: the host half registers one index.html transform (`webServer.tapIndex`, single adapter module `src/tap-index-adapter.ts`) that stamps `html[data-dsh-skin]` and inserts the stylesheet links into every served document, so a reload boots straight into the active skin with no flash of the stock look. The tap fails closed to the stock look on any problem.
- Skin format (v2): `skin.json` (validated fail-closed, v1 fields `package`/`wiring`/`bodyAttr` ignored with migration warnings), `skin.css` (L1 token remaps + L2 semantic selectors), optional `patches.css` (L3 free selectors, high sensitivity), optional `hooks.mjs` (trusted escape hatch, high sensitivity), `assets/`, `preview/`. All CSS passes the safety pipeline (`src/core/css-safety/transform.ts`): every selector is force-scoped under `html[data-dsh-skin]`, `@import` / remote or protocol-relative URLs / escaping paths are hard errors. See `contracts/README.md`.
- Coverage contract: L1 remaps the official `--dsw-*` design tokens; L2 styles the semantic attributes (`data-dsh-surface` / `data-dsh-part` / `data-dsh-plugin`, enumeration in `contracts/semantic-attrs-v1.md`) which a compat adapter (`src/client/runtime/semantic-adapter.ts`) stamps onto the official shell DOM from stable anchors (`data-slot` outlets, `data-chat-flow-kind`, etc.); L3 patches carry any selector at the skin author's own risk. Plugins that output the semantic attributes themselves get the full L2 coverage; plugins that do not only get L1.
- Background priority: a Wallpaper Engine wallpaper always wins over the user manual background scrim, which wins over the skin's manifest background media; toggling the wallpaper re-evaluates the priority live.
- Background controls: a background-occlusion slider (0–100%) veils the backdrop behind the panels for skins that paint one, plus two per-state Gaussian-blur sliders (0–20 px) — 空对话 (blur when the conversation is empty) and 有对话 (blur once it has content). The active blur is applied through a fixed `backdrop-filter` element behind the shell; 0 disables it entirely (no element, no GPU cost). These apply only to skins that paint a backdrop; the official default has none.
- Wallpaper Engine bridge: the card can use the machine's local Wallpaper Engine library as the GUI backdrop. The host half (`src/we-library.ts` + `src/we-routes.ts`) locates the WE install (Steam app 431960: registry + `libraryfolders.vdf` + probe paths on Windows), scans its projects and workshop content plus optional manual folders, and serves the inventory, media (Range-streamed), previews, web-wallpaper project files (with the WE API shim injected), and scene main-texture PNGs (decoded in-process from PKG/TEX by `src/pkg-extract.ts`, cached on disk) through same-origin `/api/skin-center/we/*` routes. Video wallpapers render in a `<video>`, web wallpapers in a sandboxed `<iframe>`, scene wallpapers as a static frame; a "static frame" render mode pins a zero-animation-cost image for any type. Per-wallpaper Import copies the project into `<harness-home>/skin-center/wallpapers/` so it survives Steam library changes, with update detection against the workshop original. Wallpapers are the user's own local files and are never uploaded or redistributed — Workshop content belongs to its authors. No Wallpaper Engine install (e.g. macOS)? The panel's Manual folders row adds any folder of `.mp4`/`.webm` files, a single wallpaper project folder, or a folder of projects as the library ('~' expands to the home directory).
- Legacy migration: on the first boot after the v2 upgrade, a one-shot bridge (`src/legacy-bridge.ts`) reads the retired `dsh-skin` managed section of the active profile's `cordis.patch.yml`, migrates the active skin id into the v2 selection store, and strips the legacy rows. The migration is idempotent and fails closed (the old state stays untouched on any error).

## Install

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/skin-center
```

`$(pwd)` is your clone of the dsh-web-ui monorepo. All built-in skins ship inside this one package; community skins are plain directories dropped into `$DSH_HOME/skins/<id>/` (no install command, no restart — reopen the card or reload to pick them up).

skin-center is a self-contained bundle meeting the official DSH plugin standard (`dsh.bundle.patch` points to `cordis.patch.yml`); it can also be installed via git: `dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>` (the `prepare` script builds `lib/` in place). pnpm ≥10 requires authorizing `allowBuilds` before installing a git dependency; a local `link:` install has no such requirement.

## Configuration

- **Enable switch**: turns the whole card (try-on / apply / background controls) on or off; persisted in the `skin-background` settings namespace.
- **Background sliders**: occlusion (0–100%) and the two blur radii (0–20 px), same namespace.
- **Wallpaper panel**: library folders, selection, render mode (live / static frame), dim, blur, pause-on-hidden, sound toggle and volume; persisted in the `skin-wallpaper` namespace.
- **User skin directory**: `$DSH_HOME/skins/<id>/`; `DSH_SKINS_HOME` overrides the root (development and tests).

## Security model

- All `/api/skin-center/*` routes are same-origin only: writes reject cross-site requests (Sec-Fetch-Site / Origin fence), and asset reads are contained inside each skin directory (path escapes fail closed).
- Skin CSS is sanitized (whitelist) before serving; `patches.css` (L3) is arbitrary CSS by design and disclosed as such — it runs with full page styling power and is not a security boundary.
- `hooks.mjs` is trusted code that shares this repository's review and release; it is served same-origin only and its import/apply errors can never take the static skin down.

## Known limitations

- Inline styles written by plugins at runtime can only be overridden by L3 `!important` patches.
- Plugins that do not output semantic attributes (and have no stable DOM anchors) receive L1 token coverage only.
- A skin video background keeps playing regardless of the wallpaper pause-on-hidden setting; pause-on-hidden applies to the Wallpaper Engine bridge only.

## Directory structure

```
skins/skin-center/
  contracts/                                # the skin-facing contract surface (schema, hooks API, semantic attrs)
  src/core/manifest-v2/                     # manifest v2 types + fail-closed validator
  src/core/css-safety/                      # lightningcss scoping + whitelist pipeline
  src/index.ts                              # host entry: routes, tapIndex adapter, legacy bridge
  src/skin-repo.ts                          # dual-source skin catalog (built-in + $DSH_HOME/skins)
  src/routes-v2.ts                          # /api/skin-center/v2/* routes
  src/tap-index-adapter.ts                  # the single tapIndex adapter (anti-FOUC)
  src/active-state.ts                       # active-skin selection persistence
  src/legacy-bridge.ts                      # one-shot v1 → v2 migration
  src/http-utils.ts / harness-home.ts       # shared route helpers / DSH path resolution
  src/we-library.ts / we-routes.ts / we-shim-source.ts / pkg-extract.ts   # Wallpaper Engine bridge
  src/client/runtime/                       # effect ledger, decoration layers, semantic adapter, switch controller, boot store
  src/client/SkinCenter.tsx                 # the settings card
  src/client/background.ts / wallpaper.ts / WallpaperPanel.tsx            # scrim + blur / WE bridge UI
  skins/<id>/                               # built-in skins (pure asset directories)
```

## Acceptance checklist

- [x] The skin-center section appears in 设置 → 皮肤中心 without console errors
- [x] The list shows the official default plus every catalog skin; the active one is marked; invalid skins surface as diagnostics
- [x] Try-on takes effect immediately and Exit restores the committed skin; only one skin is ever on the page
- [x] One-click apply switches atomically with no reload; a later page load boots straight into the skin (no FOUC)
- [x] The Wallpaper Engine bridge, background scrim and blur controls are unaffected by skin switches
- [x] e2e screenshots live in `docs/e2e/skin-center/`
