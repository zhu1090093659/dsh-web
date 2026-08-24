# Agent Note: 旧聚合包自动迁移

Status: implemented

## Problem

产品重命名后，仍挂在 `@linxin666/dsh-web-ui-all` 的 profile 会失败或停留在旧包。用户升级时如果直接添加 `@linxin666/dsh-web-all` 而不移除旧 bundle，会同时出现两层 `web-ui-*` patch，无法启动。过渡期需要把迁移内置到产品更新路径，而不是让用户手动执行先删后装。

## Decision

旧聚合包迁移是确定性、事务式的替换，分三层落地（更名决策见 [产品更名 note](../../architecture/2026-08-24-product-rename-dsh-web.md)）：

- 发布管线双发布当前 `@linxin666/dsh-web-all` 与最终 `@linxin666/dsh-web-ui-all`。旧包 tarball 从当前聚合包构建，只改写浏览器 loader id 与 self 行为旧 npm identity，并携带描述目标包和版本的 `dsh.migrate` 元数据。
- plugin-manager 更新路径识别旧包，返回迁移更新，并通过官方 `dsh plugin` writer 执行 CLI 迁移任务。任务先经官方 CLI 移除旧包，再安装当前聚合包，恢复旧层位置，执行 `--dump-config`，失败时经官方 remove/add 路径回滚。
- Doctor Launcher 在 `autoMigrate`（默认开启）且目标包可用时，在启动 DSH 前执行迁移。它先安装当前聚合包再移除旧包，避免 profile 出现无可解析聚合包的中间状态；备份 `package.json` 与 `pnpm-lock.yaml`，排序 bundles，验证组合后的 profile 后才启动真实 DSH。registry 目标即使当前包已存在也会安装到精确版本；迁移失败后不会重新加回已移除的旧包；如果迁移前新旧包同时存在，回滚保留当前包。共享迁移映射位于 `shared/host/legacy-migration.ts`，同步到两个消费端。

Doctor 新增 `autoMigrate` 设置，默认开启且只对已知 `@linxin666/dsh-web-ui-all` -> `@linxin666/dsh-web-all` 映射生效；`autoRepair` 对常规修复保持原有默认值。

## Alternatives considered

- re-export 当前聚合包的 shim 壳：否决，rename note 已记录聚合挂载语义无法经 re-export 保留。
- 新旧包同时共存：否决，两个 patch 层会输出相同的 `web-ui-*` 行。
- 仅提供手动迁移命令：否决，用户选择了完全自动的产品更新迁移。
- 只在 plugin-manager 内迁移：不足以处理启动失败，因为坏的旧 profile 到不了 GUI；Doctor Launcher 覆盖启动路径。

## Consequences

- 启用 Doctor 的现有用户不会看到迁移提示，首次受保护启动会在 DSH 启动前完成迁移与验证。
- 直接执行 `dsh web` 会绕过 Doctor Launcher，不属于零操作路径。
- 迁移固定到精确目标版本；除非当前包可用且目标 bundle 组合成功，否则不会移除旧包。
- 旧 npm 包在双发布窗口内继续存在，随后 deprecate。
