# dsh-plugin-manager · Client Plugin Manager & Lifecycle Control UI for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-client-ui-plugin-manager?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Client Plugin Manager & Lifecycle Control UI for DeepSeek Harness (DSH)</strong><br>
  <em>Installed Plugin Version Checks · One-Click Batch Updates · Runtime Compatibility Gate · Safety Rollback · Dual Channels</em>
</p>

An update and lifecycle manager for DeepSeek Harness (DSH) Web GUI and official desktop client: adds real-time registry version comparisons with DSH runtime compatibility checks directly into the official Plugins page, providing list-level batch updates, safe rollback mechanisms, and restart-to-apply workflows.

## What it does

- Contributes a check-for-updates block into the official Plugins page (the `plugins.detail.section` seat that page declares), rendered on an installed bundle's page and nowhere else. There is no tab of its own in the Plugins settings section.
- Adds a list-level toolbar beside that page's **Installed** heading. The heading is the page's own chrome and the page declares no seat beside it (its extension points are `plugins.detail.*`, `plugins.item`, `plugins.bundle.config`, `plugins.row.config` and `plugins.bundle.activation`), so the toolbar is inserted into that element and kept in place through the family's shared body-mutation hub. One click checks every installed plugin; the panel lists the third-party rows that have a newer release, with the declared DSH minimum for any row this runtime is too old for; **Update all** applies the eligible rows one at a time with per-row progress and stops at the first failure, leaving the rest listed; **Restart now** then makes the update effective (see the restart note under Known limitations). Official `@deepseek-ai/` packages are never updated in bulk — their version belongs to the DSH installation.
- Dual-channel transport: on runtimes with the official installer services (DSHCode and the 1.0.4 checkout web), every operation rides the official `/plugin-installer` and `/plugin-control` loopback RPC channels; on the npm-published web runtime those channels do not exist, so the package's host half mounts a loopback-fenced HTTP gateway that spawns the official `dsh plugin` CLI for installs/removals (the single writer) and writes `disabled` override rows for enablement. An application-owned profile (a packaged Desktop launch) takes the third writer for installs, updates and removals: the official in-process plugin manager the host mounts, because the CLI refuses to write that profile at all.
- Detects the legacy aggregate `@linxin666/dsh-web-ui-all` and converts its update action into a transactional migration to `@linxin666/dsh-web-all`; the gateway removes the legacy package, installs the current package at an exact version, restores the legacy layer position, and verifies `--dump-config` before reporting success.
- Verifies DSH runtime compatibility before npm updates (issue #754): update checks read the declared minimum DSH version from the latest manifest (`dsh.engines.dsh` with a top-level `engines.dsh` fallback), show the requirement beside the update action, disable it when the running DSH is below it, and the host update route returns 412 before starting any CLI job when the runtime cannot be verified.
- Protects the next boot on the npm runtime: after each install the gateway verifies the dependency actually landed, rejects duplicate entry-id claims and insert rows naming unresolvable packages, and composes the profile with the CLI's `--dump-config` preflight; a conflicting or failing install is rolled back through the official remove path and the existing plugins are never touched.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-plugin-manager
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-manager
```

Restart `dsh web`; the update block appears on a bundle's page inside the official Plugins panel.

## Config

The package carries no configuration namespace. Update writes apply at the next restart.

## Cordis service

The browser half provides the shared dual-channel face as the cordis service `pluginManager`, so sibling client plugins can drive and observe plugin management without re-implementing the channel detection. Consume it with `ctx.inject(['pluginManager'], cb)` and read `ctx.pluginManager`:

- `isLoopback: boolean` — whether this browser has loopback authority to use the host routes.
- `list(): Promise<InstalledPluginItem[]>` — read the installed snapshot.
- `install(spec): Promise<InstalledPluginItem>` — install one plugin from an npm spec or git URL.
- `uninstall(id): Promise<InstalledPluginItem[]>` — remove one plugin.
- `status(): Promise<InstallProgressItem>` — read the current install/update progress.
- `failures(): Promise<PluginFailuresSnapshot>` — read the recorded plugin boot-failure ring (plugin id, message, stack, install path); runtimes without a ring answer an empty snapshot.
- `setEnabled(id, enabled): Promise<InstalledPluginItem>` — flip one plugin's next-start enablement through the active channel (official installer RPC or gateway patch `disabled` row); takes effect after the host restart.
- `onChange(cb): () => void` — subscribe to successful mutations; fires after `install()`, `update()`, `uninstall()`, or `setEnabled()` resolves, and returns the unsubscribe function.

The contract source of truth is `src/core/service.ts` (`PluginManagerService`). The service is provided for the plugin's lifetime and disappears when the plugin is unloaded. The service and the update block share one face, so `onChange` subscribers observe the same mutations.

## Known limitations

- Loopback-only: on a LAN or remote browser the update block renders a local-only notice (the same boundary the official installer page enforces; the gateway refuses non-loopback requests with 403).
- On the npm-published web runtime, gateway writes go through the official CLI. The gateway resolves `dsh` from the host process PATH first, then from `node_modules/.bin` project roots above the running host entry, then from the running host package's own `lib/bin.js`, and finally from the packaged Desktop install's own CLI launcher under the Electron resource directory (`runtime/cli/bin/dsh.cmd` on Windows, `runtime/cli/bin/dsh` elsewhere) — the last one covers a packaged Desktop, where the host runs from inside `app.asar`, the private host package ships no `lib/bin.js`, every `.bin` shim directory is stripped from the installer, and the launcher puts only the bundled `node` on the host's PATH. A Node-script CLI (an npm or homebrew shim, a `.bin` symlink, a `lib/bin.js`) runs under an interpreter resolved without PATH: the `node` installed beside the CLI when the installation ships one, otherwise the host's own interpreter. The CLI's own directory goes first on the child PATH, so the `dsh plugin` run finds the pnpm installed beside it. If no source contains the CLI, CLI-backed writes remain unavailable — an application-owned profile writes through the official in-process manager and needs no binary, so its install, update and removal routes never demand one. CLI output is decoded as bytes in one pass, so a Windows console's code page (CP936/GBK) renders as readable text instead of replacement characters. Installs of git sources can take minutes and run as background jobs. Gateway updates apply only to npm registry sources, resolve the latest version on the host, and succeed only after the same installed package reports that exact version.
- An application-owned profile (the packaged Desktop client) runs installs, updates and removals through the official in-process plugin manager the host mounts, the same writer that profile's official Plugins page drives: the CLI refuses `--profile desktop` outright, and the launcher hands that manager its bundled package-manager invocation. The job, its status polling and its verification are identical to the CLI path — an install must add a dependency the profile did not carry, a removal must drop one, and an update must still report the version the route resolved — while the CLI-specific guards (duplicate-mount stripping, insert-row and boot preflight) stay with the CLI writer, because there the official manager validates and applies the bundle itself. The manager's own verdict is read before the profile is: it resolves a refused run with `application: 'failed'` instead of rejecting, so the job reports that run's real reason (the pnpm diagnostic, or the packages an incompatible-version refusal names) rather than a no-op after an unchanged profile. Every other runtime keeps the CLI as the single writer of installs, updates and removals.
- Compatibility gating applies only when the target manifest declares a minimum DSH version; packages without `dsh.engines.dsh` update unchecked, and official-installer runtimes (DSHCode and the checkout web) are not gated here because their updates go through the official installer. The running DSH version is read from the installation's own `@deepseek-ai/dsh` manifest, which the launcher publishes as the profile's install anchor — no subprocess, no PATH, and therefore an answer on a packaged Desktop host — with `dsh --version` kept as the fallback for a runtime that publishes no anchor. A requirement the host cannot verify at all is reported as unverified rather than as a version below the minimum: both hold the update back, but only the second sends the user to upgrade DSH.
- Enablement on the npm runtime reports the effective next-start value: a profile override row wins where present, otherwise the installed bundle's own `disabled` rows decide (the aggregate's inactive-by-default families), and rows no layer mentions are enabled. Enabling a row the bundle disables writes an explicit `disabled: false` override, because deleting the user row would only restore the bundle default; the runtime's loader honors these rows at the next start, but this path is less exercised than the official desktop writer's.
- Restart is explicit, user-clicked and three-mode. The route is method-aware: `GET /api/plugin-manager/restart` reads the plan (no side effects, so a prefetch or a typed URL can never stop a host) and `POST` carries it out; every other method is refused with 405. The toolbar reads the plan first, so the confirmation names the same consequence the host will produce. On a terminal launch (`dsh web`) the host starts a detached helper that waits for the outgoing process to exit and then re-executes the same command line, so the port is free before the replacement binds it, and the replacement's output goes to `$DSH_HOME/logs/plugin-manager-restart.log`. Under the packaged Desktop app the plugin cannot relaunch anything — Electron owns the process tree, a detached respawn would fight the shell for the same port, and the shell's own recovery dialog is the only restart it offers — so that confirmation says what its dialog does before running it: confirming stops the host, the shell shows its error-titled dialog, and the dialog's Restart finishes `app.relaunch()` (a crash report is written with it); the manual way out, quitting DeepSeek Harness and opening it again, is named beside it. A launch with no terminal (a supervisor, an editor task) is left running and the toolbar says to restart manually. Without a restart, updated plugin code is loaded at the next start.
- On the npm runtime, duplicate insert-id claims are detected after install and the new plugin is rolled back automatically (a shared id can never be `disabled` away: the loader's duplicate check has no disabled exemption).
- The npm runtime's boot preflight (`--dump-config`) catches composition failures, and the static insert check catches insert rows naming packages that resolve nowhere; runtime import/apply failures still surface only at the next real start.
- Duplicate-mount safeguard (gateway mode): the official CLI's bundle reconciliation re-adds every bundle-declaring dependency to `dsh.profile.bundles` after any install/remove — including packages the composition already mounts through a patch row (a bundle that mounts an external plugin by row), which would double-mount and fail the next boot (`duplicate prefix route`). After every successful CLI mutation the gateway strips exactly the newly added, already-row-mounted bundles entries back out (the manifest write goes through backup + tmp + atomic rename), reports one notice per stripped entry on the job result, and leaves normal installs' bundles entries — and every entry the user had before — untouched.
- The wire shapes mirror the official installer protocol; on drift the tolerant parsers degrade to error rows rather than misbehaving.

## Security model

- Trust boundary is the loopback fence: every gateway route requires a loopback socket address, a loopback Host header, and a non-cross-site origin (socket + Host + Origin + `sec-fetch-site`), the same authority the official installer channels enforce. There is no browser-reachable path from a remote origin; rejected requests receive HTTP 403 with `{ ok: false, error: "forbidden: loopback-only" }`.
- Mutation routes (install / update / remove / set-enabled / restart) carry no token: the loopback authority *is* the local user, matching the official channels. The restart route is the one route whose effect is process-level: it never invents a command line (it re-executes this process's own `execPath` + argv, dropping inspector flags), it refuses to relaunch anything it cannot identify as a terminal launch, and under the packaged Desktop app it only stops this process so the shell decides what happens next. Any local process can therefore drive plugin installs and removals, and npm installs run package install scripts — treat the gateway as local code execution by design and never expose it beyond loopback.
- Install specs and package ids are rejected when they contain command-shell expansion characters or control characters. On Windows, npm shims are resolved to `node.exe` plus the package `bin.js`; packaged Desktop shims have no adjacent npm layout, so they run through `cmd.exe /d /s /c` with a pre-quoted, verbatim argument envelope. Desktop profile discovery reads the packaged launcher's profile environment value or persisted profile selection, and application-owned profile installs, updates and removals run in the host half through the mounted official `pluginManager` service — the same writer that profile's official Plugins page drives through its own RPC face — under the same loopback fence and user click.
- Mutations are serialized through one queue, so concurrent jobs never interleave their before/after profile captures. An install is only `done` when the new dependency actually landed in the profile (and a removal only when it is gone); a success exit code alone is never trusted.
- Enablement re-reads the current profile manifest under that mutation queue and rejects stale or unknown package ids with `404` before writing, so a panel row left behind by an uninstall cannot create an orphan `disabled` override.
- Conflict handling is owner-aware: a duplicate entry id or an insert row naming an unresolvable package rolls the *new* package back through the official remove path. The gateway never writes `disabled` rows for a shared id (such rows cannot stop the loader's duplicate check and would flag the existing owner).
- The boot preflight (`--dump-config`) composes patch layers without importing entries: it catches composition failures, not import-time failures, which still surface at the first real boot.
- The boot profile resolves from `--profile`, then the launched profile the Host publishes on `profileContext`, then the profile directory the packaged launcher carries in its own argv (Electron strips exec switches, so the desktop host sees its profile directory positionally), then `DSH_PROFILE`, then the `web` subcommand, then the packaged app's persisted selection. The published profile outranks the variable because the packaged Desktop client exports neither and a global `DSH_PROFILE` workaround can name a profile the running Host never reads.
- The launched profile the Host publishes is foreign input: its name is traversal-checked, its directory must be an absolute traversal-free path, and its patch path is accepted only when it is that profile's own `cordis.patch.yml` — the patch path is a write target. Patch writes go through a backup copy plus tmp-write + atomic rename (`cordis.patch.yml.bak-plugin-manager`).
- The duplicate-mount safeguard writes only the profile manifest's `dsh.profile.bundles`, under the same backup + tmp-write + atomic-rename discipline as patch writes (`package.json.bak-plugin-manager`). It removes only entries the CLI just added that duplicate an existing patch-row mount, and a failed safeguard write fails the job visibly rather than silently leaving a boot-breaking state.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.

## License

BSD-3-Clause.
