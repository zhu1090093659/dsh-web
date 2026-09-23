---
name: dsh-web-agent-coding
description: Use for implementation, maintenance, or configuration in dsh-web; scope the change and load only its relevant workflow.
whenToUse: A request changes dsh-web source, scripts, configuration, generated assets, documentation, or repository automation.
user-invocable: true
---

# dsh-web Agent Coding

[Root instructions](../../../AGENTS.md) own repository safety, branches, and merge gates. This skill owns the working method; it does not grant Git or release authorization.

## Scope and implement

1. Confirm the root, branch, and dirty baseline before writing; preserve other sessions' files and index. Read only applicable directory instructions: [packages](../../../packages/AGENTS.md) for package work, [docs](../../../docs/AGENTS.md) for documentation, then the nearest owner.
2. Change the smallest owner: a plugin, skin, shared source, generator, or aggregate. Keep host/client/shared boundaries and browser platform-import/type-only SDK contracts in the package instructions. Modify generated copies through their source and generator, not by hand.
3. Follow [Agent Note rules](../../notes/README.md) for non-trivial decisions. Reuse the owning note where appropriate; do not copy its lifecycle or format rules here.
4. Verify the affected behavior and review the diff. Run focused checks during edits, and the repository's complete required gates at merge/push/release boundaries, not after every local change. Report actual evidence and limitations; a commit is not delivery.

## Context, delegation, and failure recovery

- Load task-relevant references, not the entire repository map. When authoring prompts, keep stable rules separate from changing evidence (queries, diffs, task state); place dynamic material after stable context where supported. Do not rewrite runtime-owned system/tool messages, assume cache hits, or change instruction priority for caching.
- Delegate independent, bounded work only when it helps. Select from available models by task difficulty, error cost, latency, and observed quality, not fixed provider aliases. Use capable reasoning for consequential ambiguity; do not infer that all documentation or static analysis is low-risk. Pass only necessary context and tools where the runtime permits.
- On a failing check, capture the exact log and exit code, reproduce with the narrowest useful command, fix the evidenced cause, and rerun the affected check. Separate pre-existing failures from regressions caused by this change; do not mix unrelated refactors into repairs.
- Stop repeating an approach when it adds no evidence or edits oscillate. State the obstacle, inspect a different cause or choose a materially different safe approach. Ask the user only for missing information, authorization, or a consequential choice; a retry count alone is not a reason to ask. Report an environment blocker rather than bypassing safety or weakening a gate.

## Load only the relevant workflow

- Review request: [dsh-web-code-review](../dsh-web-code-review/SKILL.md).
- README, docs, or instructions: [dsh-web-documentation](../dsh-web-documentation/SKILL.md).
- Push, PR, or repository-check claim: [dsh-web-pre-push-checks](../dsh-web-pre-push-checks/SKILL.md); reading it does not authorize synchronization or pushing.
- User-visible client behavior: [dsh-web-web-qa](../dsh-web-web-qa/SKILL.md); visual changes require screenshots and multimodal validation.
- New skin or community-plugin registration: load the dedicated skill if available; otherwise inspect the owning generator and instructions instead of inventing a skill or process.
- Explicit release or release-specific audit/repair: [dsh-web-release](../dsh-web-release/SKILL.md), starting with its authorization boundary. CI/configuration repair alone is not a release.

Code navigation prefers CodeGraph (`query`, `explore`, `node`, `impact`, `affected`) when useful and available; use source search when unavailable or unsuitable. After code changes in an indexed project, sync and check status before final validation; initialize/index a missing index when needed, but do not block a small fix on index maintenance. Documentation-only work needs no code index or GUI ceremony.
