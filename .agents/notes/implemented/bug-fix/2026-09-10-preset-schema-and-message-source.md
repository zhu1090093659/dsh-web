# Agent Note: Preset assets follow the current persona schema and durable message sources

Status: implemented

## Problem

Two bug reports filed on 2026-09-10 against DSH 0.1.5-rc.1 are the same class of defect: assets this repository ships for the agent-preset plane were written against contracts the installed harness no longer accepts.

- Issue #1450: the `liangshen` preset stopped mounting. `presets/liangshen/agent.cordis.yml` still configured the persona row with the retired `text` key, while `@deepseek-ai/dsh-persona` 0.1.5-rc.1 declares `prefix: z.string().required()` (plus `suffix`, `complete`, `includeRuntimeContext`). Mounting fails with `$.prefix missing required value`, so every session naming the preset cannot answer.
- Issue #1455: sessions whose history contains a liangshen instruction hint stopped restoring. `tool-bootstrap.mjs` stamped the injected hint as a `user` message with the custom source kind `instruction-hint`. The v2-to-v3 migration whitelist (`SOURCE_KINDS` in `@deepseek-ai/dsh-session-format-v2-to-v3`) and the v3 `MessageSourceMap` in `@deepseek-ai/dsh-api-session-controller` both classify a fixed set of kinds that excludes it, so the migration refused with `cannot safely transform unclassified message source` and left the v2 artifact unopened.

The retired `text` key also sat in the community preset template (`packages/dsh-preset-center/presets/_template/agent.cordis.yml`), which the preset-center README tells authors to copy, so every preset derived from it would have hit the same mount failure.

## Decision

- The liangshen persona row and the preset template both use `prefix` instead of the retired `text`.
- `buildInstructionHint` stamps its message with `{ kind: 'plugin', plugin: name }`; the message already names its plugin, and `plugin` is accepted by both the v2-to-v3 migration whitelist and the v3 `MessageSourceMap` (`{ kind: 'plugin'; plugin: string } & ContextFormed`, where `ContextFormed` admits the absent `form`).
- `tests/minimal-prompt.test.ts` (then `tests/tool-bootstrap.test.ts`) pins the emitted kind as `plugin` in both instruction-hint tests.

## Testing

- `pnpm --filter @linxin666/dsh-liangshen test`: 8 files, 102 tests pass with the new assertions.
- Persona schema check: the extracted persona row config of both changed preset files validates against the installed `@deepseek-ai/dsh-persona` `Config` schema, while the pre-fix shape is rejected with the reported `$.prefix missing required value`.
- Journal migration check through the installed `sessionFormatV2ToV3` stage with a synthetic v2 `agent/inbox/spliced` event: the `instruction-hint` message is rejected with the reported `cannot safely transform unclassified message source`, and the same event with `plugin` migrates and emits the event unchanged.

## Alternatives considered

- Adding `instruction-hint` to the core whitelists instead of changing the plugin. Rejected: those whitelists live in official DSH packages, and modifying a DSH checkout is out of bounds for this repository; the custom kind is also retired, so widening the contract would preserve a name nothing else uses.
- Keeping `instruction-hint` and teaching `tool-bootstrap` to rewrite historical logs. Rejected: rewriting a durable zstd journal is unsafe from a pre-step hook, and the repository does not own the session format.
- Leaving the preset template alone because no bug report names it. Rejected: it is the documented copy source for new presets and carried the identical defect; fixing only the reported file would leave the next preset broken.

## Consequences

- New liangshen sessions persist a source kind the released migration understands, so they restore after a DSH upgrade. The `DEFAULT_MESSAGE_SOURCES` whitelist this note weighed against is retired with the two-phase mechanism it belonged to ([LiangShen mode as a minimal persona plus an injected standard tool catalog](../feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.md)).
- Histories that already contain `"kind":"instruction-hint"` stay unopenable until the user normalizes that kind in the v2 log; the fix prevents new occurrences and does not repair existing files.
- Preset authors copying `_template/` get a persona row that mounts on the current schema.
