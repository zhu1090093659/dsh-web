# Agent Note: Automatic legacy aggregate migration

Status: implemented

## Problem

After the product rename, profiles still mounted on `@linxin666/dsh-web-ui-all` would fail or remain on the legacy package. A user upgrade that adds `@linxin666/dsh-web-all` without removing the legacy bundle has two `web-ui-*` patch layers and cannot boot. The transition needed a zero-user-action migration built into the product update path, not a manual remove-then-add command.

## Decision

The legacy aggregate migration is a deterministic, transactional replacement implemented in three layers (the rename decision is recorded in [the product rename note](../../architecture/2026-08-24-product-rename-dsh-web.md)):

- The release pipeline dual-publishes the current `@linxin666/dsh-web-all` and a final `@linxin666/dsh-web-ui-all` package. The legacy tarball is built from the current aggregate package, rewrites the browser loader id and self row to the old npm identity, and carries `dsh.migrate` metadata describing the target package and version.
- The plugin-manager update path recognizes the legacy package, reports a migration update, and runs a CLI-backed migration job through the official `dsh plugin` writer. The job removes the legacy package through the official CLI, installs the current aggregate, restores the legacy layer position, runs `--dump-config`, and rolls back through the official remove/add path on failure.
- The Doctor Launcher performs the migration before starting DSH when `autoMigrate` is enabled (default true) and the target package is available. It installs the current aggregate before removing the legacy package so the profile never spends a step without a resolvable aggregate, backs up `package.json` and `pnpm-lock.yaml`, reorders bundles, verifies the composed profile, and only then launches the real DSH process. Registry targets are installed at the exact release even when an older current aggregate is already present, and a failed migration never re-adds the legacy bundle after it has been removed; if both aggregates were already installed, rollback keeps the single current aggregate. The shared migration map lives in `shared/host/legacy-migration.ts` and is synchronized into both consumers.

A separate Doctor `autoMigrate` setting is default true and is scoped to the known `@linxin666/dsh-web-ui-all` -> `@linxin666/dsh-web-all` mapping only. `autoRepair` keeps its existing default for general repairs.

## Alternatives considered

- A shim package that re-exports the current aggregate: rejected because the rename note already records that aggregate mount semantics do not survive re-export.
- Keeping both packages installed and coexisting: rejected because both patch layers output the same `web-ui-*` rows.
- A manual migration command only: rejected because the user chose fully automatic product-update migration.
- Running migration only inside plugin-manager: insufficient for boot failures because a broken legacy profile never reaches the GUI; Doctor Launcher covers the startup path.

## Consequences

- Existing users see no migration prompt when Doctor is enabled; the first protected launch migrates and verifies the profile before DSH starts.
- Direct `dsh web` calls bypass the Doctor Launcher and are not covered by the zero-action path.
- Migration is pinned to an exact target version and never removes the legacy package unless the current package is available and the target bundle is composed successfully.
- The legacy npm package stays on npm for the dual-publish transition window and is then deprecated.
