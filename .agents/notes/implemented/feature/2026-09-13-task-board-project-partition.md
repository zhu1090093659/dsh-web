# Agent Note: Task-board project partition

Status: implemented

## Problem

Issue #1536 asked the board to work per DSH project: pick a project at the top, see only that project's tasks, and stop re-picking the workspace for every new task. Tasks already carry an optional `workspaceId` pin and the browser half already injects `@deepseek-ai/dsh-api-workspace-controller`, but the board had no project concept in its UI.

## Decision

The board header renders a project row (semantic part `project-filter`) built from `executionOptions.workspaces`. An empty value means all projects; selecting one narrows board and archive alike to tasks whose `workspaceId` matches, and tasks with no pin stay under all projects. Opening the new-task form while a project is open passes `defaultWorkspaceId`, so the pinned workspace is preselected and stays editable. `new project…` opens an inline path field (`project-dialog`) and calls `BoardController.createWorkspace`, wired by the browser apply to `ctx.workspaces.create({ path })` — the same runtime call the GUI's own add-project uses, so the board and the sidebar share one project list. The row is hidden when the deployment knows no project and exposes no creator.

## Alternatives considered

Forcing a workspace selection whenever "all projects" is open, which is how the issue described it, was rejected: leaving the pin empty is the documented "most recent workspace" behaviour, and making it mandatory would add a step to every task for users who never open a project.

Filtering by workspace path instead of id was rejected: the ledger stores the id, and a renamed or moved project directory must not detach its tasks.

A board-owned project registry was rejected: it would duplicate DSH's workspace list and drift from it.

## Consequences

Tasks without a pinned workspace are only visible under all projects, so a user who switches to a project may think they disappeared; the archive behaves the same way. The workspace-controller service is now used for a write, not only for its list, so a deployment whose workspace service rejects registration shows the runtime's message in the dialog instead of failing silently. The two new semantic part values are registered in `semantic-attrs-v1.md`.
