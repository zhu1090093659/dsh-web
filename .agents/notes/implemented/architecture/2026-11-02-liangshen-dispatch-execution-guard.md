# Agent Note: LiangShen refuses coordinator tools from a delegated caller

Status: implemented

Extends [the dispatcher rules](2026-10-18-liangshen-dispatcher-rules-maintained-in-place.md) and follows [the child-route guard](2026-10-25-liangshen-subagent-route-guard.md). The first states the coordinator discipline in the prompt, the second polices one delegation argument; this note owns the enforcement the prompt could not provide for the decision surfaces themselves.

## Problem

An in-process subagent inherits its parent's preset composition, so the LiangShen roster reaches a child exactly as it reaches the dispatcher: `ask_user_question`, `create_goal`, `update_goal`, and `exit_plan_mode` appear in the child's tool list and are callable. Only the prompt asked a child not to use them, and the prompt is a request, not a boundary.

The failure it permits is quiet rather than loud. A child that asks the user directly splits one decision into two: the user answers the child, the dispatcher never learns what was asked, and its plan is now built on an answer it did not collect. A child that opens a goal or exits plan mode hands the session a state change the dispatcher did not make. The same class of problem appears on the waiting side: with children still running, a dispatcher can spend a turn inside `sleep` instead of ending it, which burns budget and misses the completion notification the harness is about to deliver.

The upstream plugin (`@eddyskywalker/dsh-chatgpt-subscription`) solved both with a host-plane guard in its own plugin root, gated by a `dispatchExecutionGuard` setting inside its settings card. That placement belongs to a provider plugin; this preset carries its own roster and must police its own sessions.

## Decision

The preset mounts one more row, `dispatch-guard` (`presets/liangshen/dispatch-guard.mjs`), which registers `ctx.tools.guard` in the composing scope:

- **Coordinator-only tools.** `ask_user_question`, `enter_plan_mode`, `leave_plan_mode`, `exit_plan_mode`, `create_goal`, `update_goal`, and `present` are refused from a delegated caller with `DELEGATED_CALLER`, whose text tells the child to report `status: hand_back` or `status: blocked` with the open decision instead. Only four of those names are mounted in this deployment; the rest stay on the frozen list so the rule survives a roster change, and a name that never appears in a call costs nothing.
- **Pure-sleep waits.** While the caller still has a running child, a `bash` / `pwsh` / `win_bash` call whose command is only waiting (sleep, Start-Sleep, timeout, a localhost ping) plus harmless no-ops is refused with `ACTIVE_CHILD_SLEEP_FORBIDDEN`. A compound command that does real work, and any `run_in_background` call, are left alone: the rule targets idling, not background work.
- **Delegation is read from durable lineage first.** `session.header.origin === 'subagent'` is the primary fact; the live root set (`agents.roots()`, after confirming the caller is still the agent its id names) is the fallback. A caller the host cannot identify is not a subagent.
- **Fail open.** No guard seam, no readable session, no root set, no child listing: the call is left to the harness. A protection that guesses is worse than one that abstains.
- **One seam only.** The row registers on `ctx.tools.guard()` and touches neither `tools.register`, nor `tools.definitions`, nor prompt assembly, so the tool declaration surface stays byte-identical and a cache-prefix provider never rebuilds because of this row.
- **No settings-card field.** The row takes `enabled` / `coordinatorTools` / `shellTools` from its own config, and a profile patch is the off switch — the same shape `subagent-routes` ships with, and the deliberate opposite of the [retired breaker](2026-10-17-liangshen-guard-retirement.md), whose lesson was that a settings block with no reachable tuning is a documentation surface rather than a control.

The rule text was synced in the same change: the dispatcher block now carries the standing subagent contract, the report protocol, the coordinator-only tool list, the impact-not-effort stop, the compact delta brief, the non-penalized hand_back, the UI Before/After evidence gate, the clause deletion test, R9 (plan mode as the user's switch), and anti-patterns 21 through 25.

## Alternatives considered

- **Copy the upstream guard wholesale.** Rejected for the reason [the child-route guard note](2026-10-25-liangshen-subagent-route-guard.md) already recorded: the upstream module carries settings sampling, an injected `hasRunningChildren` seam and a plugin-plane install that a preset row does not own. The compact port keeps one home for the behaviour this preset needs.
- **Keep it a rule and add no guard.** Rejected: the prompt already said a child must not ask the user or open a goal, and that is exactly what a child does when the roster lets it. A boundary stated only in prose is a preference.
- **Block the tools by unregistering them in child scopes.** Rejected: the roster is composed once for the preset, so per-scope removal would mean a different composition for children, a second declaration surface to keep in sync, and a tool-table change that invalidates the provider prefix cache mid-session.
- **Expose the guard as a settings-card switch.** Rejected: the card has four volatile fields today and none of them mounts a row; the guard is protection, not a feature, and a deployment that wants it off writes `enabled: false` into its patch.
- **Also refuse `todo_write` for children.** Rejected: a child tracking its own steps is legitimate and private to its own turn; the refusal list is decision surfaces, not bookkeeping.
- **Block every `sleep`, not only a pure one.** Rejected: `sleep 0.2 && npm test` and a retry backoff are real work, and a guard that cannot tell them from an idle wait would deny the dispatcher its own tooling.

## Consequences

- A delegated caller can no longer ask the user, open or close a goal, or submit a plan. The decision goes back with the child's report, which is where the dispatcher can act on it.
- A dispatcher with running children can no longer idle inside a shell command; the turn ends and the completion notification wakes it.
- The blocked list is frozen data, so a future roster addition (`present`, the plan-mode entry tools) is covered without touching the guard, and a name that is never mounted simply never matches.
- Both refusals are executable text: each names the next action rather than only the prohibition, and each is pinned by a test.
- A host whose guard seam or session lineage cannot be read keeps the harness's own behaviour; the preset still loads.

## Testing

- `packages/dsh-liangshen/tests/dispatch-guard.test.ts` covers the export contract, delegated detection across lineage, live roots, a stale caller and a missing `agents` service, the pure-sleep table (waits, no-ops, mixed commands, the background exemption), running-child detection through both listing shapes plus the injected callback, one denial per mounted coordinator tool, a pass-through for a tool outside the list, every fail-open path, and the row's off switch.
- `packages/dsh-liangshen/tests/preset-composition.test.ts` pins the row's mount and its enabled default.
- `packages/dsh-liangshen/tests/minimal-prompt.test.ts` pins the re-synced rule set, the R9 section, and the provenance additions.
- The guard takes effect for sessions created after the plugin re-declares the preset: a running `dsh web` host needs a restart, which this change does not perform.
