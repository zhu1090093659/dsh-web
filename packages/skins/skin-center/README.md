# Skin Center (in-GUI embedded skin center)

English | [中文](README.zh.md)

`@linxin666/dsh-client-ui-skin-center` (cordis plugin id `ui-skin-center`) puts the skin list / try-on / apply into the real dsh Web GUI as a first-level settings section (settings → 皮肤中心 / Skin Center), a sibling nav item of General / Models / Plugins / Agent presets and of the Web UI Plugins group and Pet sections. The card carries its own enable switch (off disables try-on, apply and the background controls).

- List: shows "官方默认" (official default) plus every skin in the repo (xp / blue-fantasy / dragon-heir / minecraft / miku / matrix / harbor / trading / whale-mom / whale-song) with its name, tagline, and accent color; the currently active target carries the Active marker.
- Try-on: clicking "Try on" loads that skin's client bundle on demand — the host route `/api/skin-center/bundle/<id>` serves `lib/client.js` as a same-origin script (the same mechanism the core uses to load plugins), the factory registers with the page's own `window.__ModuleLoader__`, and `window.__DSH_MODULES__.import` materializes it (a real loader, not a simulator and no eval); the chrome takes effect immediately; light/dark switching rides the official theme service; "Exit try-on" restores everything — the current skin's styles, DOM, favicon, title, and body inline styles are all restored. "官方默认" (official default) can also be tried on: one click immediately withdraws the skin and returns to the official look preview.
- Mutual exclusion: during try-on, the active skin's visual writes (body attribute, background inline styles, chrome child nodes, xp's footer taskbar) are temporarily withdrawn per the prescription, and restored verbatim on exit; only one skin is on the page at a time.
- Apply: the host half (`src/index.ts` + `src/routes.ts`) exposes `/api/skin-center/apply` and `/api/skin-center/bundle/<id>` (serves skin bundles on demand); clicking "Apply / 恢复默认" (Apply / Restore default) runs the embedded in-process `dsh-skin use` port (`src/skin-switch.ts`) server-side, writes `<harness-home>/profiles/<profile>/cordis.patch.yml`, and the DSH config watcher hot-loads it within seconds and the page auto-refreshes — **no dsh web restart, no copying a command, no `dsh-skin` binary on PATH**. On failure the error message includes a terminal fallback command. Harness home follows the dsh launcher: an injected HOME maps to `<home>/.dsh`, else a trimmed non-empty `$DSH_HOME` is used directly, else `~/.dsh`. The target profile resolves as: explicit option, then `$DSH_SKIN_PROFILE`, then `$DSH_PROFILE`, then `process.cwd()` when it is a directory directly under `<harness-home>/profiles/<name>`, then `web`. Windows compatibility: the same resolution rules apply with no `$HOME` or fixed paths, and profile links fall back to directory junctions when symlink privileges are missing.

- Background controls: a background-occlusion slider (0–100%) veils the backdrop behind the panels for skins that paint one (blue-fantasy / whale-song), plus two per-state Gaussian-blur sliders (0–20 px) — 空对话 (blur when the conversation is empty) and 有对话 (blur once it has content). The active blur is applied through a fixed `backdrop-filter` element behind the shell; 0 disables it entirely (no element, no GPU cost). These apply only to skins that paint a backdrop; the official default has none.

- Wallpaper Engine bridge: the card can use the machine's local Wallpaper Engine library as the GUI backdrop. The host half (`src/we-library.ts` + `src/we-routes.ts`) locates the WE install (Steam app 431960: registry + `libraryfolders.vdf` + probe paths on Windows), scans its projects and workshop content plus optional manual folders, and serves the inventory, media (Range-streamed), previews, web-wallpaper project files (with the WE API shim injected), and scene main-texture PNGs (decoded in-process from PKG/TEX by `src/pkg-extract.ts`, cached on disk) through same-origin `/api/skin-center/we/*` routes. Video wallpapers render in a `<video>`, web wallpapers in a sandboxed `<iframe>`, scene wallpapers as a static frame; a "static frame" render mode pins a zero-animation-cost image for any type. Per-wallpaper Import copies the project into `<harness-home>/skin-center/wallpapers/` so it survives Steam library changes, with update detection against the workshop original. Wallpapers are the user's own local files and are never uploaded or redistributed — Workshop content belongs to its authors. No Wallpaper Engine install (e.g. macOS)? The panel's Manual folders row adds any folder of `.mp4`/`.webm` files, a single wallpaper project folder, or a folder of projects as the library ('~' expands to the home directory).

