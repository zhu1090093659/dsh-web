# Agent Note: Release automatic-upgrade compatibility gates

Status: implemented

## Problem

The release skill described version publishing and fresh-install checks but did not require a complete audit of existing users upgrading through plugin-manager, Doctor, or direct CLI paths. It also treated legacy package publishing as bounded without requiring a release-time window check, so a compatibility migration could be documented as safe while the actual pipeline still published an old package indefinitely or used inconsistent migration assumptions.

## Decision

The dsh-web release skill requires an automatic-upgrade compatibility audit before version bump, main integration, tag creation, and npm publication. The audit compares the previous release with the target source and npm tarballs, inventories package identity, profile and lockfile formats, persisted identifiers, wire and SDK contracts, generated artifacts, and cross-platform lifecycle behavior, and classifies each change as backward-compatible, deterministically migratable, or release-blocking.

The required verification matrix covers fresh installation, the previous release to target upgrade, the oldest supported release and every legacy mapping, failure and retry injection, plugin-manager update, Doctor pre-launch migration, direct CLI limitations, and platform-specific behavior. Migration changes must have one owner, an explicit old-to-new mapping, an idempotent transaction, a backup and rollback path, a target-first verification step, and no double mounts, duplicate rows, partial locks, or data loss after failure.

The skill treats the legacy aggregate rename as a conditional transition: `@linxin666/dsh-web-ui-all` may be dual-published only while the release window is active and the target package is registry-verifiable; after the window the old package is not republished and is deprecated with a migration instruction. The release checklist must match the actual pipeline implementation rather than assuming that a documented two-release window exists.

The release package count is derived from `scripts/lib/family-packages.mjs` and checked with `node scripts/verify-version.mjs X.Y.Z`; the skill does not use a hard-coded family count. The release commit explicitly includes `.agents/notes/` so the compatibility decision ships with the skill and release notes.

## Alternatives considered

- Treating a successful fresh install as sufficient: rejected because it cannot detect profile, lockfile, persisted-key, or legacy-package failures affecting existing users.

- Requiring only unit tests: rejected because update behavior depends on real npm tarballs, official CLI writes, composed profiles, process lifecycle, and platform-specific paths.

- Assuming the legacy package will stop after two releases without a pipeline gate: rejected because prose does not prevent indefinite publishing or prove deprecation.

- Blocking every rename by forcing a major version: rejected because deterministic package migration can preserve existing profiles when its transaction and rollback behavior are verified.

## Consequences

Release preparation has a larger mandatory evidence set and may stop a release before version bump when an upgrade path is unverified. Maintainers must keep the compatibility matrix, migration Agent Notes, behavior tests, release notes, and pipeline window behavior synchronized. Direct `dsh web` entry points remain an explicitly documented limitation when they bypass Doctor migration.
