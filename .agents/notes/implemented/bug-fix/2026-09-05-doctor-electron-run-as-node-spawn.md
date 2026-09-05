# Agent Note: Doctor children spawn with ELECTRON_RUN_AS_NODE

Status: implemented

## Problem

Issue #1382: on DSH Desktop 2.0.4/2.0.5 with dsh-web-all 0.3.16, the DSH window was raised and focused roughly every half minute. The reporter's process logs showed a new `DSH Desktop.exe` process carrying `cli.mjs supervisor --parent-pid <pid>` every few seconds, `deployed.json` kept reporting "supervisor is not provisioned", and `reconcile.lock` was refreshed about every 25 seconds. Disabling the doctor plugin stopped the loop.

The doctor host half runs inside the desktop's embedded host process, where `process.execPath` is the desktop GUI binary (an Electron executable). The doctor's `defaultSpawnSupervisor` spawned that binary with `env: process.env`, so under an Electron host the spawn booted a second GUI instance instead of a headless Node child: the single-instance lock refused it, the main window was restored and focused through the `second-instance` handler, and the child exited immediately without ever answering IPC. The heartbeat failure path re-kicked the auto-ensure reconciler, which spawned again — a focus-stealing loop with the supervisor permanently unprovisioned. The capsule `provision` child in `ensureDoctor` had the same flaw.

## Decision

`packages/dsh-doctor` derives every Node child through `nodeChildEnv()` (`host/ensure.ts`), which spreads the host environment and forces `ELECTRON_RUN_AS_NODE: '1'`:

- `defaultSpawnSupervisor` spawns the supervisor child with that environment;
- the capsule `provision` child in `ensureDoctor` receives it through the spawn seam's `env` option.

A real Node binary ignores the variable, so plain `dsh web` deployments are unaffected; an Electron binary runs the child as pure Node — no window, no single-instance interaction, and the supervisor can actually answer.

Defense in depth in the desktop shell: `desktop/src/runtime.cjs` gains the pure predicate `isProgrammaticLaunch(argv)`, and `desktop/src/main.cjs` no longer restores or focuses the main window for `second-instance` launches whose argv marks a programmatic spawn (`cli.mjs`, `supervisor`, `provision`, `--parent-pid`). A genuine user double-click carries no arguments and still raises the window.

## Testing

- `packages/dsh-doctor/tests/host-ensure.spec.ts` covers `nodeChildEnv`, asserts the supervisor child is spawned with `ELECTRON_RUN_AS_NODE: '1'` and the parent-pid argv, and asserts the provision spawn receives the same environment.
- `desktop/tests/runtime.test.mjs` covers `isProgrammaticLaunch` for user launches versus doctor and CLI child spawns.

## Alternatives considered

- Fixing only the desktop shell's `second-instance` handler: leaves every other Electron-based host shipping the plugin with the same spawn loop, and the supervisor still dies on the single-instance lock without ever provisioning.
- Resolving a real Node binary from PATH instead of `process.execPath`: fragile across packaging layouts (the desktop runtime directory, npm shims, GUI launchers with a minimal PATH) and unnecessary given `ELECTRON_RUN_AS_NODE`.

## Consequences

- Doctor children inherit `ELECTRON_RUN_AS_NODE=1`; a grandchild spawned by the supervisor that should run the desktop GUI binary as an app would also run as Node. Current children spawn the real `dsh` CLI or OS tools only, so this is the desired behavior.
- The shell guard matches on argv substrings; a programmatic launch that changes its argument spelling must update `PROGRAMMATIC_LAUNCH_MARKERS` in `runtime.cjs`.
- The shell-side guard reaches users only with the next packaged desktop build; the plugin-side fix rides the normal npm release and needs the desktop host to reload the bundle.
