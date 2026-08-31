# Agent Note: Morlay message-actions alpha.1 store require patch

Status: implemented

## Problem

When the harness host checkout merged 0.1.2-alpha.1 (which rehomed the snapshot-store engine from the `@deepseek-ai/dsh-client-runtime` inject face to the `@deepseek-ai/dsh-client-store` platform module), the third-party `@morlay/ui-conversation-message-actions@0.0.11` client bundle started failing the loader's client-modules validation with "missed the module table". The package reaches the profile as prebuilt npm content through `@morlay/better-session` (a `dsh-web-all` dependency) and hard-requires the rc.2-era specifier for `createSnapshotStore`. Unlike the workspace bundles (see [client-store-dual-cohort-engine-shim](2026-08-28-client-store-dual-cohort-engine-shim.md)), it cannot ride the shared tsdown shim because this repository does not build it.

## Decision

The repository owns a `pnpm patch` for the package (`patches/@morlay__ui-conversation-message-actions@0.0.11.patch`, registered under `patchedDependencies` in `pnpm-workspace.yaml`). The patch rewrites that single require into the same dual-cohort probe the tsdown shim emits: try `@deepseek-ai/dsh-client-store`, fall back to the legacy face — both specifiers join-built so the loader's static external scan cannot flag either name.

The loader resolves the entry through the parent-layer link `~/.dsh/profiles/node_modules/@morlay/ui-conversation-message-actions` (created by `scripts/link-profile.mjs`), so that link was repointed from the pre-patch store instance to the patched one (`…patch_hash=365ff758…`). The profile-owned `.dsh-module-fallback` chain needed no change: it leads through `dsh-web-all/node_modules/@morlay/better-session`, whose nested dependency link pnpm already relinked to the patched instance.

## Maintenance contract

- The patch is pinned to 0.0.11. Bumping `@morlay/better-session` requires re-deriving the patch (`pnpm patch` / `pnpm patch-commit`) against the new build — or dropping it outright once morlay ships an alpha.1-compatible release (the upstream `next` branch already carries the alignment as an unpublished WIP commit).
- After any re-patch, the parent-layer link must be re-pointed at the new `patch_hash=…` instance. `scripts/link-profile.mjs` does not do this today: it resolves the package through stale repo-root hoisted links and would rewrite the link back to an unpatched instance (verified by `--dry-run` on 2026-08-28). Refreshing that resolution is open follow-up work.

## Alternatives considered

- Build morlay's `next` branch against its vendored harness — the alpha.1 alignment exists there only as an unpublished WIP commit; heavier and not a release.
- Wait for an upstream alpha.1-compatible npm release — leaves the profile entry failing in the meantime.
- Register a loader-level alias module for the legacy name — deeper host integration to serve one consumer of one export.

## Consequences

- The failing entry loads on the alpha.1 host; rc.2 hosts keep working through the legacy fallback branch, so the patch is cohort-neutral.
- One more repo-owned patch must be maintained across dependency bumps. The consumed engine surface is just `createSnapshotStore`, a subset of the shim's shared surface.

## Verification

- `import.meta.resolve('@morlay/ui-conversation-message-actions/client')` from `~/.dsh/profiles/web` lands on the patched instance; the resolved bundle contains zero bare `require("@deepseek-ai/dsh-client-runtime/client")` and carries the join-built probe; `node --check` passes on the patched file.
