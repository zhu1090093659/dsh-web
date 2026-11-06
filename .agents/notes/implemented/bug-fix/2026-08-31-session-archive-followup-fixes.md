# Agent Note: Session archive follow-up fixes (titles, toggles, defaults)

Status: implemented

## Problem

Three defects surfaced in the first real-usage round of `dsh-session-archive`:

1. **Archived session titles unresolved.** The inventory enriched titles only
   from the aggregate projection-cache index (`storages/session_projcache.json`),
   which covers recent sessions only. Older and archived sessions fell back to
   `（无标题）` even though their per-session projection-cache files
   (`storages/session_projcache/sessions/<id>.json`, version-4 `record` shape)
   still hold `record.rows.title.val` and `record.identity`.
2. **Auto-maintenance checkboxes appeared dead.** `AutoSettingsPanel` read
   `settings.getSnapshot()` during render but subscribed `useSyncExternalStore`
   only to the controller store. The settings mirror replaces the snapshot
   object after each accepted write; without a subscription the controlled
   checkboxes never re-rendered, so a successful host write was visually
   invisible. (The same pattern in `dsh-usage` is masked by its poll-driven
   re-renders.)
3. **Day thresholds defaulted to 30/90**, heavier than wanted; both defaults
   should be 7 days.

## Decision

1. `buildInventory` now runs a bounded fallback pass after the index
   enrichment: rows still missing title/createdAt/cwd read their per-session
   projection-cache file (`readProjcacheFile`, tolerant of corrupt/missing
   files, `record ?? parsed` shape drift). Files never conjure rows; the
   archive service memoizes file facts in a per-id cache
   (`InventorySources.projcacheFiles`) so repeated inventory passes do not
   re-read unchanged files. Index facts keep precedence (applied first).
2. `AutoSettingsPanel` subscribes with
   `useSyncExternalStore(props.settings.subscribe, props.settings.getSnapshot)`,
   making toggles reflect the accepted host write immediately.
3. `DEFAULT_AUTO_CONFIG.autoArchiveDays`/`autoDeleteDays` and the host
   schemastery schema defaults moved 30/90 → 7/7 (config.ts + index.ts +
   README pair + fallback assertions in auto-rules.spec).

## Alternatives considered

- **Reading titles from session logs**: legacy `session.jsonl.zstd` is
  compressed; would add a zstd dependency for a fact the projection cache
  already holds. Rejected.
- **Clamp-saving invalid day input**: already rejected earlier (invalid values
  never save); unchanged.

## Consequences

- Older/archived rows resolve real titles when a per-session projection-cache
  file exists; rows with neither dir, feed entry, nor file stay `（无标题）`
  with the `no-data` flag (true ghosts).
- Both auto-maintenance switches round-trip: click → host write → mirrored
  snapshot → re-render; state survives reloads.
- Fresh installs default both thresholds to 7 days; existing explicit user
  values are untouched (schema defaults only fill absent fields).
- Verified on a sandboxed QA instance (fresh `DSH_HOME`, port 3999): seeded
  file-only session resolves `早安测试`, index beats file (`索引标题二`),
  dir-only session stays `（无标题）` with issue tags; both checkboxes toggle
  and persist across reload; day inputs show 7/7. Evidence:
  `/tmp/qa-evidence/22..24-*.png`. Host-half changes need the user-side DSH
  restart on the live instance; the client-half toggle fix ships to browsers on
  page refresh.

## Follow-up (same day): post-delete selection ghosts and the skip story

**Problem.** On the live instance a 371-target batch delete left 5 archived
rows visible and the selection bar stuck at `已选 371 项`. Diagnosis against
the real home: the 5 sessions were never deleted — their storage dirs are
intact and `archivedSessionIds` holds exactly those 5 — because they are still
held open by the running harness process (live SessionStore members). The
batch dialog did report them as skipped, but under the `running` reason
("会话正在运行") which is wrong for idle-attached sessions, and after the
post-delete inventory refresh the selection kept all 371 ids (366 of them no
longer existed), so the summary line claimed 366 items outside the filter.

**Decision.**

1. `setInventory` prunes selection to ids still present in the incoming rows.
   Selection across filter changes is preserved (unchanged); only ids the
   inventory no longer knows are dropped.
2. New stable reason code `attached` for live-store members; feed-reported
   running rows keep `running`. Copy: zh "会话仍被 DSH 进程占用，重启服务或
   关闭该会话后可删除" / en / ru (central pack).
3. The finished batch dialog aggregates skipped entries by reason
   (`跳过明细：… ×n · …`) so a 371-run's outcome reads at a glance; the
   per-id list stays for detail.

