# Agent Note: Staging the LiangShen Standard catalog behind the anchor turn

Status: implemented

Partially superseded by [a shell-only anchor and PTC promotion](2026-09-12-liangshen-shell-anchor-and-ptc-handoff.md): the shipped anchor set is `bash` alone and the promoted turn presents the session's tools as PTC; the durable turn boundary, the flat anchor narrowing, and the injected-catalog decision recorded here still hold.

## Problem

The merged design ([minimal persona plus an injected standard tool catalog](2026-09-11-liangshen-minimal-prompt-tool-catalog.md)) put the builtin Standard preset's complete tool roster on the wire from the session's first request. Reading the first exchange in the trace view showed the cost: the initial system entry's tool tab carried the full Standard catalog before the conversation existed — precisely the premature injection the mode exists to avoid. The one-line persona was anchoring a request whose tool surface was already Standard, so the "minimal first wave" was minimal in prose only.

## Decision

The Standard roster's schemas are staged behind the anchor turn: the session's first request carries the minimal surface, and the full catalog engages at the deterministic turn boundary. The catalog MESSAGE is not staged — a user clarification after the first shipping pass restored it to the first turn, because the tool injection the mode promises is the skill-catalog-style context message, not the wire. The staging lives in `presets/liangshen/tool-catalog.mjs`, the plugin that already owns the wire-catalog read.

- The anchor turn is defined from the durable log: fewer than two `turn/start` events. The count is read from the log on every decision, never from memory, so resume, reload, and compaction cannot lose or revive the boundary, and a first turn that ends without a reply still promotes at the next one.
- During the anchor turn the assembled wire tool list is narrowed to `anchorTools` before the request carries it.
- The catalog message publishes from the first step and indexes the full registered surface: its entries are read from the assembly BEFORE the wire narrowing, so the first turn already names every tool the second turn puts on the wire, the way the skill catalog names skills the model loads on demand. This is sound because execution resolves by name against the session registry (`dsh-tools` `resolveExecution`), which is independent of what the request declares — a first-turn call against a not-yet-schematized tool still runs.
- The rendered catalog text is identical across the turn boundary (the full surface both times), so the existing dedupe publishes exactly one durable message per session and the boundary changes only the wire's schema set.
- `anchorTools` is preset configuration (`agent.cordis.yml`), defaulting to empty, which disables the narrowing entirely and restores the assembled wire from the first request. The shipped preset sets `bash` alone — the builtin Minimal surface — and the promoted turn presents the session's tools as PTC ([a shell-only anchor and PTC promotion](2026-09-12-liangshen-shell-anchor-and-ptc-handoff.md)); the anchor's remaining prompt references stay reachable because registry-name execution resolves any registered tool while the session still presents natively.
- Everything else about the first turn is unchanged: the one-line persona, the plan policy, the runtime contexts, the instruction hint, and the skill catalog.

## Testing

- `tests/tool-catalog.test.ts` covers the turn-boundary read, wire narrowing in anchor order, the anchor turn publishing the full-surface catalog, the identical rendered text across the boundary (no republish), and the default-off behavior.
- `tests/preset-composition.test.ts` pins the `anchorTools` row in the shipped `agent.cordis.yml`.

## Alternatives considered

- Keep the full roster's schemas from the first request. Rejected: that is the flagged premature injection.
- Gate promotion on a minimal-like first reasoning block, as the retired `tool-bootstrap` did. Rejected: a model-output-dependent state machine is the exact fragility phase 1 removed; the turn boundary needs no cooperation from the model.
- Keep the first-pass behavior: suppress the catalog during the anchor turn and publish the full roster only from the second turn. Rejected by the user's clarification: the tool injection the mode promises is the context message; a first turn with no tool listing is a missing capability index, not a minimal one.
- Publish a catalog of only the anchor schemas during the anchor turn, then republish the full roster at the boundary. Rejected: the journal would carry two durable lists per session start and the text change would force a republish; indexing the full surface from the first publication keeps one stable list.
- Zero tools in the anchor turn. Rejected: the anchor turn should still be a working turn — shell and editor cover a real first task, and the surface then matches the phase-1 surface the mode shipped with originally.
- Suppress the skill-catalog message during the anchor turn instead of keeping `skill` on the wire. Rejected: that strips another plugin's injection from outside; keeping the tool keeps that catalog truthful.
- Promote on the first assistant message instead of the turn boundary. Rejected: a tool loop inside the first exchange would swap the surface mid-turn; the turn boundary keeps the whole first exchange on one surface.

## Consequences

- The first request carries only the anchor schemas, but the model can still act on the whole catalog from the first turn: registry-name execution covers the not-yet-schematized tools, at the cost of guessed parameters until the promoted turn's catalog carries each tool's argument signature.
- The wire's schema set changes exactly once per session, so there is one cache-prefix break at the boundary and none within a turn or afterwards; the catalog message itself is stable for the whole session.
- Because the roster mounts the preset composition once under a standing scope at host startup, preset file changes take effect for sessions created after the next DSH restart; the plugin's startup sync refreshes the installed copies.
- The lever's row-hiding fix shipped in the same round ([the LiangShen lever](2026-09-11-liangshen-composer-lever.md)); the two address the same user report on different halves of the plugin.
