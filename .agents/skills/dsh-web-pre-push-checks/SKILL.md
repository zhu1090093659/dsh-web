---
name: dsh-web-pre-push-checks
description: Use before pushing, opening or updating a pull request, or claiming dsh-web checks pass. Selects the required repository gates and diff-specific generation, build, and GUI evidence.
whenToUse: A dsh-web change is about to be pushed, submitted for review, merged, or reported as validated.
user-invocable: true
---

# dsh-web Pre-Push Checks

Run checks from the repository root after the implementation is stable. This workflow supplements [AGENTS.md](../../../AGENTS.md); it does not replace a focused regression test for changed behavior.

## Inspect the outgoing change

1. Confirm the branch, repository root, and worktree status.
2. Inspect the requested base-to-head diff and every dirty file that will be included.
3. Run `git diff --check` before reporting success. Do not stage unrelated changes with `git add -A`.
4. Sync collaborator merges before validating: `git fetch origin` and rebase onto `origin/dev` (`git rebase origin/dev`). Aa728848 merges renderer / Wallpaper Engine / WebGL PRs into `dev`; when the rebase pulls in new base commits, re-run the affected gates on the rebased tree before reporting.
5. Verify the push target before pushing: `git remote -v` must resolve both fetch and push to `github.com/zhu1090093659/dsh-web`, with no `remote.origin.pushurl` override. A leftover push-URL redirect (e.g. from contributor-fork PR work) silently targets the wrong repository; restore with `git remote set-url origin https://github.com/zhu1090093659/dsh-web` and `git config --unset remote.origin.pushurl`. Push to contributor forks only via a named one-off remote (`git remote add <name> <fork-url>`) or a direct URL. `scripts/git-pre-push-guard.sh` (installed as `.git/hooks/pre-push` per AGENTS.md) blocks a mispointed origin; keep it installed.

## Required repository gates

Before a push or review claim, run the repository baseline unless a higher-priority instruction narrows the operation:

```sh
pnpm typecheck
pnpm test
pnpm test:scripts
pnpm docs:check
```

Run the narrowest owning test first for a behavior change. Add an affected-package build or `pnpm build` when package exports, manifests, runtime entry points, generated bundles, or build configuration changed.

## Add checks dictated by the diff

- `shared/` changes: run `pnpm sync-shared` followed by `pnpm sync-shared:check`.
- Aggregate membership or package additions/removals: regenerate with `node scripts/aggregate.mjs`, then run `pnpm aggregate:check`.
- Skin assets, skin registry, or market asset changes: run `pnpm market:check` and `pnpm skin-center:check`.
- Community plugin index changes: regenerate with `node scripts/community-index`, then run `pnpm community:check`.
- Browser runtime imports, dependency manifests, or client bundle changes: run `pnpm runtime-deps:check` and the affected package build.
- Changed package README files: update the paired language and record the pair through `pnpm docs:write-pair` before `pnpm docs:check`.
- User-facing client changes: follow [dsh-web-web-qa](../dsh-web-web-qa/SKILL.md) and retain the actual GUI evidence.

Report commands that ran and their outcomes. State any check not run and the concrete reason rather than implying full validation.
