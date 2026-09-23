# Agent Note: Task tags on the board and in the execution prompt

Status: implemented

## Problem

The task board classified a task only by its lifecycle status (backlog / todo / running / done / failed), so a user running a dozen recurring tasks across several business lines had no way to say which line a task belonged to. Issue #1521 reports the cost of that gap: the reporter had to keep a local 13-file patch spanning the task model, the protocol, the runner, and the client renderer, and losing that patch on an upgrade produced the worst possible failure — old files overwriting new ones, a protocol mismatch, and a board that rendered but could no longer read its tasks.

## Decision

A task row carries an optional `tags: { name, promptPrefix? }[]`. The name is the badge, the search haystack, and the filter key; the optional `promptPrefix` is a line injected ahead of the execution prompt on every run. Absent field, absent prefix, and untagged tasks are all no-ops.

### Model and limits

- `TASK_TAG_LIMIT` 8, `TAG_NAME_MAX_LENGTH` 32, `TAG_PROMPT_MAX_LENGTH` 200, all enforced in `src/core/tasks.ts`.
- `normalizeTags` repairs (trim, drop blanks and repeats, cap the count and the string lengths, collapse a blank prefix to "display-only"); `isTaskTagList` validates strictly. Repair is for the ledger, strict is for the wire.
- The badge tone is `tagTone(name)` — a hash into a fixed six-colour palette. Nothing per-tag is stored, and a label cannot be one colour on one card and another on the next.

### Wire and ledger

- `create` accepts `tags` only as a non-empty, fully valid list; `update` accepts a valid list or an explicit `null` that clears it. An empty array is not a way to clear, because it is indistinguishable from a client bug.
- `parseLedger` repairs the field entry by entry and never drops the task row (the same policy the schedule and freeze fields already follow), so a hand-edited ledger degrades a label instead of the task.
- No schema bump: the field is additive and optional, so a v3 document written by an older build loads unchanged and an older build reading a newer document ignores it.

### Execution prompt

- `promptText` prepends a `标签提示` block listing `- [name] prefix` for the tags that carry one, before the handover preamble and before the task body. A task with no prefixed tag produces exactly the string it produced before the feature.
- The block sits outside the continuation-card provenance wrap: the card's instruction stays inside its source declaration.
- Prefixes are delimiter-escaped through the same helper the card text uses, so a hint cannot forge the "来源声明" markers.

### Board surfaces

- Card badges, a board-header multi-select tag filter over every label in use (archived tasks included), search that also matches label names, and a tag editor in the new/edit forms whose name input offers the labels already on the board and adopts an existing hint.
- Multi-select is conjunctive: adding a label narrows the result set.
- New semantic parts `tag-filter`, `tag-chip`, and `tag-badge` are recorded in [semantic-attrs-v1.md](../../../packages/skins/skin-center/contracts/semantic-attrs-v1.md) in the same change.

## Alternatives considered

**A settings-level tag catalog (name → prompt prefix) on the task-board settings card.** This is the design the reporter sketched for colours, and it reads well for "define a business line once". It was rejected because it puts half the feature in a second store: the Host runner would have to read settings asynchronously at execution time to answer a question the ledger already answers, and the tag a card shows could then disagree with the prefix a run injects. Keeping labels on the task keeps one authoritative source and keeps `promptText` a pure function of the task record. The "define once" ergonomics survive in the editor, which adopts the hint of a name already in use.

**Encoding the prefix into the tag name (for example `work|archive to 02-work/`).** Rejected: it makes the badge the user reads a serialized wire format, and it has no room for a name that legitimately contains the separator.

**Storing a colour per tag.** Rejected: the colour is presentation, it would have to be validated and migrated like data, and two tasks sharing a label could then disagree about it. A hash into a fixed palette cannot disagree with itself.

**Bumping the ledger schema to v4.** Rejected: a purely additive optional field does not need a migration, and a bump would force an in-place rewrite and a failure mode on every existing ledger for no compatibility gain.

**Treating tags as a content field that freezes after the first run.** Rejected: content fields freeze because they are the record of what actually ran. A label is classification that shapes the NEXT run — a business line changes, and a task that already ran must be re-labelable.

**A group-by-tag board view (the "optional" half of the request).** Deferred, not built. The filter already answers "show me one business line"; a second board layout would double the rendering paths and the responsive CSS for a view nobody has asked for yet. It stays an addition on top of the same model whenever it is wanted.

## Consequences

- An untagged task is unaffected in every layer: same prompt bytes, same patch shape on the wire, same ledger document.
- Labels are editable after the first run, so they are not covered by the content-freeze gate; an edit changes future runs only.
- The board filter's candidate list is derived from the ledger rather than from a declaration, so a label disappears from the filter as soon as no task carries it — deliberate, and the reason no cleanup UI exists.
- The prompt now has one more client-asserted preamble. It is gated, delimiter-escaped, and placed outside the provenance wrap, but a user who writes a hint can still influence every run of that task — which is the point of the feature.
- Required verification: `tests/tags.spec.ts` covers repair, the strict gate, the no-tag byte-identity, injection order, delimiter escaping, and the conjunctive filter; `pnpm --filter @linxin666/dsh-client-ui-task-board test` and `pnpm i18n:check` are the package gates.

See [task-modal-shared-form](../simplification/2026-08-26-task-modal-shared-form.md) for the shared modal fields this change extends.