**Consequences.** The protection semantics are unchanged — sessions held open
by the running DSH process remain undeletable until the service restarts or
the session is closed; what changed is that the UI now says so honestly and
the selection counter reflects reality. QA-verified: select 3 seeded sessions
→ batch delete → dialog `成功：3 / 跳过：0`, selection counter pruned to
`已选 0 项`. Evidence: `/tmp/qa-evidence/25..27-*.png`.

## Follow-up 2 (same day): bare-uuid harness ids broke every batch

**Problem.** After the user's restart, a 213-target batch delete failed 400
`no session ids` on every chunk. Diagnosis on the real home: this install's
harness mixes id spellings natively — the feed, the registry archive set, and
the session store all hold **bare uuids** for a large share of sessions (309/741
feed rows; the archive set and the plugin ledger were 100% bare), while other
rows carry `session-<uuid>`. The route's id validator only accepted the
prefixed spelling, so every id was dropped and the empty-array guard answered
400. The earlier 371-run had worked because the then-deployed build predated
the strict validator.

**Decision.** One canonical form inside the plugin, native spellings at the
harness boundary:

1. `buildInventory` canonicalizes every id it emits (feed rows, parent links,
   workspace membership, archive-set membership, ledger lookups) to
   `session-<uuid>` via `canonicalSessionId`, and records a canonical→native
   map (`BuiltInventory.nativeIds`) for every non-canonical spelling seen.
2. `routes.idList` accepts both spellings, rejects path-unsafe strings
   (ids end up in file names), and canonicalizes before the service sees them.
3. Harness-facing calls pass the native id: `archiveSession`, `inspect`
   (preview), rdb deletes (dual attempt), archive-set unarchive and
   workspace-row removal compare canonically and preserve all other stored
   entries verbatim.
4. The archive ledger and the projection-cache scrub write canonical keys and
   clean both spellings (the existing 207 legacy bare ledger keys stay
   readable through the dual lookup).

**Consequences.** Mixed-spelling installs work end to end; the wire format is
uniformly canonical; legacy bare ledger keys are read and retired naturally. Automatic cycles pass the native-id map from their candidate inventory into the archive executor, just like manual batches. The mixed-id automatic-cycle regression covers successful native archive markers, canonical ledger keys, running/current protection, and a repeat cycle that preserves archive times.
Selection made on a pre-fix page (bare ids) is pruned by the inventory refresh
(rows are canonical) and the user re-selects. Unit-covered: bare feed ids →
canonical rows + parent links + archive flags; bare id through the delete
route cleans the bare archive-set entry; path-unsafe ids still 400.

## Follow-up 3 (same day): one directory walk per user action

**Problem.** Every inventory pass re-walked the whole sessions root to sum each session directory's file sizes (`indexSessionDirs`). On the maintainer's install that walk measured ~12.5 ms per pass over 444 session directories (of which ~11.6 ms is the recursive size sum; `realpath` ~4.2 ms, `stat` ~1.5 ms, `readdir` ~0.7 ms), and every pass also re-read the per-session projection-cache fallback (~28 ms cold over 442 files). One user action triggers several passes: a 442-target batch splits into chunks of 200, each chunk request rebuilds the inventory, and the client reloads the inventory once more afterwards — four passes for one delete. A single row **Preview** rebuilt the full inventory to display one row the panel already held. Measured: four passes 80.3 ms with the walk repeated, 52.2 ms for two.

**Decision.** `InventorySources.dirIndex` accepts a prebuilt index; the service supplies one from `DirIndexCache` (`dir-index-cache.ts`), a one-entry, 2 s TTL memo of the sessions-root scan that the owner invalidates itself after a physical delete removes storage. The pass still walks the tree on its own when no index is supplied, so `buildInventory` keeps its existing contract. Reuse is bounded rather than permanent: the window is short, one scan is always one call away, and nothing polls.

**Measured effect** (444 real session directories; the four-pass sequence one batch delete performs):

| Sequence | Before | After |
| --- | --- | --- |
| Four inventory passes (one batch delete) | 80.3 ms | 42.6 ms |
| Two inventory passes | 52.2 ms | — |

The remaining cost is the projection-cache fallback reads, which `projcacheFiles` already memoizes per id; the directory walk no longer repeats inside the window.

**Alternatives considered.**

