# @linxin666/dsh-client-ui-plugin-manager

English | [中文](README.zh.md)

Plugin manager tab for the dsh web GUI Plugins settings section: installs plugins from npm or git, lists installed plugins with next-start enable switches, surfaces install-time conflict actions with undo, and hands failures off to repair conversations.

## What it does

- Registers a `Plugin manager` tab in the official Plugins settings section (the `settings.plugins.tab` slot, order 20), next to the official installer tab.
- Dual-channel transport: on runtimes with the official installer services (DSHCode and the 1.0.4 checkout web), every operation rides the official `/plugin-installer` and `/plugin-control` loopback RPC channels; on the npm-published web runtime those channels do not exist, so the package's host half mounts a loopback-fenced HTTP gateway that spawns the official `dsh plugin` CLI for installs/removals (the single writer) and writes `disabled` override rows for enablement.
- Installs plugins from an npm package name or a git repository URL, with progress.
- Lists installed user plugins with next-start enable switches, update checks (registry, npm sources), verified npm updates, and uninstall.
- Verifies DSH runtime compatibility before npm updates (issue #754): update checks read the declared minimum DSH version from the latest manifest (`dsh.engines.dsh` with a top-level `engines.dsh` fallback), show the requirement beside the update button, disable the button when the running DSH is below it, and the host update route returns 412 before starting any CLI job when the runtime cannot be verified.
- Shows the built-in product switches when the official plugin-control surface exists.
- Surfaces install-time conflict actions: the product-snapshot diff around each install (official mode) or the profile layer diff around each CLI run (gateway mode), with undo for reversible actions and an `Ask the agent to fix` handoff on every conflict row.
- Protects the next boot on the npm runtime: after each install the gateway verifies the dependency actually landed, rejects duplicate entry-id claims and insert rows naming unresolvable packages, and composes the profile with the CLI's `--dump-config` preflight; a conflicting or failing install is rolled back through the official remove path (the existing plugins are never touched), with the error and repair handoff on the error row.
- Renders the boot-failure ring per plugin with `Ask the agent to fix` (a repair conversation over the plugin install root) and `Copy error`; the npm web runtime keeps no failure ring, so only install errors offer the repair handoff there.
- Shows the host's safe-mode banner and the `Restore normal mode` affordance (the web build applies it at the next manual restart).

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-plugin-manager
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-manager
```

Restart `dsh web`; the tab appears in the settings page's Plugins section.

## Config

The tab carries no configuration namespace. Enablement switches and installs apply at the next restart.

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

The contract source of truth is `src/core/service.ts` (`PluginManagerService`). The service is provided for the plugin's lifetime and disappears when the plugin is unloaded. The service and the Plugin manager tab share one face, so `onChange` subscribers observe mutations from both.

## Known limitations

- Loopback-only: on a LAN or remote browser the tab renders a local-only notice (the same boundary the official installer tab enforces; the gateway refuses non-loopback requests with 403).
- On the npm-published web runtime, gateway writes go through the official CLI. The gateway resolves `dsh` from the host process PATH first and then from `node_modules/.bin` project roots above the running host entry, which covers local-wrapper and npx launches. If neither source contains the CLI, writes remain unavailable. Installs of git sources can take minutes and run as background jobs. Gateway updates apply only to npm registry sources, resolve the latest version on the host, and succeed only after the same installed package reports that exact version.
- Compatibility gating applies only when the target manifest declares a minimum DSH version; packages without `dsh.engines.dsh` update unchecked, and official-installer runtimes (DSHCode and the checkout web) are not gated here because their updates go through the official installer.
- On the npm-published web runtime there is no boot-failure ring and no safe mode: those surfaces degrade to empty, and only install errors offer the repair handoff.
- Enablement on the npm runtime writes bare `disabled` override rows into the profile's cordis.patch.yml; the runtime's loader honors them at the next start, but this path is less exercised than the official desktop writer's.
- The web build has no in-place restart: changes apply at the next manual restart.
- Install-time conflict detection reports what the install actually changed (product rows in official mode, profile rows and bundle entries in gateway mode). On the npm runtime, duplicate insert-id claims are detected after install and the new plugin is rolled back automatically (a shared id can never be `disabled` away: the loader's duplicate check has no disabled exemption); on official runtimes the host's own rules and the boot-failure ring own that case.
- The npm runtime's boot preflight (`--dump-config`) catches composition failures, and the static insert check catches insert rows naming packages that resolve nowhere; runtime import/apply failures still surface only at the next real start, where official runtimes keep the failure ring and the npm runtime does not.
- Duplicate-mount safeguard (gateway mode): the official CLI's bundle reconciliation re-adds every bundle-declaring dependency to `dsh.profile.bundles` after any install/remove — including packages the composition already mounts through a patch row (the family aggregate mounts `dsh-better-sidebar` as a row), which would double-mount and fail the next boot (`duplicate prefix route`). After every successful CLI mutation the gateway strips exactly the newly added, already-row-mounted bundles entries back out (the manifest write goes through backup + tmp + atomic rename), reports one notice per stripped entry on the job result, and leaves normal installs' bundles entries — and every entry the user had before — untouched.
- The wire shapes mirror the official installer tab protocol; on drift the tolerant parsers degrade to error rows rather than misbehaving.
- The repair conversation's workspace keeps its path-derived default title.

## Security model

- Trust boundary is the loopback fence: every gateway route requires a loopback socket address, a loopback Host header, and a non-cross-site origin (socket + Host + Origin + `sec-fetch-site`), the same authority the official installer channels enforce. There is no browser-reachable path from a remote origin; rejected requests receive HTTP 403 with `{ ok: false, error: "forbidden: loopback-only" }`.
- Mutation routes (install / update / remove / set-enabled) carry no token: the loopback authority *is* the local user, matching the official channels. Any local process can therefore drive plugin installs and removals, and npm installs run package install scripts — treat the gateway as local code execution by design and never expose it beyond loopback.
- Install specs and package ids are rejected when they contain command-shell expansion characters or control characters. On Windows, npm shims are resolved to `node.exe` plus the package `bin.js`; packaged Desktop shims have no adjacent npm layout, so they run through `cmd.exe /d /s /c` with a pre-quoted, verbatim argument envelope. Desktop profile discovery reads the packaged launcher's profile environment value or persisted profile selection, and its in-process official installer is confirmed through the browser RPC capability probe.
- Mutations are serialized through one queue, so concurrent jobs never interleave their before/after profile captures. An install is only `done` when the new dependency actually landed in the profile (and a removal only when it is gone); a success exit code alone is never trusted.
- Enablement re-reads the current profile manifest under that mutation queue and rejects stale or unknown package ids with `404` before writing, so a panel row left behind by an uninstall cannot create an orphan `disabled` override.
- Conflict handling is owner-aware: a duplicate entry id or an insert row naming an unresolvable package rolls the *new* package back through the official remove path. The gateway never writes `disabled` rows for a shared id (such rows cannot stop the loader's duplicate check and would flag the existing owner).
- The boot preflight (`--dump-config`) composes patch layers without importing entries: it catches composition failures, not import-time failures, which still surface at the first real boot.
- The profile name (from `--profile` / `DSH_PROFILE`) is validated against path traversal before any file is touched; patch writes go through a backup copy plus tmp-write + atomic rename (`cordis.patch.yml.bak-plugin-manager`).
- The duplicate-mount safeguard writes only the profile manifest's `dsh.profile.bundles`, under the same backup + tmp-write + atomic-rename discipline as patch writes (`package.json.bak-plugin-manager`). It removes only entries the CLI just added that duplicate an existing patch-row mount, and a failed safeguard write fails the job visibly rather than silently leaving a boot-breaking state.

## License

BSD-3-Clause.