## Install (official plugin bundle)

Install the family skin aggregate package `@linxin666/dsh-skins` first (all skins plus the skin center in one); for this package alone use the `link:` commands below.

```sh
# All skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or just the skin center
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/skin-center
```

`$(pwd)` is your clone of the dsh-web-ui monorepo.

skin-center is a self-contained bundle meeting the official DSH plugin standard (`dsh.bundle.patch` points to `cordis.patch.yml`; `prepare` uses a dedicated tsdown config for a self-contained build with no project references or type checking); it can also be installed via git: `dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>` (the `prepare` script builds `lib/` in place).

A local `link:` install needs built artifacts first — `lib/` is git-ignored and not committed, so run `pnpm install && pnpm -r build` in the monorepo before linking.

pnpm ≥10 requires authorizing `allowBuilds` before installing a git dependency (the `prepare` script builds in place); a local `link:` install has no such requirement.

The skin plugins (xp / blue-fantasy / miku etc.) must resolve in the host for skin-center to list / try on the full set; skin-center itself has no mutual-exclusion requirement.

## Directory structure

```
skins/skin-center/
  package.json / tsdown.config.ts / tsconfig.json   # metadata for building within the checkout
  src/index.ts                                       # host side: registers /api/skin-center/* routes
  src/routes.ts                                      # host routes (proxy to the dsh-skin CLI)
  src/invariant.ts                                   # invariant companion plugin (no assertions)
  src/client/index.ts                                # apply: registers the first-level settings section + body scope
  src/client/SkinCenter.tsx                          # card component (official default + list/try-on/light-dark/one-click apply)
  src/client/try-on.ts                               # try-on engine (real loader + mutual-exclusion restore, incl. official try-on)
  src/client/locales.ts                              # en/zh copy
  src/client/skin-center.module.css                  # panel styles (--dsw-* tokens, adapting to the skin)
  src/we-library.ts                                 # WE library discovery (Steam/workshop/manual folders/import store)
  src/we-routes.ts                                  # /api/skin-center/we/* routes (inventory/media/web/scene-frame/import)
  src/we-shim-source.ts                             # WE Web API shim served to web wallpapers
  src/pkg-extract.ts                                # in-process PKG/TEX decoder for scene static frames
  src/client/wallpaper.ts                           # wallpaper layer controller (media/scrim layers, static frame, pause-on-hidden)
  src/client/WallpaperPanel.tsx                     # wallpaper grid + render controls in the card
  src/client/generated/skins.ts                      # generated: skin registry (metadata only, do not hand-edit)
```

## Mechanism notes

- Skin enumeration: `generated/skins.ts` is produced by `scripts/skin-center-bundles` (reads `skins/<name>/skin.json`, validates that `lib/client.js` exists). **It contains metadata only, no embedded bundle text**: cold start does not parse the ~700KB base64 art assets, and the generated file is reproducible across machines (no build-machine absolute paths).
- Try-on loading: the host route `/api/skin-center/bundle/<id>` serves `lib/client.js` on demand (same-origin script, loaded via a `<script>` tag — the same mechanism as the core's `defaultLoadBundle`); the bundle body calls `window.__ModuleLoader__.load` to only register a factory; `window.__DSH_MODULES__.import(package)` materializes the module (CSS `<style data-plugin>` auto-injected); `surface.apply(miniCtx)` mounts with a miniCtx that only implements `effect(cb)` (the skin's only dependency). It does not rely on eval, so no CSP `unsafe-eval` pass is required — only same-origin script loading (as the page itself does when loading its plugin bundles).
- Failure semantics: when the bundle route 404s (skin not installed / `lib/client.js` not built) or the network fails, the script's error event fires, try-on reports a generic error and fully restores the active skin; no half skin is left between loading and restoring (the tryOn catch branch handles recovery).
- Exit restore: first run the skin's disposer (withdraws attribute/chrome/favicon/title/background entirely), then `invalidate(package)` + remove the style tag, then restore the active skin's visual snapshot verbatim. Official-default try-on = the same withdrawal prescription but without mounting any skin; exit restores identically.
- Active-skin detection: `window.__DSH_BOOT__.entries` only contains enabled entries, compared against the registry packages; no match means official default.
- One-click apply: host `/api/skin-center/apply` runs the embedded port of `dsh-skin use <name>` / `use official` (the port is the sole authority for the managed section and the symlink). Paths are `<harness-home>/profiles/<profile>/cordis.patch.yml` and `<harness-home>/profiles/<profile>/node_modules` with the home/profile resolution described above; legacy global managed rows are removed on the first switch so other profiles never load Web-only skins. When the active skin is itself installed as a bundle — listed in the profile manifest's `dsh.profile.bundles` or `dependencies` (the two channels the loader reconciles), or a registry `bundleWired` skin — the profile layer writes only the mutual-exclusion `disabled: true` rows and leaves the insert to the bundle patch; anything else, including the skin-center's own resolvability symlinks, keeps the profile insert row. The structural dir-probe fallback applies only when the profile manifest is missing/unreadable. Before appending the managed rows, the writer removes the DSH default `[]` root while preserving comments; an incompatible non-empty flow root fails before the atomic replacement. The DSH daemon surface ships its own config watcher (`watchUserPatches` + config-only HMR); after the patch is written it hot-loads in seconds without a restart; a browser refresh picks up the new boot graph (client plugin-graph row changes are not within `dsh-client-hmr` semantics).

