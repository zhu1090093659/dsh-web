# Agent Note: DSH Desktop Profile Documentation and Remote LAN Guidance

Status: implemented

## Problem

1. (#1180) Monorepo documentation only featured `--profile web` and `dsh web`, leaving DSH Desktop users unclear on whether and how to install `@linxin666/dsh-web-all` into the `desktop` profile.
2. (#1183) Headless server deployments over SSH (binding to `--host 0.0.0.0`) had no immediate console log indicating reachable LAN mobile Web UI URLs on startup.

## Decision

1. Updated root `README.md`, `README.en.md`, `packages/dsh-web-all/README.md`, and `packages/dsh-web-all/README.zh.md` to clearly detail `desktop` profile commands (`dsh plugin --profile desktop add @linxin666/dsh-web-all@latest`, `dsh --profile desktop --dump-config`, and restarting the Desktop client).
2. In `packages/dsh-remote-web-ui/src/index.ts`, added a startup log reporting the reachable LAN mobile UI URLs whenever LAN addresses are present.

## Consequences

Desktop users have first-class installation guides across all documentation, and headless SSH server users can immediately see available LAN connection URLs upon startup.

## Testing

`pnpm docs:check` and `pnpm --filter @linxin666/dsh-remote-web-ui test` pass cleanly.
