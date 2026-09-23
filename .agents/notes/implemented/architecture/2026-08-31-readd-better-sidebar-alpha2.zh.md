# Agent Note: 把 dsh-better-sidebar 重新加入 alpha.2 聚合

Status: implemented

## 问题

alpha.2 cohort 迁移（2026-08-30）把 `dsh-better-sidebar` 与 `@mlgbnb/dsh-archive-manager` 从 `dsh-web-all` 聚合排除：两者都硬 import 了 alpha.2 已移除的 `@deepseek-ai/dsh-client-runtime` 面，在宿主 loader 的严格 import 解析下会中止整个 `dsh web` 启动。这次排除把家族的默认右侧面板（better-sidebar）从发布包里拿掉了——对用户可见的回归，不只是 CI 问题。

## 决策

`dsh-better-sidebar` 以精确 `0.18.0-alpha.0`（npm `alpha` dist-tag，2026-08-30 发布）回归聚合——首个对齐 alpha.2 cohort 的上游构建：所有 `@deepseek-ai/*` peer 声明 `^0.1.2-alpha.2`，`dsh.client.inject` 改用 `@deepseek-ai/dsh-client-modules`（alpha 改名后的新面）而非已移除的运行时面，剩余 `dsh-client-runtime` 出现处仅是注释。聚合行恢复为直接外部行（`web-ui-better-sidebar` / `name: 'dsh-better-sidebar'`）；bundle 自带的独立安装 `disabled: !!js` 防双挂守卫不进入聚合 patch——生成器对 insert 行只保留 name/config，且该守卫的 `id !== 'better-sidebar'` 谓词在加命名空间后的 id 下会误判。冒烟 lane 在帧启动锚之外改回断言 better-sidebar 宿主 div 挂载。

`@mlgbnb/dsh-archive-manager` 仍排除：其最新上游构建（1.0.7）仍 import 已移除面。上游发布 alpha.2 兼容构建后，按同一模式恢复（aggregate.yml 行 + package.json 依赖 + `scripts/aggregate.test.mjs` 挂载断言）。

2026-09-04 修正（仅事实——机制与决策不变）：聚合 pin 移到 `dsh-better-sidebar@0.18.0`——npm 于 2026-09-03 发布、peer 全面声明 `^0.1.2-rc.1` 的 rc.1 对齐正式版；它随 [rc.1 cohort 升级](2026-09-03-sdk-cohort-0.1.2-rc.1.md)落地，替代对齐 alpha.2 的 0.18.0-alpha.0 构建。`minimumReleaseAgeExclude` 引脚沿用同一精确版本惯例。desktop 运行时载荷在下次家族发包前仍通过已发布的 `@linxin666/dsh-web-all` 解析 better-sidebar。

2026-09-10 修正（仅事实）：聚合 pin 现为 `dsh-better-sidebar@0.19.0`——npm 于 2026-09-10 发布的正式版，peer 全面声明 `^0.1.5-rc.1`，与本仓库已迁移到的 cohort 完全一致，不依赖任何预发布容差；它替代了同日短暂的 `0.19.0-alpha.1` pin（peer 声明 `^0.1.5-alpha.2`）。相对 0.18.0，其静态 import 新增 `@deepseek-ai/dsh-session`，`dsh.client.inject` 新增 optional 的 `@deepseek-ai/dsh-client-ui-sidebar-right` 面（`peerDependenciesMeta` 标记 optional）；其 `cordis.patch.yml` 与 0.18.0 字节一致，聚合 patch 无需重新生成。`minimumReleaseAgeExclude` 引脚与 `scripts/e2e-mount.sh` scratch profile heredoc 条目跟随该精确版本。desktop seed 在打包时解析聚合包的已发布 pin，保持不动；其台账条目待下次家族发包重排 seed 时再动。该重钉只有经下一次家族发版才会到达已安装的 `dsh-web-all`：聚合包以精确版本钉住 better-sidebar，插件管理器必须先看到新的聚合包版本，pnpm 才会重新解析依赖。

## 备选方案

- 停在 `0.17.1`（npm `latest`）：拒绝——其 peer 声明 `^0.1.0-rc.8`，是 rc.8 cohort 约束，alpha.2 loader 无法满足；且用户明确要求最新 alpha。
- 同时恢复 archive-manager：拒绝——尚无兼容上游构建。

## 后果

右侧面板在 alpha.2 cohort 的聚合中重新发货（精确 pin `0.18.0-alpha.0`，后续上游发布不需要重新 pin）。`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 引脚随新精确版本更新，文档（包 README 对、根 README 对、`docs/publish-prep.md`）不再把 better-sidebar 呈现为排除状态。排除的缘由仍记录在 [alpha.2 升级 note](2026-08-30-sdk-cohort-0.1.2-alpha.2-upgrade.md) 与冒烟改写 note [e2e-mount-excluded-externals-anchor](../testing/2026-08-31-e2e-mount-excluded-externals-anchor.md) 中，并互链回本文。

## 验证

`node scripts/aggregate.mjs` 重新生成 `cordis.patch.yml`，包含 `web-ui-better-sidebar` insert 行；`scripts/aggregate.test.mjs` 断言其在场、`web-ui-archive-manager` 缺席；`pnpm test:scripts`、`docs:check` 与 `aggregate:check` 通过。`bash scripts/e2e-mount.sh` 从打包后的聚合 tarball 启动 scratch `dsh web`，Playwright lane 在帧挂载后等待 `[data-dsh-better-sidebar]`（count 1）——运行通过。

后续（2026-08-31）：scratch 冒烟看不到 link profile 的依赖缺口。本地 `web` profile 把 `dsh-web-all` link 进本仓库，better-sidebar 宿主半部因此从仓库 `node_modules` 顶层做物理解析，而其必需 peer 不在（`autoInstallPeers: false`、根包无任何 `@deepseek-ai/*` 依赖）——`dsh web` 因 `ERR_MODULE_NOT_FOUND` 中止于 `@deepseek-ai/dsh-subagent`，再于是 `@deepseek-ai/dsh-util-time`。修复把 better-sidebar 的宿主静态 import 闭包（从 `lib/index.js` 沿 harness 源码走查：15 个面）镜像进根 `devDependencies`，按 cohort 版本区间（`^0.1.2-alpha.2`、`@deepseek-ai/cordis@^4.0.2`、`schemastery@^3.18.1`），让 link profile 能解析 bundle 引用到的每个宿主面。scratch 冒烟是 hoisted 安装、宿主闭包与聚合包同树，所以 CI 无论哪边都绿。

后续（2026-09-10，0.19.0-alpha.1 轮）：重新 pin 后 `pnpm aggregate:check`、`pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm test:scripts`（269 项）全部通过；`bash scripts/e2e-mount.sh` 把重打包的聚合 tarball 挂进 scratch profile，Playwright lane 再次通过（better-sidebar 挂载、无崩溃标记、archive-manager 缺席）。

后续（2026-09-10，0.19.0 正式版轮）：重新 pin 后 `pnpm aggregate:check`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm test:scripts`、`pnpm runtime-deps:check`、`pnpm typecheck`、`pnpm test` 全部通过；`bash scripts/e2e-mount.sh` 把从 registry 解析 `dsh-better-sidebar@0.19.0` 的聚合包挂进 scratch profile，Playwright lane 再次通过（better-sidebar 挂载、无崩溃标记、archive-manager 缺席）。
