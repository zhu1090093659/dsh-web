# Agent Note: Isolated browser-view CDP self-healing and Windows child cleanup

Status: implemented

## Problem

Issue #2051 reported four reliability gaps in `packages/dsh-browser-view` when running browser tools under `isolated` mode:

1. **Silent CDP write failures left a half-dead session pinned.** `CdpClient.send()` only rejected the single in-flight call when `socket.send` reported an error without failing queued calls, marking `closed = true`, or tearing down the socket, so `BrowserViewService` kept treating the dead session as healthy on subsequent calls.
2. **Mid-command socket drops failed the user call directly.** Even when a reused transport died during an action (`navigate`, `click`, `type`, `press`, `scroll`, `snapshot`, `screenshot`), callers received the raw socket failure instead of replacing the dead session and replaying once.
3. **Child exit lag and Windows lingering child processes.** Isolated Chromium child exits did not eagerly close `CdpClient`, `running`/`state()` could report a dead transport as live before `listTabs()` or `dispose()` ran, and `terminate()` on Windows called `child.kill()` only on the parent PID, leaving GPU/Crashpad helpers locking the temp profile directory.
4. **Transient isolated launch failures and locked temp profiles.** Single-shot startup hiccups immediately surfaced errors, and `removeTempProfile()` failed on locked files without brief backoff retries.

## Decision

1. **Immediate write-error teardown in `CdpClient` (`src/core/cdp.ts`).** On a `ws` send callback error, call `failAll('the DevTools socket write failed: ' + error.message)` and close `this.socket`, flipping `closed` immediately so `requireSession()` replaces the transport.
2. **Process exit hook and Windows tree cleanup (`src/core/chrome.ts`, `src/host/service.ts`).**
   - Add `ChromeProcess.onExit(listener)` and wire `openIsolatedSession` so child exit immediately calls `cdp.close()`.
   - Update `terminate()` on `win32` to run `killProcessTreeWin32(child.pid)` (`taskkill /PID <pid> /T /F`) before fallback `child.kill()`.
   - Add short backoff retries (`[50, 150, 350]` ms default `retryDelaysMs`) around transient `EBUSY`/`EPERM`/`ENOTEMPTY` directory removals in `removeTempProfile()`, preserving the symlink/junction safety walk instead of `fs.rm({ recursive: true })`.
3. **Live-transport gating, single startup retry, and in-flight replay (`src/host/service.ts`).**
   - Make `running` and `state()` require `!this.session.transport.closed`.
   - Have `listTabs()` in `isolated` mode drop and dispose an already-closed session and broadcast state without cold-starting a new browser.
   - Retry `startSession()` once in `isolated` mode on non-missing-binary launch errors (`!/No Chrome binary found/i.test(message)`).
   - Wrap public action paths (`tabFor`, `ensureTab`, `navigate`, `click`, `type`, `press`, `scroll`, `snapshot`, `screenshot`) in `runWithSession()`: if `session.transport.closed` became true during the failure and the service is not disposed, call `requireSession()` to replace the dead session and replay the operation once.

## Alternatives considered

- **Opening a fresh WebSocket or Chromium process blindly before every tool call.** Rejected: cold-launching Chromium per action ruins latency and breaks tab bindings, session cookies, and screencast continuity. Reusing a live session and recycling only on closed transport keeps steady-state calls fast while recovering transparently on failure.
- **Polling Chrome periodically with background ping timers.** Rejected: background timers add idle traffic, complicate fake-timer/async teardown tests, and still miss a failure triggered by a large payload write; write-error teardown plus `onExit` plus `runWithSession()` catches drops immediately when they occur.
- **Rebuilding missing profiles with `fs.rm({ recursive: true })`.** Rejected: recursive removal follows Windows junctions and symlinks outside the temp root and violates repository filesystem safety rules.

## Consequences

- Isolated sessions recover transparently from transient Chromium startup hiccups, child exits, and mid-command socket write errors on the first call rather than forcing manual agent retries.
- `listTabs()` in isolated mode clears dead handles cleanly without unexpectedly launching Chrome.
- Windows temp profile directories and subprocess trees are cleaned up more reliably without leaking Chrome GPU/Crashpad workers.

## Testing

- `packages/dsh-browser-view/tests/core/cdp.spec.ts`: verifies `CdpClient.send()` write-error callback fails all pending calls, flips `closed` to `true`, and closes the underlying socket.
- `packages/dsh-browser-view/tests/host/chrome.spec.ts`: verifies `removeTempProfile()` backoff retry under transient lock errors and keeps symlink/junction safety guards.
- `packages/dsh-browser-view/tests/host/reconnect.spec.ts`: verifies in-flight `navigate` session recycling + replay, isolated transient startup single retry, and dead isolated session cleanup in `listTabs()` without cold launch.
- `pnpm --filter ./packages/dsh-browser-view test` (20 files, 266 tests) and `pnpm --filter ./packages/dsh-browser-view typecheck` pass.
