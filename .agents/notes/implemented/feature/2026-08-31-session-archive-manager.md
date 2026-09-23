# Agent Note: Built-in Session Archive Manager Plugin (dsh-session-archive)

Status: implemented

## Problem

The family bundle had no native way to manage sessions at scale. The only archive surface was the official sidebar's per-session "archive" toggle (a registry-global hidden set with no unarchive verb in the alpha.2 SDK), and the third-party `@mlgbnb/dsh-archive-manager` — the previous archive UI — stayed excluded from the alpha.2 bundle because its build imports the removed `@deepseek-ai/dsh-client-runtime` face. Users with thousands of cold sessions had no way to view them, batch-archive them, restore them, or physically delete them, and no automatic policy could reclaim disk space safely.

## Decision

Ship a new family plugin `packages/dsh-session-archive` (`@linxin666/dsh-session-archive`), mounted in the aggregate below the Workshop section (order 152), with:

- **Inventory**: one host-side pass merges the authoritative session feed (`sessionController.list` — cold sessions included, agents never activated), the workspace registry (membership + global archive set), the projection-cache index (titles/creation facts), the on-disk sessions root (sizes, feed-missing rows), and the plugin's own archive ledger. Rows exist only for feed-listed or on-disk sessions — cache or ledger entries alone never conjure rows. A canonical-segment mapping (`session-<uuid>` vs bare-uuid dirs) prevents phantom duplicates.
- **Archive/unarchive**: archive goes through the public `workspaceRegistry.archiveSession`; unarchive and workspace-row cleanup go through the registry's durable domain seams (`requireState`/`setState`, entity `mutate`), which emit domain change events so connected browsers see `{ type: 'archived' }` follow frames and workspace upserts live. The seams are feature-detected and fail with `missing-seam` rather than ever editing `workspace.json` behind the registry.
- **Physical delete pipeline** in fixed order: archive set -> workspace rows -> storage (rdb rows via fingerprint-checked `node:sqlite`, then the session directory through a realpath-validated sessions-root index) -> projection cache -> archive ledger. A crash between steps leaves the session unlisted-but-present (retryable), never half-deleted. Family cascade: deleting a session pulls in all descendants; a family containing any protected member (running in feed, live in the SessionStore, the client-declared current session, or in-flight) is skipped whole with `family-protected`. Deletion paths come only from the plugin's own index; client input is session IDs, never paths. The plan reports every skipped id once: a member reachable through several direct selections stays a single entry, and a directly selected protected id keeps its own reason instead of being claimed by a relative's `family-protected` entry (issue #1503/#1504 semantics live in `core/cascade.ts`; the batch total and the result list are derived from that list, so duplicates would also stall the progress bar).
- **Batch UX**: browser half plans with the same core `planDelete` rules the host re-validates (`expectedTotal` mismatch answers 409 with the host plan), chunks deletes family-intact (<=200 sessions per request), shows live progress with per-session skip/fail reasons, and supports retry-failed-only. Select-all covers the complete filtered result set because the inventory is complete client-side; selection survives filter changes with an explicit "N selected items fall outside the current filter" note.
- **Automatic policies, independent and default-off**: auto-archive seeds from last-activity time (feed `updatedAt`, reliability-flagged); auto-delete seeds from the ledger-recorded archive time, requiring it to be known and strictly before the run started (same-tick archives are never auto-deleted; pre-plugin historical archives with unknown time are never auto-deleted). A scheduler (15–1440 min, catch-up on boot, fail-fast operation lock) persists run stats and next-check time under `$DSH_HOME/dsh-session-archive/`.
- **List rendering**: paginated at 20 rows per page (prev/next + page indicator; filter and sort changes reset to the first page), and the section opens on the ARCHIVED tab by default. Pagination is a render window only — select-all still spans the complete filtered result set.
- **i18n**: zh key source + en mirror in-package; ru ships centrally in `dsh-i18n` (`dsh-web-ui-session-archive` namespace).

## Alternatives considered

- **Restore the third-party `@mlgbnb/dsh-archive-manager`**: rejected — its latest build imports the removed `dsh-client-runtime` face, it reaches deeper into registry internals without feature detection, and it lacks family-cascade, protection, and ledger semantics the requirements demand.
- **Direct `workspace.json` file edits for unarchive**: rejected — the registry holds in-memory durable state and would flush stale archive sets back; only domain-handle writes (`setState`/`mutate`) are both durable and feed-visible.
- **Client-side per-row delete calls**: rejected — resource create/destroy churn against the requirement's bulk-safety rule; chunked family-intact batches bound the work per request.
- **File-mtime-based automatic policies**: rejected by the time-basis requirements — auto-archive must read last-activity, auto-delete must read the recorded archive time; both are authoritative feed/ledger facts.

## Consequences

- `pnpm i18n:check` now audits 16 namespaces / 1298 keys; the ru pack covers the new namespace.
- `sync-shared` grew by four copies (mount-once, dsh-home, host/http, host/loopback); copy-count assertions in `scripts/sync-shared.test.mjs` were updated.
- The external `@mlgbnb/dsh-archive-manager` stays excluded; the root README feature list now points archive needs at the built-in plugin.
- New host-face devDependencies (`@deepseek-ai/dsh-workspace`, `@deepseek-ai/dsh-api-session-controller`) joined the root and `dsh-web-all` closures for link-profile resolution.
- The external archive-manager aggregate-test invariant (`aggregate.test.mjs`) is untouched — it still asserts the third-party plugin is NOT mounted.

## Testing

- Package suite: 71 tests across 8 spec files covering cascade planning (family expansion, whole-family protection, dedupe, not-found), time-basis rules (last-activity vs archive-time, unknown-archive-time exclusion, same-tick guard, default-off config), selection/filter/sort semantics, ledger persistence, inventory merge + ghost/no-data rows, sessions-root path safety (symlink escape), rdb fingerprint + cascade delete, the full janitor pipeline (single delete removing every trace, running/current/live protection, family protection, partial failure, plan mismatch, busy lock, auto cycles, preview), route fencing/contracts (loopback + same-origin fence, method gates, 409 plan-mismatch/busy), and client chunking/progress/retry.
- Repo gates green: `pnpm typecheck`, `pnpm test`, `pnpm test:scripts`, `pnpm aggregate:check`, `pnpm sync-shared:check`, `pnpm i18n:check`, `pnpm docs:check`, `pnpm build`, `pnpm runtime-deps:check`.
- Live end-to-end verification on the running DSH Web GUI is recorded separately in this note's sibling validation snapshot once the profile mounts the new bundle.
