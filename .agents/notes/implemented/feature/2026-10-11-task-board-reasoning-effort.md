# Agent Note: Task-board reasoning effort

Status: implemented

## Problem

A task can pin its execution model but cannot state how much reasoning that model should use. The official model catalog already declares adapter-owned effort levels, yet the board discards them while building model-picker rows.

## Decision

Task creation and task details offer a reasoning-effort selector beside the model selector. Its choices come from that exact model's official `session/modelCatalog` metadata, not a universal list. An empty choice inherits the model/Host default. Switching to a known model that does not support the stored effort clears the choice; an unknown or removed route is not silently rewritten.

`reasoningEffort` is an optional task execution field. It travels through the existing strict create/update actions and ledger, and the runner includes it in the official `session/selectModel` request when selecting the execution model. The existing-session launch path uses the same selection logic. Clearing uses an empty wire string because JSON omits `undefined` properties. The additive field does not change the ledger schema version. A subtask that pins its own model but leaves effort unset uses that model's default instead of borrowing an ancestor's effort. An unpinned model may inherit its ancestor's model/effort pair; the subtask's own effort still takes precedence. Import preserves both fields. A rejected model-selection request carrying an explicit declared effort fails the execution before its prompt is queued.

The field controls the task execution model. The [subtask decision](2026-09-24-task-board-subtasks.md) owns lineage and Team execution; this note does not redefine teammate routing.

## Alternatives considered

**A universal low/medium/high list for every model.** Rejected: adapters own their supported ids and an unsupported id is a native model-selection error.

**Only add a dropdown without an execution field.** Rejected: the form would display a preference that the Host never applies.

**Upgrade the ledger schema for an optional field.** Rejected: existing optional execution targets already use additive normalization, and a schema bump creates needless compatibility risk.

## Consequences

A model with no declared effort levels has no selectable effort control. Capability discovery remains authoritative; the board does not infer support from a model name. The explicit choice is stored with the card, while leaving it unset preserves the native default behavior. Required verification covers catalog mapping, create/update/clear and persistence, model switching, task details, and the model-selection request for fresh and reused sessions.
