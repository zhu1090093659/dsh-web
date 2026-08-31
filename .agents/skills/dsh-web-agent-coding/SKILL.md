---
name: dsh-web-agent-coding
description: Use for an implementation, maintenance, or configuration task in the dsh-web monorepo. Establishes the project-specific Agent Coding workflow and routes to focused skills.
whenToUse: Any request that changes dsh-web source, scripts, plugin configuration, generated assets, or repository automation.
user-invocable: true
---

# dsh-web Agent Coding

This skill is guidance, not a replacement for repository instructions. [AGENTS.md](../../../AGENTS.md) is the authoritative source for repository rules.

## Establish scope

1. Confirm the workspace, repository root, current branch, and worktree status before writing. Preserve unrelated changes from other sessions; do not reset, clean, restore, or stage them.
2. Read the root instructions, then the nearest applicable `AGENTS.md`. Read [packages/AGENTS.md](../../../packages/AGENTS.md) before changing a package and [docs/AGENTS.md](../../../docs/AGENTS.md) before writing documentation.
3. Identify the smallest owner of the behavior: a plugin package, a skin, `shared/`, a generator in `scripts/`, or an aggregate package. Keep the change in that owner unless an existing shared abstraction is the real source of truth.

## Implement within repository boundaries

- DSH itself is an external host. Do not modify its checkout or make TypeScript resolve against it. Use the official `@deepseek-ai/*` SDK through installed dependencies.
- Keep host, client, and shared logic in their respective package areas. Browser bundles must retain the platform-import and type-only SDK constraints in [packages/AGENTS.md](../../../packages/AGENTS.md).
- Edit a generated shared copy only through its source in `shared/`, then run the documented synchronization command.
- Add a package or change aggregate membership through the repository generators and update required documentation. Do not hand-edit generated output.
- Record every non-trivial change as an Agent Note under [.agents/notes/](../../notes/README.md) in the same change: proposals start in `proposed/`, shipped decisions in `implemented/`, declined proposals in `rejected/`. Follow the lifecycle, class, and format rules there.
- Adhere to the Software Factory governance baseline: maintain prompt prefix stability (Layer 1/2), route lightweight subagents (`flash`/`flash_lite`) for routine research/search/i18n, trigger the anti-thrashing circuit breaker after 3 failed attempts, and follow the 4-step CI self-healing protocol (Log Isolation -> Local Repro -> Minimal Diff -> Gate Check) when resolving errors.
- Build and exercise the affected behavior before declaring it complete. A commit alone is not delivery.

## Route focused work

- Use [dsh-web-code-review](../dsh-web-code-review/SKILL.md) for a review request.
- Use [dsh-web-pre-push-checks](../dsh-web-pre-push-checks/SKILL.md) before a push, a pull request, or a claim that checks pass.
- Use [dsh-web-documentation](../dsh-web-documentation/SKILL.md) for README, docs, or instruction changes.
- Use [dsh-web-web-qa](../dsh-web-web-qa/SKILL.md) for client-facing behavior that needs live GUI verification.
- For a new skin, community-plugin registration, or release, load the dedicated installed skill for that task instead of recreating its process here.

## Finish

Leave the worktree with only intentional changes from this task, regenerate any owned artifacts, run the relevant checks, and report the evidence actually obtained.
