# Agent Note: dsh-git-graph 包退役，交给官方 Git 变更插件

Status: implemented

## Problem

官方 DSH 现在自带 `@deepseek-ai/dsh-workspace-changes`（`@deepseek-ai/dsh-web-app` 里的 bundle
行 `workspace-changes`），Git 变更视图不必再由本家族自己提供。`packages/dsh-git-graph`
 meanwhile 长成了三件互不相干的事——空白会话 hero 行里的分支 chip、提交图谱对话框、worktree
会话隔离——前两件现在与官方面重复，而家族还要为此养着自己的 git 服务、`/git/*` 宿主路由与
`git_worktree` 模型可见工具。

## Decision

- **包被整体删除。** `packages/dsh-git-graph/` 已删除（126 个受控文件）；聚合包不再挂载它的行、
  不再依赖它，也不再随包发布它的 ru 字典、设置桥白名单条目、移动端屏蔽规则、测试规范与覆盖率
  基线以及脚本门禁条目。
- **聚合包保留旧子路径作为退役空壳。** `aggregate.yml` 的 `tombstones:` 段保留 `git-graph`，
  `retiredPlugins:` 段登记 `{"family": "git-graph", "plugin":
  "@linxin666/dsh-client-ui-git-graph"}`。本次改动之前写下的 profile 记录的行名是
  `@linxin666/dsh-web-all/git-graph`：这个名字必须继续可解析（否则 import 阶段抛
  `ERR_PACKAGE_PATH_NOT_EXPORTED`，整组聚合 boot 一起倒），而壳必须把它当静默 no-op，而不是
  记成 degraded 插件。这与 `remote-web-ui`、`update` 已有的两段式机制相同。
- **已发布的 npm 包继续留在 registry。** `@linxin666/dsh-client-ui-git-graph` 不下架，单独安装
  它的用户仍能继续用；因此创意工坊徽章名单与已发布包的 e2e 名册里仍列着它。
- **Git 变更视图交给官方插件。** 从现在起由 `workspace-changes` 承担。worktree 会话隔离交给官方
  experimental 的 `client-ui-forge` 插件（它自带 worktree 管理与 diff），家族不再自带一套。
- **同一次改动里适配了 Verdandi 皮肤的输入卡统计栏。** 皮肤原本把输入卡 dock 画成一张纸面面板，
  并期待面板里还有第三个元素；宿主现在把上下文环渲染成 slot 包装的同级兄弟，于是面板与百分比
  方块读作两块割裂的东西。皮肤改为把它们并成一条，并删掉已失效的 `[data-dsh-live-tps]` 选择器。

## Alternatives considered

- **保留包但只提示「已废弃」。** 否决：家族会在官方面旁边再养一套 git 面，且每位用户都得手动
  把它关掉。本仓库已有四次同类移除（`dsh-aionui-panel`、`dsh-live-stats`、
  `dsh-desktop-launcher`、`dsh-model-capabilities`），先例是删包。
- **把 worktree 隔离拆成一个瘦身包留下。** 否决：官方 forge 插件已经拥有 worktree，新包等于对
  同一能力做第二套实现；而拆分后剩下的包只会是个壳。
- **连子路径导出一起删掉。** 否决：那是清单里「彻底移除」那一档读法，会把老 profile 残留的行名
  变成每次启动都抛的 import 硬错误。tombstone 加退役登记的代价只是一个壳导出，换来的是升级静默。

## Consequences

- 家族不再提供 `git_worktree` 模型可见工具、`$DSH_HOME/worktrees/` 托管目录，也不再在空白会话
  hero 行提供分支 chip。依赖这些能力的用户改用官方插件；registry 上那份 npm 包仍给想留住旧行为的
  用户留着。
- 记过用户层 `disabled` 覆盖（行 id `web-ui-git-graph`）的 profile 会让 loader 报
  "entry not found"——这与 `update`、`remote-web-ui` 两次退役已接受的代价相同。
- 皮肤侧清理（失效的 `[data-gitgraph-*]` 规则、由该插件占用的语义属性契约行、皮肤中心注入的
  `data-dsh-plugin="git-graph"`）在 dsh-skins 仓完成，并把该仓的 gitlink 移到本仓。

## Testing

`pnpm typecheck`、`pnpm test`、`pnpm test:standards`、`pnpm test:scripts`、`pnpm docs:check`、
`pnpm i18n:check`、`pnpm aggregate:check`、`pnpm libs:check`、`pnpm market:check`、
`pnpm emoji:check` 与 `pnpm build` 全绿；`node scripts/aggregate.mjs --check` 报三个退役插件且
不再有 git-graph 行。输入卡统计栏已在运行中的 Web GUI（Verdandi 皮肤）用前后截图验证。

## Superseded decisions

下列决策记录描述的是被移除的包。它们作为历史记录保留并在此交叉链接，而不是删除：官方插件需要
复现的那些行为，其理由仍由它们承载。

- [dsh-git-graph 中的 git worktree 并行会话](../feature/2026-08-26-git-worktree-parallel-sessions.md)
- [git-graph 状态探测进程收敛](../architecture/2026-10-10-git-graph-status-spawn-plan.md)
- [git-graph 只挂输入卡 dock 的座位](../architecture/2026-10-18-git-graph-dock-only-input-seat.md)
- [git-graph 分支胶囊 hero 传送门](../bug-fix/2026-08-31-git-graph-branch-chip-hero-portal.md)
- [git-graph hero 胶囊定位反馈死循环](../bug-fix/2026-10-29-git-graph-hero-chip-placement-feedback-loop.md)
- [git 语言环境固定与 CLI 探测测试](../bug-fix/2026-11-01-git-locale-pin-and-cli-probe-test.md)
