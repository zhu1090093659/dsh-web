# Agent Note: Git worktree parallel sessions in dsh-git-graph

Status: implemented

## Problem

Every DSH session of a workspace shares one checkout tree, so parallel sessions editing the same repository collide (the dsh-parallel-dev discipline exists only to mediate that pain). Mature agent desktops solve this with git worktrees: the Claude Code desktop creates one worktree per new session automatically, and the Codex desktop offers worktree chats plus a Local/Worktree handoff. The question was whether dsh-git-graph — a self-contained cordis plugin with a host git service, /git/* routes, and a branch chip — could grow the same capability WITHOUT modifying DSH itself.

## Decision

Four layers shipped, all inside packages/dsh-git-graph:

- **Managed worktree verbs (host)**: `GitService.worktrees/addWorktree/removeWorktree` over the existing runner and workspace gate, exposed as `/git/worktrees`, `/git/worktree-add`, `/git/worktree-remove`, plus a pathless `/git/config`. Every managed worktree lives at `$DSH_HOME/worktrees/<repo-key>/<name>/` (repo-key = sanitized basename + 8-char sha1 of the canonical root) and always checks out a NEW branch `wt/<name>` — git forbids one branch in two checkouts, so the base branch is never reused. The client names a worktree but never supplies its path; the host constructs the target itself, keeping the workspace-gate security boundary unchanged. Removal enforces canonical-path containment on BOTH sides (DSH_HOME may traverse symlinks: macOS /var -> /private/var), rejects dirty worktrees unless forced, and deletes the `wt/` branch only on explicit request.
- **Manual entry (client)**: the branch popover footer gained "start a new session in a worktree" (name + base-branch dialog) and a worktree manager dialog (list, dirty-guarded removal with inline force-confirm, optional branch deletion). A created worktree is registered as a workspace through the public `ctx.workspaces.create` and opened with `startSession` — the worktree-as-workspace mapping that makes isolated sessions possible with zero host patching. Registration failure rolls the worktree back.
- **Auto-isolation (client, settings-gated, default off)**: `autoIsolate` wraps the shared browser-side WorkspacesService `startSession` at runtime — a probed monkey-patch, not a source change — so the New Session action of a git workspace lands in a fresh managed worktree (baseline from `autoBaseline`: current HEAD or `origin/HEAD` with a HEAD fallback). Only `startSession` is wrapped; `connectWorkspace`'s blank-session reuse and startup selection never spawn worktrees. Shape probing degrades to official behavior with a console diagnostic when client-runtime internals change; workspaces already under the managed home are never re-isolated. A routing flow holds its target in an in-flight set, so a fast double click on New Session creates one worktree instead of two (the sidebar button has no disabled state and the official `startSession` is fire-and-forget). When the official start throws after a successful registration, the rollback drops that registration through the optional `workspaces.delete` (`IWorkspaces.delete` — "Delete a Workspace registration without deleting Sessions or files") before deleting the worktree directory, so no workspace row is left pointing at a removed path (issue #1507).
- **Agent tool (host, settings-gated, default off)**: `agentTool` registers the model-facing `git_worktree` tool (create/list/remove) through the official `ctx.tools.register` seam, scoped by the calling session's cwd. This deliberately reverses the package's original "git stays off the model-visible surface" rule for opted-in users. Because a session's cwd is immutable and the workspace-write sandbox roots writes at the session cwd, `create` also registers the worktree as a workspace (host-side `workspaceRegistry.create`) and its reply steers the model to open a new session there — the environment-preparation semantics that keep the tool useful under sandboxing; under danger-full-access the agent can work in the returned path directly.

Settings ride `installSettingsSection` (the shared settings card) with a schemastery schema; the browser reads the live config through `/git/config` per New Session action, so toggles apply without a reload. The SSE poll key gained a worktree-membership digest so external `git worktree add/remove` also pushes a change event, with no new polling cadence.

## Alternatives considered

- **Host-side interception of `session/create`**: cordis exposes `connection.rpc.intercept('/api', ...)`, but the channel accepts exactly one interceptor and dsh-api-gateway already occupies it, and the seam has no delegation semantics (no way to adjust a payload and pass it on). Rejected as impossible without main-repo changes.
- **Codex-style handoff (moving an existing session between checkouts)**: requires rebinding a session's cwd, which the immutable SessionHeader forbids and no client API offers. Deferred until DSH grows a cwd-rebind seam.
- **Claude-style per-call subagent isolation**: the model-facing subagent tool has no cwd parameter (child cwd is plugin-load-time config), so an agent cannot spawn a child into a chosen worktree. Deferred likewise.
- **Worktrees inside the repository (`.claude/worktrees` style) or repo-sibling directories**: both were considered during design; the user chose centralized `$DSH_HOME/worktrees/` management only, which keeps the workspace gate's realpath-equality semantics clean and never pollutes the repository or its parent directory.
- **Detached-HEAD worktrees (Codex style)**: rejected; a named `wt/<name>` branch keeps commits anchored and the existing branch-in-other-worktree guard vocabulary intact.

## Consequences

- The package's model-visible-surface invariant now reads "off by default"; the package AGENTS.md carries the exception clause and this note owns the rationale.
- Auto-isolation depends on unpublished client-runtime internals (the WorkspacesService singleton shape); it is explicitly experimental and fails safe.
- Worktree sessions appear as first-class workspaces in the sidebar (the Codex permanent-worktree model); lifecycle is user-managed through the manager dialog — deleted sessions never auto-delete worktrees, and orphaned worktrees are reconciled through the manager (git worktree list is the source of truth).
- Six new stable error codes entered the wire vocabulary: invalid-worktree-name, worktree-already-exists, worktree-dirty, worktree-not-found, worktree-is-main, base-ref-not-found.

## Testing

Core unit tests cover the porcelain parser, name sanitizer, and argv builders; host integration tests run real git in temp repositories with a temp DSH_HOME (creation, base-ref selection and origin/HEAD fallback, duplicate/invalid names, dirty rejection and force, containment refusal, branch deletion); route tests cover the new endpoints including the pathless /git/config and the non-loopback fence; client tests cover the dialog flows and the auto-isolation routing matrix (off/non-git passthrough, redirect, no-nesting, failure degradation, shape-mismatch refusal).
