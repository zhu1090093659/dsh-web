# AGENTS.md — skill-explorer

DSH Web GUI 的**技能中心**插件：侧边栏「技能中心」入口打开面板，按来源分级
浏览已加载 skill（系统内置 / 项目 / 用户 / 自定义 / 运行时），支持启用/禁用
（改写 frontmatter `disable-model-invocation`）、创建、删除（移入 .trash）。
包级规则：只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的
全局/包级规则。

## 本包要点

- host 半区（`src/index.ts` + `src/routes.ts` + `src/access.ts` +
  `src/collect.ts` + `src/frontmatter.ts` + `src/provider-toggles.ts` +
  `src/import.ts`）提供
  `/api/dsh-skill-explorer/*`
  路由族（list / set-enabled / set-provider-enabled / create / import / delete /
  health），显式声明 `auth: 'anonymous'` 并由插件自有围栏裁决：默认 loopback
  围栏，放行官方 `connection.admit` 认可的请求并保留旧版已配对设备 cookie 的兼容放行
  （不硬依赖已退役的 remote-web-ui）；数据来自文件系统扫描（对齐官方根约定与
  `@deepseek-ai/dsh-home-paths` 的 `$DSH_AGENTS_HOME`）+ `ctx.skills` 注册表合并。
- **导入是独立的创建面**（`import.ts`）：它只能读用户指名的目录一层
  （`<名>/SKILL.md` 或 `<名>.md`，跳过符号链接与点目录）或浏览器提交的
  `.zip`，只往用户/共享用户（`~/.agents/skills`）/项目根新建 `<名>/SKILL.md`，从不改写已有文件；冲突用
  `SKILL_SOURCE_RANK`（同级 `exists`、更强来源 `shadowed`）裁决，候选校验
  复用 `isSkillName` 与 `parseFrontmatter`。请求形状错误用
  `ImportRequestError`（路由映射为 400），不要退化成 500。现有写路由的
  「只信任面板展示路径」规则不因导入而放宽。
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
- **视图偏好属于浏览器**（`src/client/panel-prefs.ts`）：技能列表的筛选维度
  （来源 / 状态 / 标记）与来源分组的折叠决定存在 `localStorage`，因为布局在
  切面板时会卸载本页；默认只展开项目与用户根。存储内容按不可信输入处理，
  任一字段损坏只回退该字段。纯匹配规则在 `src/client/skill-filter.ts`
  （`selectGroups` 的各维度），不要在组件里重写。
- 纯逻辑（扫描/分组/frontmatter 解析）在 host 侧单测锁定行为
  （`tests/collect.spec.ts`、`tests/frontmatter.spec.ts`、
  `tests/routes.spec.ts`、`tests/access.spec.ts`）；路由围栏与错误路径必须带测试。
- 安全语义（loopback 围栏、官方 connection 准入、已配对 cookie 兼容放行、写路由只信任扫描路径）
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
