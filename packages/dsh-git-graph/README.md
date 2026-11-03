# dsh-git-graph · Visual Git Commit Graph & Multi-Agent Worktree Isolation for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-git-graph?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--alpha.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Visual Git Commit Graph & Multi-Agent Worktree Isolation for DeepSeek Harness (DSH)</strong><br>
  <em>Interactive Commit Graph · Blank-Session Branch Switcher · Worktree Isolation · Conflict Prevention · Security Guards</em>
</p>

An external plugin for DeepSeek Harness (DSH) Web GUI and official desktop client: featuring an **interactive Git branch switcher** and a **visual Git commit graph** panel. The branch switcher appears exclusively on blank conversations, mounting on the shell's composer dock (`conversation.input.dock`), the seam every shipped shell declares. In blank conversation hero state, the chip elevates into the hero row directly right of the agent-preset chip, styled with authentic 28px pill layout and `--dsw-*` theme tokens. Active sessions hide the switcher. Git operations run in the host process (`git switch`) while the UI renders via React.

Mirrors ZCode's `GitBranchSwitcher` behavior: searchable dropdown, active checkmark, "Create and switch branch... / Git Graph" footer actions, safety guards (unresolved merge conflicts, operations in progress, branch locked by other worktrees), and clear error diagnostics.

## Repository layout and build

