# Agent Note: win_bash supplies HOME explicitly for Unicode Windows profiles

Status: implemented

## Problem

Issue [#2028](https://github.com/zhu1090093659/dsh-web/issues/2028) showed that `shellEnvironment()` did not pass `HOME` to the pinned MSYS bash. When a desktop-launched host had no inherited `HOME`, MSYS inferred it from `USERPROFILE` through the active ANSI code page. A non-ASCII Windows account directory consequently became a different byte sequence, so `~` expansion and tools that resolve configuration under the user home could address the wrong directory.

## Decision

`shellEnvironment()` now always supplies `HOME`: an existing `base.HOME` wins, and a missing value falls back to Node's `homedir()`. This gives the child the Unicode path already known to the host instead of asking MSYS to reconstruct it through the active code page. Foreground shells and background jobs continue to share this single environment builder. The change does not rewrite `USERPROFILE`, convert path spelling, or alter any other environment contract.

## Alternatives considered

**Leave HOME unset and let MSYS infer it.** Rejected: the issue's byte comparison and explicit-HOME control demonstrate that this inference is the corruption point for a non-ASCII profile.

**Always replace HOME with homedir().** Rejected: an explicit inherited `HOME` is a deliberate caller or host choice and must remain authoritative; only an absent value needs the OS-user fallback.

**Set HOME only in the foreground shell call site.** Rejected: background commands use the same pinned shell semantics, and separate call-site patches would let the two paths drift.

## Consequences

A shell with an inherited `HOME` sees the same value as before. A shell without one now receives the real OS user home, including non-ASCII characters, so `~` and home-relative configuration resolve to that directory. The function signature, tool schema, process model and native-shell fallback are unchanged.

## Testing

`packages/dsh-win-bash/tests/shell-environment.spec.ts` covers byte-identical non-ASCII fallback, preservation of an explicit `HOME`, and the unchanged payload PATH, private-temp, MSYSTEM and TERM entries. The package gates are `pnpm --filter @linxin666/dsh-win-bash typecheck`, `test`, and `build`.
