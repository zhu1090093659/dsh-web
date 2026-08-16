# dsh-branch 插件会话交接：master/main 树回滚/恢复（DOM 注入版）

任务：继续构造 dsh-branch 插件 —— 轨迹标签页所有节点的回滚/恢复，回滚创建
master 树（master1、master2、……），恢复回到 main 树。**不替换官方轨迹 UI**，
只在原有界面增加按钮。

## 架构（用户要求后重构）

- 放弃 shadow 官方 conversation.view 槽位的做法（会整个替换官方界面，用户否决）。
- 改为 DOM 注入：官方轨迹表行 `tr[data-record-index]` 上追加操作单元格
  （回滚/恢复按钮），MutationObserver 自愈（虚拟滚动行进出视口都正确）。
- `core/official-rows.ts`：只读复刻官方 ui-trajectory layout 的 cell-index
  枚举（user/message/tool/subtool/request/system/compacted + 行内 block
  callId 去重 + runningCalls），把官方行映射到文件状态 stateIndex。
- host 半区不变（/branch/preview + /branch/apply，loopback + workspace 围栏）。
- 树模型（git 式，用户已确认）：回滚到节点 = 把该节点文件状态创建为编号
  master 树并切换（同状态复用）；恢复 = 回到 main 树（轨迹 head 状态）。
- 树注册表 localStorage 按 cwd 持久化；树切换器为注入的悬浮 chip。

## 本次落地文件

- 新增：src/core/official-rows.ts、src/client/inject.ts、tests/official-rows.spec.ts
- 重建：package.json（inject 改为 sessions+locale，不再注册视图槽位）、
  cordis.patch.yml、tsconfig 系列、tsdown 系列、host 半区、core
  （trajectory/trees/types）、client（api/tree-store/trajectory-snapshot/
  locales/branch.module.css/index.ts）、tests、README 三件套、LICENSE。

## 验证快照

- `pnpm --filter @linxin666/dsh-client-ui-branch typecheck` 通过
- `pnpm --filter @linxin666/dsh-client-ui-branch test` 通过（trajectory /
  trees / fs-service / official-rows）
- `pnpm --filter @linxin666/dsh-client-ui-branch build` 通过
- `node scripts/verify-docs.mjs` 全仓通过
- 全仓 typecheck / test / aggregate 门禁：见会话收尾输出（aionui-panel 的
  symlink 用例在本 Windows 主机 EPERM、liangshen 无测试文件为历史环境问题）。

## 遗留决策

- 未把 dsh-branch 加入 packages/dsh-web-ui-all/aggregate.yml（独立包，挂载走
  `dsh plugin --profile web add link:<repo>/packages/dsh-branch`）。
- 挂载已存在于 ~/.dsh/profiles/web（link 到本目录）；目录被删后需重新
  build 并重启 dsh web 加载新 bundle。
- 浏览器端实测（官方轨迹页行按钮交互）未做，需真实 dsh web 环境验证。
