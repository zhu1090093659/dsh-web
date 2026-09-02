# Agent Note: Multi-Package Open Issues Resolution Batch

Status: implemented

## Problem

Multiple open issues reported defects and UX friction across packages:
1. Issue #1341: CI under Node 22 failed on `packages/dsh-session-archive` with "Cannot bundle Node.js built-in 'node:sqlite'" because its vitest configuration ran under `environment: 'jsdom'`.
2. Issue #1331: In DSH kernel `0.1.2-alpha.1` (DSH Desktop 2.0.4), `settingsCtx.settings.installSection` threw TypeError during plugin tree load, breaking `dsh-git-graph`.
3. Issue #1344: When language models call `describe_image` with long Markdown image references, transcription errors (such as stray trailing colons) failed JSON parsing and broke image loading.
4. Issue #1346: In `dsh-task-board`, `settleExecution` unconditionally set successful execution status to `done`, moving recurring cron tasks into the completed column and preventing them from staying in the todo column.

## Decision

1. In `packages/dsh-session-archive/vitest.config.ts`, changed `environment: 'jsdom'` to `environment: 'node'` since all tests in this package test host persistence and storage routines.
2. In `packages/dsh-git-graph/src/index.ts`, introduced defensive compatibility during settings registration: use `installSection` if present, fallback to `register` if available, and guard against runtime discrepancies.
3. In `packages/dsh-tool-describe-image/src/attachment-reference.ts` and `attach-routes.ts`, introduced `repairImageRefJson` to handle model transcription noise, relaxed `parseMarkdownAttachmentReference` to fall back to `attachmentId`, and added fallback registry lookup in `serveRawImage`.
4. In `packages/dsh-task-board/src/core/tasks.ts`, updated `settleExecution` so that when `task.schedule?.enabled` is true, successful runs settle to `todo` instead of `done`.

## Consequences

- Full repository CI tests pass reliably on both Node 22 and Node 24 without `node:sqlite` bundling errors.
- `dsh-git-graph` mounts safely across varying DSH kernel versions.
- `describe-image` is resilient to model transcription syntax variations while remaining fail-closed against invalid payloads.
- Recurring task board tasks stay visible in the todo column across cron execution cycles.

## Testing

- `pnpm --filter @linxin666/dsh-session-archive test` (8/8 passed)
- `pnpm --filter @linxin666/dsh-client-ui-git-graph test` (10/10 passed)
- `pnpm --filter @linxin666/dsh-tool-describe-image test` (21/21 passed, 385 tests)
- `pnpm --filter @linxin666/dsh-client-ui-task-board test` (33/33 passed, 314 tests)
- `pnpm test` (all workspace packages green), `pnpm docs:check`, `pnpm i18n:check`.
