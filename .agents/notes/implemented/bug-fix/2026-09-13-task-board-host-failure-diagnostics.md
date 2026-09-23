# Agent Note: Task-board Host failure diagnostics and stale-lock recovery

Status: implemented

## Problem

Issue #1528 reported a board whose Host half had never mounted: the panel showed `Host 操作失败：Unexpected token 'o', "not found" is not valid JSON`, the task list stayed empty forever, and the on-disk evidence was a 0-byte `ledger-v2.lock` whose mtime was two days old while the running Host had started later.

Two defects produced that. The browser transport parsed every response as JSON, so the core webserver's plain-text `not found` for an unmounted `/api` path became the user-visible error. And `HostTaskLedger.acquireLock` treated an unreadable lock as fatal, so a leftover from an unclean shutdown stopped the whole Host half from mounting until a human deleted the file.

## Decision

The browser transport classifies Host failures (`not-mounted`, `unauthorized`, `locked`, `rejected`, `timeout`, `unreachable`, `unexpected`) and renders each as its own sentence in the active language; a non-JSON body is never handed to `JSON.parse`. A failed event stream nudges the panel into one state read, throttled to one per 15 s, so a Host half that never mounted is visible instead of silently empty.

`HostTaskLedger` reclaims an unreadable lock once its mtime is older than `UNREADABLE_LOCK_GRACE_MS` (60 s). The owner writes and fsyncs its record immediately after `O_EXCL`, so an unreadable lock that old cannot be mid-write. A fresh unreadable lock still fails closed with the recovery hint, and a lock held by a live process is still refused.

## Alternatives considered

Reporting the raw parse error with a link to a troubleshooting page was rejected: the panel is the only surface the reporter had, and a JavaScript runtime error carries no information about which failure occurred.

Always reclaiming an unreadable lock was rejected: between `openSync(..., 'wx')` and the owner's `writeFileSync` the file is legitimately empty, and reclaiming it there would start a second ledger writer over the same document.

Registering degraded routes that answer 503 with the constructor's failure reason was deferred, not rejected. It is the only way to report "another live DSH instance holds the ledger" precisely, and it requires the Host service to be constructible without a ledger; the unmounted-API message names that cause in the meantime.

## Consequences

Failure text moved into the task-board dictionary and its Russian mirror in `dsh-i18n`. The panel now distinguishes an unmounted API from a rejected action, which is what triage needs; the exact reason a Host half failed to mount still lives only in the Host log.
