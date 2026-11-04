# Agent Note: win_bash checks the payload cache's mandatory integrity label

English | [中文](2026-11-04-win-bash-cache-integrity-label.zh.md)

Status: implemented

## Problem

The fix for [#1996](2026-11-01-win-bash-payload-cache-outside-package.md) publishes the pinned MinGit payload into `<DSH_HOME>/win-bash/runtime/<key>` and spawns `bash.exe` from that copy. On a Windows host whose `DSH_HOME` data tree carries an inheritable Low Mandatory Level ACE (for example a standing workspace grant), every file created below it inherits that label. Windows takes the lower of the parent token's and the executable image's integrity level, so a Medium host runner starts a Low-integrity bash; a Low process cannot write a Medium workspace or temp directory. Users saw `Permission denied` on `git add`, `mktemp` and Node file writes in a `danger-full-access` session, and restarting DSH or rebuilding the persistent shell did not help (issue [#2007](https://github.com/zhu1090093659/dsh-web/issues/2007)).

The shipped cache check only compared the SHA256 manifest and file bytes. Both are identical between the packaged payload (no Low label) and the broken copy, so a cache hit kept the unusable tree alive across restarts, plugin reloads and updates. The defect is in the security descriptor, not the content.

## Decision

`src/integrity.ts` reads the Windows mandatory integrity label without a native dependency or elevated rights. It calls `%SystemRoot%\System32\icacls.exe <path> /save <file>` by absolute path (never through `PATH`), decodes the UTF-16LE SDDL, and classifies `(ML;...;LW)` / `S-1-16-<rid below 8192>` as `low-or-untrusted`. A missing SACL means Medium by default. High/System labels and the volume root's `S:P(ML;OINPIO;NW;;;HI)` are not downgrades. The SDDL SID spelling is language-independent, so the check works on a localized Windows. It only reads: no label, DACL, token or user directory is modified. On POSIX there is no Windows MIC and the reader reports `medium-or-higher`.

`prepareRuntime()` now treats a byte-verified cache as reusable only when the label check also passes. It inspects every existing ancestor of the candidate directory (an inheritable Low ACE can be propagated onto existing children later), and the published `bash.exe` itself, at three points: before reuse, before publication and after publication. `unknown` is not treated as verified.

Candidate roots are tried in order. `cacheRoot()` stays under the DSH home, preserving the #1996 fix and the probe-isolation convention. `isolatedCacheRoot()` lives under the per-user application-data (or cache) directory with a final path component derived from the DSH home, so an isolated `DSH_HOME` still gets its own cache while the executable tree leaves the Low-labelled data tree. `DSH_WIN_BASH_RUNTIME_HOME` overrides its parent. A Low tree is never reused and never spawned from; the old cache is migrated by abandonment, not by a one-off repair of one payload-key directory.

When no candidate can be written or verified, the verified packaged tree runs instead and `warn` names the cost (`ERR_PNPM_EPERM`), keeping the existing availability rule. Only when a Low label was actually observed AND even the packaged `bash.exe` is labelled Low does mounting fail with `unsafe-integrity`, naming the `pwsh` fallback, the override and the fact that no workspace label or sandbox policy needs changing. No user action, elevation or policy change is required. `src/tool.ts` is untouched: restricted sessions are still refused with `SANDBOX_UNSUPPORTED`.

## Alternatives considered

**Check the label only on the nearest existing ancestor.** Rejected: the issue explicitly leaves open whether the Low label was inherited at creation time or propagated onto an existing tree afterwards. Checking the full existing chain closes both orders at the cost of a few `icacls` calls per mount (memoized within one call).

**Use `icacls <path>` display output or PowerShell `Get-Acl`.** Rejected: the display is localized and `Get-Acl` does not expose the SACL. `icacls /save` emits SDDL whose SID abbreviations are fixed and whose encoding is UTF-16LE.

**Repair the Low label on the user's DSH home, or ask the user to lower the workspace label / change sandbox policy / run DSH elevated.** Rejected: it mutates a user data directory, needs privileges this plugin does not have, and would make the fix a workaround rather than a root-cause repair. `icacls /save` is read-only.

**Move the default cache out of the DSH home entirely.** Rejected: it would reverse the recorded #1996 decision, break the probe-isolation convention and migrate every healthy install for a problem that only occurs on a Low-labelled tree. The isolated root is a fallback, not a new default.

**Refuse to mount whenever a Low label is seen.** Rejected: it would be an availability regression on a host whose packaged payload is clean. The degraded path stays available and is explicitly reported.

## Consequences

- A `danger-full-access` session on a Low-labelled DSH home gets a Medium-integrity bash from the isolated root; ordinary Medium workspace and temp writes work again without changing the workspace, the policy or the launch elevation.
- A hash match alone no longer keeps a Low cache alive: the label check reruns on every mount, so restarts, plugin reloads and payload updates abandon the stale tree. Old Low cache directories remain inert and can be deleted while DSH is stopped.
- The running tree is still outside the package on the normal and fallback paths, so #1996 stays fixed. The packaged-tree fallback keeps its `ERR_PNPM_EPERM` warning.
- The mount pays a handful of `icacls` queries per candidate; labels are memoized within one `prepareRuntime()` call, and a healthy first root normally needs only one candidate. Non-Windows hosts pay nothing.
- When `icacls` is unavailable the label is `unknown`: the tree is not claimed as verified, the isolated root is tried, and the operator sees an explicit warning rather than a silent downgrade.
- `unsafe-integrity` is a mount-level refusal, so `registerWinBash` never runs and `installPwshReplacement` is not installed: `pwsh` stays on the session surface. `servingVerdict` needs no third session-level reason.

## Testing

- `tests/runtime-integrity.spec.ts` (21 cases) certifies the SDDL parser (Low, inherited Low, Untrusted, Medium/High/System, no SACL, mixed ACEs), the isolated root's separation and DSH-home-derived isolation, the Medium default path, Low parent trees, byte-perfect stale Low caches, post-publication inherited Low, payload updates, repeated restarts, the packaged-tree warning, the `unsafe-integrity` refusal, the `ERR_PNPM_EPERM` fallback, the platform refusal, the manifest refusal and the ancestor chain.
- `tests/runtime-cache.spec.ts` adds two win32-x64 live cases: a real `icacls /setintegritylevel (OI)(CI)L` directory reads `low-or-untrusted` on both the directory and an inherited `bash.exe`, and a real Low cache parent makes `prepareRuntime` publish into the isolated root whose `bash.exe` reads `medium-or-higher`. Both restore the label to Medium before cleanup.
- `pnpm --filter @linxin666/dsh-win-bash typecheck`, `test` (14 files, 181 tests) and `build` pass on win32 x64; `pnpm test:standards`, `pnpm docs:check` and `pnpm emoji:check` pass.
