---
name: dsh-web-code-review
description: Use when reviewing uncommitted changes, a branch, or a pull request for dsh-web. Focuses on correctness, plugin boundaries, browser behavior, security, generated artifacts, and missing evidence.
whenToUse: A user asks to review dsh-web code, a branch, a pull request, or a diff.
user-invocable: true
---

# Reviewing dsh-web Changes

This skill is guidance, not a checklist substitute. Review the requested diff and enough surrounding code to establish actual behavior; do not infer correctness from a passing typecheck alone.

## Establish the review frame

1. Confirm the repository, requested base and head, and current worktree state. Do not mix unrelated dirty changes into the review scope.
2. Read [AGENTS.md](../../../AGENTS.md), [packages/AGENTS.md](../../../packages/AGENTS.md) for package work, and the nearest package-specific instructions.
3. Inspect the complete change surface: source, tests, manifests, generated artifacts, documentation, and the real host or client entry path.

## Collaborative review

- Aa728848 is a collaborator with merge permission on `dev` and the auto-approver for renderer / Wallpaper Engine / WebGL PRs (routed by `.github/workflows/auto-assign-pr-reviewers.yml` with `.github/pr-review-routes.json`, see [PR_TRIAGE.md](../../../PR_TRIAGE.md)). Those PRs normally skip our second review; do not review them unless the user explicitly asks.
- Before reviewing or building on top of new code, sync his merged work first: `git fetch origin` and rebase onto `origin/dev` (`git rebase origin/dev`), then re-run the affected checks. His merged PRs are already on `dev`; never review or test against a stale local `dev`.
- When the reviewed diff includes commits from his merged PRs, treat those commits as merged upstream code, not as part of the change under review.

## Prioritize material risks

- Trace host, client, and shared changes through their actual consumers. Flag incompatible service assumptions, missing disposal, stale subscriptions, HMR regressions, and changed user-visible behavior without coverage.
- Enforce the SDK boundary: packages must not import or reference a DSH source checkout; browser bundles must preserve type-only SDK imports and allowed runtime dependencies.
- Check generated ownership. Changes to `shared/`, aggregate manifests, skin registries, community indexes, or market assets need their corresponding generator and consistency check.
- Treat credentials, remote execution, local filesystem access, profile writes, and token handling as security-sensitive. Confirm authorization, error behavior, cleanup, and documentation where the affected package requires them.
- For UI changes, inspect responsive layout, loading and error states, keyboard behavior where applicable, and actual rendered output. A component-only test does not prove the linked GUI integration works.
- Verify README pairs and documentation claims when public behavior, configuration, or safety semantics change.

## Report findings

Report only actionable findings, ordered by severity. Each finding names the affected path and line, describes the observable failure or regression, and explains the condition that triggers it. Follow with test gaps and residual risks. Do not lead with a prose summary; state clearly when no blocking issue was found.
