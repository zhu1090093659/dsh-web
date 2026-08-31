# Agent Note: Compress agent workflow instruction files for token efficiency

Status: implemented

## Problem

The agent workflow instructions loaded every session — the user-layer global file `~/.dsh/AGENTS.md` (symlinked as `~/.zcode/AGENTS.md`), the DSH workflow skills under `~/.dsh/skills/`, `~/.agents/skills/dsh-parallel-dev`, and `~/.codex/AGENTS.md` — carried duplication accumulated across merges: three parallel Mem0 sections, a bilingual restatement of the same working-style rules, and roughly 9 KB of verbatim shared blocks between `pr-issue-maintenance` and `existing-feature-improvement`. This text is paid on every session start, including the scheduled maintenance automation that runs `pr-issue-maintenance`.

## Decision

The user-layer files are compressed in place with semantics preserved clause-by-clause, originals backed up at `~/.dsh/backup-tokenopt-20260828/`. `~/.dsh/AGENTS.md` dedupes the Mem0 and working-style sections into single sections; `pr-issue-maintenance` and `existing-feature-improvement` move their shared blocks (Git preconditions, fact baseline and concurrency, comment conventions, queue and worktree discipline, merge gates, route channels, collaborator-reviewed no-re-review) into one shared file at `~/.dsh/skills/pr-issue-maintenance/pr-review-common.md` that both skills mandate reading before any review or merge action; the remaining skills tighten prose while keeping every rule; the dangling references to the removed `dsh-upstream-customization` and `dsh-snapshot-upgrade` skills are dropped. Total user-layer text shrinks from about 85 KB to about 62 KB including the new shared file. In this repository, root `AGENTS.md` merges its two CodeGraph workflow bullets into one and de-duplicates a repeated Agent Note rules link; `packages/AGENTS.md` and `docs/AGENTS.md` stay unchanged because they already sit at the one-fact-one-home, one-to-three-line density this repository mandates.

## Alternatives considered

Rewriting the shared-pool third-party skills (`hyperframes*`, `cloudflare`, `wrangler`, `media-use`, and similar installed packs) loses: their wording is the upstream trigger and contract surface, edits would be overwritten on update and cannot be verified here. Translating the Chinese governance rules into English for byte savings loses: translation risks semantic drift in review-binding rules with no structural gain, so each file keeps its original language. Trimming only repository files and skipping the user layer loses: the user layer loads in every session across all projects and holds the real duplication.

## Consequences

Always-loadable workflow text shrinks by about a quarter with no rule removed, and the two maintenance skills now share one source of truth for review discipline, so a rule edit lands in both workflows at once. Agents running either maintenance skill must read the shared common file before acting, one extra read per invocation. The unifying of the two skills' review rules adopts the stricter superset where they previously diverged, such as collaborator follow-up on new commits after review. Compressed wording loads only in newly started sessions.