- **`readdirSync(path, { withFileTypes: true })` to drop one `stat` per subdirectory**: implemented and benchmarked, and **slower** — 6.93 ms versus 6.60 ms for the same 444 directories. Rejected on measurement.
- **A permanent directory index**: rejected — sizes and the directory map would go stale after external deletion, and correctness here decides what the delete pipeline is allowed to remove.
- **Slowing the client's chunking or dropping the post-batch refresh**: rejected — those exist so an interrupted batch lands in a retryable state and the panel reflects it; the redundant work is the repeat walk, not the refresh.
- **A TTL on the inventory response itself**: rejected as a larger behavioral change (it would also mask concurrent external changes) where the scan reuse removes the measured cost with no wire-visible difference.
- **A separate cached document for `preview()`**: re-measured after the scan reuse landed and declined — preview reaches the same `sources()`, so it already shares the walk and the per-id fact memo. Its residual 31.7 ms cold is the one-time projection-cache fact load for 444 sessions, paid once and then 0.7 ms; a second cache would memoize a cost the first one already amortizes.

**Consequences.** Sizes and the directory map can be up to 2 s behind an external deletion; the service's own deletes invalidate immediately. `preview()` still builds its own inventory and remains a candidate for a later reducer. Verified: 14 package test files / 104 tests pass, typecheck (both programs) and build pass, `test:standards`, `docs:check`, `i18n:check`, `emoji:check` and `sync-shared --check` pass. New coverage `tests/dir-index-cache.spec.ts`, 5 cases: one scan across passes inside the window, a fresh scan once it lapses, explicit invalidation removing deleted storage, a newly added directory discovered after the window, and identical rows whether the pass walks the tree or is handed the index. Negative control: neutering `invalidate()` fails the invalidation case and ignoring the TTL fails two cases. Host-half change; it reaches the GUI only after the user restarts the DSH service.
## Follow-up 4 (same day): the same bounded memo also serves the projection-cache index

**Problem.** The inventory reads the aggregate projection-cache index (`storages/session_projcache.json`) in full on every pass — one `readFileSync` plus one `JSON.parse` of the whole document — while the far larger sessions-root walk beside it is already served from a bounded memo. A size sweep over the index file measures that read and parse at 3.66 µs/KiB (R² = 0.943); on the maintainer's 112 KB index that is about 0.40 ms per pass, which is 1.2% of a cold pass and 36% of a warm pass — the pass where the walk is served from the memo. The saving is **sub-millisecond**, and it is recorded that way: it earns its place because it is the same repeated work the walk's memo already removes, on exactly the passes one user action repeats.

**Decision.** One memo type serves both reads. `ttl-memo.ts` owns `TtlMemo`: one entry, a TTL window, and an invalidation its owner calls explicitly. `DirIndexCache` is that type specialized to the sessions-root scan with its public surface unchanged, and `ArchiveService` holds a second memo for the projection-cache index, injected through `InventorySources.projcacheIndex` in `sources()`. `scrubProjcache()` — the only writer of the index file — invalidates it whenever it actually rewrote something (`ids.size > 0`). `buildInventory` still calls `readProjcacheIndex` itself when no memo is injected, so the pass keeps its contract with or without a service.

**Consequences.** A pass may read an index up to one TTL window old; the delete pipeline's own rewrite invalidates immediately, so a scrubbed title cannot survive into the next inventory. Each memo holds one entry, accumulates nothing and polls nothing. Coverage: `tests/projcache-index-memo.spec.ts`.

**Negative controls.** Removing the injection makes the guard report `expected ['Amended','Beta'] to deeply equal ['Alpha','Beta']`; removing the invalidation makes a deleted title come back as `expected 'Doomed' to be undefined`.
## Follow-up 5 (2026-10-16): the projection-cache fallback reads both id spellings

**Problem.** The per-session projection-cache fallback (`readProjcacheFile`) resolved one file name only — `${id}.json`, where `id` is always the `session-`-prefixed form because `canonicalSessionId()` adds that prefix and never strips it. The harness names a session's file from the id form it happens to hold, and both spellings are live at once: on the maintainer's install the directory held 862 files, 386 named `session-<uuid>.json` and 476 named bare `<uuid>.json`, with no session present under both spellings, and either spelling's modification times span 2026-10-02 to 2026-10-16 — a coexistence, not a renamed convention. The aggregate index was absent on that install, so every enrichment went down this fallback and every bare-named file was unreachable: 478 of 857 rows carried `no-title` although 476 of those sessions had a file holding title, createdAt and cwd. The miss was then memoized as `null` in a plain `Map` nothing invalidates, so a later harness write could not repair the row until the plugin reloaded. `scrubProjcache` already deleted under both spellings: the archive had accepted both names, and only the reader had not.

**Decision.** `readProjcacheFile` tries the canonical spelling first and the bare one only when that read yields nothing, parsing through one shared `readProjcacheEntry` helper. A cache file named canonically therefore costs exactly the read it always cost, and the added work lands only on rows that had no facts at all. The memo contract is unchanged: one entry per canonical id, and still `null` for a session with no file under either name.

