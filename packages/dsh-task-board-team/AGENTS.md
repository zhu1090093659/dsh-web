# AGENTS.md — dsh-task-board-team

任务看板的外部提供方扩展（团队协作 / team-hub）。本文件只写本包特有规则。

## 与看板的边界

- 本包是 `packages/dsh-task-board` 的外部提供方：不 import 看板的任何 `src/**` 实现，
  跨包协作只走提供方契约（cordis 服务 `taskBoard`）。契约的唯一事实源是看板的
  `src/core/extension.ts`，本包在 `src/core/contract.ts` 同形重述它，两侧半区都经
  `ctx.inject(['taskBoard'], ...)` 的依赖作用域取得能力面。
- 三个子席位（`task-board.detail.section`、`task-board.settings.section`、
  `task-board.card.decoration`）在 `src/client/index.ts` 以同形 `declare module` 声明，
  不 value import 看板包。设置区块**不随本扩展开关撤下**（它是重新打开开关的地方），
  只依赖看板服务。
- 设置区块是看板专题列表（`<ul>`）里的一张卡，因此必须渲染成共享
  `PluginSettingsCard`（`density="nested"`）：卡片外壳与行布局一律来自
  `settings-card.module.css` 的切片，本包自己的 CSS 模块只管切片没有的部件（状态词、
  分组标题、动作行）。行用切片的 `.field` 网格，标签在 head 列、控件在尾列——不要写
  `flex + width:100% 输入框` 的行，那会把标签压成按字换行、控件列各起一行。
  区块经看板动作通道写入，因此卡片不持有暂存草稿（save/discard 是空操作）。
- 共享副本：`src/client/{settings-form.ts,PluginSettingsCard.tsx,settings-card.module.css,SegmentGroup.tsx,RangeBubble.tsx}`
  是 `scripts/sync-shared.mjs` 生成的副本（文件头有 generated 注释），禁止手改；改
  `shared/client/settings/` 后重跑 `node scripts/sync-shared.mjs`。本包刻意不复制
  `settings-entry-form.ts`：字段不绑家族设置命名空间。
- 三项可选能力必须探测后再用：`sessions.followUp`、`tasks.rework`，以及看板宿主面的
  动作应用器（`apply`，用来启动执行）。缺失时降级并在卡片与设置区可见地说明，
  绝不假定存在。探测结果由 `probeTaskBoardCapabilities` 与发布摘要的
  `capabilities` 字段承载。

## 团队协作侧

- Host Token 只在宿主半区读写（`src/host/credentials.ts`）：来自 harness 凭据库或
  同名环境变量，绝不进入设置命名空间、看板快照、发布摘要或 agent 载荷。浏览器只在
  用户主动粘贴时单向发送一次。
- 只认领 `user-questions/request`。`approval/request`（工具权限审批）在本包没有监听器，
  这是 `team-hub/PROTOCOL.md` 第 6 节的不变量；订阅清单集中在 `src/host/waterfall.ts`，
  改动它要同时改 `tests/questions.spec.ts` 的对照测试。
- 领取、续租与结算的凭据（issue id、attempt id、lease token）唯一存放处是镜像卡的
  `integrations['task-board-team']` 载荷；重连幂等完全依赖它，不要另建内存索引。
- dsh-agents 不提供成员定义的服务，成员从 `$DSH_HOME/dsh-agents/ledger.json` 只读解析
  （`src/host/bindings.ts`）。文件缺失、损坏或形状未知都解析为空列表并给出原因，
  绝不让本机冒领别人的工作。

## 半区分层

- `src/index.ts`：host 入口（Config schema、提供方登记、凭据与设置写入面、公告）。
- `src/host/`：host 半区（hub REST 客户端、事件通道、成员绑定、同步服务、问题路由、
  水位线订阅、`team_comment` 工具、扩展工厂、凭据与设置面）。
- `src/core/`：两侧共享的纯逻辑（契约同形声明、hub 协议词汇与常量、镜像载荷、
  镜像卡草案、结算映射、问题上报映射、定时器席位）。
- `src/client/`：浏览器半区（locales、发布摘要 store、三个席位与装配器）。文案一律经
  locales 字典，客户端源码不出现裸中文；第三语言 ru 由 dsh-i18n 集中承载。

## 测试

`tests/support/harness.ts` 用真实的 `HostTaskLedger` + `TaskBoardHostService` 组装看板，
`tests/support/fake-hub.ts` 是按 `team-hub/PROTOCOL.md` 写的进程内 fake（REST 走注入的
fetch seam，WS 走注入的 socket 工厂）。断言写在行为上：领取过滤、租约节奏、重连幂等、
结算映射、问题生命周期、审批不认领、@ 投递、返工与两项能力缺失时的降级。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board-team typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board-team test
pnpm --filter @linxin666/dsh-client-ui-task-board-team build
pnpm docs:check
```
