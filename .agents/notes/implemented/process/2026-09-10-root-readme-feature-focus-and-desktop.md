# Agent Note: Root README feature focus and the DSH Desktop section

Status: implemented

## Problem

The root README presented three surfaces that the default family install does not carry: LiangShen mode and rescue mode are factory-default-off optional rows (`aggregate.yml` `inactive`), and the external archive manager is not shipped at all. Their feature sections, single-plugin install commands, npm package rows and provenance entries advertised capability a fresh install does not load. In the same document the repository's own Electron desktop app — installable macOS/Windows builds that bundle the runtime and the family — had only a three-step Quick Start bullet, and that bullet told readers to run `dsh plugin --profile desktop add @linxin666/dsh-web-all@latest`. The app never reads a `desktop` profile: it seeds and serves `$DSH_HOME/profiles/web`, so the instruction installed into a profile the app ignores.

## Decision

- The LiangShen mode and rescue mode feature sections, their single-plugin install commands, their npm package rows and their provenance entries are removed from `README.md` and `README.en.md`, and `dsh-doctor` is dropped from the original-plugins attribution list.
- The external archive manager bullet is removed from "More plugins"; session archiving is owned by the built-in Session Archive Manager.
- Session archive management (`dsh-session-archive`) is presented as a first-class feature plugin: it keeps its `### Session Archive Manager` section and gains a capability-table row, an npm package row, a single-plugin install command, and a slot in the opening plugin list.
- A top-level `## DSH Desktop (Desktop Client)` section sits between "What It Is" and "Workshop" in both languages, covering the bundled Node runtime, the dedicated 3082-3181 host port range, the shared `~/.dsh` with marker-based re-seeding, in-app plugin management, the startup error page, and the unsigned-installer caveats, and links `desktop/README.md` / `desktop/README.zh.md`.
- Quick Start's desktop entry becomes the download-and-run path (the `dsh-desktop-*` assets of the GitHub Release), and "Upgrade from the legacy aggregate" describes the plugin-manager migration the update check performs (`legacyMigrationFor` → `gateway.migrate`, transactional with rollback and a `--dump-config` preflight) instead of the Doctor launcher preflight.

## Alternatives considered

- Removing only the three topic bodies and keeping their install commands, npm rows and provenance lines: rejected — the README would still present plugins the factory-default family does not load, which is the confusion this change removes.
- Keeping the Doctor-launched legacy migration text: rejected — rescue mode is factory-default-off, so the documented path would require enabling a plugin first; the plugin-manager update job performs the same migration in the default install.
- Deleting the "Upgrade from the legacy aggregate" section entirely: rejected — profiles still mounted on `@linxin666/dsh-web-ui-all` need the migration pointer, and the plugin-manager path is accurate for them.
- Presenting the desktop app as a plugin row or a capability-table entry: rejected — it is a distribution of the whole family (an Electron shell with its own bundled host), not a mountable row.

## Consequences

- The root README no longer mentions LiangShen mode, rescue mode or the external archive manager. Their owning documents are unchanged: `packages/dsh-liangshen` keeps its in-package MIT preset notice and `packages/dsh-doctor` keeps its own README.
- Readers installing the desktop app follow the Releases download path instead of a `--profile desktop` command that resolved to a profile the app does not use.
- This partially supersedes [root README simplification](../simplification/2026-08-24-root-readme-workshop-simplification.md) again and reverses part of the frozen [root README SEO pass](../../archived/process/2026-08-25-root-readme-seo-feature-sections.md); the SEO pass's remaining keyword coverage stands.
- The root README pair stays structurally mirrored; the structural signature helper used by `docs:check` reports equal signatures for both sides.

## Testing

- `pnpm docs:check` passes.
- `signature`/`sigEqual` from `scripts/verify-docs.mjs` applied to `README.md` and `README.en.md` reports equal structure, and every relative link in both files resolves on disk.
- A full-text grep over both files finds no remaining occurrence of the removed topics.
- The new section's installer claim was verified against the v0.3.20 GitHub Release assets (`dsh-desktop-0.3.20-mac-arm64.dmg`, `-mac-x64.dmg`, `-win-x64.exe` plus zip variants).
