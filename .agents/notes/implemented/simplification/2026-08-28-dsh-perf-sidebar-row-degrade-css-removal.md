# Agent Note: dsh-perf sidebar row degrade CSS removal

Status: implemented

Partially supersedes the "Sidebar row degrade CSS" bullet of [dsh-perf render pipeline batch 2](../feature/2026-08-26-dsh-perf-render-pipeline-batch2.md) - that note's other decisions are unaffected.

## Problem

dsh-perf's degrade stylesheet injected `content-visibility: auto` plus `contain-intrinsic-size: auto 32px` onto dsh-better-sidebar's sidebar session rows (`[class*="_sidebarCol"] [class*="_sessionRow"]`). The fixed 32px placeholder pins off-screen rows to a fixed height, so when the sidebar's real rows are not exactly that tall, rows sit at wrong fixed positions and the sidebar's own layout visibly breaks. The rule also reached across a plugin boundary into another plugin's DOM on a class-substring guess, with a hardcoded measurement that silently goes stale whenever the upstream layout changes.

## Decision

The sidebar session-row rule is removed from `installPerfCss` in `packages/dsh-perf/src/client/index.ts`. dsh-perf's CSS degrade scope is back to message rows only (`[data-chat-flow-kind="assistant-step"]` / `[data-chat-flow-kind="tool-call"]`). dsh-better-sidebar's sidebar renders exactly as that plugin lays it out, with no injected containment. The package READMEs now state the deliberate non-handling instead of advertising the rule, and the built client bundle no longer contains the `_sessionRow` selector.

## Alternatives considered

- Gate the rule behind a settings toggle (default off): rejected - the rule only ever served one third-party layout assumption and already proved harmful in practice; a dormant cross-plugin CSS override is surface area without a user.
- Keep `content-visibility` but drop only `contain-intrinsic-size`: rejected - without a placeholder height the browser guesses off-screen row heights even worse, and any remaining `_sidebarCol`-anchored rule still couples dsh-perf to another plugin's class names.

## Consequences

Sidebar session rows render at their real positions again; the fixed-32px pinning is gone. The cost dsh-perf originally targeted - dsh-better-sidebar mounting hundreds of rows in one shot on group expand (upstream issue stays filed) - returns unmitigated; this change trades that unmeasured saving back for the layout correctness of another plugin's surface.

## Testing

`pnpm --filter @linxin666/dsh-perf test` passes 54/54 and `tsc --noEmit` is clean; the package build succeeds and a grep of `lib/` finds no `_sessionRow` rule; `pnpm docs:check` passes with re-recorded README pair hashes.
