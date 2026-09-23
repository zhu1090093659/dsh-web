# LiangShen Dynamic Reasoning Effort — a Bounded, Breaker-Triggered Revival

> This note records the 2026-09-20 **partial amendment** of [Removing the LiangShen dynamic reasoning effort](2026-09-17-remove-liangshen-dynamic-reasoning-effort.md): reasoning-effort adjustment returns in the form of "zero intervention under normal operation, a one-shot step-down only when a runtime degeneration signal fires". The earlier note's other two decisions (dropping the settings-card effort controls, keeping no dormant code) **stand unchanged** — the new logic is not a settings surface; it lives as one action of the circuit breaker `guard.mjs`.

Status: implemented

## New evidence (published after the earlier note)

The earlier note's third reason for removal was "the persona's reflection-fuse discipline is sufficient to suppress发散 thinking". DeepSeek-V4.1-Flash (released 2026-09-10) disproved it:

- **DSH Discussion #5976**: v4.1-flash falls into a reasoning degeneration loop under very long context at max effort (zero-output turns, no automatic fuse, manual abort required); the same configuration on v4-flash ran 3000+ steps without recurring. The report's own conclusion: a model-side generation degeneration, but the exposed guard-layer gap "**can be filled by a plugin without touching the core**". In that state the persona discipline is fully ineffective — the discipline text itself has left the effective context, and only an outside force helps.
- **Official effort-cost data** (V4.1 model card / tech report): effort 25→100 costs ~2.5× output tokens; 60–80 already recovers most accuracy; the last step to 100 lengthens trajectories 1.6–1.8×. Neither "pinned high/max" nor "pinned low for execution" is optimal; the optimum is **leave the user's level alone by default + step one notch down when degeneration fires**.
- **r/DeepSeek field report (1whgo3e)**: a tool-call loop burning tokens recovered once reasoning effort was lowered.

## The amended shape

| Dimension | Removed implementation | Revived form |
| :--- | :--- | :--- |
| When it acts | Every phase boundary | **Only when the breaker detects degeneration** (consecutive zero-output long reasoning, identical-argument repeated failures); otherwise not a single request is touched |
| Default | Dormant opt-in config | No standing config; the step-down is part of firing the breaker, automatic |
| Prefix cache | Broken at every phase boundary | Broken once at the fire moment — the session is already out of control, and the cache cost is far below the tokens a loop burns |
| Step-down target | Fixed execution level low | One notch below the current level (max→high→low), avoiding low's lazy/forgetful feel |
| Settings card | Three effort controls | Not restored; the earlier simplification stands |
| Carrier | Standalone `reasoning-effort.mjs` | Folded into `guard.mjs`, rewriting via the `agent/request` waterfall for a 3-request window |

## Decision

- Do not restore `reasoning-effort.mjs` or its settings-card controls;
- Implement in `presets/liangshen/guard.mjs`: on a breaker fire, inject the breaker message and step `reasoningEffort` one notch down through the `agent/request` waterfall for a window of 3 requests;
- The guard rewrites a request strictly inside a fired episode's window and is a pure pass-through otherwise, satisfying the earlier note's constraints on prefix-cache stability and the user's explicit level.

## Consequences

- LiangShen mode gains runtime protection against the #5976 shape, while an ordinary session's request surface and cache behavior are identical to running without the guard;
- The breaker thresholds (consecutive steps, repeated failures, reasoning-character floor) are deliberately conservative: a false interruption of real long thinking hurts more than a missed episode. Concrete values are left to calibration by replaying sessions through `packages/dsh-liangshen/tools/benchmark-live-run.mjs` (see docs/liangshen-v41-community-feedback-update.md §4 P2-2).
