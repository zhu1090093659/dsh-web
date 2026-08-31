# Agent Note: Monorepo Open Issues Batch Resolution (#1296, #1305, #1304, #1313, #1301)

Status: implemented

## Problem

Five actionable issues remained in the repository:
1. **#1296**: Task board and SSH collapsed sidebar entries shifted right by 4px in standalone installs because their styles relied on `[data-dsh-frame][data-sidebar-collapsed]`, which is only present when `dsh-web-all` is mounted.
2. **#1305**: In `dsh-skill-explorer`, the "invokable" badge lacked sufficient visual contrast and missing accessible tooltip semantics.
3. **#1304**: In `dsh-skill-explorer`, provider identifiers (such as `filesystem`) were rendered verbatim in English without localization or tooltip.
4. **#1313**: In `dsh-task-board`, calling `session/list` on older DSH runtimes (< 0.1.2-alpha.2) produced repeated `invocation-unavailable` errors on every polling tick.
5. **#1301**: In `dsh-web-all`, staggered multi-stage mounting during initial load caused visible layout flickering across WebView and mobile browsers.

## Decision

1. **Sidebar Collapsed Centering (#1296)**:
   - Updated `packages/dsh-task-board/src/client/board.module.css` and `packages/dsh-ssh/src/client/panel/panel.module.css` to match both `:global([data-dsh-frame][data-sidebar-collapsed])` and `:global([data-sidebar-collapsed])`.
   - Updated respective unit test assertions.
2. **Skill Explorer Badges & i18n (#1305, #1304)**:
   - Improved `.badgeInvokable` contrast in `packages/dsh-skill-explorer/src/client/skill-panel.module.css`.
   - Added `providerLabel` helper and tooltip attributes in `SkillPanel.tsx`.
   - Added localized translation keys in `packages/dsh-skill-explorer/src/client/locales.ts` and `packages/dsh-i18n/src/client/ru/skill-explorer.ts`.
3. **Task Board Version Degradation (#1313)**:
   - Added `isInvocationUnavailable` check in `packages/dsh-task-board/src/host-runner.ts` to log a single actionable warning on DSH < 0.1.2-alpha.2 runtimes and degrade gracefully without continuous error logs.
4. **Boot Shield Transition (#1301)**:
   - Added lightweight `[data-dsh-boot-splash]` overlay in `packages/dsh-web-all/src/client/index.ts` with automatic fade-out and timeout guard upon initial shell mount.

## Consequences

- Standalone navigation entries align accurately with shell center lines.
- Skill explorer badges are fully accessible, localized (zh/en/ru), and informative.
- Host logging on older DSH versions remains clean and actionable.
- Startup loading experience is seamless without unstyled content flashing.

## Testing

`pnpm typecheck`, `pnpm test`, `pnpm test:scripts`, `pnpm i18n:check`, and `pnpm docs:check` all pass cleanly.
