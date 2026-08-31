# Agent Note：morlay message-actions 的 alpha.1 store require 补丁

Status: implemented

## Problem

宿主 checkout 合入 0.1.2-alpha.1 后（快照 store 引擎从 `@deepseek-ai/dsh-client-runtime` 注入面迁入 `@deepseek-ai/dsh-client-store` 平台模块），第三方包 `@morlay/ui-conversation-message-actions@0.0.11` 的 client bundle 开始在 loader 的 client-modules 校验上失败（"missed the module table"）。该包经 `@morlay/better-session`（`dsh-web-all` 依赖）以预构建 npm 内容进入 profile，并对 rc.2 时代的旧说明符发出硬 require 来获取 `createSnapshotStore`。它不同于工作区自有 bundle（见 [client-store-dual-cohort-engine-shim](2026-08-28-client-store-dual-cohort-engine-shim.md)）——本仓库不构建它，无法搭上共享 tsdown 垫片。

## Decision

仓库以 `pnpm patch` 托管对该包的补丁（`patches/@morlay__ui-conversation-message-actions@0.0.11.patch`，注册在 `pnpm-workspace.yaml` 的 `patchedDependencies`）。补丁把那一条 require 改写为与 tsdown 垫片相同的双 cohort 探测：先试 `@deepseek-ai/dsh-client-store`，失败回退旧面——两个说明符均用 `join` 拼接构造，避免被 loader 的静态 external 扫描标记。

loader 经父层链接 `~/.dsh/profiles/node_modules/@morlay/ui-conversation-message-actions`（由 `scripts/link-profile.mjs` 创建）解析该条目，因此把该链接从补丁前的 store 实例重指到补丁实例（`…patch_hash=365ff758…`）。profile 自有的 `.dsh-module-fallback` 链无需改动：它经 `dsh-web-all/node_modules/@morlay/better-session` 到达，其嵌套依赖链接已被 pnpm 重新指向补丁实例。

## Maintenance contract

- 补丁钉在 0.0.11。升级 `@morlay/better-session` 时需对新构建重新推导补丁（`pnpm patch` / `pnpm patch-commit`），或在上游发布 alpha.1 兼容版本后整体移除（上游 `next` 分支已以未发布 WIP 提交携带对齐改动）。
- 每次重新打补丁后，父层链接必须重指到新的 `patch_hash=…` 实例。`scripts/link-profile.mjs` 目前做不到：它经陈旧的 repo 根提升链接解析该包，会把链接改写回未打补丁的实例（2026-08-28 已用 `--dry-run` 验证）。修正该解析是未完成的后续工作。

## Alternatives considered

- 基于 morlay 的 `next` 分支及其 vendored 宿主构建——alpha.1 对齐在那里只是未发布的 WIP 提交；更重且不是发布物。
- 等待上游发布 alpha.1 兼容的 npm 版本——期间 profile 条目持续失败。
- 在 loader 层为旧名注册别名模块——为一个消费者、一个导出做更深的宿主集成。

## Consequences

- 失败条目在 alpha.1 宿主上恢复加载；rc.2 宿主走旧名回退分支继续工作，补丁对 cohort 中立。
- 依赖升级时多了一个需维护的仓库自有补丁。被消费的引擎面只有 `createSnapshotStore`，是垫片共享面的子集。

## Verification

- 在 `~/.dsh/profiles/web` 下 `import.meta.resolve('@morlay/ui-conversation-message-actions/client')` 落在补丁实例；解析出的 bundle 中裸 `require("@deepseek-ai/dsh-client-runtime/client")` 为零，且带有 join 拼接探测；补丁文件通过 `node --check`。
