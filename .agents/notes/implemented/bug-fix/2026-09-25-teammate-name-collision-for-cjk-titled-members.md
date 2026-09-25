# Agent Note: teammate names collide for CJK-titled members

Status: implemented

## Problem

Running a team-mode cascade (`teamRun: true`) whose members had CJK-only titles failed to provision
its members. The 生物词典 project card ran six stage containers as six teammates and the sixth was
refused in 251 ms with:

```
teammate provisioning failed: teammate name "subtask-e048c604" was already used in this Team
```

The Host settles a parent only after every member of its run group is terminal, so the refused spawn
left the whole cascade open: five children kept an execution with `endedAt: null`, the parent waited
on a group that could never complete, and the card sat in the running column for hours.

The cause is the name derivation. `teammateName` slugged the title with `[^a-z0-9]+` and fell back to
the constant `subtask` when nothing survived, then appended the run-group token. A CJK-only title
leaves an empty slug, so **every** CJK-titled member of one run produced the same name. The token
separates repeated runs of one tree, which is what it was added for; nothing separated two members of
the same run. The defect scales with the number of CJK titles rather than affecting one unlucky pair:
the real data collapsed six stage containers into five distinct names, and one stage container's eight
children into six — **three** of them all rendering `subtask-8dd00e0e`.

## Decision

`teammateName(title, token, memberId)` now appends a third discriminator: an FNV-1a (32-bit) digest of
the member's task id, rendered as eight lower-case hex characters. The run-group token still separates
repeated runs; the member digest separates members of the same run. Deriving it from the member
identity rather than the title also covers two members that share a title outright, and keeps the name
stable when a title is edited mid-run.

The digest is a pure inline function instead of `node:crypto`: `core/subtask.ts` is compiled into the
client program as well as the host, so it may not import a Node builtin. The name only needs a stable,
well-spread discriminator, not a cryptographic one.

All three consumers pass the task id: the spawn call, the Lead prompt's peer list, and the prompt's
own fallback. The Lead prompt and the spawn must derive the same name, so they call the same function
with the same arguments.

## Testing

`host-service.spec.ts` drives a real team run through `TaskBoardHostService` with two CJK-titled
subtasks and asserts two spawns under two distinct, contract-valid names. Against the old derivation
it fails with `expected 1 to be 2` — one distinct name for two spawns — which is the production
failure reproduced end to end. `subtask-run.spec.ts` covers the derivation directly: the same member
and run always render the same name, two members sharing a title stay distinct, and every name is
lower-kebab-case, at most 64 characters, and never `lead`, matching the service's
`TEAM_INVALID_MEMBER_NAME` rule.

## Alternatives considered

- **Append an index or a counter.** Requires the caller to know each member's position and stays
  correct only while the member list does not change; the Lead prompt and the spawn would have to
  agree on that ordering, and a re-derivation after any edit could hand one member another's name.
- **Hash the title instead of the member id.** Fixes the CJK case but not two members that share a
  title, and the name would change whenever the title is edited — while the Team holds names immutable.
- **Make the fallback prefix unique per member, such as `subtask-<id>`.** Works for CJK titles but
  changes the ASCII path too, makes every name unbounded in length, and offers no guarantee for two
  distinct titles that slug to the same string.
- **Truncate or transliterate CJK titles to ASCII.** Transliteration is a large dependency doing
  guesswork for a name that only has to be unique; truncation does not guarantee uniqueness.
- **Let the spawn fail and retry with a suffix.** The refusal is the failure mode to remove; a retry
  loop makes provisioning time depend on collisions and leaves the first attempt recorded as an error.

## Consequences

- A team run over CJK-titled members provisions every member. Re-derived over the live 生物词典 cards,
  the six stage children yield six distinct names and the eight children of 后续内容与平台发展 yield
  eight, each within the service's contract.
- Names are longer by nine characters, so the 32-character title slug plus the token plus the digest
  stays inside the 64-character bound; a long ASCII title is still capped by the slug.
- Names are not stable across the change: a Team already holding the old names must not be re-entered
  with the new derivation. The rule that a team run always mints a fresh Lead session already
  guarantees this, and a stale teammate from a previous derivation cannot collide with a new one.
- The earlier incident — the container stuck in the running column — was bookkeeping caused by this
  defect. Settling it by repairing the ledger removed the symptom; this change removes the cause.
