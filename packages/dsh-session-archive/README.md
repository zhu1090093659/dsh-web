# dsh-session-archive

English | [中文](README.zh.md)

Session archive management for DSH Web: one place to see every session, archive or restore them in bulk, and physically delete sessions with a full, auditable pipeline. Optional (default-off) automatic policies archive long-inactive sessions and purge expired archives.

## What it does

- **Complete inventory**: every session the host can see — active, archived, blank, sub-agent, workspace-less, and historical sessions with incomplete metadata — with title, session ID, workspace, last activity, status, archive time (or an explicit "unknown"), size, and child-session counts.
- **Filter, search, sort**: by status (all / unarchived / archived), workspace (including no workspace), title or ID search, last-activity / archive-time / creation-time / title / size sorting, and a "sessions with issues" quick filter. The result count is always shown.
- **True multi-select**: per-row checkboxes, per-workspace select/deselect, and select-all that covers the complete filtered result set — not just rendered rows. Selection is kept across filter changes with an explicit note when selected items fall outside the current filter.
- **Batch operations**: archive, unarchive, and physical delete over the selected set, executed as bounded server-side chunks with live progress, per-session results (success / skipped with reason / failed with reason), and a retry-failed-only action. The current session, running sessions, and sessions with running descendants are always protected and skipped with an explanation.
- **Physical delete with cascade semantics**: deleting a session also removes its storage (jsonl.zstd directory or session-rdb rows), workspace accounting, archive-set entries, projection cache, and the plugin's archive ledger. Deleting a parent pulls in all descendants; a family containing any protected member is skipped whole — never half-deleted. Deletion requires an explicit confirmation that states the direct count, the cascade count, the final total, the skipped protected count, and the estimated freed space; large deletes require an extra acknowledgement.
- **Optional automatic maintenance (off by default)**: auto-archive sessions inactive beyond a threshold (by last-activity time, never creation time) and auto-delete archived sessions past their retention (by the recorded archive time, never file times). Both are independent switches with pre-enable previews, run-now buttons, and persisted last-run/next-check status. Sessions archived before this plugin existed have no reliable archive time, are shown as "unknown", and are never auto-deleted.
- **Safe by construction**: all routes are loopback-fenced (tunnels and LAN clients get 403), deletion never follows symlinks outside the sessions root, and operations serialize so two batches can never interleave.

## Install

```sh
pnpm add @linxin666/dsh-session-archive
```

The family bundle (`dsh-web-all`) includes this plugin. For a standalone profile mount:

```sh
dsh plugin --profile web add link:/path/to/dsh-web/packages/dsh-session-archive
```

Restart `dsh web`. The plugin **takes over the official "Archived sessions" Settings entry** rather than adding a parallel first-level one: it seats the same `settings.section` id (`archived-sessions`) and nav order (25) that `@deepseek-ai/dsh-client-ui-settings-unarchive-sessions` uses, and `dsh-web-all` retires that official row, so Settings shows a single archive entry carrying both the official restore behaviour (the section opens on the archived view) and this plugin's management surface.

With the aggregate the consolidation is automatic. A standalone install next to the official page renders two entries instead; disable one of the two rows in Plugins so only one archive entry mounts.

## Configuration

The settings section exposes:

- `enabled` — turn the whole management surface off.
- `autoArchiveEnabled` + `autoArchiveDays` (1–3650, default 7) — auto-archive threshold by last activity.
- `autoDeleteEnabled` + `autoDeleteDays` (1–3650, default 7) — archive retention before physical deletion.
- `checkIntervalMin` (15–1440, default 60) — scheduler cadence for the automatic checks.

Invalid or out-of-range values are never saved; the form shows a validation message.

## Semantics you should know

- **Archiving never deletes data.** An archived session only disappears from grouping surfaces; unarchiving restores it with its workspace slot intact.
- **Physical delete is unrecoverable.** It removes the session history, metadata, workspace association, archive records, projection cache, and other session-owned data. Shared, content-addressed attachments are left alone (they may be referenced by other sessions); orphaned attachment objects are not garbage-collected by this plugin.
- **Archive times are recorded by this plugin.** Sessions archived before installation show "archive time unknown" and stay outside auto-delete until a human deletes them or they are unarchived and re-archived (which restarts the retention clock).
- **Protected sessions are never deleted, manually or automatically**: running sessions, the session you are currently viewing, sessions with running children, and sessions already inside another archive operation. Forced stops never happen.

## Security model

All HTTP routes (`/api/dsh-session-archive/*`) are fenced to loopback sockets with a loopback Host header and browser same-origin markers; `X-Forwarded-For` is never trusted. Deletion resolves storage paths only through the plugin's own sessions-root index, re-validates realpaths before removal, and rejects anything outside `$DSH_HOME/sessions`. Clients send session IDs only — never file paths. The session-rdb store (SQLite) is fingerprint-checked before any row deletion.

## Known limitations

- Remote-browser users (LAN or `dsh-remote-web-ui` tunnels) cannot operate this section; every route is loopback-only by design, because it can destroy local session data.
- Sessions missing from the host feed and the projection cache are flagged "incomplete metadata" and excluded from automatic flows.
- Attachments under `$DSH_HOME/attachments` are shared and content-addressed; this plugin does not reclaim orphaned ones.
