# Agent Note: An sshd diagnostics sink outlives the child it captures

Status: implemented

## Problem

`pnpm test` failed intermittently while every test in the package passed:

    packages/dsh-ssh test:  Test Files  29 passed (29)
    packages/dsh-ssh test:        Tests  293 passed (293)
    packages/dsh-ssh test:       Errors  1 error

The error was an uncaught `Error: write after end` (`ERR_STREAM_WRITE_AFTER_END`) whose stack ran `Writable.write` ← `Socket.ondata` ← `Pipe.onStreamRead`, reported against `tests/service.test.ts` and naming the newest test in that file — the real-sshd transfer case. It reproduced in about one loaded full-repository run in six (the reviewer saw two in seven) and never on an idle machine running that one file.

## Decision

A diagnostics sink owns the lifetime of the child whose stderr it captures. `packages/dsh-ssh/tests/helpers/sshd.ts` keeps its log stream open from `start()` until `stop()` has the child gone. `stop()` returns a promise that settles only after the child has exited, the pipe has been detached (`child.stderr.unpipe(logStream)`), the sink has finished, and the sandbox directory is removed; both call sites await it.

## Root cause

`start()` ended the log stream as soon as `waitPort()` answered. Node's `pipe()` `ondata` handler calls `dest.write(chunk)` with no `writable` guard — read from the runtime source of the running Node 24 build — so any stderr chunk that arrives between `end()` and the moment `finish` unpipes the source is written into an ending stream. That write is refused with `ERR_STREAM_WRITE_AFTER_END`, `pipe` re-emits it through `errorOrDestroy`, and because the sink carries no `error` listener it escapes as an uncaught exception that vitest attributes to whichever test file happens to be running: a fully green suite failed by an asynchronous stream error.

sshd writes stderr in two bursts. A timestamped capture of this harness shows the config warning at about 3 ms ("Deprecated option UsePrivilegeSeparation") and a second line at about 26 ms, while the port becomes reachable at about 22 ms, so the old `end()` fired in the middle of the child's own logging and the sink's flush outlived the next chunk once the machine was busy. Instrumenting `Writable.prototype.write` in the failing configuration caught the write with `ctor=WriteStream writable=false` and the `Socket.ondata` stack above, which names the only such pipe in the package: the sshd harness sink.

## Alternatives considered

**Attach an `error` listener to the sink and ignore `ERR_STREAM_WRITE_AFTER_END`.** Rejected: it silences a real stream-contract violation, hides the same defect class in every other sink, and turns a broken teardown into an invisible one.

**Retry the suite or loosen the reporter.** Rejected: the cause is this package's teardown, not a flake to absorb, and a retry would also hide a genuinely broken test on its second attempt.

**Detach the pipe and end the sink while keeping `stop()` synchronous.** Rejected: the pipe is only one of the two participants. A caller that does not await leaves the worker closing while the child is still alive and the sandbox still being removed — exactly the ordering this decision owns.

**Stop capturing stderr.** Rejected: the log is what makes a failed start diagnosable, including the configuration warning that explains it.

## Consequences

- `TestSshd.stop()` is asynchronous and idempotent: a second call joins the first. `tests/engine.test.ts` and `tests/service.test.ts` await it, so the sink and the sandbox are gone before the test file ends.
- Teardown stays bounded: a child that ignores SIGTERM past two seconds is killed outright instead of holding the suite open, and the sink close is a callback rather than a sleep.
- `tests/service.test.ts` pins the contract — after `await sshd.stop()` the sandbox directory no longer exists, which can only hold when the removal happens inside `stop()`.
- Verification on the fixed harness: fifteen consecutive package runs under a concurrent family-suite load stayed green with no unhandled error, and three loaded full-repository runs reported no `write after end` and no write into an ending stream, against one reproduction in six such runs before the fix.
- The trap generalizes to the family's other harnesses: never close a diagnostics sink while a live producer is still piped into it, and make harness teardown awaitable.
