# Agent Note: Agent Notes decision-record tree

Status: implemented

## Problem

Design decisions and their rejected alternatives lived only in commit messages, PR threads, and scattered handoff files, so the *why* behind structural choices was not discoverable at the point of future work, and superseded rationale kept being re-litigated.

## Decision

The repository adopts the deepseek-harness-style Agent Notes tree under `.agents/notes/`: lifecycle folders `proposed/`, `implemented/`, `rejected/`, and the frozen `archived/` tree, each note path-encoded as `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md` over the closed class set feature / bug-fix / simplification / architecture / process / testing. Every non-trivial change records or updates one Agent Note in the same change; notes ship as English/Chinese/sidecar triplets under the repository i18n contract; the root AGENTS.md Development Workflow and Instruction Layers route to [.agents/notes/README.md](../../README.md), and the dsh-web-ui-agent-coding skill carries the same rule.

Enforcement is discipline-based in this adoption: no dedicated format gate script exists yet.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->

## Consequences

The cost is one more document per non-trivial change and the risk that notes drift without a machine gate; the gain is durable rationale, mandatory alternatives, and a mechanical supersession check before any new decision. The pre-existing flat note on the refined whale registry moved to [implemented/feature/2026-08-19-refined-whale-registry.md](../feature/2026-08-19-refined-whale-registry.md) as part of this change.
