# Agent Note: task-board session/list treats the qualified service-unavailable code as retryable

Status: implemented

## Problem

On the alpha.2 host, `dsh web` booted but the task-board logged `[dsh-task-board] session/list failed; treating the host session roster as unknown` with `code: 'gateway/service-unavailable'`. The `sessionController` service activates behind a long inject chain, so the first `session/list` poll at plugin start races it. The task-board's `isServiceUnavailable` compared the error code to the bare `'service-unavailable'`, but the alpha.2 gateway emits the namespace-qualified `'gateway/service-unavailable'`; a string mismatch meant the race was never retried and the board degraded to "roster unknown" every boot.

## Decision

`isServiceUnavailable` now recognizes both the qualified (`gateway/service-unavailable`) and bare (`service-unavailable`) forms, so a provider that is merely slow to activate is retried (5 attempts, 2s backoff) instead of permanently degraded. Verified: after the fix the alpha.2 host boots without the warning.
