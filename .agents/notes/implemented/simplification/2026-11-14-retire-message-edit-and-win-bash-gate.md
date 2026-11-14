# Agent Note: Retire the message-edit plugin and the win-bash LiangShen gate

Status: implemented

English | [中文](2026-11-14-retire-message-edit-and-win-bash-gate.zh.md)

Supersession check: this Note retires the capability owned by [text-message-edit-and-resend](../../archived/feature/2026-10-24-message-edit-and-resend.md) and narrows the availability decision recorded in [dsh-win-bash-pinned-bash](../feature/2026-10-16-dsh-win-bash-pinned-bash.md). Neither decision is reversed elsewhere: the fork-boundary rationale is preserved in the archived feature note, and the pinned-payload, cache-publishing and shell-ladder decisions stay in force.

## Problem

Two shipped surfaces cost more than they return. `@linxin666/dsh-client-ui-message-edit` adds a Turn-tail "edit and resend" entry that forks a branch session; the branch churn it creates outweighs the correction it offers, and the plugin has no settings, no persisted format and no consumer besides that one entry. `@linxin666/dsh-win-bash` registered `win_bash` only for deployments that declare the `liangshen` agent preset, so a Windows user who never enables that preset gets no pinned bash at all even though the platform guard and the payload verification already decide whether the tool can work.

## Decision

The message-edit plugin leaves the repository and the aggregate: package directory, `patchFrom` and `deps` rows, its ru dictionary in `dsh-i18n`, coverage-baseline entry, i18n audit entry, shared-copy target, and every documentation reference. It ships no tombstone subpath and no display metadata, so a stale profile row naming `@linxin666/dsh-web-all/message-edit` fails at import instead of silently mounting nothing.

`win_bash` no longer follows the LiangShen preset. `src/gate.ts`, the `syncWithLiangShen` config field and the mount continuation that awaited the preset roster are gone: `apply` registers the tool synchronously once the payload verifies and the config resolves, and a registration failure is logged instead of escaping as a rejection. Availability follows the platform guard and payload verification only. A profile row that still carries `syncWithLiangShen` mounts normally, because the key is no longer declared and is therefore ignored.

## Alternatives considered

- **Keep the plugin in the bundle but disabled by default**: rejected. A row that is off by default still ships its browser bundle, its i18n rows and its maintenance load, and nothing turns it back on.
- **Tombstone the aggregate row and keep the package for standalone installs**: rejected. The request was removal from the project, and the plugin offers no capability the official composer pipeline lacks.
- **Keep the gate behind a default-off `syncWithLiangShen` switch**: rejected. The preset coupling was the defect; a switch nobody sets preserves the false absence for every Windows user who does not run LiangShen.
- **Move `win-bash` to the aggregate `inactive` list instead of decoupling it from the preset**: rejected. The tool already refuses on unsupported platforms, so a second opt-in switch adds a step without addressing the coupling.

## Consequences

Windows x64 sessions get `win_bash` without enabling LiangShen; a profile that declared the preset keeps working, and one that did not gains the tool on the next host restart. Message editing has no replacement: a mistaken user message can only be corrected by continuing the conversation or opening a new one. A stale profile row naming the removed plugin fails loudly at import, which is the documented behaviour for a fully removed family. The archived feature note keeps the original fork-boundary rationale for anyone revisiting the capability.

## Testing

- `node scripts/aggregate.mjs --check` reports 20 rows, 18 dependencies and 3 retired plugins after the removal; `pnpm aggregate:check` agrees.
- `pnpm i18n:check`, `pnpm docs:check`, `pnpm libs:check` and `pnpm test:scripts` pass; `pnpm-lock.yaml` loses the workspace package and the aggregate dependency.
- `pnpm --filter @linxin666/dsh-win-bash typecheck && pnpm --filter @linxin666/dsh-win-bash test && pnpm --filter @linxin666/dsh-win-bash build` pass; the package tests assert registration on a context that publishes no preset registry and performs no roster read.
