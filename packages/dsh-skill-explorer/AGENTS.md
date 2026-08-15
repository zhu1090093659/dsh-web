# AGENTS.md — skill-explorer

DSH Web GUI 的**技能中心**插件：侧边栏「技能中心」入口打开面板，按来源分级
浏览已加载 skill（系统内置 / 项目 / 用户 / 自定义 / 运行时），支持启用/禁用
（改写 frontmatter `disable-model-invocation`）、创建、删除（移入 .trash）。
包级规则：只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的
全局/包级规则。

## 本包要点

- host 半区（`src/index.ts` + `src/routes.ts` + `src/collect.ts` +
  `src/frontmatter.ts`）提供 `/api/dsh-skill-explorer/*` 路由族（list /
  set-enabled / create / delete / health），全部 loopback 围栏；数据来自
  文件系统扫描（官方根约定）+ `ctx.skills` 注册表合并。
- client 半区（`src/client/`）注入侧边栏入口（DOM 级，MutationObserver
  自愈），面板为 React overlay 模态（`SkillPanel.tsx`），不接管中心列。
- 纯逻辑（扫描/分组/frontmatter 解析）在 host 侧单测锁定行为
  （`tests/collect.spec.ts`、`tests/frontmatter.spec.ts`、
  `tests/routes.spec.ts`）；路由围栏与错误路径必须带测试。
- 安全语义（loopback 围栏、写路由只信任扫描路径）见 README「安全模型」节，
  修改安全语义时必须同步更新 README 与测试。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-skill-explorer typecheck
pnpm --filter @linxin666/dsh-client-ui-skill-explorer test
pnpm --filter @linxin666/dsh-client-ui-skill-explorer build
```
