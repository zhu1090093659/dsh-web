# Agent Note: LiangShen ships the child-route guard

Status: implemented

Extends [the child-model selection opt-in](../bug-fix/2026-10-07-liangshen-preset-child-model-selection.md) and [the dispatcher rules](2026-10-18-liangshen-dispatcher-rules-maintained-in-place.md). The first made the preset opt into child-model selection, the second states the routing discipline in the prompt; this note owns the enforcement neither of them could provide. The delegation-time boundary it adds is paired with [the dispatch execution guard](2026-11-02-liangshen-dispatch-execution-guard.md), which polices the decision surfaces of the same composition.

## Problem

The harness records a Session's authorized child routes as a durable `subagent/model-selection-policy` event, but its own delegation tool only rejects an EXPLICIT route outside that list: the route assertion returns before it compares anything when a call names no `provider`/`model`. An inherit-only tool such as `subagent_fork` cannot name one at all. A Session whose allowlist authorizes one model family therefore still spawns children on the parent's route, silently, through any of three shapes:

- a bare `subagent` call, which falls back to the configured child defaults or the parent route;
- a `subagent_fork` call, which inherits the parent route by design;
- a delegation tool mounted without route fields — a composition written for an older SDK cohort mounts exactly that — which cannot be asked for a pair at all.

The settings service refuses to record an allowlist with no routes, so the recorded states are "no policy" and "a non-empty list". An empty list is still representable in a durable log, and it authorizes nothing.

## Decision

The preset mounts one more row, `subagent-routes` (`presets/liangshen/subagent-routes.mjs`), which registers `ctx.tools.guard` in the composing scope:

- **explicit mode** (`subagent`): a policy-carrying Session must name a complete authorized `provider`/`model` pair. A missing half, a missing pair, and an off-list pair each get their own corrective reason naming the authorized routes.
- **inherit mode** (`subagent_fork`, `spawn_teammate`): a named pair is refused as an override attempt, because that is the re-route the tool exists to prevent; otherwise the inherited route — the caller's latest request header, with its creation options as the fallback — is checked against the same list. A refusal says the child cannot be re-routed and points at the tool that can.
- **the mode follows the mounted tool**: the guard asks the registry which fields the tool declares, because the configured mode is a preset's intention while the parameters are a runtime fact. An undeclared-route tool is enforced through the route its child would inherit, and is never asked for a pair no call could satisfy.
- **fail-open**: an absent policy event, an absent session registry, or a registry that cannot name the tool's fields all leave the call to the harness. Only a fact the guard can justify from the durable log produces a denial.
- The walk to an ancestor policy crosses only parent links the delegation seam created (`origin: subagent`), so an unrelated parent Session cannot impose its list on a delegation it does not own.
- The row ships enabled and takes `enabled: false`, plus explicit/inherit name overrides, from its own config.

## Alternatives considered

- Depend on the deployment's host-plane authorization plugin instead. Rejected: LiangShen is a replica of the dispatcher mode and has to carry the capability itself; a deployment that installs only this preset would otherwise keep the silent inheritance the guard exists to stop.
- Police only inherit-only tools. Rejected: a bare `subagent` call bypasses an allowlist exactly as a fork does, and it is the more common shape.
- Demand an explicit pair from every delegation tool unconditionally. Rejected: a tool mounted without route fields cannot accept one, so the denial would be unsatisfiable — the composition defect the same week's preset fix addressed.
- Treat an absent policy event as an empty allowlist. Rejected: absence is not "nothing is authorized", it is "this Session recorded no policy", and denying there would break every unconfigured deployment.
- Copy the host plugin's implementation wholesale. Rejected: it carries settings sampling, scope options, teammate policy and prefixed-model tolerance this preset does not own; the compact port keeps one home for the behaviour the preset actually needs.

## Consequences

- A LiangShen Session that recorded an allowlist can no longer spawn children off it, by any of the three shapes above.
- Unreadable facts never block a delegation, so a Host without the guard seam keeps the harness's own behavior and the preset still loads.
- An empty recorded allowlist authorizes nothing, which is stricter than the host plugin's "empty means unlisted" reading; the settings service makes that state unreachable through the UI, so the difference only shows up in a hand-edited log.
- The prompt's fork guidance is now true in both deployments: the built-in assertion skips inherited routes, and this guard is the layer that does not.

## Testing

- `packages/dsh-liangshen/tests/subagent-routes.test.ts` (15 tests) covers the policy reader in both log shapes, the ancestor walk, the inherited-route read order, and every decision branch: no policy, authorized fork, unauthorized fork, override attempt, bare/half/off-list explicit calls, an undeclared-route tool, an empty recorded list, the seam-detection path, and the row's off switch.
- `packages/dsh-liangshen/tests/preset-composition.test.ts` pins the new row's mount and its enabled default.
- `pnpm --filter @linxin666/dsh-liangshen test` (380 tests) passes.
