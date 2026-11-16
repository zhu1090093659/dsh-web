# Agent Note: Built-in plugin search and bounded pagination

Status: implemented

## Problem

The built-in plugin group can widen from the small set of global Loader rows to every row in the deployment. Rendering that complete set in one list made the official Plugins page hundreds of rows long, and finding one module or entry required scrolling through unrelated package rows.

## Decision

The group in `packages/dsh-plugin-manager/src/client/BuiltinPlugins.tsx` filters the already-read rows locally. A trimmed, case-insensitive query matches the localized title, module package, entry id, and owning bundle in the currently selected scope. The heading count reflects the filtered result, a distinct empty state appears when no row matches, and Escape clears the query.

The filtered result renders in pages of at most 20 rows with previous and next controls and a page/result summary. Searching, clearing the query, or changing scope returns to page one. The current page is clamped to the available result pages, and duplicate-label detection runs over the filtered result rather than only one page. Search, scope changes, and pagination do not re-read the Loader, call the manager, or alter enablement; the official write and post-write re-read paths are unchanged.

The controls use the package's existing theme-token styles, wrap on narrow screens, and ship Simplified Chinese, English, and Russian copy. The package README documents the same local-view behavior.

## Testing

The built-in component suite has 37 tests. Its search and pagination cases drive the real component through localized-title, module, entry-id, and owner matching; the empty result and Escape recovery; the 20-row bound and second page; the absence of Loader reads and manager writes behind view changes; and first-page reset after search, clearing, and scope changes. The focused suite passes.

## Alternatives considered

- **Append another page with a Load more control:** rejected because the DOM and page still grow without bound after repeated clicks, while the main problem is the length of the management page itself.
- **Keep one list inside a fixed-height scrolling container:** rejected because it introduces nested scrolling and hides the official page's natural flow. Pagination bounds both the rendered rows and the outer page length.
- **Add host-side search and pagination:** rejected because both scopes already come from one complete snapshot. A host query API would add a contract and network work without changing any authoritative data or write behavior.

## Consequences

A reader can search and page through the expanded inventory without rendering more than 20 built-in rows at once. Search remains scoped: bundle-owned rows participate after the reader widens the list. Query and page state are component-local and are not persisted across an unmount. Agent preset composition and rendering are outside this change.
