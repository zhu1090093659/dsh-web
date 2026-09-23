# Agent Note: Mandatory target selector guard for ssh_cluster (Issue #1417)

Status: implemented

## Problem

In `dsh-ssh`, `ssh_cluster` previously allowed execution with completely empty filter parameters (`aliases`, `environment`, and `tags` all omitted or empty). In this state, the engine, HTTP route, and agent tool defaulted to targeting **all configured SSH hosts**.

When controlled by an autonomous AI agent, if the model inadvertently omitted selector parameters or experienced context confusion, destructive or state-changing shell commands would be broadcast concurrently across every remote server in the inventory (including production systems) without any confirmation or limitation.

## Decision

We enforced defense-in-depth target filtering across all layers:

1. **Engine Layer (`src/engine/cluster.ts`)**:
   - `cluster()` checks that at least one of `aliases` (non-empty strings), `environment` (non-empty string), or `tags` (non-empty strings) is present.
   - Throws `Error('ssh_cluster requires aliases, environment, or tags to limit the target set')` if all selectors are empty.
2. **HTTP Route Layer (`src/routes.ts`)**:
   - `/api/dsh-ssh/cluster` validates the selectors before calling the engine, responding with `400` and the same error message when omitted.
3. **Agent Tool Definition (`src/tools.ts`)**:
   - Updated `ssh_cluster` description and parameter docstrings to explicitly state that at least one filter (`aliases`, `environment`, or `tags`) is required.
   - Guarded `execute` to reject calls lacking a non-empty selector before invocation.
4. **Guidance and UI Copy (`src/index.ts`, `locales.ts`, and `dsh-i18n`)**:
   - Updated `SSH_GUIDANCE` to describe the mandatory selector requirement.
   - Aligned UI label/placeholder `cluster.aliases` across Chinese, English, and Russian dictionaries to indicate that at least one filter must be specified.

## Testing

- Updated `packages/dsh-ssh/tests/engine-cluster.test.ts`: added test case verifying rejection when no selectors are provided, and updated `maxWorkers` test cases with explicit alias selectors.
- Updated `packages/dsh-ssh/tests/routes.test.ts`: added tests verifying 400 rejection on empty selector and 200 response on valid selector.
- Updated `packages/dsh-ssh/tests/tools.test.ts`: added tests verifying tool-level rejection on empty selector and documentation string assertions.
- All 20 test suites and 155 unit tests in `dsh-ssh` pass.
- Verified repository gates: `pnpm typecheck`, `pnpm i18n:check`, `pnpm docs:check`, `pnpm skin-center:check`, `pnpm aggregate:check`.

## Consequences

Accidental full-fleet execution by AI agents or web callers is prevented. Callers wishing to run commands across hosts must explicitly specify their target scope via aliases, environment, or tags.
