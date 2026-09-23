# @linxin666/dsh-client-ui-preset-center

English | [中文](README.zh.md)

Community agent-preset manager for the DSH Web GUI: the Workshop's **Presets** panel and the host library that installs, declares, disables and uninstalls presets downloaded from [dsh-market.com](https://dsh-market.com). A preset is only listed under **Settings → Agent presets** once this plugin declares it to the agent-preset registry; everything else stays in the Workshop.

## What it does

- Adds a **Presets** tab to the Workshop store card (contributed through the card's `dsh-workshop.panel` child slot) that lists the community catalog with install state, version updates and install counts.
- Installs a preset into an inert library at `$DSH_HOME/agent-presets/<id>/`. Nothing scans that directory: the harness discovers no preset on disk, so a downloaded composition never loads by itself.
- Declares an installed preset to `ctx.agentPresets` (`@deepseek-ai/dsh-agent-preset-registry`). The host half reads `preset.yml` for the display text and `agent.cordis.yml` for the child plugin rows, then calls `register`, so a declared preset composes new sessions immediately without restarting `dsh web`. Disabling withdraws the declaration; uninstalling withdraws it and deletes the library directory.
- Shows a **composition profile** computed from the installed bytes — the plugin names the composition mounts, whether it ships local code files or `!!js` expressions — and requires an explicit confirmation before it declares anything executable. A read-only viewer renders `agent.cordis.yml` first.
- Refuses a preset whose id another declaration already supplies (the registry rejects a duplicate, so declaring would look like a successful install and do nothing), and refuses to disable or uninstall the preset the registry's default names (a default naming a missing preset fails every new session).
- Verifies market provenance on every state read: per-file sha256 pinned to `https://dsh-market.com`, so a locally edited preset is reported as modified and an update never silently overwrites it.

## Install

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-preset-center
```

The Workshop card (`@linxin666/dsh-client-ui-market`) declares the panel slot and owns the download; without it the host routes still work but there is no panel to drive them. Both ship in the `@linxin666/dsh-web-all` aggregate.

## Config

None. The panel is the only surface, and every behavior is derived from the catalog, the library directory and the live declarations. The plugin registers no settings namespace and injects nothing into the agent system prompt.

## Security model

A preset is code, not an asset: its composition may name npm plugins, load files that travel inside the preset directory, and evaluate `!!js` expressions — all inside the DSH host process once it is declared. The harness states the trust plainly: a preset carries the same trust as shell access. This plugin therefore never treats a download as running:

- **The download is inert.** The market installer writes into `$DSH_HOME/agent-presets/<id>/`, which no discovery root scans. The plugin declares nothing when it loads.
- **The declaration is the consent boundary.** Declaring registers the composition with the registry, which eagerly mounts its rows in the host process. The panel requires an explicit confirmation whenever the composition carries local code, relative rows or inline expressions, and shows what those are.
- **The declaration is pre-checked and rolled back.** The id is checked against the live roster, and a preset the registry reports broken is unregistered with the reason shown instead of being left half-declared.
- **Provenance is the integrity anchor.** The market's per-file sha256 record is re-verified on every read; a mismatch is reported, never repaired silently.
- **Routes are loopback-only.** `/api/preset-center/*` answers only loopback requests, the same fence the market gateway uses, so a remote browser cannot drive the library.
- **Unmanaged directories are untouchable.** A preset that has no market provenance (hand-authored, or installed by another tool) is listed as such and refused by uninstall.

## Known limitations

- **Declaring is not sandboxing.** The confirmation and the composition profile reduce accidental risk; they do not make an untrusted preset safe. Review at the publish gate is the real control.
- **Declarations live with the host process.** Nothing is declared while the plugin loads, so after a `dsh web` restart every installed preset is inert again and is enabled with one click per preset in the Workshop. Persisting enablement would make a restart the moment a downloaded composition becomes live, which is the consent this panel exists to collect.
- **The official settings section may lag.** It re-reads on its own actions, `settings/document-updated` and `connection/reset`, so a preset declared in the Workshop can require a page refresh before it appears under **Settings → Agent presets**. New sessions pick it up immediately.
- **Running sessions keep their preset.** A session's composition is fixed at creation, so disabling or uninstalling a preset never changes a session already using it.
- **The composition subset is deliberately small.** Compositions are read by a reader that understands the YAML a preset ships (block maps and sequences, quoted and plain scalars, literal and folded blocks, `!!js`) and refuses anything else — anchors, aliases, flow collections, extra tags — rather than guessing. A refused composition is reported as such and stays undeclared.
- **The catalog is empty until presets are published.** `packages/dsh-preset-center/presets/catalog.json` is the publishing source; see its README for the contribution format.

## Architecture

- `src/index.ts` — host half: owns the live declarations and mounts the loopback gateway once per process.
- `src/routes.ts` — `GET /api/preset-center/state`, `GET /api/preset-center/composition?id=`, `POST /api/preset-center/{install,disable,uninstall}`; the only layer that reads the roster, so the reserved-id and default-preset policies live here.
- `src/host/declarations.ts` — the registry declarations: register on install, unregister on disable/uninstall and on plugin unload.
- `src/core/paths.ts` — the library path contract and the preset id rule.
- `src/core/library.ts` — the library state: scan, the declaration-derived `enabled` flag, and uninstall.
- `src/core/yaml.ts` — the composition reader (fail-closed YAML subset, `!!js` preserved as data).
- `src/core/definition.ts` — the registry definition read from the installed bytes.
- `src/core/provenance.ts` — the market provenance reader and per-file verification.
- `src/core/profile.ts` — the composition profile.
- `src/client/PresetPanel.tsx` — the panel the Workshop card renders.
- `presets/` — the publishing source read by `scripts/market-build` (catalog plus one directory per preset).

The library path is a cross-package contract: the market installer writes `preset` assets into `$DSH_HOME/agent-presets/<id>/` and neither package imports the other; the path name and the `dsh-market.provenance.json` format are mirrored constants, the same way the Skin Center mirrors the market's provenance.
