# Agent Note: 在 dsh-web-all 中为 dsh-better-sidebar 补齐 peer SDK devDependencies

Status: implemented

## Problem

在使用重新加入的 `dsh-better-sidebar@0.18.0-alpha.0` 启动 `dsh web` 时，cordis 加载 `web-ui-better-sidebar` 条目失败，报错 `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-subagent'`。

由于仓库在 `pnpm-workspace.yaml` 中设置了 `autoInstallPeers: false`，只有在导入方 workspace 包（`packages/dsh-web-all`）或 monorepo 声明了对应依赖时，pnpm 才会将 peer 依赖装填进外部包的 `.pnpm/` 虚拟 store。`dsh-better-sidebar` 的宿主侧运行时导入了 `@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-invariants` 等，而这些此前未在 `dsh-web-all` 的 `devDependencies` 中声明。当 `scripts/link-profile.mjs` 把 `dsh-better-sidebar` 从仓库 `.pnpm` 虚拟 store 软链进 `~/.dsh/profiles/node_modules/` 时，Node 基于 realpath 的模块解析无法定位到 `@deepseek-ai/dsh-subagent`。

## Decision

1. 将 `dsh-better-sidebar` 及其他外部聚合插件所需的完整官方 SDK peer 依赖集合加入 `packages/dsh-web-all/package.json` 的 `devDependencies`，版本固定为 `^0.1.2-alpha.2`（`cordis` 固定为 `^4.0.2`）：
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
2. 将 `@deepseek-ai/dsh-util-time@0.1.2-alpha.2` 加入 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。
3. 执行 `pnpm install` 与 `node scripts/link-profile.mjs`，刷新 pnpm store 的 peer 软链与 profile 软链映射。

## Alternatives considered

- 全局开启 `autoInstallPeers: true`：否决——仓库策略保持 `autoInstallPeers: false`，避免 workspace 各包间无意引入臃肿的传递依赖。
- 要求 `dsh-better-sidebar` 内联打包全部宿主 peer：否决——`dsh-better-sidebar` 是上游外部包，其架构依赖 cordis 与 DSH SDK 的 peer 注入机制。

## Consequences

`dsh-better-sidebar` 的 `.pnpm` 虚拟 store 包含全部 peer SDK 包。在启动 `dsh web` 时，Node.js 可以干净地解析 `@deepseek-ai/dsh-subagent` 及所有传递性 SDK 依赖。

## Testing

1. 在 `~/.dsh/profiles/web` 执行环境下验证动态导入 `import("dsh-better-sidebar")` 成功。
2. 验证 `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm aggregate:check`、`pnpm test:scripts` 全部通过。
