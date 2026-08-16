# @linxin666/dsh-client-ui-skin-matrix

English | [中文](README.zh.md)

A Matrix-style dark skin for the dsh Web GUI, designed for late-night bedroom use: near-black green background, ink-green monospace text, and a low-opacity digital rain — easy on the eyes and unobtrusive for sleeping family members.

## Features

- **Low-brightness palette**: near-black green background `#040805`, ink-green body text `#7dffb3`, brand green `#00e676` — comfortable for long sessions
- **Forces dark**: does not follow the system light/dark theme (a feature for late-night use); `apply()` sets the `data-dsh-matrix` body attribute and forces `data-ds-dark-theme`, kept in place by a MutationObserver
- **Full token coverage**: the complete `--dsw-static-*` / `--dsw-alias-*` / `--aion-*` design-token sets (sidebar, conversation, dialogs, code blocks, git-graph lane colors, scrollbars, selection)
- **Rain as ambience, not the star**: canvas overlay at 10% opacity, 20fps cap, `pointer-events:none`, auto-off under `prefers-reduced-motion`, paused when the tab is hidden, DPR capped at 2
- **Zero dependencies**: pure browser-side CSS + canvas, no host logic, does not modify DSH source; the effect disposer reverts every write on unload

## Install (official bundle way)

```sh
# All skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or this skin alone
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-matrix
# Enable: dsh-skin use matrix
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/matrix
```

## Notes

- This skin is **dark-only**: `preview/light.png` and `preview/dark.png` are identical by design (forced dark).
- Presentation only: no services, no cordis events, no model-request involvement.
