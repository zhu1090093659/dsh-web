# Agent Notes

English | [中文](README.zh.md)

One kind of design doc lives here. An **Agent Note** records a decision or proposal that affects this repository — the *why* behind a change and *what we gave up*, the parts code and docs cannot carry. This file defines where Agent Notes live, when to write one, and [the in-file format](#the-file-format).

## Layout and naming

Every Agent Note has two axes, both encoded in its path — `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`:

- **Lifecycle** (the top-level folder) is the Agent Note's status, and an Agent Note moves between folders as that status changes:
  - **`proposed/`** — proposals reviewed before implementation; not yet built (or only partly).
  - **`implemented/`** — the decision shipped. The file records what was decided and what was rejected, and is kept current with what actually shipped: when later work moves a file, renames a package, or changes a key or default, the note's facts are updated in the same change — never its decision. See [implemented/AGENTS.md](implemented/AGENTS.md).
  - **`rejected/`** — the proposal was considered and declined; the verdict lives on the `Status:` line. Keep it only while its rationale prevents a plausible mistake; otherwise delete the complete triplet.
- **Class** (the nested folder) is the kind of decision — see [Classification](#classification).

The date in the filename is when the topic was first proposed (per git history). Cross-references between Agent Notes use relative markdown links (`[topic](../../implemented/architecture/2026-01-01-topic.md)`) — never bare prose or numbers — so they stay mechanically checkable and survive moves between folders. The active lifecycle tree is the working inventory: browse its lifecycle/class folders or search the repository; do not maintain a centralized index file. Low-future-value implemented records move to the frozen [`archived/`](archived/AGENTS.md) tree described under [Archiving and deletion](#archiving-and-deletion).

## Classification

Each Agent Note belongs to exactly one class folder from this closed set:

| Class | What it covers |
| --- | --- |
| `feature` | A new user- or model-facing capability. |
| `bug-fix` | Corrects a defect or closes a gap. |
| `simplification` | Removes code, behavior, or surface area without adding a capability. |
| `architecture` | A structural decision about the shipped source — how packages relate, what the runtime vocabulary is. |
| `process` | Tooling, policy, or workflow around the code — gates, scripts, release flow — not runtime behavior. |
| `testing` | Test infrastructure and strategy. |

The `architecture` / `process` line: architecture is about the source we ship; process is the surrounding tooling and workflow. `refactor` is deliberately absent — it overlaps `simplification`, whose discriminator "does observable behavior change?" already covers it.

## When to write one

Every non-trivial change MUST add or update at least one Agent Note in the same change. A change is non-trivial when it alters behavior, architecture, a contract shared across files or packages, process or tooling, testing strategy, an on-disk, wire, or configuration format, or another decision a maintainer may reasonably revisit. A proposal for substantial future work starts in `proposed/`; an already-made decision starts in `implemented/`.

Updating the Agent Note that already owns the decision satisfies the rule; do not create duplicates. Only a purely mechanical or local edit with no change to behavior, contracts, structure, process, or rationale is exempt. An Agent Note is never edited into a different decision: supersede it with a new one and keep both cross-linked unless a full consolidation preserves every unique rationale, alternative, consequence, and required verification while repairing every inbound link.

Every new Agent Note triggers a supersession check: search the active tree for older notes covering the same decision or mechanism before writing.

## The file format

The first three lines of every Agent Note are exactly:

```markdown
# Agent Note: <title>

Status: <status>
```

The `Status:` value takes one of three forms and must agree with the lifecycle folder: `Status: proposed`, `Status: implemented`, or `Status: rejected — <why, in one line>`. The status carries no dates and no parentheticals: the filename holds the first-proposed date and git holds everything else. On a rejected note the rejection reason is the fact readers come for.

### Body skeletons

Every Agent Note opens its body with `## Problem` — the motivation, written to stand without the solution. Recurring sections use these canonical names and nothing else; genuinely bespoke technical sections stay free-form between the required ones.

For `proposed/`: `## Problem`, then `## Proposal`, then bespoke sections, then `## Alternatives considered`, `## Acceptance criteria`, `## Risks`. The proposal may speak in the future tense — plans, migration steps, and open questions belong here while the work is unbuilt. Acceptance criteria say what observable state means done; risks cover what could go wrong and what the change knowingly gives up.

For `implemented/`: `## Problem`, then `## Decision`, then bespoke sections, then `## Alternatives considered`, `## Consequences`. The decision describes shipped reality in the present tense. Spec-speak headings — `## Proposal`, `## Plan`, `## Migration plan`, `## Acceptance criteria` — do not appear here; a `## Testing` section stating present-tense fact is fine.

For `rejected/`: the file keeps whatever proposal-time sections it had (including `## Acceptance criteria` or `## Plan`) and freezes; only the header block, the `## Problem` opener, and the alternatives mandate apply.

### Alternatives considered — mandatory

Every Agent Note carries an `## Alternatives considered` section: each genuine alternative and why it lost, one paragraph per alternative. A decision recorded without what it beat invites re-litigation. Alternatives are recorded, never invented: a legacy pre-format note whose alternatives are not reconstructible carries this exact comment in place of the section:

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### Moving between lifecycles

Moving a file between lifecycle folders updates the `Status:` line and re-satisfies that folder's skeleton in the same change. `proposed/` to `implemented/` rewrites `## Proposal` into a present-tense `## Decision` and folds acceptance criteria and risks into `## Consequences`. `proposed/` to `rejected/` only adds the reason to the `Status:` line and freezes the file.

### Chinese counterparts

A `.zh.md` counterpart mirrors its English sibling's structure section-for-section under the [i18n contract](../../docs/i18n.md); the machine-checked header tokens (`# Agent Note: ` and the `Status:` line) stay in English verbatim. Each note ships as the standard three-file pair — `<name>.md`, `<name>.zh.md`, `<name>.i18n.yaml` — with blob hashes recorded in the sidecar via `git hash-object`.

## Archiving and deletion

Archive an implemented Agent Note when the shipped decision is complete and its rationale is unlikely to guide future work; keep it active while its alternatives, ownership boundary, negative guarantee, durable semantics, security rule, or reintroduction condition remains useful. Never archive a proposed note: reject an obsolete proposal instead. Keep a rejected note only while it prevents a plausible mistake; otherwise delete its English, Chinese, and sidecar files together.

The archive is path-encoded as `archived/{class}/yyyy-mm-dd-topic-title.md`; `implemented` is absent because only implemented notes can enter it. An archival change moves the complete triplet, inserts an identical `Archived: YYYY-MM-DD` line immediately below each `Status: implemented` line, re-records the sidecar hashes, and repairs or deletes inbound links — these are the only permitted content changes during archival. Once sealed, archived notes are permanently frozen: never edit, translate, reformat, move, or delete them, and never treat them as authority for current behavior. See [archived/AGENTS.md](archived/AGENTS.md).
