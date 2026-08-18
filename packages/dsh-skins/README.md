# @linxin666/dsh-skins

English | [中文](README.zh.md)

The skin-family aggregate plugin: installing it gives you the skin center (`skin-center`) plus every skin asset (xp / blue-fantasy / dragon-heir / minecraft / miku / trading / whale-song / harbor / whale-mom / matrix / maid-atelier ...) bundled inside the package's `skins/` directory, so no per-skin npm package is needed.

## What it is

- **Skin center + full collection**: one package replaces installing skins individually.
- **Mutual exclusion via `dsh-skin use`**: skin activation is exclusive and managed by `dsh-skin use` (the active Web profile's `managed` section), so skins live as `skins/` assets only and never enter `patchFrom`; non-Web profiles do not inherit browser-only skin entries.
- **YAML-safe profile writes**: the DSH default `[]` overlay template is normalized before the managed block is appended; an incompatible non-empty flow root is rejected before the file is replaced.

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
- Maid Atelier is licensed separately under CC BY-NC-SA 4.0 and is restricted to non-commercial use; its license and attribution are shipped inside the bundled skin and summarized in `THIRD_PARTY_NOTICES.md`.
