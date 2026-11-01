# Agent Note: The task-board team settings block renders as a nested settings card

Status: implemented

## Problem

The team provider's configuration block is the last topic of the board's own settings card: that card is a `<ul>` of nested topic cards, and an external provider fills its `task-board.settings.section` seat. The sibling provider (GitHub Issues sync) fills the same seat with a `PluginSettingsCard` in nested density — a bordered disclosure card with a header, body insets and hairline-separated rows.

The team block rendered a bare `<div>` instead, and three defects followed from that markup:

- It was a direct child of the `<ul>` — invalid list content — with no card chrome of its own, so it read as a stray fragment of the parent card rather than as a topic beside its siblings.
- Its rows were a hand-rolled `display: flex; justify-content: space-between` holding a `width: 100%` input. A full-width input inside a flex row takes the line, so the label beside it shrank to its minimum content width and wrapped one or two characters per line (`Hub 地址` broke into `Hub 地` / `址`, `本地兜底等待（分钟）` into three lines), and every input started at a different x, so the column of controls had no shared left edge.
- The capability rows were the same flex row with a long sentence on the right: the label wrapped to two lines while the value wrapped to two lines beside it, and the two interleaved into one unreadable block.

The extension's own CSS module carried all of it (`.section`, `.row`, `.input`), which is why nothing in the shared card slice could correct it: the block never used the card.

## Decision

`TeamSettingsSection` renders one `PluginSettingsCard` in nested density, and its rows are the shared field grid.

- The card chrome (border, background, radius, header, disclosure, body insets, the hairline between two `.field` rows) comes from the family slice, never from this package's CSS module.
- Every row is a `.field`: the label in the head column, the hint under it, and one control in the trailing column, capped by the slice's own container query — below a 440px card the control drops under the text instead of crushing it. A label therefore cannot be squeezed by its control, and the controls share one left edge.
- A long explanation is a field's `hint`, not the control area: an unavailable capability keeps its name on the label line, its reason under it, and the `不可用` verdict at the trailing edge.
- The block still writes through the board's own action channel (`setup-save`, `set-token`, `clear-token`, `refresh`) and keeps its own save row: the card holds no staged draft, so save and discard are no-ops and the card footer reports a refused write.
- `dsh-task-board-team` joins the shared card trio's consumer list in `scripts/sync-shared.mjs`; the five generated copies (`settings-form.ts`, `PluginSettingsCard.tsx`, `settings-card.module.css`, `SegmentGroup.tsx`, `RangeBubble.tsx`) are committed like every other consumer's. It deliberately takes no copy of `settings-entry-form.ts`: its fields are written through the board, not through a family settings namespace.
- `@deepseek-ai/dsh-client-store` joins the package's devDependencies for the type the shared slice imports. It stays out of `dsh.client.inject`: `PluginSettingsCard` imports `CardShell` type-only, so nothing of that module reaches the bundle at runtime.

## Alternatives considered

Keeping the block self-contained and copying the chrome into `team.module.css` was rejected: it duplicates the card's border, radius, background and insets in a second home, and the next change to the family card would leave this one behind. The bundle-purity rule already forbids reaching the board's card by import, and the shared-slice mechanism exists for exactly this.

Fixing only the flex rows and leaving the bare block was rejected as insufficient: the block would still render as invalid list content with no chrome, so the topic list would keep showing one uncarded item between carded ones.

Dropping the block's own save row in favour of the card's staged form was rejected: these fields are not a family settings namespace — the Host Token never enters the settings namespace and the rest is written through the board's action channel — so there is no `CardForm` to stage over, and introducing one would move the write path.

## Consequences

The team block is now visually indistinguishable in structure from the sibling provider card: same chrome, same row rhythm, same control column.

`dsh-task-board-team` carries five generated client copies. They must not be hand-edited: change `shared/client/settings/` and run `node scripts/sync-shared.mjs`, which `test:scripts` gates.

The dedicated-input row for the Host Token is now a normal field with the status word beside its label and the paste sentence as its hint; the long placeholder became the short `section.token.placeholderShort` because a 220px control clips it. Five card-vocabulary keys (`settings.collapse`, `settings.expand`, `settings.notExposed`, `settings.readOnly`, `settings.saveFailed`) joined the package dictionaries and the Russian mirror in `dsh-i18n`.

## Testing

`pnpm --filter @linxin666/dsh-client-ui-task-board-team test`: 94 tests pass across 11 files, including the new `tests/settings-card.spec.tsx`. It renders the section to static markup and pins the three properties this defect was about — the root is a card of the topic list, every row carries the shared field class and none carries the hand-rolled row class, and each of the five inputs is bound to a label of its own.

`typecheck` and `build` pass for the package; `pnpm i18n:check`, `pnpm docs:check` and `node scripts/sync-shared.mjs --check` pass.

GUI evidence, same settings page, same 1280x800 viewport and theme, taken from the running host: before the fix the block sat borderless inside the parent card with `Hub 地`/`址` and `团队`/`ID` wrapping and the preset-pin row interleaving with its verdict; after the fix it is a bordered nested card titled 团队协作 with single-line labels, one control column, and the capability reason under its name. The same screenshots show the sibling GitHub card unchanged.
