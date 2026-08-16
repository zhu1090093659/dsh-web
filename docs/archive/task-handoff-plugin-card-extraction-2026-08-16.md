# 任务交接：皮肤中心 / 社区插件 / 桌面宠物抽离为顶层设置卡（2026-08-16）

一次性记录（冻结历史）：本文件只描述当时完成的工作与验证结论，长期事实以
README / docs/plugins.md 为准。

## 改动摘要

- 新增独立插件包 `packages/dsh-community-plugins`（npm 名
  `@linxin666/dsh-client-ui-community-plugins`）：社区插件索引卡从
  dsh-web-ui-settings 迁入，自带 `enabled` 开关（community-plugins 设置
  命名空间），注册进顶层 `settings.plugin.item`。
- 皮肤中心（packages/skins/skin-center）与桌面宠物（packages/dsh-pet）的
  设置卡从 `web-ui.plugin.item` 子槽改注册到顶层 `settings.plugin.item`；
  皮肤中心新增 `enabled` 开关（skin-background 命名空间），关闭后停用
  试穿 / 应用 / 背景控件。
- dsh-web-ui-settings 保留 Web UI 插件组卡（归组 task-board / live-stats /
  remote-web-ui / describe-image），移除社区插件实现；设置桥接 allowlist
  加入 community-plugins 命名空间。
- dsh-web-ui-all aggregate.yml 注册新包并重新生成 cordis.patch.yml /
  package.json；scripts/community-index 与 sync-shared.mjs 同步更新。

## 验证（2026-08-16）

- 全仓门禁全绿：pnpm typecheck / pnpm test / pnpm test:scripts /
  pnpm docs:check / pnpm aggregate:check / pnpm gallery:check /
  pnpm skin-center:check / pnpm community:check / pnpm sync-shared:check。
- 隔离实例实测（DSH_HOME=/tmp/dsh-verify-home + dsh web --port 3190）：
  插件配置页列出 7 个同级入口（Shell / Agent loop / Web search / Web UI
  Plugins / Skin Center / Community Plugins / Pet）；社区插件卡的启用开关
  关闭隐藏列表、重开恢复；皮肤中心开关关闭隐藏试穿与背景控件；宠物卡展开
  正常。截图留存于本会话证据，未入库。
- 本地运行中的 dsh web（3080 端口）经页面刷新已显示皮肤中心与宠物升为
  顶层；社区插件行需重启 dsh web 才会加载，而当前 web profile 的 bundles
  里 liangshen / describe-image 与 web-ui-all 聚合行重复，重启会报
  duplicate loader entry id，需先按 dsh-web-ui-all README 的规则移除
  重叠 bundle 行。