The plugin is a self-contained cordis plugin package inside the dsh-web family monorepo (see "Generic install" below); no DeepSeek Harness source checkout is involved. All peer APIs come from the official `@deepseek-ai/*` npm SDK declared in `devDependencies`, resolved from `node_modules`, and the type gate is `pnpm run typecheck` (`tsc -b` over the package's own host and client programs).

```sh
pnpm install
pnpm run typecheck   # tsc -b (host + client programs)
pnpm test            # vitest (core pure functions / real git service / jsdom components)
pnpm run build       # tsc -b && tsdown (lib/index.js + lib/client.js)
```

`lib/client.js` is the browser bundle (a closure-factory artifact, `window.__ModuleLoader__.load`), served by the host's client-modules at `/plugins/<id>/client.js`; both `tsdown.config.ts` and `tsdown.prepare.config.ts` import the one shared client preset at `shared/tsdown.client.ts` (with the browser platform seed table it reads), and the package keeps no copy of either.

Git installs go through the `prepare` script: `tsdown --config tsdown.prepare.config.ts` transpiles directly from src without type checking (`tsconfig.prepare.json` is self-contained).

## Activation

This package is a dsh profile bundle (`package.json` declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`). After activation, the next `dsh web` (or corresponding profile) startup has the bundle patch's insert line mount `ui-git-graph` (host half: git service + `/git/*` routes) together with the browser half (dsh.client declaration) into the Web composition; after a page refresh, the branch pill appears in the hero row after the agent-preset seat for a blank session and is absent from an active session.

### Generic install (any machine)

This plugin is merged into the dsh-web family monorepo (`github.com/zhu1090093659/dsh-web`). The plugin is published to npm; one-line install recommended:

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-git-graph@latest
```

Or install the family aggregate package `@linxin666/dsh-web-all` all at once (same one-line `dsh plugin --profile web add @linxin666/dsh-web-all@latest`).

Install from the repository when you need to debug code:

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-git-graph
```

> The `github:` install form applies to a standalone repo whose package sits at the repository root (the `prepare` script builds self-contained; pnpm ≥10 rejects it the first time, add the package key to the profile's `pnpm-workspace.yaml` `allowBuilds` per the printed error and retry). For subpackages of a monorepo use the `link:` form above.

### Local development loop (this repo checkout)

```sh
dsh plugin --profile <name> add link:/absolute/path/to/dsh-git-graph
```

A `link:` install references the local directory directly; a rebuild takes effect immediately without reinstalling (after a code change, `pnpm run build` then refresh the page). Note that `link:` takes an absolute path (`~` is expanded by the shell, not by pnpm semantics).

## Worktree isolation

The branch popover carries two worktree entries (a worktree is a linked git checkout that shares the repository history but owns its files and branch, so parallel sessions never touch each other's tree):

- **Start a new session in a worktree…** opens a dialog: name the worktree and pick the base branch (the current branch is preselected). The host creates the worktree at `$DSH_HOME/worktrees/<repo-key>/<name>/` on a NEW branch `wt/<name>` (git forbids checking out one branch in two places), registers it as a workspace, and opens its blank session. The current checkout never moves.
- **Manage worktrees…** lists every linked worktree of the repository with branch/head. Managed worktrees can be removed: a dirty worktree rejects once and then offers an inline force-confirm; the `wt/` branch survives removal unless the row's delete-branch checkbox is on. The primary checkout row is display-only.

Two gates live in the plugin's settings card (both off by default):

- **Auto-isolation** (`autoIsolate`): the New Session action of a git workspace silently creates a fresh managed worktree and starts the session there — the Claude-desktop-style automatic shape. `autoBaseline` picks the base: the checkout's current HEAD (`current`) or the remote default branch (`default`, resolved as `origin/HEAD` with a HEAD fallback when no remote exists). Workspaces already inside the managed home are never re-isolated, and any failure degrades to the official new-session behavior. This wraps the browser-side workspaces service at runtime — a shape-probed patch, not a source change; an SDK update that changes that service disables the feature with a console diagnostic instead of breaking anything.
- **Agent tool** (`agentTool`): registers the model-facing `git_worktree` tool (create/list/remove over the same managed home, workspace-gated by the calling session's cwd). This deliberately lifts the package's "git stays off the model-visible surface" rule for opted-in users. Mind the sandbox boundary: a session's cwd is immutable, so the current session cannot move into the worktree, and under workspace-write sandboxing the agent cannot write outside its session root — `create` therefore also registers the worktree as a workspace and its reply tells the model to open a new session there. Under danger-full-access the agent may work in the returned path directly.

Removal only ever targets direct children of the repository's managed directory (canonical-path containment on both sides) and unregisters the linked workspace after the disk removal succeeds.
## Uninstall

```sh
dsh plugin --profile web remove @linxin666/dsh-client-ui-git-graph
```

## Design notes

- Boundary and load-chain research and key decisions: see [docs/ADR-001-plugin-boundary.md](docs/ADR-001-plugin-boundary.md).
- The host half's `/git/*` only accepts paths of registered workspaces (realpath check) and trusted clients (loopback socket + loopback Host, the same fence as dsh-ssh, plus a live paired-device cookie when `dsh-remote-web-ui` is loaded); the browser cannot run git against arbitrary directories, and a LAN-exposed dsh web answers unpaired non-loopback clients with 403.
- The switch semantics are workspace-level: `git switch --no-guess <branch>` operates on the repoRoot checkout tree and affects all sessions of that workspace; project switch = activate the target workspace and open its (reused or newly created) blank session, without changing the cwd of existing sessions.
- Mount seam: `conversation.input.dock`, the composer dock the shell declares for its own queue and todo docks. Registration waits for that declaration through `slots.inject` (a bare `register` is rejected for undeclared slots) and there is no second seat. The branch pill renders only for blank sessions and hides when there is no session cwd, the workspace is not a Git repository, or the session is no longer blank. There the chip re-anchors into the official hero row after the agent-preset seat (2px row gap, vertically centered, with matching workspace/preset chip metrics and tokens) and opens its picker downward like the official workspace menu. React appends portal children at the end of that row, so the chip re-orders itself immediately before the row's trailing options group, which is pinned to the right edge with `margin-left: auto`; without that step it would render above the composer card's right corner instead of beside the preset chip. Active sessions have no branch-selection control.
- Workspace selection is not inside this plugin: the official workspace pill (`conversation.input.selector.workspace`) is the only entry; this plugin only provides git branch context.
- Branch state refresh: fetch when the blank-session chip mounts / the popover opens / a switch succeeds, plus host SSE (`/git/events`, polling workspace state every 30s while subscribed, each probe bounded by a 15s deadline so a hung git never stalls the stream) pushing external changes and a window-focus refresh (throttled to once per 5s). Active sessions do not subscribe. The SSE stream is shared across tabs through a cross-tab leader relay (Web Locks + BroadcastChannel): one stream per URL browser-wide, so extra tabs never exhaust the same-origin HTTP connection pool (#383).

## Check chain

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.
