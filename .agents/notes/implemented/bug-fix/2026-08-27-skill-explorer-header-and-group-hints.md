# Agent Note: Clean Header Title and Accurate Group Hints in Skill Explorer

Status: implemented

## Problem

In `dsh-skill-explorer` (#1215):
1. The modal header rendered an arbitrary first workspace path (`cwd: /path/to/project1`), which was misleading when opened from other projects or global views.
2. Group hints for project skill directories were hardcoded as "Current project only" (`仅当前项目`), which caused confusion when skills from multiple active project workspaces were scanned and displayed.

## Decision

1. In `SkillPanel.tsx`, removed `cwd` display from the modal header so it renders a clean, focused title "Skill Center" / "技能中心".
2. In `collect.ts` and `locales.ts`, updated group hints to accurately describe scope:
   - Project skills: located in the project directory, scoped to their workspace.
   - User skills: global skills (`~/.dsh/skills`, `~/.agents/skills`) shared across all projects.
   - Bundled skills: global skills shipped with DSH and plugins.

## Consequences

- The header title is clean and no longer misleadingly displays a single project path.
- Skill group descriptions accurately clarify whether skills are global or scoped to their respective project workspace.

## Testing

Added unit test in `packages/dsh-skill-explorer/tests/panel.spec.tsx`. All 73 tests in `dsh-skill-explorer` passed.
