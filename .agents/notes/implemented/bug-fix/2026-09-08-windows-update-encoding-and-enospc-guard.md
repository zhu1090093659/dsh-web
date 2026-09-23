# Agent Note: Windows Update Encoding Fallback and Scheduler ENOSPC Guard

Status: implemented

## Problem

Two distinct defects affected production stability on desktop/server environments:

1. **Issue #1430**: In Windows localized (e.g. Chinese) environments without `pnpm` in PATH, the update flow in `@linxin666/dsh-remote-web-ui` reported "pnpm exited with code 1" with completely garbled (U+FFFD replacement) stderr text. The missing shim was never detected because `WIN_CMD_MISSING_RE` only tested the English `'not recognized as an internal or external command'`, while localized cmd prints `'不是内部或外部命令'`. Furthermore, the child process output was hard-decoded with UTF-8, destroying Windows CP936/GBK bytes into replacement characters, and candidate errors always blamed `pnpm` regardless of whether `corepack` or `npx` failed.
2. **Issue #1427**: When disk space was exhausted (`ENOSPC`), `@linxin666/dsh-client-ui-task-board`'s periodic scheduler tick failed to write `scheduler-v2.json`. The subsequent `console.error` call in the catch block wrote to redirected stderr (`SyncWriteStream`), which also failed with `ENOSPC`. Without an `'error'` event listener on `process.stderr`, Node.js emitted an unhandled error event (`node:events throw er`), crashing the entire DSH host process.

## Decision

1. In `packages/dsh-remote-web-ui/src/update.ts`:
   - Added tolerant decoding (`decodeProcessChunk`) which tries UTF-8 first and falls back to GBK (`new TextDecoder('gbk')`) on invalid byte sequences.
   - Expanded `WIN_CMD_MISSING_RE` to match both English and Chinese command-not-found patterns, and also recognized Windows exit code 9009 as command-not-found.
   - Attributed non-zero exit error messages to the actual candidate command rather than hardcoding `pnpm`.
2. In `packages/dsh-task-board/src/host-service.ts`:
   - Added `installStreamErrorGuards()` attached to `process.stderr` and `process.stdout` so unhandled stream errors cannot crash the process.
   - Added `safeConsoleError()` wrapper with try/catch to safely log diagnostic errors even under broken streams or full disks.
   - Used `safeConsoleError` across all async failure paths (`scheduleTick`, `schedulePoll`, `scheduleLaunch`).
3. In `packages/dsh-task-board/src/host-ledger.ts`:
   - Cleaned up stale orphaned `*.tmp-*` files on startup.
   - Swallowed `ENOSPC` during heartbeat sidecar writes in `setScheduler` while keeping the in-memory timestamp updated.

## Alternatives considered

- In `update.ts`, run `chcp 65001` before executing candidates. Rejected: `spawn` with `shell: true` would require compound command string construction, risking quoting and platform compatibility regressions.
- In `task-board`, rely only on `try/catch` around `console.error`. Rejected: `SyncWriteStream` under redirected file outputs in Node.js emits stream-level `'error'` events when unhandled; installing stream error guards guarantees process survival.

## Consequences

- On Windows, missing commands in update candidates fall back cleanly to `corepack` and `npx`, and error output renders legible Chinese rather than garbled characters.
- On low/zero disk space environments, task-board heartbeat failures no longer trigger cascading crashes of the DSH host process.

## Testing

- Unit tests in `packages/dsh-remote-web-ui/tests/update.spec.ts` verify GBK decoding, localized Chinese command missing fallback, and exit code 9009.
- Unit tests in `packages/dsh-task-board/tests/host-ledger.spec.ts` and `host-service.spec.ts` verify startup tmp cleanup, ENOSPC heartbeat degradation, and stream error guards.
