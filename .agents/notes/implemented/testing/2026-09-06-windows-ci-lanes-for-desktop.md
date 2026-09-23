# Agent Note: Windows CI lanes for the desktop payload

Status: implemented

## Problem

Nothing in CI executed anything on Windows: the main lane runs on ubuntu, and the desktop release job cross-builds the Windows installers on macOS, where the win payload can only be presence-checked ("it cannot execute on macOS"). The win32 semantics the desktop helpers encode (Path/PATH case normalization, NTFS junctions, Windows tmpdir layouts) and the payload's real boot path had no automated evidence; Windows compatibility relied on manual runs.

## Decision

- `desktop/tests/*.test.mjs` join the main CI lane through a new root script `pnpm test:desktop` (Node builtins only — no desktop `npm install` needed).
- A `desktop-windows` job in `ci.yml` runs the same suite on `windows-latest`, exercising real NTFS junction creation and Windows path semantics that the POSIX runs only simulate. Its `setup-node` step pins `package-manager-cache: false`: the v5 default auto-enables the repo's package-manager cache (detected from pnpm-lock.yaml) and demands pnpm on PATH, a tool this Node-builtins-only job never uses — the first real run failed on exactly that.
- `desktop-release.yml` gains a `windows-smoke` job: on a real Windows runner it stages the full runtime payload (`npm run prepare-runtime`), smoke-checks node/npm/pnpm from the staged win-x64 distribution, boots the staged host on an empty scratch `DSH_HOME` and probes the GUI (HTTP status < 500 with 000 excluded, 120s deadline), and the packaging job `needs: windows-smoke` — a Windows boot failure stops the installers from reaching the release. The boot flow (empty-home `dsh web`, probe loop) was validated locally against the staged mac-arm64 payload before landing: GUI answered HTTP 401 (auth fence) within 4s and the token URL line was printed.

## Alternatives considered

- Boot the packaged installer itself on the Windows runner (install and launch the Electron app): closest to user reality, but needs a GUI session and installer orchestration on the runner; the staged-host boot proves the payload claims that matter (bundled node runs, host serves the GUI) without that flakiness. Installer-level verification stays a manual release check.
- Run the payload boot smoke on every PR: the payload is registry-pinned and changes only on release bumps, so per-PR cost buys little; the release-time gate covers every shipped payload.

## Consequences

- Every push runs the desktop suite twice (ubuntu + windows-latest, about a minute); every desktop release pays one windows-latest payload staging before installers build.
- The smoke shares the desktop run's concurrency group and gates it; a smoke failure means no installers are uploaded for that run.
- Combined with [the cloudflared arch coverage fix](../bug-fix/2026-09-06-desktop-cloudflared-arch-coverage.md), the Windows release path now has build-time assertions, a real boot gate, and unit-level win32 coverage.

## Testing

- `pnpm test:desktop` passes locally (16 tests); the tunnel plugin suite (347 tests) and the repository typecheck are green.
- The first real runs (v0.3.17 tag window) surfaced two Windows-lane defects, both fixed: the windows-smoke staging failed on Git-bash GNU tar drive-letter parsing ([Windows-safe bsdtar extraction](../bug-fix/2026-09-07-desktop-tar-windows-bsdtar.md)), and this job failed in setup-node's default package-manager cache (`package-manager-cache: false` above). The first CI push carrying the fixes is their acceptance run.
