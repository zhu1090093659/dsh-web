# Agent Note: SSH ProxyCommand Child stdin EPIPE and Context Preservation Fix

Status: implemented

## Problem

Under Linux (Ubuntu runner) in GitHub Actions CI, the test `surfaces a failing ProxyCommand instead of waiting for the handshake timeout` in `packages/dsh-ssh` failed with:
1. An `Unhandled error: Error: write EPIPE` emitted from `packages/dsh-ssh/src/engine/proxy-command.ts:127:13`. The implementation only listened to `'error'` on `child.stdout` and `child`, leaving `child.stdin` without an `'error'` listener. In Node.js, writing to a closed pipe emits an `EPIPE` event on `stdin`, which escalates to an unhandled exception if no listener is present.
2. In `Duplex.write`, the raw system error `Error: write EPIPE` was forwarded directly to the callback without wrapping. This caused test assertions expecting `/ProxyCommand/` to fail (`expected [Function] to throw error matching /ProxyCommand/ but got 'write EPIPE'`), and masked the subprocess's real exit code and stderr diagnostics (such as `/bin/sh: 1: definitely-not-a-real-binary-xyz: not found`).

## Decision

1. **Attach Error Listener on `child.stdin`**:
   - Added a listener on `child.stdin?.on('error')` to intercept broken pipe errors (`EPIPE`) when the child process exits early.
   - When triggered, if the child has already exited, extract the exit status (code / signal) and stderr immediately.

2. **Wrap Error Context and Harmonize Exit Timing in `Duplex.write` and `final`**:
   - In `write(chunk, _encoding, callback)`, if `stdin.write` reports an error, check if the child has already exited. If an exit is in flight, attach a temporary `child.once('exit')` with a short grace timer to capture the actual exit status and stderr instead of an unhelpful `write EPIPE`. If timeout expires without an exit, safely wrap the error as `ProxyCommand transport write failed: <message>`.
   - In `final(callback)`, wrap any error from `stdin.end` as `ProxyCommand transport close failed: <message>`.
   - In `child.stdout?.on('error')`, prefix errors with `ProxyCommand stdout error:`.

3. **Add Test Coverage**:
   - In `packages/dsh-ssh/tests/proxy-command.test.ts`, added a test case writing into a dying/dead proxy command process to verify that no unhandled exceptions are raised and the resulting error retains `ProxyCommand` context.

## Testing

- `pnpm --filter @linxin666/dsh-ssh test`: 22 test files passed (182 passed).
- `pnpm typecheck`: all 22 packages passed.
- `pnpm test`: full workspace test suite passed.
- `pnpm docs:check && pnpm i18n:check && pnpm test:scripts`: passed.
- `pnpm skin-center:check && pnpm aggregate:check && pnpm runtime-deps:check`: passed.
