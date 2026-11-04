# Agent Note: the dsh-git-graph package is retired in favour of the official Git changes plugin

Status: implemented

## Problem

Official DSH now ships `@deepseek-ai/dsh-workspace-changes` (bundle row `workspace-changes` in
`@deepseek-ai/dsh-web-app`), which serves the Git-changes view the family had been shipping
itself. `packages/dsh-git-graph` had grown into three unrelated jobs — a branch chip in the
blank-session hero row, a commit graph dialog, and worktree session isolation — and its first
two now duplicate the official surface while the family keeps paying for its own git service,
its `/git/*` host routes and its `git_worktree` model-facing tool.

## Decision

- **The package is deleted outright.** `packages/dsh-git-graph/` is gone (126 tracked files);
  the aggregate no longer mounts a row for it, no longer depends on it, and no longer ships its
  ru dictionary, its settings-bridge allowlist entry, its mobile suppression rule, its
  test-standards and coverage baselines, or its script-gate entries.
- **The aggregate keeps the old sub-path as a retirement shell.** `aggregate.yml` keeps
  `git-graph` in `tombstones:` and registers `{"family": "git-graph", "plugin":
  "@linxin666/dsh-client-ui-git-graph"}` in `retiredPlugins:`. A profile written before this
  change recorded the row name `@linxin666/dsh-web-all/git-graph`; that name must stay
  resolvable (otherwise the import stage throws `ERR_PACKAGE_PATH_NOT_EXPORTED` and takes the
  whole aggregate boot group down), and the shell must treat it as a silent no-op instead of
  recording a degraded plugin. This is the same two-part mechanism `remote-web-ui` and
  `update` already use.
- **The published npm package stays published.** `@linxin666/dsh-client-ui-git-graph` remains
  on the registry, so a user who installed it standalone keeps a working plugin; the workshop
  badge list and the published-package e2e roster therefore still list it.
- **The Git-changes view is served by the official plugin.** `workspace-changes` owns it from
  now on. Worktree session isolation moves to the official experimental `client-ui-forge`
  plugin, which ships worktree management and diffs; the family no longer carries its own.
- **The Verdandi skin's composer stats bar was adapted in the same change.** The skin styled the
  composer dock as a paper panel and expected a third element inside it; the host now renders
  the context ring as a sibling of the slot wrapper, so the panel and the ring read as two
  detached pieces. The skin now joins them into one bar and drops the dead
  `[data-dsh-live-tps]` selector.

## Alternatives considered

- **Keep the package as a deprecated stub that only prints a notice.** Rejected: the family would
  keep a second git surface next to the official one, and every user would have to disable it by
  hand. The four earlier removals in this repository (`dsh-aionui-panel`, `dsh-live-stats`,
  `dsh-desktop-launcher`, `dsh-model-capabilities`) set the precedent: delete the package.
- **Split worktree isolation into a slim package and keep it.** Rejected: the official forge
  plugin already owns worktrees, so a new package would be a second implementation of the same
  capability, and the split would leave a package whose only job is a wrapper.
- **Retire the aggregate row and drop the sub-path export too.** Rejected: that is the
  "completely removed" reading of the manifest, and it turns an old profile's leftover row name
  into a hard import error at every boot. The tombstone plus the retirement registry costs one
  shell export and keeps the upgrade silent.

## Consequences

- The family no longer ships the `git_worktree` model-facing tool, the managed
  `$DSH_HOME/worktrees/` directory, or the branch chip in the blank-session hero row. Users who
  relied on them move to the official plugins; the registry copy of the npm package still offers
  the old behaviour for anyone who wants to keep it.
- A profile that recorded a user-layer `disabled` override for the now-absent
  `web-ui-git-graph` row id makes the loader report "entry not found" — the same accepted
  consequence the `update` and `remote-web-ui` retirements already carry.
- The skin-side cleanup (dead `[data-gitgraph-*]` rules, the semantic-attribute contract rows
  owned by the plugin, the skin centre's `data-dsh-plugin="git-graph"` injection) lives in the
  dsh-skins repository and moves that repository's gitlink here.

## Testing

`pnpm typecheck`, `pnpm test`, `pnpm test:standards`, `pnpm test:scripts`, `pnpm docs:check`,
`pnpm i18n:check`, `pnpm aggregate:check`, `pnpm libs:check`, `pnpm market:check`,
`pnpm emoji:check` and `pnpm build` all pass; `node scripts/aggregate.mjs --check` reports
three retired plugins and no git-graph row. The composer stats bar was verified in the running
Web GUI under the Verdandi skin with before/after screenshots.

## Superseded decisions

The decision records below describe the removed package. They are kept as historical records and
are cross-linked here rather than deleted, because they still carry the rationale behind
behaviours the official plugins had to reproduce.

- [Git worktree parallel sessions in dsh-git-graph](../feature/2026-08-26-git-worktree-parallel-sessions.md)
- [git-graph status spawn plan](../architecture/2026-10-10-git-graph-status-spawn-plan.md)
- [git-graph dock-only input seat](../architecture/2026-10-18-git-graph-dock-only-input-seat.md)
- [git-graph branch chip hero portal](../bug-fix/2026-08-31-git-graph-branch-chip-hero-portal.md)
- [git-graph hero chip placement feedback loop](../bug-fix/2026-10-29-git-graph-hero-chip-placement-feedback-loop.md)
- [git locale pin and CLI probe test](../bug-fix/2026-11-01-git-locale-pin-and-cli-probe-test.md)
