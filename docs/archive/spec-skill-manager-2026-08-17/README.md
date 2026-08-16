# dsh-skill-manager 技能启停插件 — 设计存档

日期：2026-08-17
状态：已获用户批准（聊天内设计确认），本文档为冻结存档；实施见同目录 PLAN.md。

## 目标

在 dsh Web GUI 设置页新增一级分区「技能」：用户可随时查看、启停（总开关）、安装与卸载 skill，
全部经官方 DSH skill 机制实现，不修改 DSH 源码。

## 关键机制（调研结论）

- DSH 模型目录 = `tool-skill` 每次 pre-step 对 `ctx.skills.snapshot({ cwd, scope: agent })`
  过滤 `isModelInvocable` 后重发；`/name` 斜杠注入走 `isUserInvocable`。两者都由
  SKILL.md frontmatter 的 `disable-model-invocation` / `user-invocable` 控制。
- 启停 = 改写技能文件 frontmatter（watcher 使目录失效 → 下一次 agent 步骤目录自动更新，无需重启）。
- 安装 = 拷贝（本地目录）或 git 浅克隆（URL）到 skill 根：
  - 用户级 `~/.dsh/skills`（DSH_HOME 或 homedir()/.dsh）
  - 工作区级 `<项目根>/.agents/skills`（项目根 = 会话 cwd 的 git 根，回退 cwd）
- 查看视角 = 会话：host 侧按官方 `skill.list` 同款解析（cwd 取会话 header；
  registry 取 host `ctx.skills`；scope 取 live agent，冷会话回退全局层——web-app 组合中
  dsh-skill 注册表在 host 平面，scope 分层合并可见 preset 挂载的 filesystem provider）。

## 决策（用户确认）

1. 启停粒度：单个总开关（关闭 = 模型目录 + /斜杠 均不可用）。
2. 安装来源：本地目录路径 + Git 仓库 URL（浅克隆）。
3. 管理范围：当前工作区视角 + 用户级；安装目标可选「当前工作区 / 用户级」。
4. 入口：设置页一级分区（`settings.section` 槽，id `skills`，order 30，排在 Agent 预设之后）。
5. 卸载：仅允许删除管理器安装过的技能（账本 `~/.dsh/skill-manager.json`，0600 原子写）。

## 包结构

`packages/dsh-skill-manager`（npm `@linxin666/dsh-skill-manager`，双半区 cordis bundle）：
- `src/index.ts` host 入口：注册 /api/dsh-skill-manager/* 路由（loopback 围栏）。
- `src/core/frontmatter.ts`：yaml（^2.4.2）解析/校验/启停改写。
- `src/core/roots.ts`：dshHome 解析、项目根查找、目标根分类。
- `src/core/ledger.ts`：安装账本（原子写、损坏回退）。
- `src/core/install.ts`：安装计划与拷贝（目录 bundle / 平铺 .md / git 浅克隆）。
- `src/core/service.ts`：list / toggle / install / uninstall 编排（依赖注入便于测试）。
- `src/routes.ts`、`src/protocol.ts`、`src/invariant.ts`。
- `src/client/`：设置分区组件 + controller + api + locales（zh 源 / en 对照）+ CSS Modules。

## 行为契约

- list：name/description/whenToUse/source/provider/path/toggleable/installed/modelInvocable/userInvocable。
- toggle：只允许有文件路径（filesystem 来源）的技能；bundled / 运行时注册技能拒绝并说明。
- install：校验 frontmatter（name/description 必填、kebab-case、目标无重名）；
  目录型整体拷贝（剔除 .git），平铺 .md 逐个安装；成功记入账本。
- uninstall：仅账本内的路径可删（文件或目录）。
- 路由全部 loopback-only（同 dsh-ssh 围栏）；写文件仅限 skill 根与 ~/.dsh/skill-manager.json。

## 明确不做

新建模板、粘贴 Markdown 安装、模型/斜杠独立开关、agent 工具、系统提示词公告。

## 验证约束

本机（win32 沙箱）无 bash/pnpm，无法本地跑门禁；以下命令需在 CI 或用户本机执行：
`pnpm --filter @linxin666/dsh-skill-manager typecheck && pnpm --filter @linxin666/dsh-skill-manager test && pnpm --filter @linxin666/dsh-skill-manager build`
`node scripts/aggregate.mjs --check`、`pnpm docs:check`（含 `node scripts/verify-docs.mjs --write packages/dsh-skill-manager` 重录 i18n hash）、
`pnpm run typecheck && pnpm test && pnpm test:scripts && pnpm runtime-deps:check`。
