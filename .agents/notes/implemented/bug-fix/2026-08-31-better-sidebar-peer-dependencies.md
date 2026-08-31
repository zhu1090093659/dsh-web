# Agent Note: Provide peer SDK devDependencies for dsh-better-sidebar in dsh-web-all

Status: implemented

## Problem

When booting `dsh web` with the re-added `dsh-better-sidebar@0.18.0-alpha.0`, cordis failed to load the `web-ui-better-sidebar` entry with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-subagent'`.

Because the repository sets `autoInstallPeers: false` in `pnpm-workspace.yaml`, pnpm only populates peer dependencies into an external package's `.pnpm/` virtual store when the importing workspace package (`packages/dsh-web-all`) or the monorepo declares those dependencies. `dsh-better-sidebar`'s host-side runtime imports `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-session`, and `@deepseek-ai/dsh-invariants`, which were not declared in `dsh-web-all`'s `devDependencies`. When `scripts/link-profile.mjs` linked `dsh-better-sidebar` from the repository's `.pnpm` virtual store into `~/.dsh/profiles/node_modules/`, Node's realpath-based module resolution could not locate `@deepseek-ai/dsh-subagent`.

## Decision

1. Add the full set of official SDK peer dependencies required by `dsh-better-sidebar` and other external aggregate plugins to `packages/dsh-web-all/package.json`'s `devDependencies` pinned to `^0.1.2-alpha.2` (and `cordis` to `^4.0.2`):
   - `@deepseek-ai/cordis`
   - `@deepseek-ai/dsh-agent`
   - `@deepseek-ai/dsh-attachment`
   - `@deepseek-ai/dsh-host-webserver`
   - `@deepseek-ai/dsh-invariants`
   - `@deepseek-ai/dsh-llm`
   - `@deepseek-ai/dsh-scope`
   - `@deepseek-ai/dsh-session`
   - `@deepseek-ai/dsh-settings`
   - `@deepseek-ai/dsh-subagent`
   - `@deepseek-ai/dsh-system-prompt`
   - `@deepseek-ai/dsh-tools`
   - `@deepseek-ai/dsh-typert-protocol`
   - `@deepseek-ai/dsh-util-time`
2. Add `@deepseek-ai/dsh-util-time@0.1.2-alpha.2` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
3. Run `pnpm install` and `node scripts/link-profile.mjs` to refresh the pnpm store peer links and profile links.

## Alternatives considered

- Turn on `autoInstallPeers: true` globally: rejected — repository policy keeps `autoInstallPeers: false` to avoid unintended dependency bloating across workspace packages.
- Require `dsh-better-sidebar` to bundle all host peers: rejected — `dsh-better-sidebar` is an upstream external package whose architecture relies on cordis and DSH SDK peer injection.

## Consequences

`dsh-better-sidebar`'s `.pnpm` virtual store contains all peer SDK packages. Node.js resolves `@deepseek-ai/dsh-subagent` and all transitive SDK dependencies cleanly when booting `dsh web`.

## Testing

1. Verified direct dynamic import `import("dsh-better-sidebar")` succeeds in the `~/.dsh/profiles/web` execution environment.
2. Verified `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm aggregate:check`, and `pnpm test:scripts` all pass.
