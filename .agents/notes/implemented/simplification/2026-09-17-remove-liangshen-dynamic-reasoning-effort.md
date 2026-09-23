# Agent Note: liangshen mode modernization and simplification

Status: implemented

Partially supersedes [LiangShen preset V4.1 Flash native rebuild](../feature/2026-09-16-liangshen-v41-flash-native-rebuild.md) and [LiangShen shell and paging](../feature/2026-09-17-liangshen-shell-and-paging-ptc-surface.md): removes the preset-local `reasoning-effort` plugin, replaces the PTY persistent shell with the upstream standard Stdio shell (`tool-bash` / `tool-pwsh`), switches the default presentation to `both`, leaves tools unpaged by default, and relaxes compaction pruning to standard budgets.

## Problem

The LiangShen mode had accumulated several engineering frictions that degraded real-world performance:
1. **Dynamic reasoning overhead**: `reasoning-effort.mjs` attempted phase-based effort switching, which invalidated server-side prefix KV caches, conflicted with explicit model picker choices, and shipped disabled by default.
2. **PTY shell cards**: `tool-pwsh-persistent` had no `description` parameter, hardcoding `args.command` as the card title and flooding the UI with raw commands, while risking terminal escape sequence noise.
3. **PTC lock-in & fragility**: Shipped with `presentation: 'ptc'` as the default, forcing all interactions through JavaScript scripts inside `run_code` and incurring a 5% SWE-bench penalty compared to native tool calling.
4. **Paging friction**: `pagedToolPatterns: ['mcp__*']` hid MCP tools (like CodeGraph) behind an extra `tool_activate` round, causing models to miss tools or waste turns.
5. **Over-aggressive truncation**: `tool-result-pruner` at 4096 characters clipped crucial stack traces and test outputs in the middle.

## Decision

The LiangShen preset is modernized and simplified across all four layers:
- **Cleaned up dynamic reasoning**: Deleted `presets/liangshen/reasoning-effort.mjs`, its row in `agent.cordis.yml`, its settings card controls, its tests, and its sync overrides.
- **Switched to standard Stdio shell**: Replaced `persistent-shell` with upstream `@deepseek-ai/dsh-tool-bash` (POSIX) and `@deepseek-ai/dsh-tool-pwsh` (Windows), recovering concise active-voice description title cards and deterministic exit codes.
- **Set default presentation to `both`**: Both native DSML tools and `run_code` co-reside by default, allowing native multi-invoke parallel exploration while retaining `run_code` for computation.
- **Updated persona discipline**: Added `Parallel Inspection` (encourage single-turn multi-tool batching) and `Shell Discipline` (compound commands / explicit workdir for ephemeral subshells).
- **Unpaged tools by default**: Set `pagedToolPatterns: []` in `agent.cordis.yml` and removed `tool-activate` row so tools are resident and callable on turn 1.
- **Relaxed compaction pruning**: Set `tool-result-pruner` to `thresholdChars: 8192`, `headChars: 4096`, `tailChars: 1024`.

## Alternatives considered

- **Retain PTY shell**: Rejected. PTY on Windows introduces escape codes, wrapper nonces, and lacks description parameters for clean title cards.
- **Keep presentation fixed to PTC**: Rejected. Official benchmarks prove native calling achieves 72.6% vs 67.6% on SWE-bench, and native multi-invoke delivers the turn-reduction benefit without script fragility.

## Consequences

- Sessions on the LiangShen preset enjoy clean active-voice shell title cards, native tool execution, and unpaged MCP availability.
- Model picker reasoning levels remain untouched with 100% prefix KV cache stability.
- Stale preset files are automatically cleaned up on next restart.

## Testing

- Unit tests: all 18 test files (295 tests) in `packages/dsh-liangshen` pass via `vitest run`.
- Type checking: `pnpm typecheck` passes with zero errors across the monorepo.
- Code style: `git diff --check` passes with zero whitespace or line-ending warnings.
- Documentation & i18n: `pnpm docs:check` and `pnpm i18n:check` pass cleanly.
- Artifact fingerprints: `pnpm libs:check` passes.
