# Agent Note: npm 通道暂停期间的 dsh-usage 独立发布

Status: implemented

## Problem

npm 发布通道处于全家桶暂停状态（见[暂停决策](2026-08-28-pause-release-npm-publish-unstable-dsh-alpha.md)）：tag 只产出 GitHub Release，因为全家桶依赖的 `@deepseek-ai/*` alpha cohort 无法从 registry 解析。但用户要求把新的使用统计插件以独立 npm 包的形式发布以便分发——从 npm 安装是本 checkout 之外的机器最方便的路径，且社区插件生态本就是 npm registry 形态。

## Decision

`@linxin666/dsh-usage@0.3.7` 已手工发布到 npm（在包目录内一次 `pnpm publish --access public`，基于已提交的功能状态），不走 tag 管线。全家桶通道保持暂停；不发布其他包，不改任何版本号。

这不与暂停理由冲突。暂停阻断的是依赖图无法从 registry 解析的发布。dsh-usage 的运行时依赖图只有 `schemastery`；`@deepseek-ai/*` 仅出现在 `devDependencies`（作为依赖被安装时永不安装），对它们的运行时导入由 DSH 运行时自身解析——正是仓库 `.npmrc` scope 映射与 `scripts/runtime-deps-check.mjs` 所断言的解析路径，且该检查对本包通过。`react` 是正常的 registry peer。消费者的 `pnpm add @linxin666/dsh-usage` 可干净解析，这正是暂停要保证的事。

## Consequences

- 版本 0.3.7 不对应任何 tag：包创建于 v0.3.7 切出之后，统一版本策略禁止单个包抢先升版。tarball 内容即发布时所自的功能提交；下一次全仓发版（0.3.8 或更高）会让 dsh-usage 与其他包一样走管线发布，统一 bump 保证 `pnpm -r publish` 不会撞上已发布版本。
- 通道恢复前，这是全家桶唯一在 npm 上的包；npm 消费者不应期待其余包出现在那里。
- 已发布清单保留了 `@deepseek-ai/*` 的 devDependency 区间（不可解析但惰性）；通道重开后每个家族包发布出去也是同样形态。
