# Agent Note: Windows-safe tar extraction for desktop runtime staging

Status: implemented

## Problem

The first tag run of the desktop-release windows-smoke gate (v0.3.17) failed in "Stage the bundled runtime payload": fetch-node.mjs invoked `tar -xf C:\...` and Git-bash's GNU tar parsed the drive-letter path as a remote host (`tar: Cannot connect to C: resolve failed`). fetch-pnpm.mjs one step later had the same defect. Two independent problems: GNU tar cannot parse `C:\...` targets, and it cannot read the win-x64 Node `.zip` at all — only bsdtar covers both formats, and it is what macOS ships as `tar` and Windows ships at System32.

## Decision

- New shared helper desktop/scripts/tar-extract.mjs: `tarBinary()` prefers `%SystemRoot%\System32\tar.exe` on win32 (bsdtar parses drive letters and auto-detects gzip and zip), falling back to PATH `tar` elsewhere; `extractArchive(archive, destDir)` runs `tar -xf`, whose format auto-detection makes an explicit `-z` unnecessary.
- fetch-node.mjs and fetch-pnpm.mjs extract through the helper instead of invoking `tar` directly; the now-unused execFileSync imports are removed.
- desktop/tests/tar-extract.test.mjs covers plain and gzipped extraction and the binary-selection contract on the running platform; it joins `pnpm test:desktop`, so the windows-latest CI lane exercises the real System32 tar on every push.

## Alternatives considered

- Convert paths with cygpath and keep GNU tar: more moving parts for the same guarantee; System32 bsdtar needs no conversion and exists on every GitHub windows runner image.
- Bundle a JS tar/zip extractor: avoids the subprocess but adds a dependency to the zero-tooling staging path for a problem the OS binary already solves.

## Consequences

- The windows-smoke staging step runs one code path on all runners; the drive-letter and zip-format failure classes are gone from the desktop release gate.
- Cross-linked: this closes the first real-execution gap recorded by [the Windows CI lanes note](../testing/2026-09-06-windows-ci-lanes-for-desktop.md) — that note's smoke job was correct, the staging script it runs was not Windows-safe.
- The v0.3.17 desktop assets are rebuilt by dispatching desktop-release.yml with tag v0.3.17 and ref main; the tag itself stays on the release commit and the npm family is unaffected.

## Testing

- `pnpm test:desktop`: 19 tests pass locally on macOS, including the three new extraction and binary-selection tests; `node desktop/scripts/fetch-node.mjs` end-to-end verifies the rewired imports on the staged-marker skip path.
- The dispatched desktop-release run for v0.3.17 must go green (windows-smoke staging plus boot, then packaging) before the installers attach to the release.
