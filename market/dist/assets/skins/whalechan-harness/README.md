# Whale-chan Harness

English | [中文](README.zh.md)

Whale-chan Harness gives the dsh web GUI a marine-blue community fan-art identity with a Whale-chan riding-whale brand mark and dedicated artwork for workspaces, files, built-in tools, controls, permissions, sessions, and subagents.

## What it does

- **Cohesive Whale-chan identity**: the sidebar and empty-session brand marks use the riding-whale emblem while the palette maps official dsh tokens to clear ocean blues in light and dark modes.
- **Functional icon system**: familiar UI silhouettes remain legible at 16–24 px, with dedicated artwork for workspace and file navigation, built-in Harness tools, composer actions, permission levels, and activity states.
- **Local character backdrop**: light and dark modes include a restrained Whale-chan operations vignette behind translucent surfaces without loading remote media.
- **Declarative activation**: the skin contains local CSS and image assets only; Skin Center scopes every selector, validates every asset path, and owns try-on, apply, persistence, and teardown.

## Install

Whale-chan Harness is distributed through the dsh Workshop. Install Skin Center, open Settings → Workshop to install the skin, then open Settings → Skin Center to try on or apply Whale-chan Harness.

~~~sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
~~~

## Configuration

The skin follows the GUI light/dark setting automatically and has no skin-specific controls. Skin Center's enable switch and global background controls remain available.

## Preview

~~~sh
pnpm market:build
open market/dist/preview.html?skin=whalechan-harness&theme=light
open market/dist/preview.html?skin=whalechan-harness&theme=dark
node scripts/capture-previews whalechan-harness
~~~

## Security model

The skin makes no network request and executes no script. Its images and styles are bundled locally, all resource references remain inside the skin directory, and activation changes presentation only.

## Known limitations

- Fine-grained icon replacement uses the high-sensitivity CSS patch surface and several generated-class selectors; an upstream dsh frontend rebuild can require selector maintenance.
- User-directory and Workshop editions contain no client hooks, so dynamic text tagging from the separate standalone installer is not present; standard permission entries retain declarative ordered fallbacks.
- The artwork is unofficial non-commercial community fan art under CC BY-NC-SA 4.0; attribution and third-party-rights details are recorded in `NOTICE` and `LICENSE`.
