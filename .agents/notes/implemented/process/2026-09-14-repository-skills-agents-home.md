# Agent Note: repository skills resolve from the .agents skills home

Status: implemented

## Problem

The four repository-owned skills - `dsh-web-skin-developer`, `dsh-web-pet-developer`, `dsh-web-community-plugin-developer`, and `dsh-web-release` - lived under `.dsh/skills/`, a project root DeepSeek Harness scans but the shared `.agents` instruction layout does not name. `.agents/skills.json` existed only as a bridge listing `.dsh/skills`, so an `.agents`-aware tool depended on that sidecar to see the skills at all. The split left the skills in a harness-specific directory and kept a manifest whose only entry duplicated the standard `.agents/skills` root.

## Decision

- Move all four repository-owned skills from `.dsh/skills/` to `.agents/skills/`, the canonical project skills home in the `.agents` layout. DeepSeek Harness scans `.agents/skills` natively alongside `.dsh/skills`.
- Delete `.agents/skills.json`; its single entry (`.dsh/skills`) is redundant once the skills live in the default `.agents/skills` root.
- Point every live reference at the new root: the root `AGENTS.md` release link, the release skill's `git add` staging path, and the agent-coding skill's release cross-link.
- This supersedes in part [personal developer skills resolve from the skills home](../simplification/2026-09-10-personal-skills-canonical-home.md): deleting the vendored personal copies still stands, while its "keep the four repository-owned skills in `.dsh/skills/`" bullet now resolves through this decision.

## Alternatives considered

- Keep the skills in `.dsh/skills/` and retain `.agents/skills.json` as the bridge: rejected - the bridge compensates for a non-standard root, so a stale or missing manifest hides the skills from `.agents`-only tooling; the standard root removes the indirection.
- Symlink `.dsh/skills` to `.agents/skills`: rejected - a symlink gives two paths for the same files and adds a watch and canonicalization surface for no gain over a plain move.
- Move the skills but leave `.agents/skills.json` in place: rejected - the manifest would then point at a directory that no longer exists.

## Consequences

- Project skills resolve from one root, `.agents/skills/`, for `.agents`-aware tooling and for DeepSeek Harness.
- `.dsh/` keeps only local, untracked probe and perf files; its `skills/` root no longer exists.
- The release workflow stages `.agents/skills/` instead of `.dsh/skills/`, so release commits include skill edits from the new location.

## Testing

- `git status` reports four renames `.dsh/skills/<name>/SKILL.md -> .agents/skills/<name>/SKILL.md` and the deletion of `.agents/skills.json`.
- Every changed relative link resolves on disk, and `pnpm docs:check` passes.
- A repository search for `.dsh/skills/` finds no live target for the moved skills; the remaining matches are frozen `docs/archive` snapshots, release notes, and decision records.
