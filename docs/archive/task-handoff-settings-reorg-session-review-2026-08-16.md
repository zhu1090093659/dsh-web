# 会话回顾：设置页插件架构重组（2026-08-16）

一次性记录（冻结历史）：本文是本次会话三个交付轮的索引与决策备忘，细节见各轮
交接文档；长期事实以 README / docs/plugins.md 为准。

## 时间线（均已合并 origin/main）

1. [插件抽离](task-handoff-plugin-card-extraction-2026-08-16.md)（b7ef957d）：社区插件从
   dsh-web-ui-settings 迁出为独立包 packages/dsh-community-plugins；皮肤中心、
   社区插件、桌面宠物三张卡在插件配置页与 Web UI 插件组平级；三者各带
   `enabled` 开关（community-plugins / skin-background 命名空间）。
2. [一级菜单化](task-handoff-settings-first-level-sections-2026-08-16.md)（cab0eeb6）：
   Web UI 插件、皮肤中心、宠物改为 `settings.section` 一级设置分区，与
   General / Models / Plugins / Agent presets 并列。
3. [直接展开 + 社区升级 + 导航图标](task-handoff-settings-direct-expand-community-2026-08-16.md)
   （9765c282、bb31b146）：社区插件也提升一级分区；四个家族分区去掉折叠、
   内容直接展开；用插件侧 CSS 给四个分区换上专属导航图标。

## 最终架构（快照）

- 设置侧边栏 8 个一级项：官方 4（orders 0/10/15/20）+ 家族 4——
  web-ui-plugins(110)、skin-center(120)、pet(130)、community-plugins(140)。
- 插件配置页只剩内置三卡（Shell / Agent loop / Web search）。
- 家族四分区直接展开：共享设置卡 PluginSettingsCard 新增 `defaultOpen`
  （默认 true）与 `alwaysOpen`（静态头 + 内容常显），sync-shared 同步到
  6 个消费包；skin-center 用自己的静态头（保留皮肤数徽标）。
- 导航图标：DSH 设置外壳按 section id 硬编码图标、无插件扩展点，插件侧在
  web-ui-settings.module.css 用稳定后缀选择器 + `:has(:nth-child(8))` 且无
  第 9 个导航单元的门控，隐藏齿轮并以 currentColor + SVG mask 绘制
  （Web UI 插件=四格网格、皮肤中心=色环、宠物=爪印、社区插件=双人）。
- 包布局：packages/dsh-community-plugins（新包）、dsh-web-ui-settings
  （组分区 + 设置桥接 + 导航图标）、dsh-pet、packages/skins/skin-center。

## 关键决策与取舍

- 「独立启用/禁用与配置」= 每个插件命名空间的 `enabled` 布尔（家族惯例，
  与 pet / task-board 一致），不是插件行级开关。
- 皮肤中心保留在 packages/skins/skin-center（dsh-skins 聚合的一部分），
  未迁到 packages/dsh-skin-center——它本来就是独立包，只改了注册目标。
- 图标走 CSS 注入而非改 DSH：符合仓库「不改 DSH 源码」原则；门控保证部分
  安装时回退为齿轮而不会张冠李戴。
- 社区插件登记：community.json + scripts/community-index 迁入新包，
  `pnpm community:check` 门禁路径同步更新。

## 已知边界（后续开发注意）

- 导航图标 CSS 依赖外壳类名后缀（`_navList/_navCell/_navIcon`）与导航
  顺序；DSH 改版可能失效并安全回退为齿轮（tests/nav-icons.spec.ts 守护）。
- packages/skins/skin-center 无 typecheck 脚本；`tsc --noEmit` 有既有报错
  （routes.ts / skin-switch.ts 与缺 @types/react 级联），CI 不覆盖。
- 用户 profile 修复：bundles 里与 web-ui-all 聚合重复的 liangshen /
  describe-image 行已移除（备份 package.json.bak-agent-extract-20260816），
  否则重启报 duplicate loader entry id。
- 拆仓残留耦合（软性）：`ctx.get('webUiSettings')` 兼容 binder（缺省回退
  官方 scope 的 DI）、web-ui-settings/allowlist.ts 集中维护家族命名空间、
  skin-center 注册表由仓库级 scripts/skin-center-bundles 生成。

## 验证摘要

- 各轮全部门禁全绿（typecheck / test / test:scripts / docs:check /
  aggregate:check / gallery:check / skin-center:check / community:check /
  sync-shared:check）。
- 隔离实例（DSH_HOME 临时目录 + 独立端口）与运行中的 127.0.0.1:3080 均
  实测：七个/八个一级项、直接展开、导航图标、启用开关全部符合预期。
