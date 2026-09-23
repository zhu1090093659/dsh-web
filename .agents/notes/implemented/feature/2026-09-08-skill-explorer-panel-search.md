# Agent Note: Skill Explorer panel search with stacked workspace filtering (Issue #1423)

Status: implemented

## Problem

The skill center panel listed every loaded skill grouped by source, and a
workspace picker filtered project skills by workspace, but there was no way to
find a skill by name once dozens were loaded: users scrolled and eyeballed each
group. Source grouping answers "whose skill is this and where does it live",
not "where is the skill called X". The panel needed an in-panel search that
composes with the existing source grouping and workspace picker instead of
replacing them.

## Decision

- Added `src/client/skill-filter.ts`: pure `matchRank` (name hit 0,
  description hit 1, no hit undefined) and
  `selectGroups(groups, { workspace, query })`, which applies the workspace
  axis first, then the query, ranks name hits before description hits (a stable
  sort keeps host order inside a rank), and drops groups that became empty.
  Skills without a workspace root are global and stay visible under every
  workspace selection, which is the pre-search behavior.
- `SkillPanel.tsx` ListTab owns the `query` state and renders one
  `filter-bar` holding the search input, its clear button, and the existing
  workspace picker. When the combined filter hides everything it renders
  `filter.empty` (query present) or `filter.emptyWorkspace` (workspace only)
  while keeping the filter bar usable. Group structure and the
  enable/disable/delete actions stay intact while filtered.
- Escape inside the search box clears the query without closing the panel; the
  panel's document-level Escape handler already ignores form-field targets.
- i18n: `filter.searchLabel`, `filter.searchPlaceholder`, `filter.clear`,
  `filter.empty`, `filter.emptyWorkspace` in zh/en, mirrored into the ru
  dictionary owned by `dsh-i18n`.
- The L2 semantic-attribute contract gains `filter-bar` (owner
  skill-explorer).
- Both READMEs document the search box and its stacking with the workspace
  picker.

## Testing

- `tests/skill-filter.spec.ts`: rank order, case-insensitivity, empty needle,
  workspace stacking with global skills, empty-group dropping, and that the
  payload is not mutated.
- `tests/panel.spec.tsx`: typing filters rows with name hits first, the empty
  state plus clear button restore the list, and Escape clears without closing
  the panel.
- Gates run for this change: package typecheck and tests, `pnpm i18n:check`,
  `pnpm docs:check`.

## Alternatives considered

- Server-side search (`?q=` on the list route): rejected. The payload is
  already in the browser, a round trip would add latency, and the host route
  would need its own tests for a purely presentational filter.
- Sorting across groups by match rank: rejected. It would destroy the source
  grouping the panel is built around; ranking happens inside each group.
- Matching `whenToUse` as well: rejected for now. The request scopes search to
  name and description, and `whenToUse` is derived guidance text that would
  inflate description hits without a ranking signal.
- Fuzzy matching (Fuse.js style): rejected. Substring matching is predictable,
  dependency-free, and the panel lists tens of skills, not thousands.

## Consequences

- Finding a skill no longer requires scrolling, and the filter composes with
  source grouping and the workspace picker.
- The panel now distinguishes "no skills loaded" from "nothing matches the
  current filter".
- Search state is component-local and resets when the panel closes, like the
  panel's other ephemeral state.
