# Agent Note: Skill Explorer multi-workspace presentation and isolation awareness (Issue #1407)

Status: implemented

## Problem

In multi-workspace environments where multiple project sessions are running concurrently, `dsh-skill-explorer` loaded project skills from all sessions into a single flat list without distinguishing which workspace each skill belonged to:
1. Users could not tell which project workspace an entry in "Project skills" originated from.
2. Inactive workspace project skills cannot be invoked in the current active session context (workspace boundary isolation), leading to user confusion when enabling them.
3. In name collisions between project skills from different workspaces, arbitrary scan order resolved conflicts nondeterministically.

## Decision

We introduced multi-workspace presentation, isolation tagging, and workspace filtering across host scanning, wire protocol, and UI:

1. **Workspace Association & Precedence (`collect.ts`)**:
   - `scanSkillRoot` attaches `workspaceRoot`, `workspaceName`, and `isActiveWorkspace` to each `SkillEntry`.
   - In name collisions with identical priority level (`project-dsh`), the active workspace entry explicitly wins over inactive workspaces.
   - `buildPayload` compiles a `workspaces` descriptor array from all known project roots.
2. **Wire Protocol & Client API (`api.ts`)**:
   - Extended `SkillEntry` with `workspaceRoot`, `workspaceName`, and `isActiveWorkspace`.
   - Extended `ListPayload` with `workspaces?: WorkspaceItem[]`.
3. **Workspace Presentation & Filtering UI (`SkillPanel.tsx` & `skill-panel.module.css`)**:
   - Renders a workspace badge for project skills indicating their home project.
   - Renders a distinct "Workspace isolated" badge with tooltip for project skills outside the current active session, dimming the card slightly to indicate cross-workspace non-invocation.
   - Added a workspace filter dropdown atop the skills list when multiple workspaces exist, allowing users to filter by specific project workspace while keeping global skills visible.
4. **i18n Parity (`locales.ts` & `dsh-i18n`)**:
   - Added `filter.workspaceLabel`, `filter.workspaceAll`, `filter.workspaceCurrent`, `workspace.isolated`, and `workspace.isolatedHint` across Chinese, English, and Russian.

## Testing

- Added `packages/dsh-skill-explorer/tests/workspace-isolation.spec.ts`: verified workspace detection, active workspace precedence on conflicts, workspace badge rendering, isolation badge rendering, and dropdown filtering.
- All 12 test suites and 79 unit tests in `dsh-skill-explorer` pass.
- Passed full repository gates: `pnpm typecheck`, `pnpm i18n:check`, `pnpm docs:check`, `pnpm test`.

## Consequences

Users can clearly distinguish project skills across workspaces, understand execution isolation boundaries, and filter skills by active project.
