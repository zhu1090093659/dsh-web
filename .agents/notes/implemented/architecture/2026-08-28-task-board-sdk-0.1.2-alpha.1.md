# Agent Note: Task board SDK 0.1.2-alpha.1 migration

Status: implemented

## Problem

The approved SDK cohort removes the legacy Host API proxy and client runtime surfaces. The task board's execution, settings, and client option wiring therefore cannot typecheck or operate against the selected runtime until its imports, service injections, gateway protocol, and tests use the replacement contracts.

## Decision

Migrate only `packages/dsh-task-board` to the approved official SDK cohort `0.1.2-alpha.1`. Host execution uses the injected `TypertGateway` and `workspaceRegistry`; browser execution-target data uses the assembled Client Remote, Session and Workspace client services, and the official store/settings modules.

The Host runner dispatches unary methods through gateway namespaces and consumes direct business results. It opens `session/follow` through `TypertGateway.stream()`, consumes the opening snapshot, closes that short-lived iterator, and pages backward with the returned cursor to settle executions.

## Alternatives considered

Retaining `@deepseek-ai/dsh-host-apiproxy` or `@deepseek-ai/dsh-client-runtime` loses because those modules are deleted from the approved cohort.

Calling `session/follow` through `invoke()` loses because stream remotes are rejected on the unary carrier; the runner uses `stream()` instead.

Adding a workspace list RPC loses because the approved Host workspace API has no such RPC; the injected `WorkspaceRegistry.list()` is authoritative.

## Consequences

Session create, rename, prompt, list, and page calls are dispatched as `{ namespace, method, args: { request } }`; `agentPresets/list` uses an empty args object and returns the direct roster.

Workspace validation is local to the Host registry, whose rows use `id`; browser workspace rows continue to use `workspaceId`.

The package-local generated settings-form copy is adapted directly because this migration is intentionally scoped away from `shared/`; it must not be regenerated from the old shared source as part of this change.

The client preset roster uses `remote.agentPresets.list()`, which returns a `RemoteResult`; a failed roster read leaves the previous picker options in place.

## Testing

The task-board typecheck, full Vitest suite, tsdown build, and scoped `git diff --check` pass. The full suite reports 25 passed and 1 skipped test file (239 passed and 1 skipped tests).
