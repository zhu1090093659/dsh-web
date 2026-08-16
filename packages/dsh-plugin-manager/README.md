# @linxin666/dsh-plugin-manager

English | [中文](README.zh.md)

Plugin enable/disable manager for the dsh web GUI: it shadows the official
read-only "All" plugin list inside the Plugins settings section and adds an
enable/disable switch to every row. Switches apply immediately through the
Cordis Loader and are persisted in `~/.dsh/cordis.patch.yml` so they survive
restart. Everything rides official DSH mechanisms — no dsh source changes.

## What it does

- Settings → Plugins → Plugin List: the manager occupies the official
  inventory tab's cell (id `all`) at a lower slot priority, so the read-only list is
  replaced by the same list with per-row enable/disable switches.
- The list mirrors the official inventory: every loaded Loader entry with its
  module name, entry id, live fiber phase, and an enabled/disabled tag.
- Each row has an enable/disable switch. The switch calls the Loader entry
  update directly, so the plugin mounts or unmounts live — no restart needed.
- Every switch is written into the user patch layer
  `<dshHome>/cordis.patch.yml` (default `~/.dsh/cordis.patch.yml`) as an
  id-targeted `disabled` override; dsh web hot-reloads that file, and the
  next boot reads it again, so the switch is durable.
- Boot-glue entries (the include row, the manager itself, `cordis:include` /
  `cordis:group`, HMR and timer modules) are protected and show no switch;
  official @deepseek-ai plugins are marked "Official".
- If a live switch fails, a disable intent falls back to the ledger
  `<dshHome>/plugin-manager.json` and is replayed on the next boot. Enables
  never defer: a plugin that failed to start must not fail the whole boot.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-plugin-manager
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-manager
```

Restart `dsh web`, open Settings → Plugins → Plugin List.

## Config

The plugin has no settings namespace; behavior is fixed:

| Aspect | Behavior |
| --- | --- |
| Scope | Every loaded plugin entry (official and third-party); group rows are skipped. |
| Live switch | `entry.update({ disabled })` through the Cordis Loader — transactional, a failing candidate rolls back. |
| Persistence | `<dshHome>/cordis.patch.yml` id-targeted `disabled` override (atomic write, comments preserved); dsh web applies it live and on every boot. |
| Fallback | A failed disable intent is recorded in `<dshHome>/plugin-manager.json` and replayed after the loader settles; enables are never deferred. |
| Protection | `include`, the manager's own entry, `cordis:include` / `cordis:group`, and HMR / timer modules cannot be toggled. |

## Security model

- All `/api/dsh-plugin-manager/*` routes are loopback-only: requests from
  non-local addresses, foreign Host headers, and cross-site origins are
  rejected with 403 (the same fence as dsh-ssh).
- The plugin writes only two places: the user patch layer
  `<dshHome>/cordis.patch.yml` (atomic write) and the fallback ledger
  `<dshHome>/plugin-manager.json` (0600, atomic write).
- The plugin adds no agent tools and no system-prompt announcement; it is a
  pure user-side management surface.

## Known limitations

- The shadow replaces the rendered content of the "All" tab but not its
  tab-bar row: with the official inventory plugin still enabled, the section
  projects two "Plugin List" cells (both render this plugin's list). Disable the
  official `ui-settings-plugin-inventory` entry in the profile patch to keep
  a single tab (the repository's own mount already does).
- A plugin whose module fails to start cannot be enabled from the UI (no
  restart fallback for enables), and the plugin-manager entry itself is
  protected from its own list.
- The durable switch applies to the current dsh home only; a different
  `DSH_HOME` profile has its own patch layer.

## License

Apache-2.0.
