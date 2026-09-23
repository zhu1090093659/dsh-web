# Agent Note: Collapsible aggregate child list in the plugin manager

Status: implemented

## Problem

A bundle such as `@linxin666/dsh-web-all` claims 40+ entry rows, more than 20 of them user-visible family plugins. Issue #1439: the plugin manager tab rendered every child row inline under its owning package row, so each installed aggregate added 20+ switch rows to the settings page and pushed the built-in product switches far below the fold.

## Decision

The child list is a collapsed disclosure. The owning row renders a toggle button carrying a `N/M child plugins on` summary (`childrenSummary`), with `aria-expanded` and `aria-controls` pointing at the list; the child rows and the `childrenHint` paragraph render only while expanded. The list starts collapsed on every mount, and each parent row expands independently, keyed by the owning plugin id.

## Alternatives considered

- Native `<details>/<summary>`: no controlled `aria-expanded`, and the summary text has to track the React row model (counts and the locked-row hints) anyway.
- Persisting the expanded set in `localStorage` or the profile: a default-collapsed list already answers the request and adds no new durable state.
- Auto-expanding while a child toggle is in flight: the row refreshes from the returned parent row, so the summary updates without the list jumping.

## Consequences

- Rows with `children === []` render neither the toggle nor the hint (the previous code rendered an empty list plus the hint).
- The parent row keeps its existing `enabled`/`disabled`/`mixed` label, the per-child switch semantics, the `data-plugin-row` anchors, and the `lockedRowHint` for core rows; only visibility changed.
- Counts derive from the row the tab already renders, so a child toggle updates them through the existing "refresh from the returned parent row" path.

## Testing

`packages/dsh-plugin-manager/tests/PluginManagerTab.spec.tsx`: default-collapsed state and summary, expand/collapse round trip, per-parent independence, and the child toggle still calling `setEnabled(entryId, false)` with the summary refreshing to `1/2`. Gates: `pnpm --filter @linxin666/dsh-client-ui-plugin-manager test` and `typecheck`, plus `pnpm i18n:check` for the new zh/en/ru keys.
