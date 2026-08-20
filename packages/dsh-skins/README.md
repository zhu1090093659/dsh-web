# @linxin666/dsh-skins

English | [中文](README.zh.md)

Retired compatibility carrier (kept for one release cycle): every skin is built into `@linxin666/dsh-client-ui-skin-center`. This package pulls in the skin center and ships asset-free no-op leaf packages so stale v1 profile junctions remain resolvable until the legacy bridge removes them.

## What it is

- **Compatibility carrier**: installing or upgrading this package installs the skin center (`skin-center`), which ships the full built-in skin collection (xp / blue-fantasy / dragon-heir / minecraft / miku / trading / whale-song / harbor / whale-mom / matrix / maid-atelier / mint) as pure asset directories.
- **No-op v1 leaves**: `build.mjs` generates asset-free packages for the 11 retired v1 package names. They do not apply a skin; they only keep an existing profile junction importable during one cleanup boot.
- **Removal next cycle**: this package is scheduled for retirement; new installs should use `@linxin666/dsh-client-ui-skin-center` directly (or the family aggregate `@linxin666/dsh-web-ui-all`).

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/skins/skin-center
```

Switch skins in the GUI's first-level Skin Center section, or with `dsh-skin use <id>`; only one skin is active at a time.

## Known limitations

- The browser bundle targets the web only, scoped to the dsh web GUI.
- Skins are presentation-only: they mutate the browser DOM and never touch a model request.
- A profile overlay that is already invalid YAML fails inside DSH before this compatibility package can load; repair that overlay before booting.
- Maid Atelier is licensed separately under CC BY-NC-SA 4.0 and is restricted to non-commercial use; its license and attribution ship inside the skin-center package's skin directory.
