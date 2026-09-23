# Agent Note: Windows shell for pnpm install in runtime staging

Status: implemented

## Problem

Follow-up to the tar/bsdtar fix (2026-09-07-desktop-tar-windows-bsdtar). That fix unblocks archive extraction in "Stage the bundled runtime payload", but the same step would have failed next inside build-runtime.mjs: `spawnSync('pnpm', ['install'])` relies on PATH resolving pnpm, and on windows-latest pnpm/action-setup installs a `.cmd` shim. Node's spawn cannot execute `.cmd`/`.bat` without a shell, so every attempt exits with ENOENT (status null, error set) and the step aborts after its 3 retries — before the smoke-check and boot-probe steps ever run. The failure class is recorded empirically in the dsh-trading desktop runtime, which carries the identical platform-scoped fix.

## Decision

- build-runtime.mjs `pnpmInstall()`: the spawn options gain `shell: process.platform === 'win32'`. Every argument is a constant literal, so routing through cmd.exe adds no injection surface; cwd/env/encoding/maxBuffer are unchanged, and the retry loop is untouched.

## Alternatives considered

- Resolve the shim path (e.g. `pnpm.cmd`) explicitly: duplicates the lookup the shell already performs and breaks again if the shim layout changes across setup actions.
- Invoke `cmd /c pnpm install` unconditionally: changes the POSIX error surface for no benefit; the macOS lane must keep its current behavior.

## Consequences

- The windows-smoke staging step can reach the toolchain smoke-check and boot probe; the pnpm-ENOENT failure class is gone from the desktop release gate.
- Cross-linked: closes the second staging gap behind 2026-09-07-desktop-tar-windows-bsdtar. The boot-probe steps still run for the first time on windows-latest in the next dispatched release run; any further failure there needs fresh evidence, not speculation.
- The v0.3.17 rebuild dispatches desktop-release.yml with tag v0.3.17 and ref main (same strategy as the bsdtar note), so this fix rides along in the same run; the tag stays on the release commit and the npm family is unaffected.

## Testing

- `node --check desktop/scripts/build-runtime.mjs` passes; desktop `npm test` is green locally on macOS (19/19, including the tar-extract tests from the preceding fix). The win32 branch itself is exercised by the dispatched windows-smoke run for v0.3.17.
