# Agent Note: Remove dsh-doctor and dsh-tool-describe-image from the family

Status: implemented

## Problem

dsh-doctor (a diagnostics settings panel) and dsh-tool-describe-image (an image-description tool plugin) no longer serve a purpose for this repository, and the owner directed their outright removal from the plugin family rather than continued maintenance. Keeping them meant two full packages riding every cohort move, build, i18n audit, sync-shared manifest, and release — including a ru dictionary each in dsh-i18n, a settings allowlist namespace each in dsh-web-settings, shared-client copy targets in `scripts/sync-shared.mjs`, and rows in the aggregate that the mount smoke had to account for. The removal landed in the same change as the 0.1.7-alpha.2 host-compat repairs because the aggregate's stale `retire:` block (targeting `web-ui-settings-unarchive-sessions`, a row the alpha.2 host no longer mounts) made every boot log a patch-not-found warning, and touching the aggregate file forced the full sweep anyway.

## Decision

Both packages are deleted from the workspace (`packages/dsh-doctor/`, `packages/dsh-tool-describe-image/`), and `packages/dsh-web-all/aggregate.yml` loses their `patchFrom`/`deps` rows and their `inactive` entries. The aggregate keeps one tombstone shell export per removed id (`describe-image`, `doctor`, both pointing at `./lib/shells/shell.js`) so an old profile whose patch file still carries a mount row degrades to an inert plugin instead of crashing module resolution with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The stale `retire:` block is removed wholesale rather than re-pointed, because the alpha.2 host no longer mounts the row it targeted; `scripts/aggregate.test.mjs` now asserts the aggregate declares no unverified retire targets and pins the removal contract (no `web-ui-doctor` / `web-ui-describe-image` patch lines, no deps, both tombstones present).

The reference sweep covers: `scripts/sync-shared.mjs` (SETTINGS_CONSUMERS and per-package copy targets), `scripts/i18n-audit.mjs` (two package rows), both sync/i18n baseline JSONs, `.github/labeler.yml` (the `area/tools` label and the doctor row), dsh-i18n (`ru/doctor.ts`, `ru/tool-describe-image.ts`, `ru/index.ts`, both README tables), dsh-web-settings (allowlist namespaces and aliases, the client plugin list becomes "task-board, remote-web-ui, pet"), dsh-plugin-manager test fixtures, the skin-center semantic-attrs contract (doctor anchors removed, plugin group count 15 to 13), `docs/publish-prep.md` (19 packages), `docs/plugins.md`, `docs/architecture.md` (17 subpackages), and both root READMEs.

Deliberately untouched: `desktop/runtime/profile-web` pins the published `@linxin666/dsh-web-all@0.3.19`, which still contains both packages — editing that pin would break its `minimumReleaseAgeExclude` reconciliation, and the desktop runtime keeps shipping what it pinned until its own upgrade. `market/worker/src/npm-badge.js` keeps both ids in FAMILY_PACKAGES because that table is an ever-published cumulative registry, not a current-membership list. Archives, release notes, and historical Agent Notes are not rewritten.

## Alternatives considered

- Keep both packages but inactive in the aggregate: rejected — inactivity does not remove the build, test, i18n, and audit tax, and the owner's instruction was removal.
- Delete the packages without tombstone shells: rejected — any profile patched before this change would fail module resolution at boot; the shells cost two lines and make the removal safe for existing installs.
- Re-point the `retire:` block at an alpha.2 row: rejected — no replacement row exists; the unarchive-sessions surface is simply gone upstream.

## Consequences

The family shrinks from 21 to 19 packages (17 aggregate subpackages). sync-shared copy entries drop from 132 to 113 (mount-once host halves 17 to 16), and the counts are pinned in `scripts/sync-shared.test.mjs`. dsh-web-settings no longer accepts the `doctor` / `describe-image` namespaces; a profile that still mounts either id shows an empty shell card. Old profiles are not migrated — the tombstones make migration unnecessary. This change edits `cordis.patch.yml`, so it takes effect only after the user restarts the DSH service.

## Testing

Full gate sequence passes on the removal commit in the isolated worktree: `pnpm typecheck`, `pnpm build`, `pnpm sync-shared:check`, `pnpm skin-center:check`, `pnpm community:check`, `pnpm libs:check` (fingerprints re-recorded for the four lib-committing packages), `pnpm aggregate:check`, `pnpm runtime-deps:check`, `pnpm emoji:check`, `pnpm i18n:check`, `pnpm docs:check` (README pairs re-recorded for dsh-web-all, dsh-web-settings, dsh-i18n), `pnpm test:scripts` (347/347, including the recounted sync-shared manifest test), `pnpm market:check`, `pnpm test:standards` (baseline ratcheted down), `pnpm test:desktop`, and the workspace-wide `pnpm test`. The e2e mount smoke passes against the real 0.1.7-alpha.2 host in all-local-tarball mode with the removed plugins absent ([plugin-mount-smoke-local-tarballs](../testing/2026-09-23-plugin-mount-smoke-local-tarballs.md)). The one remaining red is the dsh-ssh real-sshd sftp test failing with `All configured authentication methods failed` on this macOS host — a local sshd environment limitation, green on CI ubuntu, not a regression from this change.
