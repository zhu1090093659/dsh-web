# Agent Note: Doctor capsule Windows execution fixes and named tunnel flags ordering

Status: implemented

## Problem

Two distinct issues were identified in local and cloudflared execution:
1. In `dsh-doctor`, capsule provisioning on Windows encountered race conditions and failure to spawn: `store.ts` and `launch.ts` imported POSIX path utilities (`node:path/posix`), causing Windows backslash paths to truncate directory names to `.` and treat drive paths as relative, causing ENOENT when creating parent directories. Furthermore, `provisionCapsule` invoked naked `spawn` instead of `spawnDsh`, which fails on Windows when invoking `.cmd` wrappers for `dsh` (`spawn dsh ENOENT`).
2. In `dsh-remote-web-ui`, configuring a named tunnel caused the cloudflared process to exit immediately with `flag provided but not defined: -no-autoupdate`. Upstream `cloudflared` npm package's `Tunnel.withToken` appends options after the `run` subcommand, but cloudflared CLI defines `--no-autoupdate` and `--protocol` as top-level flags preceding `run`.

## Decision

1. In `packages/dsh-doctor`:
   - Replaced `node:path/posix` with platform-aware `node:path` in `store.ts` and `launch.ts`.
   - Enhanced `dshSpawnSpec` to wrap bare `'dsh'` commands with `cmd.exe /d /s /c` on Windows.
   - Updated `provisionCapsule` to execute through `spawnDsh` instead of naked `spawn`.
2. In `packages/dsh-remote-web-ui`:
   - Exported and utilized `namedTunnelArgs(token: string)` producing `['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--token', token]`.
   - Replaced `Tunnel.withToken` in `TunnelManager` default factory with direct `new Tunnel(namedTunnelArgs(target.token))`.

## Consequences

- Doctor capsule provisioning succeeds reliably across Windows and POSIX platforms with proper directory creation and command resolution.
- Named Cloudflare tunnels start smoothly without flag parsing errors from cloudflared.

## Testing

- `pnpm --filter @linxin666/dsh-doctor test`: all 43 test suites and 397 unit tests pass.
- `pnpm --filter @linxin666/dsh-remote-web-ui test`: all 32 test suites and 350 unit tests pass.
