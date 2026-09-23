# Agent Note: LiangShen delivers workspace instructions in the user role

Status: implemented

Partially supersedes [LiangShen mode lifts the AGENTS.md instructions into the system prompt](2026-09-12-liangshen-agents-md-in-system-prompt.md) on the delivery channel: in-prompt delivery is no longer this mode's default.

## Problem

Delivering the workspace-instruction chain as a `workspace-instructions` system-prompt section, while dropping the harness's own injections, carried three costs the mode did not account for.

The system prompt is re-rendered at every assembly, so an edit to any instruction file changes text inside the cached prefix and invalidates every cached request position after it. The harness keeps its injections append-only — a changed baseline appends a complete replacement rather than rewriting earlier history — precisely so cached prefixes survive instruction edits.

The dropped injections never become sourced `user/message` events. The instruction text lands on a `system/message` surface node instead: it sits outside the harness's source-and-digest reconciliation of instruction files, and the session-reference projection skips those nodes, so the text does not carry into a session projected as a reference.

Moving the text from a user-role message into the system prompt also removed the harness's structural statement that workspace instruction files are guidance that does not override system, developer, or direct user instructions, leaving the user-global `AGENTS.md` at the level of the persona's standing discipline.

## Decision

`instructionSource` accepts `host`, and `host` is the default: the plugin appends no prompt section and returns the entering message batch untouched, so the harness's own `agent-instructions` injection reaches the model exactly as it does for every other preset — one durable user-role baseline carrying the user-global and project chain, then the touched-path additions, replacements, and removals.

`system-prompt` keeps the in-prompt delivery as an opt-in for deployments that want the instruction text in the system prompt; it appends the `workspace-instructions` section under `instructionMaxBytes` and filters the harness messages as before. `hint` is unchanged.

## Alternatives considered

- Keep `system-prompt` as the default and strengthen the wording inside the injected chain. Rejected: the framing that de-motivates convention-following belongs to the hint channel this mode adds, not to the harness baseline the default now uses, so the delivery change alone answers the complaint; and rewriting the harness's own baseline prose would put the preset in the business of editing runtime-owned message text.
- Default to `hint`. Rejected: the hint replaces the first injection with a pointer whose framing tells the model the reference files never matter, which is the behavior the owner rejected; `host` carries the same content from the first request without that framing.
- Keep the system-prompt section and let the harness messages through as well. Rejected: the model would receive the instruction chain twice per request, with divergent framing.
- Mirror the harness's touched-path reconciliation inside the plugin for every mode. Rejected: in `host` mode the harness already reconciles descendant files; the plugin's own discovery serves only `system-prompt` mode, which drops the harness messages it would otherwise duplicate.

## Consequences

- A LiangShen session's system prompt is the persona block, plan mode's `policy`, and the official PTC sections when the wire carries `run_code`; the instruction chain no longer occupies it.
- Instruction edits no longer invalidate cached prompt positions: the baseline is one append-only durable message and every refresh appends after it.
- The instruction text is visible in the session log again, and the baseline carries the harness's own precedence-and-authority framing.
- Descendant instruction files reach the model through the harness's reconciliation in the default mode; the plugin's touched-directory discovery serves the opt-in `system-prompt` mode only.
- The opt-in `system-prompt` mode keeps its costs: a re-rendered prefix on every assembly, the instruction text on a `system/message` node rather than a sourced instruction event, and that text sitting at the persona's level.

## Testing

- `tests/minimal-prompt.test.ts` covers the default `host` mode (no appended section; `agent-instructions` messages pass through byte-identical), alongside the `system-prompt` and `hint` suites.
- `tests/preset-composition.test.ts` pins the shipped `instructionSource: host` row and its `instructionMaxBytes: 65536` budget.
