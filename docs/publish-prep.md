# dsh-web 发布准备 (Release Preparation)

## 范围

本版本统一发布 `packages/` 与 `packages/skins/` 下由 `scripts/lib/family-packages.mjs` 发现的 21 个公开家族包；根 package.json 与 shared 私有包不发布。所有家族包采用统一版本号（当前为 0.3.23），皮肤中心只随包分发 `blue-fantasy`，其余皮肤由 Workshop 按需安装。

| 目录 | npm 包 | 版本 | 发布状态 |
| --- | --- | --- | --- |
| packages/dsh-community-plugins | @linxin666/dsh-client-ui-community-plugins | 0.3.23 | public |
| packages/dsh-doctor | @linxin666/dsh-doctor | 0.3.23 | public |
| packages/dsh-git-graph | @linxin666/dsh-client-ui-git-graph | 0.3.23 | public |
| packages/dsh-i18n | @linxin666/dsh-i18n | 0.3.23 | public |
| packages/dsh-liangshen | @linxin666/dsh-liangshen | 0.3.23 | public |
| packages/dsh-market | @linxin666/dsh-client-ui-market | 0.3.23 | public |
| packages/dsh-model-capabilities | @linxin666/dsh-client-ui-model-capabilities | 0.3.23 | public |
| packages/dsh-pet | @linxin666/dsh-pet | 0.3.23 | public |
| packages/dsh-plugin-manager | @linxin666/dsh-client-ui-plugin-manager | 0.3.23 | public |
| packages/dsh-preset-center | @linxin666/dsh-client-ui-preset-center | 0.3.23 | public |
| packages/dsh-remote-web-ui | @linxin666/dsh-remote-web-ui | 0.3.23 | public |
| packages/dsh-session-archive | @linxin666/dsh-session-archive | 0.3.23 | public |
| packages/dsh-session-id | @linxin666/dsh-client-ui-session-id | 0.3.23 | public |
| packages/dsh-skill-explorer | @linxin666/dsh-client-ui-skill-explorer | 0.3.23 | public |
| packages/dsh-ssh | @linxin666/dsh-ssh | 0.3.23 | public |
| packages/dsh-task-board | @linxin666/dsh-client-ui-task-board | 0.3.23 | public |
| packages/dsh-tool-describe-image | @linxin666/dsh-tool-describe-image | 0.3.23 | public |
| packages/dsh-usage | @linxin666/dsh-usage | 0.3.23 | public |
| packages/dsh-web-all | @linxin666/dsh-web-all | 0.3.23 | public |
| packages/dsh-web-settings | @linxin666/dsh-client-ui-web-ui-settings | 0.3.23 | public |
| packages/skins/skin-center | @linxin666/dsh-client-ui-skin-center | 0.3.23 | public |

## 外部依赖与迁移说明

- alpha 分支的聚合包没有任何外部依赖：`dsh-better-sidebar@0.19.1`（2026-09-11 发布的稳定版本）的 peer 区间 `^0.1.5-rc.1` 不覆盖本分支的 `0.1.7-alpha.1` cohort，故 `aggregate.yml` 不再声明该行、`package.json` 不再依赖它、锁定它的 `minimumReleaseAgeExclude` 条目也已删除；右侧面板改为按需安装。稳定线 `dev` 仍内置 0.19.1 并保留对应锁定条目。
- 历史聚合包命名迁移：从 `@linxin666/dsh-web-ui-all` 向 `@linxin666/dsh-web-all` 的迁移已在 0.3.3 完成并弃用旧包名，当前统一发布 `@linxin666/dsh-web-all`。

## 兼容性边界

所有 `web-ui-*` bundle id、`dsh-web-ui-market`、`/api/dsh-web-ui-settings` 与 `dsh-web-ui-settings-proxy-token` 请求头保持冻结。Doctor 迁移与插件管理器迁移采用共享映射；Doctor 经受限 `cmd.exe` 参数调用 Windows `.cmd` shim。直接执行 `dsh web` 旁路 Doctor 迁移。皮肤中心对当前工坊安装保持来源验证路径，仅当已安装 manifest 与钩子字节匹配审查通过的生成标识时才恢复预置钩子效果；`pnpm skin-center:check` 拦截标识漂移。创意工坊目录包含声明式 `whalechan-harness` 皮肤（本地 CC BY-NC-SA 4.0 资产，无执行钩子），其细粒度生成类选择器作为明确记录的前端重新构建兼容性边界保留。

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
pnpm skin-center:check
pnpm community:check
pnpm market:check
pnpm libs:check
pnpm build
node scripts/verify-version.mjs 0.3.23
```

CI 与发布挂载冒烟测试挂载目标为 `@deepseek-ai/dsh@0.1.7-alpha.1`，与家族包通过 `dsh.engines.dsh >=0.1.7-alpha.1` 声明的最低宿主版本一致。
