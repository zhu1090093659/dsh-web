# Agent Note: Task board source grouping

Status: implemented

This decision extends [Task Board external provider extension contract](2026-09-30-task-board-extension-contract.md) with an optional browser capability and partially supersedes the column-only grouping in [Task Board Card Scanability](../feature/2026-10-03-task-board-card-scanability.md).

## Problem

A board ingesting several repositories mixed every source inside each status column. Recency groups alone did not show repository ownership, and a Done column containing hundreds of synchronized cards remained expensive to scan even after density and oldest-group folding.

## Decision

The browser client contract adds an optional API-v1 capability:

```ts
interface TaskBoardSourceGroup { id: string; label: string }
type TaskBoardGroupingSelector = (task: TaskRecord) => TaskBoardSourceGroup | undefined
registerGrouping?(selector: TaskBoardGroupingSelector): () => void
```

- The board controller and client service replay registrations made before attach, notify on registration and disposal, and preserve a disposer's ability to remove the live registration after attach. The first selector returning a valid group claims the card; selector failures degrade to the local group. These functions live only in browser memory.
- GitHub interprets its own payload and returns a case-stable `github:owner/repository` id plus the full original `owner/repository` label. The board consumes only generic id/label values and never learns GitHub vocabulary.
- All five main columns and the archive group by source, sort provider groups by full label then id, and put unclaimed cards in a localized Local tasks group last. Empty groups are omitted and drag/drop remains a column operation.
- Backlog, To Do and Running preserve card order within a source. Done, Failed and the archive nest the existing recency groups per source; the more-than-30 oldest-recency fold is scoped by column and source.
- `dsh.taskBoard.sourceGroupFolds.v1` stores explicit view/source boolean overrides. Done sources start collapsed, all other main columns and the archive start expanded, and text or tag search force-expands every rendered group with a match while disabling recency folds.
- Source containers reuse `card-group` and `card-group-toggle`; only inner recency groups carry `data-group=today/week/earlier`, so no semantic-attribute enum or satellite contract changes.

## Alternatives considered

**Read `integrations.github.owner` and `repository` directly in the board.** Rejected: it recouples the generic board to one provider and violates the opaque-payload boundary.

**Add a typed source field to the ledger or Host snapshot.** Rejected: this is presentation metadata derivable in the browser, so a durable migration and a wider wire contract buy no correctness.

**Offer only a repository filter or virtual scrolling.** Rejected: a filter cannot compare several repositories at once, and virtual scrolling still makes the reader traverse visually similar cards instead of collapsing whole sources.

## Consequences

- A provider adds source grouping without a board API-version bump or Host change; an older board simply omits the optional method and keeps the provider's other seats.
- Done initially renders source headers and counts instead of every card, while search never hides a match behind a fold. Preferences remain browser-local.
- Any provider selector must be cheap and pure because grouping runs during board render, and its id must be provider-namespaced and stable for fold persistence.

## Testing

Pure source-group tests cover ordering, local fallback, faulty selectors, defaults and persistence. Client-face tests cover pending replay, first-match ownership and live disposal. Board-view tests cover all five columns, the archive, Done folding, search reveal, per-source recency folding and existing drag/drop behavior; GitHub tests cover case-stable repository grouping and operation without the optional method.
