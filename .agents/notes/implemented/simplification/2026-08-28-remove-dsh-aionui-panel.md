# Agent Note: remove dsh-aionui-panel

Status: implemented

Completes the retirement recorded in the package docs since the provider choice was removed: the panel columns never mounted, and [dsh-perf render pipeline batch 2](../feature/2026-08-26-dsh-perf-render-pipeline-batch2.md) already treats dsh-better-sidebar as the right panel owner.

## Problem

The aionui right panel was retired in two steps, but the package itself kept shipping: the aggregate still pulled it in, and its browser half still carried three live surfaces - the composer drag-file-inlay, the transcript mermaid sentinels, and the Side Card settings card (the embedded editor for dsh-better-sidebar's preferences, including the position-compatibility toggle). "Deprecated but mounted" kept the package in every install, the lockfile, and the docs, and the inline Side Card editor reached into another plugin's settings transport - a cross-plugin surface without an owner once the panel died.

## Decision

The dsh-aionui-panel package is removed completely: the package directory, its `patchFrom` and `deps` entries in the dsh-web-all aggregate manifest (regenerated outputs included), the stale workspace dependency the generator's keep-unknown-deps rule would otherwise preserve, the publish-prep row, and every README reference. packages/AGENTS.md's testing exception now states the removal. The right panel remains dsh-better-sidebar's alone; its preferences are managed in that plugin's own settings section. Three residual behaviors disappear with the package: chat mermaid rendering (the official pipeline has no mermaid renderer - the known loss), the composer drag-file-inlay, and the inline Side Card preference editor.

## Alternatives considered

- Rescuing MermaidChatEnhancer into a surviving package first: deferred as unnecessary for now - if mermaid rendering in chat is missed, port it into a small dedicated plugin rather than reviving a deprecated carrier.
- Aggregate-row removal only (the originally documented "remove from the family bundle in a future release"): rejected this round - a deprecated, default-off package kept as an installable sidestep preserved the cross-plugin settings surface and the documentation debt the removal is meant to end.

## Consequences

Every install loses chat mermaid rendering and composer file-drag path insertion; dsh-better-sidebar's preferences are edited only in its own settings section (the position-compatibility toggle included). The generator's keep-unknown-deps preservation means future removals must also delete the stale dependency line from the generated package.json by hand - the aggregate regenerator alone will keep it.

## Testing

`node scripts/aggregate.mjs` regenerated the patch (18 rows) and package.json (16 deps) and `--check` passes; `pnpm install` pruned the workspace importer from pnpm-lock.yaml (158 lines); `pnpm docs:check` passes with re-recorded web-all README pair hashes; repo-wide `pnpm typecheck` and `pnpm test` pass after the deletion and the follow-up cleanups (web-settings allowlist entries plus spec, remote-web-ui comment examples and update-spec fixture, poll-guard consumer examples via sync-shared). Remaining aionui mentions are intentional: this note's cross-links, the README tombstones and AGENTS.md removal line, the aggregate.yml removal comment, frozen archives and release notes, and skins' inert `.aionui-*` CSS selectors.
