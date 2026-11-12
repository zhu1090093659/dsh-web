# dsh-session-archive · Full-Text Session Search, Batch Archiving & Lifecycle Manager for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-session-archive?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Full-Text Session Search, Batch Archiving & Lifecycle Manager for DeepSeek Harness (DSH)</strong><br>
  <em>Centralized Session View · Faceted Search & Filtering · Batch Archive & Cascade Delete · Automated Retention Rules</em>
</p>

A comprehensive session lifecycle and archive management plugin for DeepSeek Harness (DSH) Web GUI and official desktop client: centralized session inventory, batch archive/unarchive, and verifiable cascade physical deletion pipelines with disk space reclamation. Optional automated policies automatically archive inactive sessions and prune expired archives based on retention schedules.

## What it does

- **Complete inventory**: every session the host can see — active, archived, blank, sub-agent, workspace-less, and historical sessions with incomplete metadata — with title, session ID, workspace, last activity, status, archive time (or an explicit "unknown"), size, and child-session counts.
- **Filter, search, sort**: by status (all / unarchived / archived), workspace (including no workspace), title or ID search, last-activity / archive-time / creation-time / title / size sorting, and a "sessions with issues" quick filter. The result count is always shown.
- **True multi-select**: per-row checkboxes, per-workspace select/deselect, and select-all that covers the complete filtered result set — not just rendered rows. Selection is kept across filter changes with an explicit note when selected items fall outside the current filter.
- **Batch operations**: archive, unarchive, and physical delete over the selected set, executed as bounded server-side chunks with live progress, per-session results (success / skipped with reason / failed with reason), and a retry-failed-only action. The current session, running sessions, and sessions with running descendants are always protected and skipped with an explanation.
- **Physical delete with cascade semantics**: deleting a session also removes its storage (jsonl.zstd directory or session-rdb rows), workspace accounting, archive-set entries, projection cache, and the plugin's archive ledger. Deleting a parent pulls in all descendants; a family containing any protected member is skipped whole — never half-deleted. Deletion requires an explicit confirmation that states the direct count, the cascade count, the final total, the skipped protected count, and the estimated freed space; large deletes require an extra acknowledgement.
- **Optional automatic maintenance (off by default)**: auto-archive sessions inactive beyond a threshold (by last-activity time, never creation time) and auto-delete archived sessions past their retention (by the recorded archive time, never file times). Manual and automatic archiving both support bare UUID and `session-`-prefixed IDs, while the archive ledger uses canonical IDs. Both are independent switches with pre-enable previews, run-now buttons, and persisted last-run/next-check status. Sessions archived before this plugin existed have no reliable archive time, are shown as "unknown", and are never auto-deleted unless the optional backfill below is enabled.
- **Safe by construction**: all routes are loopback-fenced (tunnels and LAN clients get 403), deletion never follows symlinks outside the sessions root, and operations serialize so two batches can never interleave.

## Install

```sh
pnpm add @linxin666/dsh-session-archive
```

The family bundle (`dsh-web-all`) includes this plugin. For a standalone profile mount:

```sh
dsh plugin --profile web add link:/path/to/dsh-web/packages/dsh-session-archive
```

Restart `dsh web`. The plugin adds its own Archived sessions Settings entry: it seats the plugin's own `settings.section` id (`dsh-session-archive`) at nav order (25), carrying this plugin's management surface. The section opens on the archived view.

The section id is deliberately this plugin's own namespace rather than the official `archived-sessions` id. The settings shell renders one nav row per registration and never merges same-id sections, and its registry refuses a second registration of the same `id` at the same `priority` (default 0) while `order` only sorts the rows. Two archive plugins claiming the same section id therefore collide whatever order they pick: one registration throws, or one of the two entries silently disappears. With its own id the entry coexists with the official Archived sessions page and with any third-party archive plugin, one entry each.

A standalone install, or an install with no other archive plugin enabled, shows this single entry.

## Configuration

The settings section exposes:

- `enabled` — turn the whole management surface off.
- `autoArchiveEnabled` + `autoArchiveDays` (1–3650, default 7) — auto-archive threshold by last activity.
- `autoDeleteEnabled` + `autoDeleteDays` (1–3650, default 7) — archive retention before physical deletion.
- `recordManualArchive` (default off) — backfill an archive time for sessions archived outside this plugin; see below.
- `checkIntervalMin` (15–1440, default 60) — scheduler cadence for the automatic checks.

Invalid or out-of-range values are never saved; the form shows a validation message.

## Semantics you should know

- **Archiving never deletes data.** An archived session only disappears from grouping surfaces; unarchiving restores it with its workspace slot intact.
- **Physical delete is unrecoverable.** It removes the session history, metadata, workspace association, archive records, projection cache, and other session-owned data. Shared, content-addressed attachments are left alone (they may be referenced by other sessions); orphaned attachment objects are not garbage-collected by this plugin.
- **Archive times are recorded by this plugin.** The archive ledger (`$DSH_HOME/dsh-session-archive/archive-ledger.json`) stays the only archive-time fact source; no file timestamp is ever used. Sessions archived before installation — including sessions archived from the official sidebar, which never reaches this plugin — show "archive time unknown" and stay outside auto-delete until a human deletes them, they are unarchived and re-archived (which restarts the retention clock), or the backfill below records a time for them.
- **`recordManualArchive` is a backfill, off by default.** When enabled, the first time this plugin observes a session that is already archived with no ledger entry, it records one `observed` entry stamped with the observation moment, so the retention countdown starts from there and the session can later be auto-deleted. The observation moment is a lower bound, not the real archive moment, and the list marks it "(backfilled)" to keep the two distinguishable. The backfill never deletes in the same cycle that records a time: the existing rule that ignores archive times at or after the run start keeps the row out of that cycle. With the switch off, nothing is written to the ledger and behaviour is exactly as before.
- **Auto-starting the clock is a deliberate trade.** A session archived long ago gets a countdown that starts now, not its real age; the backfill can therefore never delete something that was archived more recently than the retention window.
- **Protected sessions are never deleted, manually or automatically**: running sessions, the session you are currently viewing, sessions with running children, and sessions already inside another archive operation. Forced stops never happen.

## Security model

All HTTP routes (`/api/dsh-session-archive/*`) are fenced to loopback sockets with a loopback Host header and browser same-origin markers; `X-Forwarded-For` is never trusted. Deletion resolves storage paths only through the plugin's own sessions-root index, re-validates realpaths before removal, and rejects anything outside `$DSH_HOME/sessions`. Clients send session IDs only — never file paths. The session-rdb store (SQLite) is fingerprint-checked before any row deletion.

## Known limitations

- Remote-browser users (LAN or `dsh-remote-web-ui` tunnels) cannot operate this section; every route is loopback-only by design, because it can destroy local session data.
- Sessions missing from the host feed and the projection cache are flagged "incomplete metadata" and excluded from automatic flows.
- Attachments under `$DSH_HOME/attachments` are shared and content-addressed; this plugin does not reclaim orphaned ones.
