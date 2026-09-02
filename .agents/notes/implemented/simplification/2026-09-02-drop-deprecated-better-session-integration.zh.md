# Agent Note: 移除已弃用的 @morlay/better-session 聚合集成

Status: implemented

## 问题

`@morlay/better-session` 集成（RDB 持久层上的分支式会话编辑）已被弃用：会话存储重新由官方 jsonl 后端承担，而该集成始终默认关闭。它的聚合行、三条展开的子插件行、npm 依赖、四条 `minimumReleaseAgeExclude` 豁免、`@morlay/ui-conversation-message-actions` 的 patchedDependency 及其补丁文件，还有专用维护 CLI 都留在树里。这块休眠面在每次 cohort 升级时都要跟着走（lockfile 解析、发布顺序检查），也让外部插件的故事更难审计。

## 决策

该集成从聚合包移除。`packages/dsh-web-all/aggregate.yml` 删除外部行及其 `"inactive": true` 标记；`node scripts/aggregate.mjs` 重新生成 `cordis.patch.yml`，不再产出 `web-ui-session-branch` / `web-ui-session-rdb` / `web-ui-conversation-message-actions` 行及其 `disabled: true` 覆盖；`@morlay/better-session` devDependency、四条 release-age 豁免、patchedDependency 条目加补丁文件、以及 `scripts/dsh-better-session.mjs` 及其测试一并删除。生成器的 inactive-external 机制与说明注释保留（通用逻辑），注释不再引用被删脚本。聚合测试的展开断言改为反向守卫：`cordis.patch.yml` 不得再出现任何 `@morlay/` 引用。

dsh-perf 的 Better Session 卡片与其原生 `src/bsm` 迁移核心在本次移除中不动：它们是仓库自己的重新实现（只有出处引用，无 `@morlay/*` import）。卡片里针对已删聚合行写托管覆盖的启用开关随之失效；裁剪它的后续工作于同日落地，见 [remove-dsh-perf-better-session-card](2026-09-02-remove-dsh-perf-better-session-card.md)。

## 已考虑的替代方案

- 保留行但维持默认关闭：否决——集成已弃用，休眠外部依赖仍在每次 cohort 升级中消耗 lockfile、发布顺序与审计面。
- 把 dsh-perf 的 Better Session 卡片一并移除：否决——卡片是先前决策并入 dsh-perf 的仓库自有管理面，其迁移/巡检工具仍服务旧会话。

## 后果

会话存储运行在官方 jsonl 后端上，本仓库不再提供回到 RDB 持久层的启用路径；需要 better-session 的环境直接对自身 profile 安装。profile 中指向 `web-ui-session-branch` / `web-ui-session-rdb` / `web-ui-conversation-message-actions` 的覆盖行成为空操作。旧 jsonl.zstd 数据原地留在官方后端上——dsh-perf 的 Better Session 卡片于同日随集成一并移除（见上文移除 note）。dsh-web-all README 删除启用章节；根 README 的特性条目、npm 插件表格行与第三方许可条目随之移除。

## 测试

`node scripts/aggregate.mjs` 重新生成 patch（20 个源块、21 行）；lockfile 解析零个 `@morlay/*` 包；`scripts/aggregate.test.mjs` 断言反向守卫；`verify-docs --write` 重录双语 hash 后文档配对检查通过。
