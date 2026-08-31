# Agent Note: Task-board roster poll rides out the boot-time service window

Status: implemented

## Problem

On the 0.1.2-alpha.1 host the session tree activates `sessionController` only after its nine inject services resolve (`agentDefaultModel`, `agents`, `attachments`, `llm`, `sessions`, `sessionProjections`, `sessionQuery`, `typert`, `workspaceRegistry`), while `TaskBoardHostService.start()` fires the first roster poll immediately during plugin start. The first `session/list` therefore fails with the gateway's `service-unavailable` and every boot printed a stack-trace-level `console.error` ("treating the host session roster as unknown") even though the 5-second poll recovered on its next tick.

## Decision

`HostExecutionRunner.listRunning` retries `session/list` while the gateway reports `code: 'service-unavailable'`: up to `SERVICE_UNAVAILABLE_ATTEMPTS` (5) attempts with a 2-second backoff, both overridable through a new optional constructor option `unavailableRetry` for tests and embedders. Retrying stays scoped to that error code — descriptor mismatches and every other failure keep the previous single-shot semantics (one `console.error`, roster unknown). Exhausting the window logs the same error once and returns `{ known: false }`, so the degraded-state contract is unchanged; the boot race now resolves silently with a known roster.

## Alternatives considered

- Delay the first poll by a fixed number of seconds — a blind wait that still races on slow machines and slows every start.
- Declare an inject wait on `sessionController` in the task-board entry — the exact anti-pattern removed for `remote.agentPresets` (see [client-store-dual-cohort-engine-shim](2026-08-28-client-store-dual-cohort-engine-shim.md)): a hard wait pends the whole entry forever on hosts that never activate the service.
- Leave it as-is — the roster does recover on the next tick, but every boot logs a stack-trace error that reads as a breakage.

## Consequences

- A genuinely unavailable session tree now costs one poll up to ~10 seconds before the roster is declared unknown; the poll-in-flight guard prevents overlapping retries.
- The retry window is observable through the constructor option and covered by unit tests; non-unavailable errors are never retried.

## Verification

- `pnpm test` in `packages/dsh-task-board`: 243 passed (two new cases: retry-then-known with a single `service-unavailable` failure, and exhaustion after the configured attempts with exactly one log line), plus `pnpm typecheck` clean.
