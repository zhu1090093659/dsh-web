# Agent Note: Fix dsh-doctor Supervisor Lifecycle and Scheduled Task Registration on Windows

Status: implemented

## Problem

On Windows environments, @linxin666/dsh-doctor exhibited two critical lifecycle and deployment failures (Issue #1238):

1. **CLI direct entry check mismatch**: src/cli.ts compared import.meta.url === new URL(process.argv[1] ?? '', 'file:').href. On Windows, drive letters in process.argv[1] (e.g. C:\...) produced malformed file URLs when constructed with 
ew URL(..., 'file:'), causing the equality check to always evaluate to false. CLI commands exited silently with code 0 without executing main().
2. **Path handling and schtasks parameter splitting**:
   - service.ts mistakenly imported path helpers from 
ode:path/posix, corrupting Windows absolute paths.
   - \runCommand passed { shell: true } on Windows, causing cmd.exe to break paths containing spaces (e.g. DSH Doctor) into multiple arguments and failing schtasks /Create with ERROR: Invalid argument/option - 'Doctor'.
   - The /TR task run target lacked surrounding quotes for paths containing spaces.

## Decision

- **Cross-platform CLI entry check**: Refactored entry detection into isDirectCliRun using \fileURLToPath(import.meta.url) and \resolve(entryArg) with case-insensitive normalization on Windows.
- **Platform-adaptive service planning and invocation**:
  - src/agent/service.ts uses win32 or posix path modules based on target platform.
  - Wrapped schtasks /TR target paths in quotes (") to safely accommodate spaces in %LOCALAPPDATA% or user profile paths.
 - Removed shell: true from \runCommand, allowing Node's native spawn to pass exact argument vectors directly to schtasks.exe.
- **Testing & regression prevention**: Added ests/cli-entry.spec.ts and enhanced ests/agent-service.spec.ts to assert Windows path structures and quoted arguments.

## Alternatives considered

- **Renaming DSH Doctor to DSH-Doctor alone**: Rejected — user profile directories (e.g. C:\Users\John Doe) may still contain spaces; proper argument escaping and shell avoidance is the only complete solution.

## Consequences

Windows installations can reliably execute dsh-doctor service-install, register the ONLOGON scheduled task, and run the background Supervisor process for crash recovery.
