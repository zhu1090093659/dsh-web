# Agent Note: Family plugin cards resolve their seat from the loaded settings group

Status: implemented

## Problem

The "Web 插件" settings page of a stock dsh-web install rendered its heading, its description and nothing else. The section declared its child seat `web-ui.plugin.item`, the slot tree showed the seat, and the seat held zero entries — the family configuration cards (task board, remote access, LiangShen mode, and the rest) were unreachable from the UI, with no error anywhere.

Two earlier decisions each looked right on their own and together produced the empty page:

- [Issue batch 1587-1600 fixes](2026-09-16-issue-batch-1587-1600-fixes.md) taught every family card to ask the host which plugin-card seat exists, and to prefer the official keyed `settings.plugin.item` when it is declared. That rule was written from issue #1589, where a profile with the family plugins but no `dsh-web-settings` had no reachable card.
- The harness ships `ui-settings-plugins` in the web bundle, and that package's `configurable` tab declares `settings.plugin.item` unconditionally, before any external plugin's `apply()` runs.

So in the one deployment the family group exists for, the probe answered "the official seat is declared", every card went to the official Plugins tab, and the group's own section was left with nothing to render. The family cards were not lost — they rendered correctly in 设置 → 插件 → 插件配置 — but the section whose entire purpose is to host them could never fill. Any plugin order produced the same result, because the official declaration always precedes external application code.

## Decision

Seat selection keys on the settings group being **loaded**, not on the official seat being **declared**. `installPluginCard` (`shared/client/settings/plugin-card-seat.ts`) contributes to the family list seat `web-ui.plugin.item` when `ctx.get('webUiSettings')` answers a value, and to the official keyed `settings.plugin.item` otherwise.

`webUiSettings` is the service `dsh-web-settings` publishes while it is loaded, and every family plugin already reads it for its settings scope, so the probe adds no new coupling and cannot be fooled by a harness release that changes how it declares the official seat.

The decision is re-evaluated on every `slots/changed`, because the group may apply after the card's own plugin (the aggregate orders it first, a profile that installs the group separately need not). The initial contribution goes to the official seat and moves to the family seat the moment the group registers its section; the previous entry is disposed before the replacement is registered. A re-entrancy latch guards the move: the registry emits `slots/changed` synchronously from inside both `register` and the previous entry's disposer, and an unguarded reconcile re-enters itself mid-move and registers the card twice into the seat it is leaving.

## Alternatives considered

- **Probe the family seat's live declaration with `slots.inject('web-ui.plugin.item', …)`** (the family convention before #1589): rejected. It re-introduces the load-order defect that #61/#62 reported — a card whose plugin applies before the group section never fires and silently contributes nothing — and `inject` does not observe a declaration that collapses and re-forms.
- **Probe the family seat's entry count as a "is the group rendering" signal**: rejected. The group's section registers its entry first and declares the child seat last, so a count of zero also describes a group that is loading right now; the probe would answer "no group" inside the very deployment it is meant to detect.
- **Register into both seats and let the renderer pick**: rejected — a slot has one parent, so the second registration throws, and the sidebar/dialog would show the family card twice in a tab that already lists the built-in cards.
- **Rename `web-ui.plugin.item` back / drop the family seat and keep only the official one**: rejected. It removes the group's own first-level section, which is the documented product surface; the section, its nav entry and the family copy all exist to hold these cards.
- **Declare the family seat from `dsh-web-settings` at a point that always precedes external plugins** (the pre-#1589 family design): rejected as the sole mechanism, because a profile that installs a family plugin without the group then has no reachable card at all — the exact gap #1589 filed.

## Consequences

- The "Web 插件" section renders its family cards again on a stock install, and the official Plugins tab keeps only its own built-in cards plus the plugin-manager tab.
- A profile with family plugins and no `dsh-web-settings` still reaches every card through the official keyed seat; the #1589 outcome is preserved.
- The card follows the group across any apply order: installing the group later moves the card into the section without a reload.
- Five shipped plugins (remote-web-ui, task-board, doctor, tool-describe-image, liangshen) change seat behavior together, through the one generated shared module.
- The seat is decided once per card and re-decided only on a seat change, so a group that is loaded but whose section is never registered leaves the card in the official seat rather than oscillating.

## Testing

- `packages/dsh-remote-web-ui/tests/plugin-card-seat.spec.ts` pins the group-loaded family registration (with the official seat also declared), the group-absent official registration, the move from the official seat to the family seat when the group arrives, the no-op reconcile while the seat is unchanged, the logged refusal, and the two probe fallbacks.
- `packages/dsh-remote-web-ui/tests/remote-entry.spec.tsx` asserts the card lands in `web-ui.plugin.item` when the group service is present, and keeps the sidebar-entry lifecycle assertions unchanged.
- Real-GUI verification on the shipped web profile: 设置 → Web 插件 lists 远程访问设置 / 任务看板 / 梁神模式 and a card expands to its full form; 设置 → 插件 → 插件配置 lists only 上下文 / 终端 / Agent 循环 / Subagent / 网页搜索; the browser console reports no refused registration.
