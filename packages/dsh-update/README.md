# dsh-update · Plugin Ecosystem Version Check & Update Notifier for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-update?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.1-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Plugin Ecosystem Version Check & Update Notifier for DeepSeek Harness (DSH)</strong><br>
  <em>Sidebar Footer Trigger · npm Auto-Detection · Release Notes Integration · Verified Update Pipeline</em>
</p>

> In-GUI auto-update extension for the DeepSeek Harness (DSH) family: a download trigger alongside the settings button in the sidebar footer that checks npm for newer `@linxin666/dsh-web-*` versions and runs a verified `pnpm update --latest` inside the active profile.

> **The family aggregate does not include this package.** `@linxin666/dsh-web-all` mounts no update row and does not depend on `@linxin666/dsh-update`; install this package on its own in the profile that should offer self-update. The aggregate keeps only the `update` tombstone subpath, so a profile that still records `@linxin666/dsh-web-all/update` resolves the export and mounts nothing.

This package is an external plugin for DeepSeek Harness (DSH), structured as a cordis bundle: the host half mounts the `/api/update` route family while the browser half renders the sidebar trigger and update modal.

The feature is deliberately structured as an **independent plugin row** (row id `update`) rather than sharing a seat with `dsh-remote-web-ui`: disabling remote access must never remove the update path, and the row belongs to this package alone.

## What it does

- **Sidebar trigger**: a download control in the official
  `sidebar.footer.action` seat beside the settings trigger. It marks the button
  with a text badge when a newer release exists, checks the registry on open, and
  lets the user confirm the update from the result view.
- **Web pages only**: the trigger mounts on pages a web transport delivered —
  the loopback GUI in a browser, a LAN or tunnel deployment. The official DSH
  Desktop shell serves its page from `dsh-app://app/` and owns its own updater,
  so the seat is not mounted there at all; that page's seat keeps the
  phone-remote trigger alone.
- **Verified install**: the run endpoint executes `pnpm update --latest` in the
  profile the web GUI was booted from, then re-reads the installed versions. The
  pnpm 11/12 `minimumReleaseAge` gate can silently keep same-day releases, so a
  green exit alone is not reported as success.
- **Release notes**: the panel fetches the matching GitHub release notes and lists
  the component versions it moved.
- **Restart hint**: a successful update asks the user to restart `dsh web`, which
  is when the new package versions load.

## Requirements

- DSH `>= 0.2.2-rc.1`.
- The profile must own the family packages through npm: the aggregate
  `@linxin666/dsh-web-all`, or the family packages installed directly. A profile
  whose family is installed with local `link:` specs is reported as **local
  development mode** and the update is refused (sync the checkout instead).

## Install

```sh
# Recommended: install directly from npm
dsh plugin --profile <profile> add @linxin666/dsh-update

# Or from a checkout (development loop)
dsh plugin --profile <profile> add link:<repo>/packages/dsh-update
```

Installing the package mounts the row. Uninstall it, or disable the row in the
plugin manager, so a profile stops offering self-update.

## Configuration

The plugin ships no settings namespace of its own: a profile either mounts the
row or not, and the plugin manager's per-row switch is the only control. The
host surface is fixed — the two loopback routes below — and the sidebar trigger
always registers into the official `sidebar.footer.action` seat.

## Use

1. Open the dsh web GUI and look at the sidebar foot: the download trigger sits
   beside the settings trigger (a 36px circle in the collapsed rail, a pill in the
   wide column).
2. Click it. The panel probes the registry and shows either "up to date" or the
   newer release with its notes.
3. Confirm with **Update now**. The panel shows the pnpm run, then the outcome and
   the component versions.
4. Restart `dsh web` for the new packages to load.

## Routes

Both routes are exact matches on the host web server and answer only to the local
machine:

| Route | Method | Meaning |
| --- | --- | --- |
| `/api/update/status` | GET | Registry probe: install mode, owning profile, per-package current/latest, release notes |
| `/api/update/run` | POST | Runs the verified `pnpm update --latest` in the owning profile |

A paired remote desktop reaches them through the `dsh-remote-web-ui` gated
`/remote/api` channel, which is why that plugin's channel rules keep
`/api/update/` on the paired path.

## Security model

- **The run endpoint executes a real install on this machine.** It is fenced to
  the loopback authority and refuses cross-site browser markers, so a LAN or
  tunnel origin can never trigger it directly.
- **The update target is the host process's own module graph.** The anchor
  manifest is resolved from the running host (`@linxin666/dsh-web-all` first,
  falling back to this package), so the update always writes the profile that
  serves the page — never a path supplied by the client.
- **Local links are refused**, not rewritten: a `link:` spec cannot be updated
  from the registry, and silently replacing it would detach the user's checkout.
- The panel prints the captured pnpm output, which can contain local paths. No
  credentials are read from or written to the profile by this plugin.

## Known limitations

- The desktop shell (`dsh-app://` pages) has no update seat by design: use the
  desktop application's own updater there, or open the GUI in a browser to drive
  the family update.
- A profile whose family packages are installed with local `link:` specs reports
  local development mode and cannot self-update; sync the checkout instead.
- `pnpm` must be resolvable on the host (`pnpm`, `corepack`, or `npx`); the panel
  names the candidate that failed when none works.
- The pnpm 11/12 `minimumReleaseAge` gate can hold back same-day releases. The
  update command overrides it per run with `--config.minimum-release-age=0`; the
  key is kebab-case because pnpm 12 ignores `--config.minimumReleaseAge=0`
  without a warning, while pnpm 11 accepts both spellings (#1897). When the
  installed versions did not move, the panel explains that key change and the
  `minimumReleaseAgeExclude` / `minimumReleaseAge: 0` remedy.
- The captured pnpm output is shown verbatim and can contain local paths.
- The wide sidebar row that puts the footer actions beside the settings trigger
  is declared by `dsh-remote-web-ui`. With that plugin disabled the update trigger
  falls back to the shell's own stacked foot: it still renders and works, only
  the shared-row layout is lost.

## Development

```sh
pnpm --filter @linxin666/dsh-update typecheck
pnpm --filter @linxin666/dsh-update test
pnpm --filter @linxin666/dsh-update build
```

## Checks

Focused gates: `pnpm --filter @linxin666/dsh-update test`, `pnpm typecheck`,
`pnpm test:standards`, and `pnpm libs:check` after the aggregate is rebuilt.

## Telemetry

One anonymous install heartbeat per browser per UTC day (package name only, silent
failure), following `docs/telemetry.md`. No session content, paths, or update
results are reported.

## Dependency rationale

`@deepseek-ai/*` entries are the official SDK used for types and host faces;
`react`/`react-dom` are the GUI's own platform modules. The
`@deepseek-ai/dsh-client-ui-primitives` icons ride the platform module table.
