# @linxin666/dsh-client-ui-community-plugins

English | [中文](README.zh.md)

Community plugin index section for the dsh web GUI settings page: a first-level settings entry (alongside Web UI Plugins, Skin Center and Pet) that opens directly expanded, lists community-contributed plugins with links to each contributor's own repository, and carries its own enable switch.

## What it does

- **First-level section**: registers one settings section next to General / Models / Plugins / Agent presets and the Web UI Plugins, Skin Center and Pet sections. The content renders directly expanded (no disclosure fold), with its own enable switch backed by the community-plugins settings namespace.
- **Index only**: every entry links to the contributor's own repository; the package never vendors the listed code. The registry lives in community.json and is compiled into the client bundle by scripts/community-index.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-community-plugins
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-community-plugins
```

Restart `dsh web` for the card to appear in the settings page.

## Config

- **Enable switch**: inside the Community Plugins first-level section itself (the section carries its own switch). Turning it off hides the index list until it is turned back on; the choice persists in the community-plugins settings namespace.

## Known limitations

- The card shows on the dsh settings page only when its prerequisite (`@deepseek-ai/dsh-client-ui-settings`) is present.
- Entries are curated by maintainers in community.json; the card ships the build-time snapshot.

## License

BSD-3-Clause.
