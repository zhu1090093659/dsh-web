# Agent Note: 仓库 Open Issues 批量修复与整理 (#1296, #1305, #1304, #1313, #1301)

Status: implemented

## 背景与问题

仓库内剩余 5 个有效 Issue：
1. **#1296**：任务看板与 SSH 在独立安装时折叠图标偏右 4px（样式选择器依赖全家桶标记 `[data-dsh-frame]`）。
2. **#1305**：技能中心「可调用」徽标对比度不足且缺少 tooltip 语义说明。
3. **#1304**：技能中心 `filesystem` 等 provider 标识以英文技术词原样展示，缺少本地化与来源说明。
4. **#1313**：任务看板在低版本 DSH（< 0.1.2-alpha.2）环境下每次轮询重复输出 `invocation-unavailable` 错误刷屏。
5. **#1301**：启动加载时界面分步挂载导致肉眼可见的多次闪烁。

## 决策与改动

1. **折叠侧栏居中 (#1296)**：
   - 在 `packages/dsh-task-board/src/client/board.module.css` 与 `packages/dsh-ssh/src/client/panel/panel.module.css` 中补齐 `:global([data-sidebar-collapsed])` 选择器，并更新单测断言。
2. **技能中心徽标与国际化 (#1305, #1304)**：
   - 提升 `.badgeInvokable` 颜色对比度以满足 WCAG AA 标准。
   - 在 `SkillPanel.tsx` 中增加 `providerLabel` 本地化映射与来源 tooltip，并为可调用状态补充说明 tooltip。
   - 在 `dsh-skill-explorer` 与 `dsh-i18n`（含俄语字典）中同步对应国际化词条。
3. **版本探测与降级 (#1313)**：
   - 在 `packages/dsh-task-board/src/host-runner.ts` 中增加 `isInvocationUnavailable` 判定，低版本运行时仅输出单次明确 Warning 并优雅降级，避免每秒报错刷屏。
4. **启动防闪烁遮罩 (#1301)**：
   - 在 `packages/dsh-web-all/src/client/index.ts` 中增加 `[data-dsh-boot-splash]` 过渡遮罩，首次挂载就绪后自动渐出清理，并设超时兜底。

## 影响与结论

- 独立插件折叠图标与官方原生图标完全共用中心线对齐。
- 技能中心状态更清晰直观，多语言支持完备。
- 运行时日志更干净友好。
- 冷启动界面无感平滑加载。

## 验证

`pnpm typecheck`、`pnpm test`、`pnpm test:scripts`、`pnpm i18n:check` 与 `pnpm docs:check` 全部门禁通过。