## Build (in-repo tsdown, no DSH checkout)

Like the skins, the skin center builds with the in-repo shared tsdown preset (`shared/tsdown.client.ts` handles CSS-Module injection and platform externalization; types come from the official NPM SDK devDependencies):

```sh
# 1. Regenerate the registry (re-run after skin metadata changes; bundle text rides the host route on demand, no regen needed)
node scripts/skin-center-bundles
#    A skin bundle change itself only needs that skin rebuilt (tsdown); the GUI picks up the new text on the next try-on

# 2. Build in the repo
cd ~/code/dsh-web-ui && export NPM_TOKEN='<token>'   # if private-scope auth is still required
pnpm --filter @linxin666/dsh-client-ui-skin-center run bundle
```

## Install (personal environment wiring, not committed to the checkout)

```sh
# 1. profile symlink (same as xp/blue-fantasy)
ln -sfn ~/code/dsh-web-ui/packages/skins/skin-center \
  ~/.dsh/profiles/node_modules/@linxin666/dsh-client-ui-skin-center

# 2. add to ~/.dsh/profiles/web/cordis.patch.yml (outside the dsh-skin managed section, do not touch that section):
#   - insert:
#       - id: ui-skin-center
#         name: '@linxin666/dsh-client-ui-skin-center'

# 3. the config watcher hot-loads in seconds; refresh the page to see the skin-center section in 设置 → 皮肤中心
```

## Try-on mutual-exclusion restore prescription (try-on.ts)

| Skin | body attribute | extra handling |
| --- | --- | --- |
| All | withdraw `bodyAttr` (CSS deactivated) | snapshot/clear the body background inline style (blue-fantasy whale background); remove chrome among the body's direct child nodes that are not `#root` (measured: only skin chrome); neutralize observers to prevent ghost write-backs |
| xp | same | additionally inject neutralizer CSS to hide the sidebar footer's taskbar/start button (its rules are not scoped by attribute) |

Exit try-on = try-on skin disposer (real code path) → module invalidate + style cleanup → restore the active skin snapshot verbatim.

## Acceptance checklist (top-level README contract)

- [x] The skin-center section appears in 设置 → 皮肤中心 without console errors
- [x] The list contains the official default plus all skins; the currently active one is marked
- [x] Try-on really takes effect (chrome/background/title/favicon); light/dark correct; the official default can be tried on
- [x] Exit fully restores; mutual exclusion (no two title bars)
- [x] One-click apply: the host API runs `dsh-skin use`, the watcher hot-loads, and the new skin is hot-mounted in place through the real module system (no reload, no restart — instant switch in packaged installs too; a page reload remains the fallback when the hot mount fails); failure carries a command fallback
- [x] Regression: the dsh-skin CLI (incl. `use official`), the web gallery, and the official GUI are unaffected
- [x] On-demand loading: cold start does not parse the ~700KB embedded base64 (`generated/skins.ts` is only ~5KB of metadata); try-on fetches the bundle on demand; no eval (CSP needs no `unsafe-eval`)
- [x] e2e screenshots live in `docs/e2e/skin-center/`
