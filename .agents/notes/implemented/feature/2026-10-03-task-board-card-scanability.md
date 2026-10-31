# Agent Note: Task Board Card Scanability

Status: implemented

Provider source grouping now wraps the recency groups described here; see [Task board source grouping](../architecture/2026-10-31-task-board-source-grouping.md) for the current column and archive layout.

## Problem

A board fed by GitHub issue sync held a Done column of more than a hundred cards that all read alike. Every excerpt began with the same issue-form boilerplate (a duplicate-search checkbox, a plugin field, an issue-type field). Every card read "updated 4m" because each sync touched `updatedAt`. A card in Done showed a red "1 run" whenever its latest run had failed and the issue was closed upstream, which looked like a contradiction. The provider's issue badge stretched across the full card width: it was a direct child of the card's vertical flex column and inherited `align-items: stretch`. The day-old time label used the browser's local date while the tooltip used the Host zone. Finally, the card was itself a `<button>`, so it could not host its own controls (open the session, open the issue).

## Decision

- **Pure view model.** `packages/dsh-task-board/src/client/board/card-view.ts` derives everything the card shows from the record: `splitTitleKind` (a bracketed `[Bug]:` prefix becomes a badge), `cardOutcome` (stripe tone and the `declared` flag), `cardTimeline` (which instant the column shows), `groupByRecency` (Today / Last 7 days / Earlier in the Host calendar), and the stored per-column density (`dsh.taskBoard.compactColumns.v1`; Done starts compact). Nothing here writes the ledger.
- **Excerpt without boilerplate.** `markdownExcerpt` in `task-markdown.tsx` drops headings, all-checkbox lists, raw HTML, rules, and empty-field placeholders, and prefers the body of a summary-like section. The heading and placeholder vocabulary lives in `src/core/issue-form.ts` because it is data about issue forms, not UI copy. A description that loses everything falls back to its full plain text.
- **Outcome and time.** A 3px left stripe (`data-tone`) shows the latest run's outcome. The run label reads "last failed · 1 runs". When the column disagrees with that run (Done after a failure, Failed after a success), it adds "set by hand" with an explanatory tooltip. The time label shows created (Backlog/To Do), started (open run), settled (Done/Failed), or archived, and is formatted by `formatCardTime` in the Host zone.
- **Article plus stretched button.** The card is an `article` carrying the drag source. A transparent `button[data-dsh-part="card-open"]` covers it and is the keyboard and accessibility target, labelled with the title, the run state, the declared flag, and the labels. The article's click handler opens the detail unless the click landed on another button or a link. The session quick action (`card-session`) and a provider link therefore act on their own.
- **Decorations join the meta row.** The `task-board.card.decoration` seat renders inside `.cardMeta` as an inline chip. The GitHub badge is an `a` that opens the issue in a new tab when the stored URL is http(s), and a plain `span` otherwise. The seat contract (`{ task }` props, list scope) is unchanged.
- **Long columns.** Each column header has a density toggle. Done, Failed, and the archive render in recency groups, newest first. Past 30 cards the oldest group folds behind a disclosure, and an active text or label search never folds.

## Alternatives considered

**Keep the card a `<button>` and stop propagation inside it.** Nested interactive content inside a button is invalid HTML; browsers and assistive technology handle it inconsistently, and the provider badge could not become a real link. The article plus stretched button is the standard card pattern and keeps a single keyboard stop.

**Let providers override the excerpt through a new seat.** A seat would let the GitHub extension supply a clean summary, but it extends the provider contract for a problem that is about issue-form text in general (it also hits cards pasted from issues by hand). A board-side heuristic with a full-text fallback covers both without a contract change.

**Keep "updated" as the only time and stop syncs from bumping `updatedAt`.** That changes ledger semantics that the Host, tools, and providers rely on. Choosing the instant per column is presentation only.

**Virtualize the Done column instead of grouping and folding.** Virtualization keeps scrolling cheap but leaves the reader scrolling past a hundred near-identical rows. Grouping plus density addresses the reading problem, and the fold bounds the DOM for the common case.

## Consequences

- Skins that target `[data-dsh-part="card"]` keep matching. The element is now an `article`, so a selector written as `button[data-dsh-part="card"]` no longer matches. The new parts and attributes are listed in the semantic-attrs/v1 contract (dsh-skins `contracts/semantic-attrs-v1.md`).
- The board's provider contract is unchanged ([task board extension contract](../architecture/2026-09-30-task-board-extension-contract.md)). Decorations now render as inline chips beside the board's own badges.
- Dragging still follows [drag and drop status changes](2026-08-26-task-board-drag-drop-status.md); the drag source moved from the button to the article.
- The density preference is per browser, not per Host; a second device starts from the default.
- The excerpt heuristic recognizes the headings in `issue-form.ts`. An unfamiliar template degrades to "first non-boilerplate paragraph", never to a blank card.

## Testing

`tests/card-view.spec.ts` covers the view model, Host-zone recency at a day boundary, the stored density, and the excerpt. `tests/compact-card.spec.tsx` covers the rendered card: kind badge, excerpt, declared outcome, settlement time, session quick action, and compact density. `tests/board-view.spec.tsx` covers the grouped, folded, and compact Done column end to end. `dsh-task-board-github/tests/github-ui.spec.tsx` covers the issue link and its non-http fallback.

The [card surface contract](2026-10-20-task-board-card-surface-contract.md) owns the type scale, outcome slots and fold behaviour of these surfaces.
