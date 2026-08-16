# @linxin666/dsh-client-ui-web-ui-settings

English | [中文](README.zh.md)

The dsh web UI plugin group for the DSH settings page: it adds a first-level settings section (a sibling nav item of General / Models / Plugins / Agent presets) that hosts the enable switches and configuration forms of the family plugins.

## What it is

- **One section for the family**: on the DSH settings page it registers a first-level section that renders directly expanded (a static heading followed by the cards, no disclosure fold) and hosts the enable switches and configuration forms of the remaining dsh web UI family plugins (task-board, live-stats, remote-web-ui, describe-image).
- **Sibling sections**: Skin Center, Community Plugins and Desktop Pet ship as their own packages and register their own first-level sections that open directly expanded.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-settings
```

Restart `dsh web` for the section to appear in the settings page.

## Known limitations

- The section shows on the dsh settings page only when its prerequisite (`@deepseek-ai/dsh-client-ui-settings`) is present.
