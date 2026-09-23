# Agent Note: The LiangShen lever in the new-session composer

Status: implemented

## Problem

LiangShen mode was installed but switched on the same way as any other preset: open the preset picker on the new-session screen and choose it from a list. The mode's own premise — a deliberately different agent composition — had no visible entry point, and the preset row ships disabled by default in the aggregate, so nothing on the screen said the mode existed at all.

The switch itself is also narrower than it looks. An agent preset is fixed when a session starts, and the only supported exception is a session that is still blank: `agentPresets.select` recomposes such a session and records an `agent-preset/selected` event, and refuses anything else with `agent-preset/locked`. Any control that pretends to switch modes mid-conversation would be lying.

## Decision

The plugin gains a browser half that owns one control: a slot-machine lever in the composer tool row, claimed through the `conversation.input.right` slot, which the shell renders immediately left of the model selector (`conversation.input.model`) inside the same composer card — the new-session hero uses the same bar.

- Pulling the lever down composes LiangShen mode for the current session; pushing it up restores the preset the user was on before, falling back to the deployment default when the page has not seen a prior pick. Dragging in either direction toggles the current state so pulling the lever down while already in LiangShen mode restores the previous preset instead of becoming a no-op.
- The arm reports the session's `agentPreset` projection rather than local state, so a reload shows the truth, and it is only operable while the session is blank — the same window the host accepts. Outside that window the row renders nothing at all.
- A landed pull plays the burst: flash, shockwave rings, sparks, and a banner carrying the mode name over classical Chinese, binary, and Morse lines. The burst is driven by a counter the controller advances only when the host accepted the switch, so a refusal cannot celebrate. `prefers-reduced-motion` keeps the state change and drops the animation.
- The switch goes through the agent-preset Remote namespace (`agentPresets.list` and `agentPresets.select`) that the browser session is already authenticated for. The official preset package's browser module is not imported: cross-plugin collaboration in this repository goes through cordis services and Remote surfaces, not value imports, and the browser bundle's purity gate enforces it.
- The controller declares every service it reads in the fiber's inject list — `slots`, `locale`, `sessions`, `remote`, and `remote.agentPresets`. The browser context is a proxy that throws on any service the fiber did not inject, and a nested service name does not imply its parent, so `remote` is declared alongside `remote.agentPresets`. Each read is additionally guarded: a deployment that cannot answer one of them leaves the lever inert instead of failing this plugin's fiber and taking the composer row down with it.
- The lever is scoped to the new-session screen by state, not by slot: the slot renders for every session, and the component renders nothing for a session that has started (its summary reports `locked`) or for a missing preset — a dead control in a running session's composer would suggest a switch the host will refuse.

## Testing

- `tests/lever-logic.spec.ts` covers the pure decisions: state resolution (on / off / locked / missing), actionability, and which preset a push-up restores, including a remembered preset the roster no longer supplies.
- `tests/lever-control.spec.ts` drives the controller over a fake client runtime: the selected preset per gesture, the restore fallback, the locked and not-found refusal mapping, a carried-through host reason, the rule that a refused switch never advances the burst counter, gestures the state cannot serve, and the namespace-bound translate function.
- `tests/lever-ui.spec.tsx` renders the component under jsdom: the semantic attributes, the `role="switch"` state, pointer pulls, pushes, and horizontal drags, keyboard activation, the locked and missing states rendering nothing (and the row returning when the snapshot leaves those states), the refusal line, and the burst appearing once per landed pull.
- `tests/lever-control.spec.ts` also pins service resolution and switch liveness: a context whose `remote` or `sessions` accessor refuses (the inject proxy's throw) must leave the lever inert rather than throw, and a switch whose Remote call never answers must report a timeout instead of staying busy forever.
- The live GUI was exercised with the shipped bundle: the lever rendered on the new-session screen, a pull committed `liangshen` (the official preset chip changed with it) and played the burst, and a push restored `standard`; the host's durable log carried the matching `agent-preset/selected` events.
- `pnpm --filter @linxin666/dsh-liangshen build` emits the browser bundle through the shared preset's purity gate and CSS-Modules pipeline, so a cross-plugin value import or a non-platform external fails the build.

## Alternatives considered

- A second entry in the official preset chip row on the new-session hero. Rejected: it duplicates the official preset control for the same field on the same screen, and the request was a control beside the model selector inside the input box.
- Importing the official preset package's exported `writeDefaultPreset` helper. Rejected: it changes the default for all later sessions rather than the session being started, and importing it would be a cross-plugin value import the bundle purity gate forbids.
- Changing the deployment default instead of the session preset. Rejected: it silently rewrites every future session and gives no way back per session; the session-scoped select is the narrower, reversible act.
- A plain toggle button. Rejected: the requested gesture is a lever, and the arm's travel is also the affordance that distinguishes pulling down (on) from pushing up (back), which a checkbox cannot express.
- Tracking the on/off state locally for the animation's sake. Rejected: the session projection is authoritative, and local state would drift after a reload or a switch made from the official chip.
- Playing the burst on the gesture rather than on the host's acceptance. Rejected: a refused switch would celebrate a change that did not happen.

## Consequences

- LiangShen mode has a visible, one-gesture entry point on the screen where the mode can actually be chosen, and the plugin's browser half ships with the preset it belongs to.
- The lever cannot enable a mode the deployment has not installed: with the preset absent it renders nothing — the same silence a user sees when the plugin row is disabled.
- A switch that outlives its ten-second ceiling is reported as a timeout and clears the busy state. The host may still have committed it, because a Remote answer can be lost on the way back, so the next session read reports what actually happened and the lever never keeps claiming to be switching.
- The control exists only while a session is blank, so it disappears once the conversation starts; switching mode mid-conversation remains unsupported by design, not by omission.
- The levers copy is a translatable namespace (`liangshen`) with zh/en dictionaries in the package and a ru mirror in `dsh-i18n`, and its DOM carries the `liangshen` plugin group and five `lever*` part values registered in the semantic-attrs contract.
- The lever reads the roster once per page visit and on `settings/document-updated` for the `agent-presets` namespace, so a preset installed or removed while the page is open updates the arm without a reload.
