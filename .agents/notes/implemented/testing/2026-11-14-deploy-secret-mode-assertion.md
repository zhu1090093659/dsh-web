# Agent Note: The staged-secret mode assertion is POSIX-only

Status: implemented

English | [中文](2026-11-14-deploy-secret-mode-assertion.zh.md)

## Problem

`scripts/deploy-market.test.mjs` proves that the deploy lane stages a secret in a file only its owner can read by running a child that reports `fs.statSync(file).mode & 0o777` and then asserting `mode:600`. Windows has no POSIX permission bits: `statSync().mode` reports `0o666` for every file and the `{ mode: 0o600 }` passed to the write is advisory, so the assertion failed on every Windows run while passing on the Linux CI lane. Earlier cohort runs recorded it as a known pre-existing failure rather than relaxing it.

## Decision

The assertion stays strict where the guarantee exists and degrades honestly where it cannot be observed. On POSIX the child's mode must be `600`. On Windows the test asserts that the child reported some mode and read the exact secret, and the existing cleanup assertion still proves the file is gone after the run. The comment beside the assertion states why, so nobody re-tightens it into a platform-dependent red test.

## Alternatives considered

- **Keep the failing assertion and report it as environment noise.** Rejected: a permanently red local gate hides real regressions in the same suite and trains people to ignore `test:scripts`.
- **Skip the whole test on Windows.** Rejected: the read and cleanup halves are platform-independent and exercise the staging mechanism; only the mode observation is not.
- **Assert an ACL manually on Windows.** Rejected: parsing `icacls` output would add a second security-sensitive parser to a test, and the implementation has no Windows-specific ACL path to verify.

## Consequences

`pnpm test:scripts` is green on Windows and Linux again. The `0600` write mode is still exercised on the Linux CI lane, which is where the guarantee is defined; the Windows lane covers the read and removal paths.
