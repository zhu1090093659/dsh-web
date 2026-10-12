# AGENTS.md — skill-explorer

DSH Web GUI 的**技能中心**插件：侧边栏「技能中心」入口打开面板，按来源分级
浏览已加载 skill（系统内置 / 项目 / 用户 / 自定义 / 运行时），支持启用/禁用
（改写 frontmatter `disable-model-invocation`）、创建、删除（移入 .trash）。
包级规则：只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的
全局/包级规则。

## 本包要点

- host 半区（`src/index.ts` + `src/routes.ts` + `src/access.ts` +
  `src/collect.ts` + `src/frontmatter.ts` + `src/provider-toggles.ts`）提供
  `/api/dsh-skill-explorer/*`
  路由族（list / set-enabled / set-provider-enabled / create / delete /
  health），默认 loopback
  围栏，已配对设备 cookie 为额外放行路径（不硬依赖 remote-web-ui）；数据来自
  文件系统扫描（官方根约定）+ `ctx.skills` 注册表合并。
- **自定义根有两个来源**：本插件 config 的 `customSkillDirs`，以及在用
  `skill-filesystem` loader 行上的同名配置（官方文档推荐的配法）。只读前者会让
  注册表报告的 custom 来源技能全部无 path，控件与写路由一起失效（#1801）。
  派生逻辑是 `collect.ts` 的 `customSkillDirsFromLoader` + `normalizeSkillRoots`，
  由 `index.ts` 合成一个解析函数传给路由；写路由与 list 路由必须用同一个
  `panelCwd` 解析工作区，否则跨工作区会 409。改这里时保持两半一致。
- **插件提供技能（provider-file）的开关是面板本地状态**：`provider-toggles.ts`
  把 `(provider, 技能名)` 组合写入
  `$DSH_HOME/dsh-skill-explorer/provider-toggles.json`（原子写），`collect.ts`
  的 `applyProviderToggles` 在收集末尾据此把该行的 `modelInvocable` 置
  false。停用要求最新收集仍能解析出 provider-file 行；启用只删记录、无条件
  放行。它只改变面板的可调用视图，宿主注册表照旧加载该技能——文案与 README
  必须如实说明，不要写成「模型收不到」。
- client 半区（`src/client/`）经官方槽位注册**原生中栏面板**：`native-panel.tsx`
  往 shell 自己的面板列表（`sidebar.panellist`）贡献一行、往布局的 keyed
  `main` 槽贡献页面（`src/client/panel/`，`SkillPanel.tsx` 壳 + 技能/创建
  页签，编辑时多出编辑页签），并驱动 `ctx.layout.selectPanel`——与任务看板
  同一形态，行盒 / 标签 / 高亮 / 折叠轨道归 shell。页签与编辑目标存在
  `panel/controller.ts`，因为布局只在该面板被选中时挂载页面，组件本地 state
  会在切面板时丢失；页面只读 controller 快照。占位完全由布局的 keyed `main`
  槽决定，本包不再参与任何家族互斥协议。
- 纯逻辑（扫描/分组/frontmatter 解析）在 host 侧单测锁定行为
  （`tests/collect.spec.ts`、`tests/frontmatter.spec.ts`、
  `tests/routes.spec.ts`、`tests/access.spec.ts`）；路由围栏与错误路径必须带测试。
- 安全语义（loopback 围栏、已配对 cookie 额外放行、写路由只信任扫描路径）
  见 README「安全模型」节，修改安全语义时必须同步更新 README 与测试。
- 样式纪律（`src/client/panel/panel.module.css`）：面板不持有自己的调色板——
  颜色 / 表面 / 边框 / 阴影 / 字体一律取自官方主题 token（`--dsw-alias-*`、
  `--dsw-specific-*`、`--dsw-shadow-*`、`--dsw-font-*`），不写 hex/rgb 字面量、
  不给 `var()` 写颜色兜底、不写 `[data-ds-dark-theme]` 覆写块。明暗由主题负责；
  填充主按钮用 `button-primary-fill` + `label-primary-foreground` 配对
  （官方主题下即亮色黑底白字、暗色白底黑字）。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-skill-explorer typecheck
pnpm --filter @linxin666/dsh-client-ui-skill-explorer test
pnpm --filter @linxin666/dsh-client-ui-skill-explorer build
```
