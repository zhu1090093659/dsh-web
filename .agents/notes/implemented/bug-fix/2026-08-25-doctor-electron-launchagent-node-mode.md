# Agent Note: Doctor Electron LaunchAgent Node Mode

Status: implemented

## Problem

On macOS, DSH Desktop hosts Harness in an Electron utility process. Doctor therefore sees the Electron Helper as `process.execPath`, while the live Harness process relies on `ELECTRON_RUN_AS_NODE=1` to make child invocations use Node semantics. Doctor persisted the Helper path in `com.dsh.doctor.plist` but only persisted `DSH_DOCTOR_HOME`; launchd later started the Helper without Node mode. The Helper entered Electron startup, crashed with `EXC_BREAKPOINT` / `SIGTRAP`, and `KeepAlive` repeated the failure roughly every ten seconds. The repeated launches could steal focus from the user's current application.

## Decision

The macOS service adapter now preserves `ELECTRON_RUN_AS_NODE=1` in the LaunchAgent whenever the installing Doctor CLI inherited that flag. A normal Node-hosted installation does not add the variable. The existing idempotent service deployment replaces an affected plist and restarts the Supervisor, so the repaired definition is applied during Doctor reconciliation.

## Alternatives considered

- **Detect Electron from the executable filename or bundle path**: Helper names and application paths vary between development, packaged, and rebranded builds. Preserving the explicit runtime flag is a stronger signal than path heuristics.
- **Always set `ELECTRON_RUN_AS_NODE=1` on macOS**: harmless for a real Node executable in current environments, but it adds an Electron-specific contract where none is required. Conditional propagation keeps ordinary Node services unchanged.
- **Make DSH Desktop rewrite third-party LaunchAgents**: the service definition belongs to Doctor. Repairing it at the owner avoids Desktop-specific knowledge of one plugin and also covers other Electron-hosted Harness distributions.

## Consequences

Doctor Supervisors installed from Electron-hosted Harness processes start as Node programs instead of entering Electron startup. Existing affected installations are repaired when Doctor's normal ensure flow redeploys the service. Users who removed the plugin before receiving the fix still need to unregister the orphaned LaunchAgent because the package code is no longer present to reconcile it.

## Testing

The service adapter tests cover propagation when Electron Node mode is present and omission for a normal Node installation. Package typecheck, test, and build gates validate the shipped source and CLI bundle.
