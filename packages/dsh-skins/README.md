# @linxin666/dsh-skins

English | [中文](README.zh.md)

The skin-family aggregate plugin: installing it gives you the skin center (`skin-center`) plus every skin asset (qq98 / ths / xp / blue-fantasy / dragon-heir / minecraft / miku / trading / whale-song / harbor ...) bundled inside the package's `skins/` directory, so no per-skin npm package is needed.

## What it is

- **Skin center + full collection**: one package replaces installing skins individually.
- **Mutual exclusion via `dsh-skin use`**: skin activation is exclusive and managed by `dsh-skin use` (the `managed` section of `~/.dsh/cordis.patch.yml`), so skins live as `skins/` assets only and never enter `patchFrom`.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-skins
```

Switch skins with `dsh-skin use <id>`; only one skin is active at a time.

## Known limitations

- The browser bundle targets the web only, scoped to the dsh web GUI.
- Skins are presentation-only: they mutate the browser DOM and never touch a model request.
