# dsh-web 发布准备 (Release Preparation)

## 范围

本版本统一发布 `packages/` 下由 `scripts/lib/family-packages.mjs` 发现的 22 个公开家族包；根 package.json 与 shared 私有包不发布，根的 `version` 与家族包同步 bump（git 安装仓库根别名 bundle 时，插件管理器显示的就是它）。所有家族包采用统一版本号（当前为 0.4.8），皮肤中心只随包分发 `blue-fantasy`，其余皮肤由 Workshop 按需安装。

皮肤中心、宠物、社区插件索引与预设中心已拆分为独立仓库并各自发版：`@linxin666/dsh-client-ui-skin-center`（[dsh-skins](https://github.com/zhu1090093659/dsh-skins)）、`@linxin666/dsh-pet`（[dsh-pet](https://github.com/zhu1090093659/dsh-pet)）、`@linxin666/dsh-client-ui-community-plugins`（[dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins)）、`@linxin666/dsh-client-ui-preset-center`（[dsh-presets](https://github.com/zhu1090093659/dsh-presets)）。本仓的聚合包按 semver 依赖它们，`satellites/` 下各 submodule 的 gitlink 固定市场站要拉取的内容。四个卫星仓与本仓发布同一个版本号：卫星先发、本仓后发，聚合包的依赖范围、锁定条目与 gitlink 随对齐一起更新，逐步流程见 [dsh-web-release 技能](../.agents/skills/dsh-web-release/SKILL.md)。

| 目录 | npm 包 | 版本 | 发布状态 |
| --- | --- | --- | --- |
| packages/dsh-agents | @linxin666/dsh-agents | 0.4.8 | public |
| packages/dsh-git-graph | @linxin666/dsh-client-ui-git-graph | 0.4.8 | public |
| packages/dsh-i18n | @linxin666/dsh-i18n | 0.4.8 | public |
| packages/dsh-liangshen | @linxin666/dsh-liangshen | 0.4.8 | public |
| packages/dsh-market | @linxin666/dsh-client-ui-market | 0.4.8 | public |
| packages/dsh-message-edit | @linxin666/dsh-client-ui-message-edit | 0.4.8 | public |
| packages/dsh-plugin-manager | @linxin666/dsh-client-ui-plugin-manager | 0.4.8 | public |
| packages/dsh-remote-bridge | @linxin666/dsh-remote-bridge | 0.4.8 | public |
| packages/dsh-remote-web-ui | @linxin666/dsh-remote-web-ui | 0.4.8 | public |
| packages/dsh-session-archive | @linxin666/dsh-session-archive | 0.4.8 | public |
| packages/dsh-session-id | @linxin666/dsh-client-ui-session-id | 0.4.8 | public |
| packages/dsh-skill-explorer | @linxin666/dsh-client-ui-skill-explorer | 0.4.8 | public |
| packages/dsh-ssh | @linxin666/dsh-ssh | 0.4.8 | public |
| packages/dsh-task-board | @linxin666/dsh-client-ui-task-board | 0.4.8 | public |
| packages/dsh-task-board-github | @linxin666/dsh-client-ui-task-board-github | 0.4.8 | public |
| packages/dsh-task-board-remote | @linxin666/dsh-task-board-remote | 0.4.8 | public |
| packages/dsh-task-board-team | @linxin666/dsh-client-ui-task-board-team | 0.4.8 | public |
| packages/dsh-update | @linxin666/dsh-update | 0.4.8 | public |
| packages/dsh-usage | @linxin666/dsh-usage | 0.4.8 | public |
| packages/dsh-web-all | @linxin666/dsh-web-all | 0.4.8 | public |
| packages/dsh-win-bash | @linxin666/dsh-win-bash | 0.4.8 | public |
| packages/dsh-web-settings | @linxin666/dsh-client-ui-web-ui-settings | 0.4.8 | public |

## 外部依赖与迁移说明

- alpha 分支的聚合包没有任何外部依赖：`dsh-better-sidebar@0.19.1`（2026-09-11 发布的稳定版本）的 peer 区间 `^0.1.5-rc.1` 不覆盖本分支的 `0.2.1-rc.3` cohort，故 `aggregate.yml` 不再声明该行、`package.json` 不再依赖它、锁定它的 `minimumReleaseAgeExclude` 条目也已删除；右侧面板改为按需安装。稳定线 `dev` 仍内置 0.19.1 并保留对应锁定条目。
- 历史聚合包命名迁移：从 `@linxin666/dsh-web-ui-all` 向 `@linxin666/dsh-web-all` 的迁移已在 0.3.3 完成并弃用旧包名，当前统一发布 `@linxin666/dsh-web-all`。
- 远程访问组件演进与弃用：`dsh-remote-web-ui`（`@linxin666/dsh-remote-web-ui`）已从聚合包 `dsh-web-all` 摘除并进入弃用期（以 tombstone 导出与 `retiredPlugins` 登记静默退役，计划下一版本删除），当前版本仍作为独立包发布供过渡期独立安装；公网与局域网接入栈（中继与隧道）已迁入 `@linxin666/dsh-remote-bridge`。

## 兼容性边界

所有 `web-ui-*` bundle id、`dsh-web-ui-market`、`/api/dsh-web-ui-settings` 与 `dsh-web-ui-settings-proxy-token` 请求头保持冻结。旧聚合包迁移由插件管理器的更新路径经共享映射执行。皮肤中心对当前工坊安装保持来源验证路径，仅当已安装 manifest 与钩子字节匹配审查通过的生成标识时才恢复预置钩子效果；该门禁已随皮肤中心迁至 dsh-skins 仓。创意工坊目录包含声明式 `whalechan-harness` 皮肤（本地 CC BY-NC-SA 4.0 资产，无执行钩子），其细粒度生成类选择器作为明确记录的前端重新构建兼容性边界保留。

本版本具有全新安装、单元迁移与 Linux CI 挂载证据。

## 发布检查门禁

```sh
pnpm sync-shared:check
pnpm typecheck
pnpm test
pnpm test:scripts
pnpm aggregate:check
pnpm runtime-deps:check
pnpm docs:check
pnpm i18n:check
pnpm market:fetch
pnpm market:check
pnpm libs:check
pnpm build
node scripts/verify-version.mjs 0.4.8
```

CI 与发布挂载冒烟测试挂载目标为 `@deepseek-ai/dsh@0.2.1-rc.3`，与家族包通过 `dsh.engines.dsh >=0.2.1-rc.3` 声明的最低宿主版本一致。