**Measured effect** (maintainer's install, 857 rows): rows without a title 478 → 7, rows with a title 379 → 850, over an identical row set, so the fallback still conjures no row. The added work is 471 successful reads and parses: 33-35 ms across three rounds with the files in the page cache, 158 ms on the first and colder pass, against the 5.3 ms of failed opens those rows paid before. Warm passes are unchanged because the memo answers. The 7 remaining rows resolve to their canonical file, which carries an explicit `title: null` beside a real createdAt and cwd — an honest `no-title`, not a miss.

**Alternatives considered.** Carrying `nativeIds` down into the read was rejected: the alternate name here is a bijection on the id, so deriving it keeps the exported helper independent of inventory state, while `scrubProjcache` needs that map only because it must also delete names it cannot derive. Reading the projection-cache directory once into a name set was rejected because the names are not the cost — the 11.8 MiB of file contents behind them is — and such a set would not avoid one of those reads. Making the memo forget a miss was rejected as a separate decision with its own evidence to gather: it changes which passes re-read, and the rows this follow-up targets are old sessions whose files already exist.

**Consequences.** A row whose session has a bare-named cache file is enriched from the first pass instead of never. A session with no file under either name still memoizes `null` for the plugin's lifetime — unchanged, and recorded here as an open decision of its own. Coverage: `tests/inventory.spec.ts` adds both-spellings reading with canonical precedence, plus a canonical row enriched from a bare-named file; the package's 15 test files / 115 tests, the typecheck of both programs, and `docs:check` pass. Host-half change; it reaches the GUI after the user restarts the DSH service.

## Follow-up 6 (issue #2022): the list refuses what the host refuses

**Problem.** The host's protection decision was computed only inside the delete path (`ArchiveService.protectedReason`: live SessionStore members as `attached`, feed `running`, the client-declared `current`, busy targets as `in-flight`), while the served inventory carried only the feed's `running` flag. The browser half therefore knew two of the four facts: rows the running harness process holds open looked deletable, a select-all batch stayed enabled even when every selected session was protected, and the confirm dialog reported `skipped 0` for sessions the host would refuse — the user learned the truth only from the finished batch. Three of the four facts are unobservable in the browser: an idle attachment, an in-flight operation, and (for mixed id spellings) the current session are host-side state.

**Decision.**

1. `ArchiveSessionRow.hostProtectedReason?: 'attached' | 'in-flight'` carries the two facts the browser half cannot observe; `running` (a feed flag) and `current` (the client's own session) keep travelling on their own, so the wire grows by one optional field and nothing else changes shape. `InventorySources.hostProtectedReason` injects it and `buildInventory` stamps it onto the matching rows; `ArchiveService.sources()` fills the map from `liveSessionIds()` and the busy set, writing `in-flight` last so an in-flight target wins exactly as `protectedReason()` decides.
2. `clientProtectedReason` merges row facts with the host's precedence — `in-flight > current > attached > running` — recorded next to `planDelete` in `core/cascade.ts`, so the confirm dialog's skip count and the batch's skipped reasons name the same winner the host's authoritative plan names.
3. The list reads that map once per inventory: a protected row's delete button is disabled and titled with its reason, and the batch delete is disabled only when `selectionFullyProtected` holds — a mixed selection keeps working and the confirm dialog states the exact number of skips. New copy key `arch.batch.deleteBlocked` (zh/en, ru in the central pack).
4. A host that does not send the field degrades to `running` + the viewed session: exactly the pre-fix behaviour, and the host still refuses authoritatively.

**Alternatives considered.** Sending the host's whole protected map as a separate inventory field (`InventoryView.protected`) was rejected: it would duplicate a fact the rows already own and make "which rows are protected" two places to look at. Sending `running` and `current` from the host as well was rejected: the browser half observes both and a duplicate source would drift. Disabling the row checkbox for protected rows was rejected as a larger behavioural change than the report asked for — the row stays selectable so the dialog can account for it, which is what the skip list exists for.

**Consequences.** What a user can click now matches what the host will do; deletion semantics are untouched — the host remains the only authority, and every refusal still lands as a `skipped` result with its reason. Coverage: `tests/card-protection.spec.ts` (row affordances, all-protected and mixed selections, dialog skip accounting, old-host degradation), `tests/cascade.spec.ts` (merge precedence, `selectionFullyProtected`), `tests/inventory.spec.ts` (wire field present/absent), `tests/janitor.spec.ts` (an attached row and an in-flight row as the served inventory reports them), `tests/controller.spec.ts` (confirm-dialog counts and per-row skip reasons). Component DOM captures of the card before and after the change (same inventory, same viewport-independent jsdom render) live outside the repository at `C:\\Users\\A\\Documents\\qa-2022-archive-evidence\\{before,after}.{json,html}`; a live-GUI confirmation on a real install is left to the maintainer, so no screenshot is claimed here.
