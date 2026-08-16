# 任务交接：社区插件升一级菜单 + 四个新分区直接展开（2026-08-16）

一次性记录（冻结历史）：本文件只描述当时完成的工作与验证结论，长期事实以
README / docs/plugins.md 为准。

## 改动摘要

- dsh-community-plugins：社区插件从「插件」配置页卡片提升为一级设置分区
  （settings.section，id community-plugins，order 140，label thunk），
  与 Web UI 插件（110）/ 皮肤中心（120）/ 宠物（130）并列。
- 直接展开（去掉一级分区里的折叠层）：
  - shared/client/settings/PluginSettingsCard.tsx 新增 defaultOpen（默认
    true）与 alwaysOpen（静态标题 + 内容常显）两个 prop，sync-shared 同步到
    全部 6 个消费包；宠物与社区插件卡片传 alwaysOpen，归组的 task-board /
    live-stats / remote-web-ui / describe-image 卡片默认展开（仍可折叠）。
  - web-ui-settings：Web UI 插件分区改为静态标题 + 描述 + 卡片列表，删除
    折叠组卡。
  - skin-center：皮肤中心卡片去掉折叠头（静态头 + 常显正文），移除
    expand/collapse 文案与 chevron 样式。
- 「插件」配置页现在只剩内置三卡（Shell / Agent loop / Web search）。
- 导航图标：DSH 设置外壳按 section id 硬编码导航图标（models /
  agent-presets / plugins 专属，其余一律齿轮），无插件扩展点。插件侧在
  web-ui-settings.module.css 用稳定后缀选择器（[class*="_navList"] 等，
  经 :has(:nth-child(8)) 且无第 9 个导航单元的门控）隐藏齿轮，给四个家族
  分区分别绘制 currentColor + SVG mask 图标（Web UI 插件=四格网格、皮肤
  中心=色环、宠物=爪印、社区插件=双人）。门控保证部分安装时回退为齿轮而
  不会张冠李戴；DSH 大改版（类名后缀/导航数量变化）时同样回退为齿轮。
  测试：tests/nav-icons.spec.ts 守护选择器与 mask 数量。
- 文档同步：根 README 双语、docs/plugins.md、community /
  web-ui-settings 的 README 三件套、设置中心截图。

## 验证（2026-08-16）

- 全仓门禁全绿：pnpm typecheck / pnpm test / pnpm test:scripts /
  pnpm docs:check / pnpm aggregate:check / pnpm community:check /
  pnpm sync-shared:check / pnpm skin-center:check，pnpm -r build 全过。
- 运行界面实测（127.0.0.1:3080，刷新即生效）：设置侧边栏八个一级项
  （General / Models / Plugins / Agent presets / Web UI Plugins / Skin
  Center / Pet / Community Plugins）；Web UI 插件分区直接展开四张家族卡
  （表单控件可见）；皮肤中心开关与皮肤列表直接可见；宠物表单直接可见；
  社区插件索引与开关直接可见；插件配置页只剩内置三卡。
