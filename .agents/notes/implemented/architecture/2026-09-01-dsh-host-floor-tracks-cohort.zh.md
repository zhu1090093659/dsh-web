# Agent Note：DSH 宿主版本门槛跟随适配 cohort

Status: implemented

## 问题

用户安装本家族插件时，得不到「这些插件需要哪个版本的 DSH 本体」的权威答案。alpha.3 cohort 提升之后，机器可读的门槛仍停留在 `dsh.engines.dsh >=0.1.2-alpha.1`，根 README 的 DSH 徽章展示的是宿主 npm `alpha` dist-tag 的实时值（可能跑到家族尚未适配的版本之前），CI 与 release 挂载冒烟道也仍钉在 alpha.2 宿主 CLI。没有任何东西告诉安装用户应升级到 0.1.2-alpha.3，也没有规则把门槛、徽章与冒烟道绑到同一个版本上。

## 决策

家族声明的宿主版本门槛就是家族当前适配的 cohort，三处用户可见面声明同一个版本。dsh-web 的最新发布线始终跟随宿主的最新 npm 版本，因此门槛随每次 cohort 提升一起移动。具体到 alpha.3 cohort：

- 全部家族包与插件模板声明 `dsh.engines.dsh >=0.1.2-alpha.3`；插件管理器在安装/更新检查时读取该门槛，对更老的宿主提示或拦截。
- 根 README 徽章（中英两份）改为静态表述要求——shields 静态徽章渲染 `DSH >=0.1.2-alpha.3`，仍链接到 npm 包——替换原先的实时 dist-tag 徽章。
- CI 与 release 挂载冒烟道钉住 `@deepseek-ai/dsh@0.1.2-alpha.3`：冒烟道挂载的正是要求用户运行的宿主版本，docs/publish-prep.md 陈述同一事实。
- 插件模板的 `@deepseek-ai/*` devDependencies 对齐 `^0.1.2-alpha.3`，使新插件脚手架落在已适配的 cohort 上。

因此 cohort 提升契约是：一次提升同时移动清单 devDependency 区间、engines 门槛、README 徽章与 CI 挂载 pin。cohort 机制见 [sdk-cohort-0.1.2-alpha.2-upgrade](2026-08-30-sdk-cohort-0.1.2-alpha.2-upgrade.zh.md)；门槛必须声明的规则在 docs/plugins.md。

## 备选方案

保留实时 `alpha` dist-tag 徽章被否决：它展示的是宿主最新发布版，不是家族的要求，且会宣传家族尚未适配的版本。有界区间（`^0.1.2-alpha.3`）被否决：插件管理器契约只支持 `>=<semver>` 形式，且上限会拦截同一条线上家族随后适配的未来宿主。把门槛留在 `>=0.1.2-alpha.1` 以保住老宿主可安装被否决：家族发布在 alpha cohort 线上，老宿主正是用户必须离开的版本，插件管理器也只会提示它拿到的门槛。

## 后果

宿主老于 0.1.2-alpha.3 的用户在安装或更新任何家族包时会撞上插件管理器的门槛检查，README 对要求的表述不会再跑到适配 cohort 之前或之后。今后每次 cohort 提升在既有的 devDependency 区间与门槛移动之外，新增两处必动点（徽章与 CI pin）。提及更早 cohort 的历史叙述（包 README 里的 alpha.2 说明、release notes、归档记录）保持历史原貌，不随每次提升重写。

## 测试

`pnpm test:scripts` 通过（234 个测试），含 family-dsh-engines 不变量——每个家族包与模板都声明受支持的 `>=<semver>` 门槛，22 处声明现均为 `>=0.1.2-alpha.3`。徽章 URL 实测渲染 `>=0.1.2-alpha.3`。`pnpm docs:check`、`pnpm aggregate:check`、`pnpm typecheck`、`pnpm i18n:check` 通过。`pnpm market:check` 在本检出失败，原因与本次改动无关：本地 `market/shell/dist` 重建（2026-09-01 00:11 构建，晚于 shell 源码最后一次提交）与已提交的 `market/dist/tryon` 整体不一致，而已提交的 tryon 对自身 756 个文件的哈希清单校验全绿——这正是 CI 无 shell dist 的 check 模式所校验的性质——且漂移清单不含任何 manifest 条目，家族 package.json 的改动不是漂移输入。
