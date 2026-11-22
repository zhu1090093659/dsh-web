# Agent Note: remote-bridge attachment identity reads the entry, not its realpath

Status: implemented

## Problem

The `windows-smoke` lane's `Remote bridge tests` step failed 13 of the 32 cases in
`tests/attachment-path.spec.ts` on every run since the attachment path feature
landed (`0ed7f493e`, 2026-11-10); the lane had been red for 30 consecutive runs.

`readAttachment` decided "is this still the file the session named" by requiring
`realpath(path)` to equal the stored string. On `windows-latest`, `os.tmpdir()`
returns the 8.3 short name (`C:\Users\RUNNER~1\...`) while `realpath()` returns the
long name (`C:\Users\runneradmin\...`), so that comparison was false for every
file under the temp directory. The first file decision therefore refused each
path as `path-not-in-session` before `stat` ran: the six cases that expect to be
served failed on `.ok`, `not-found` / `not-an-image` / `frame-too-large` became
unreachable, and the symlink case failed because its assertion named the resolved
target instead of the refused path.

`/var` → `/private/var` on macOS is the same class of failure. Only the Windows
lane saw it in CI because it is the only lane whose temp directory is a short name.

## Decision

`readAttachment` reads the entry itself: one `lstat()`, refuse
`isSymbolicLink()`, take `size` from the same call. The rule now states the intent
- the name must not be a link standing in for another file - instead of comparing
two spellings of one path. The module comment and the `CODE_PATH_NOT_IN_SESSION`
comment in `protocol.ts` say "the name is a link", not "realpath differs".

The symlink case in `tests/attachment-path.spec.ts` asserts that the refusal names
the requested path and does not name the link target. That assertion holds under
either spelling, and it states what the refusal is for rather than how the
temporary directory happens to be spelled.

Evidence: with `TMPDIR` pointed at a symlink - the same normalisation split,
reachable on Linux - the old rule rejects every file (`realpath(path) !== path`
is true) while `lstat().isSymbolicLink()` is false, so the new rule accepts them.
The spec passes 32/32 in that condition and 32/32 normally; the package suite is
81 files / 1139 tests.

## Alternatives considered

**Keep `realpath()` and compare `join(realpath(dirname(p)), basename(p))`.** Rejected:
it repairs the 8.3 case but still refuses a path whose on-disk spelling differs in
case, which Windows is free to do - the same false rejection in another disguise.

**Normalise both sides first (lower-case on Windows, expand 8.3).** Rejected:
platform-dependent string munging inside a security decision, where the entry test
has no spelling to normalise at all.

**Keep `realpath()` only to build the refusal message.** Rejected: it re-adds the
syscall for a message that reads better naming the path the client actually asked
for.

## Consequences

- One syscall instead of two, and `not-found` / `not-an-image` / `frame-too-large`
  are reachable again on Windows.
- A dangling link now answers `path-not-in-session` (`lstat` succeeds and the entry
  is a link) where it used to answer `not-found` (`realpath` threw). No test covered
  it, and "this is not the file the session named" is what a dangling link is.
- A parent directory swapped for a link after the session named the file is no
  longer caught by this read. The file itself must still be a regular file whose
  bytes carry an image signature, and whoever can rewrite the parent directory can
  write the target file directly - which the old check admitted too.
