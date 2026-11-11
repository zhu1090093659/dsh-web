# Agent Note: Task-board card surfaces on one presentation contract

Status: implemented

## Problem

Every task-board surface answered the same question — what is this card, and what will running it do — with a scale of its own. The detail panel stacked nine same-weight buttons, four type sizes (15/13/12/11px), and a full acceptance report inside every execution row, so a card with thirty-four runs repeated the same machine sentence thirty-four times and the scan layer carried no signal. The board columns and cards used a second scale (11px and 10px meta lines), the dialogs a third (12.5px region headers), and the markdown renderer inside the panel a fourth (16/15/14/13/12.5/12/11px, with a 1px step between h2 and h3). Nothing in the repository made any of those budgets checkable, so each surface drifted on its own.

## Decision

One presentation contract, declared in `packages/dsh-task-board/src/client/board.module.css`, `task-markdown.module.css` and the task-board locale dictionaries, and asserted mechanically in `tests/responsive-css.spec.ts`, binds the panel, the board columns and cards, the dialogs, and the markdown renderer.

### Type scale

A surface renders at most three sizes and carries the remaining levels with weight and colour. The panel uses 15 (title), 13 (body) and 12 (meta); the dialogs 16, 13 and 12; the markdown renderer 16 for h1 and h2, 13 for h3 to h6 and body copy, and 12 for code and image placeholders, with depth carried by weight (700/600/600/600/500/500) and colour (`label-primary`, `label-secondary`, `label-tertiary`). No surface declares 11px or 12.5px.

### Outcome slots

Status and result badges read one filled slot per outcome: warn is the rest state, success and error read their `-secondary` fill under `-primary` text, and cancelled reads the neutral `interactive-bg-hover`. No badge family keeps a transparent fill, so two instances of one badge never reach a single state through two colours. The six-hue label palette stays a declared exemption: it identifies a tag, not a state.

### Disclosure

Folding is one behaviour with one contract. A region row owns `aria-expanded`, an `aria-controls` id, `data-open`, the chevron, a one-line summary of what the closed region holds, a paired enter and exit animation (`dshTbRowsIn` / `dshTbRowsOut` on one easing and one duration pair, with reduced motion collapsing to opacity alone), an unmount only after the exit leg completes, and focus returned to the row when the body holding focus closes. The panel's folds, the dialog's regions, and the execution log all ride that one pair (as did the former acceptance report before its [2026-11-11 removal](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md)); the file declares one `@keyframes` pair.

### Reading order and rhythm

The panel is two tracks at a viewport of 1024px or wider — content on the left, how this run will run on the right — and one column in the same order below that. Workspace, preset, permission, model and reasoning effort stay visible; session reuse folds into one "Advanced" row whose closed summary echoes whether it is on (the former `/goal` and skip-acceptance switches were removed in [2026-11-11](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md)). Scheduled runs and execution history are one fold row each, their summaries naming the state, and history lists five runs until it is expanded. Status moves are one menu, and the footer holds one primary, one ghost and one danger action with the created stamp between the primary and the danger.

Consecutive folds form a group (`.detailFolds`, 8px) rather than joining the 16px section rhythm, so a fold row is 30px and the pitch between two folds is 38px against 58px before the change.

## Testing

`tests/responsive-css.spec.ts` parses the declarations and asserts each budget: the detail region's size set equals {12px, 13px, 15px}, the dialog region's {12px, 13px, 16px}, the markdown renderer's {12px, 13px, 16px}, the fold row box at 30px or less, the group gap at 12px or less, the fold pitch at 44px or less, one filled background per badge rule, no literal colour on a changed line, and one keyframe pair shared by the panel and the dialog legs. `tests/task-detail-panel.spec.tsx` asserts the reading structure: five runs until expanded, a closed fold whose summary echoes whether session reuse is on, and the footer's three actions in order.

## Alternatives considered

Folding the long explanations without shortening them was the first proposal, and it loses the root cause: the copy is the defect, because four paragraphs of 60 to 90 characters each restated a switch the row already names. The decision keeps one line per switch and demotes the long form to the row's tooltip.

Pure visual polish — spacing, colour and weight with no copy and no structure change — was rejected because the two loudest findings were structural: the repeated verification sentence lived in how the data was presented, and nine equal-weight buttons were an ordering defect rather than a spacing one.

Folding the permission gate and the status badge into "Advanced" was rejected. A blocking confirmation and the card's current column are decisions a human acts on, and a disclosure in front of either turns a visible obligation into a hidden one.

Re-recording the `test-standards` baseline instead of rewriting the assertions this rework introduced was rejected. The gate's `baseline -> current` counts showed ten tautological assertions, one title without a role, and six bodies without a stated precondition, all introduced by this work; re-recording would have frozen that debt and hidden it behind a green run.

Sharing the panel's scoped overrides with the dialog's base rules was rejected: the dialog keeps its own rhythm (8px region gap, 8px 10px 10px body padding) and only its region header joins the contract, so the surfaces agree on behaviour, type and slots without either dictating the other's spacing.

A third disclosure component written for the panel was rejected: two implementations would have diverged in keyboard and motion behaviour within one release.

## Consequences

The panel's fold no longer clips, so a 44px hit target fits a 30px row: `.detailBody .formSection` is `overflow: visible` and the header carries the section's inner radius itself. Inside the 8px gap the two 44px targets overlap by 6px, so the lower part of a gap belongs to the next row. The row itself is 30px, above the 24px floor of WCAG 2.5.8, and tightening the rhythm was the explicit request, so the overlap is accepted rather than paid for with a 44px pitch.

`.cardTag` serves the card and the panel's label row alike, so its 12px size reaches both surfaces; that is intended, not leaked. The card surface's own scale — columns, cards, density — is asserted by the same spec under its own region slice.

Two surfaces stay outside this contract on purpose: the board settings card (`settings-card.module.css`, a settings surface rather than a card surface) and the six-hue label palette.

Every claim about rendered geometry — the two tracks at a real 1024px viewport, the shared right edge of three summaries, the hover fill over a radius that moved from the section to the header, and the 44px target on a touch screen — is asserted from declarations and DOM structure only. jsdom has no layout, and this session did not reload a running GUI, so a screenshot pass is still the proof for those.
