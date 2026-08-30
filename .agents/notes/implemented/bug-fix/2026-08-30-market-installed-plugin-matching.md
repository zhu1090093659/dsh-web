# Agent Note: Market Installed Plugin Matching and Scoped Package Resolution

Status: implemented

## Problem

In `packages/dsh-market/src/client/install-source.ts`, `entryInstalled(entry, installed)` performed a naive exact identity check (`item.id === entry.id`).

In DSH Web runtime environments:
1. `dsh-plugin-manager` reads installed dependencies from the managed profile's `package.json`, where keys reflect actual published package names including npm scopes (for example `@omdsh-dev/dsh-annotation`, `@a9i5k4/dsh-auto-memory`, `@noob-stupid/dsh-plugin-console`).
2. The Workshop market catalog (`community.json` / `plugins.json`) registers plugins under short identifiers (`dsh-annotation`, `dsh-auto-memory`, `dsh-plugin-hub`).
3. Furthermore, some entries in `community.json` (such as `dsh-annotation` and `dsh-genui`) lacked explicit `"npm"` field metadata.

As a result, `entryInstalled` returned `null` for installed scoped plugins, causing the Workshop UI (`MarketCard.tsx`) to fail to render the "Installed" badge and mistakenly display the primary "Install Now" action button.

## Decision

1. **Multi-dimensional installed matching in `install-source.ts`**:
   - Direct ID and name equivalence check (`item.id === entry.id || item.name === entry.id`).
   - Direct npm package match against `entry.npm` (with version suffix stripping).
   - Scope-stripped comparison (for example `@omdsh-dev/dsh-annotation` normalized to `dsh-annotation` matching `entry.id` or `entry.npm`).
   - Git repository canonical path comparison (normalizing `entry.repo` and `item.source.spec` / `item.id`).
2. **Metadata completion in `community.json`**:
   - Added `"npm": "@omdsh-dev/dsh-annotation"` for `dsh-annotation`.
   - Added `"npm": "@omdsh-dev/dsh-genui"` for `dsh-genui`.
3. **Regenerated artifacts**:
   - Rebuilt `market/dist/manifest/plugins.json` and verified `market:check`.

## Alternatives considered

- **Strict single-field matching**: requiring `community.json` entry IDs to match npm package names verbatim. Rejected because breaking external ID stability degrades persistent ratings, bookmarks, and URLs.
- **Host-side normalization only**: changing `InstalledPluginItem.id` in `dsh-plugin-manager` to strip scopes. Rejected because host profile operations (`set-enabled`, uninstalls) require exact package names matching `package.json` dependency keys.

## Consequences

- Market cards accurately detect installed states for all scoped and unscoped community plugins.
- Duplicate installation buttons are correctly hidden when a plugin is already installed in the current profile.
- All unit tests and static consistency gates pass.
