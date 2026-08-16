# 任务交接：WebUI 插件 / 皮肤中心 / 宠物提升为设置页一级菜单（2026-08-16）

一次性记录（冻结历史）：本文件只描述当时完成的工作与验证结论，长期事实以
README / docs/plugins.md 为准。

## 改动摘要

- dsh-web-ui-settings：Web UI 插件组从 `settings.plugin.item` 卡片改为
  `settings.section` 一级设置分区（id web-ui-plugins，order 110，
  label 用 `() => ctx.locale.bind('web-ui-plugins')('title')` thunk），
  内容仍渲染归组的家族插件卡（task-board / live-stats / remote-web-ui /
  describe-image）。
- dsh-pet：宠物设置卡改注册 `settings.section`（id pet，order 130），新增
  PetSettingsSection 包裹组件与 settings-section.module.css。
- skins/skin-center：皮肤中心改注册 `settings.section`（id skin-center，
  order 120），新增 SkinCenterSection 包裹组件与 sectionList 样式。
- dsh-community-plugins：保持为「插件」配置页的卡片（与内置 Shell /
  Agent loop / Web search 并列），不提升一级菜单。
- 文档：根 README 双语、docs/plugins.md、dsh-web-ui-settings /
  skin-center / dsh-community-plugins 的 README 三件套同步更新；
  docs/screenshots/02-settings-web-ui-plugins.png 换成新的设置中心截图。

## 验证（2026-08-16）

- 全仓门禁全绿：pnpm typecheck / pnpm test / pnpm test:scripts /
  pnpm docs:check / pnpm aggregate:check / pnpm community:check /
  pnpm sync-shared:check / pnpm skin-center:check。
- 新增测试：web-ui-settings（tests/webui-section.spec.tsx）、pet
  （tests/pet-section.spec.tsx）、skin-center（tests/client-apply.spec.tsx）。
- 运行界面实测（127.0.0.1:3080，页面刷新生效，无需重启 dsh web）：设置侧边栏
  依次为 General / Models / Plugins / Agent presets / Web UI Plugins /
  Skin Center / Pet；Web UI 插件分区展开显示四张家族卡；皮肤中心分区有启用
  开关与官方默认列表；宠物分区有启用开关；插件配置页只剩 Shell / Agent loop /
  Web search / Community Plugins 四张卡。
