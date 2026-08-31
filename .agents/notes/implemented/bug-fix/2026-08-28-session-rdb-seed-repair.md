# Agent Note: session-rdb stored-seed repair for misresolved surface coordinates

Status: implemented

## Problem

Loading history for `session-e85b346e-7cb9-4f5c-b090-d86aca5b83ad` failed on the live host:

```
history unavailable for session "session-e85b346e-…": SessionPersistenceCorruptionError:
stored session … failed validation: Error: invalid seed event at index 5074:
surface replace: sourceEventSeqs must include every shadowed surface node; missing 2930, 3432 (internal)
```

The `web` profile currently opts into the better-session stack: the aggregate ships `@morlay/session-rdb` (SQLite persistence, v0.0.11 — also npm latest) as insert rows, and the profile block disables the stock jsonl row and enables the rdb row. The failing session lives only in that store (no legacy jsonl exists), so the corruption is in rdb-stored data, and a full-store replica scan found **6 of 512 sessions** failing seed validation — the reported one plus five silently broken sessions that fail with `tool/result surface replacement` errors when opened.

Root cause (in the external engine's read path, not in dsh-web code): the rdb write path stores `surfaceOp` replace ranges and `sourceEventSeqs` provenance in **upstream (host) seq coordinates**, and the read path resolves each stored value onto the **dense persisted seq space** with a heuristic (`resolveProvenanceSeq`: "the stored f_sequence wins" when the value exists in dense space as an earlier surface node). Two collision classes defeat it:

1. **Dense-collision**: a stored upstream citation whose value also exists as an *earlier dense surface node* is read as that dense node instead of being mapped upstream→dense. Example (session 2840ba5e): a tool/result replace stored `{start: 308, end: 308}` meant upstream node 308 (dense 36); dense 308 happens to be a *different* tool/result (different callId), so the rewrite targeted the wrong node and the "may change only content" check rejected it.
2. **Resume-boundary duplicate upstreams**: a resumed session persists the parent's seed rows and the child's renumbered rows in one log, so one upstream seq maps to two rows; `buildSeqMap` keeps the first occurrence. Session e85b346e cites upstream 19628 meaning the child-segment tool/result (dense 3432), but first-wins resolves it to the parent-segment tool/call (dense 297).

The engine's own mitigation cannot recover: `readPrefix` runs `normalizeSurfaceReplaceProvenance` after remapping, but it merges candidates by **seq range** (`candidate.seq >= start && candidate.seq <= end`) while shadowing is **positional** — after replacement folds, live nodes sit positionally inside a window with seq values outside it (dense 2930/3432 sit positionally inside the [3527..5065] window but below its seq range), so the merge misses them; and `cleanseSession` persists exactly the same misresolved read, making the corruption dense-coordinate-official instead of fixing it.

## Decision

Repair the stored data with ground-truth resolution computed from the fold state, using the upstream validator itself as the acceptance oracle:

- **tool/result rewrites (5 sessions)**: the true target is semantically unambiguous — the current surface node with the same `toolCallId` as the replacement (exactly one candidate existed in every case). Rewrite the stored `f_surface_op` to the dense target and `f_source_event_seqs` to `[target]`. Every written value is a dense surface seq below the citing event, so the read heuristic resolves it as the identity.
- **Generic replace provenance (session e85b346e)**: keep the (correctly resolved) op window and rewrite the stored provenance to the union of the positional shadowed set (computed by folding with the served coordinates) and the served refs that are surface nodes — 589 shadowed nodes, all dense surface values, again identity on read.
- Applied to the live store in one guarded transaction (each row updated only if its old values still match), after a full rehearsal on a copy. Backup: `~/.dsh/backups/manual-seed-repair-<stamp>/` (bsm's own backup convention).
- Verification oracle: a faithful replica of the engine's read path (rowToEvent remap + readPrefix's normalize) plus the upstream `dsh-session` seed fold, run over **all 512 sessions** of a detached snapshot — 506 passing before, **512/512 passing after**.

## Alternatives considered

- **Upgrade the engine**: rejected — 0.0.11 is the npm latest (published 2026-08-27); the defect is present in it.
- **Run the engine's own `cleanseSession`**: rejected — it persists the misresolved read ("对已清洗数据解析恒为恒等"), which would make the corrupted coordinates official rather than repair them.
- **Restore from legacy jsonl**: unavailable — the six sessions have no legacy sources (post-migration live sessions or deleted sources).
- **Disable better-session and re-migrate**: rejected — loses the six sessions' rdb-only history and changes the user's storage backend as a side effect of a data bug.
- **Hand-editing event payloads**: rejected — only surface metadata columns were touched; event data rows are byte-untouched.

## Consequences

- All 512 stored sessions load under the current engine; the six repaired sessions validate through the same read path the loader uses.
- The written values are dense coordinates inside rows whose other fields may stay upstream-coordinate; the engine's per-value resolution handles the mix (proven by the full-store validation). A future engine upgrade that changes resolution semantics should be validated against the same fold oracle before deploying.
- The underlying heuristic defect remains upstream (@morlay/session-rdb): dense-first resolution without segment awareness, first-wins mapping across resume boundaries, and seq-range (not positional) provenance completion. Reported upstream with the diagnosis and repair; until fixed upstream, resumed sessions that collide the same way will keep failing and need the same one-off repair.

## Verification

- Replica reproduction: the failing seed event and message (`missing 2930, 3432`) reproduce byte-identically from the stored rows.
- Full-store scan before: 512 sessions, 6 failures (1 provenance-coverage, 5 tool/result targeting).
- Rehearsal on a copy: 6 repairs applied, 512/512 pass.
- Live application: guards passed (no concurrent row change), 6 rows updated in one transaction; post-apply validation on a fresh detached snapshot: **512/512 pass**.
- Backup kept at `~/.dsh/backups/manual-seed-repair-<stamp>/` (db + wal + shm).
