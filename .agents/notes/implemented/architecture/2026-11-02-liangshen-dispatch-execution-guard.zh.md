# Agent Note: LiangShen 拒绝被委派调用方的调度者工具

Status: implemented

扩写[调度者规则](2026-10-18-liangshen-dispatcher-rules-maintained-in-place.md)、沿用[子路由守卫](2026-10-25-liangshen-subagent-route-guard.md)。前者把调度纪律写进提示词，后者管住一个委派参数；本 note 负责的是提示词管不到的那部分——决定口本身的执行期边界。

## Problem

同进程的子代理继承父会话的 preset 组成，于是 LiangShen 的工具面也一样落到子代理身上：`ask_user_question`、`create_goal`、`update_goal`、`exit_plan_mode` 在子代理的工具表里，且真的可以调。此前只有提示词要求子代理别用，而提示词是请求，不是边界。

它放行的故障是安静的那种。子代理自己去问用户，就把一个决定拆成两个：用户答了子代理，调度者不知道问过什么，计划却建立在一个它没收集到的答案上。子代理自己开目标、自己退出计划模式，等于把会话状态改成了调度者没做过的样子。等待那一侧是同一类问题：子代理还在跑时，调度者可能把一整轮花在 `sleep` 上，既烧预算又错过 harness 即将投递的完成通知。

上游插件（`@eddyskywalker/dsh-chatgpt-subscription`）在它自己的插件根装了一台宿主面守卫，开关是它设置卡里的 `dispatchExecutionGuard`。那个位置属于 provider 插件；本 preset 自带工具面，就得自己管住自己的会话。

## Decision

preset 多挂一行 `dispatch-guard`（`presets/liangshen/dispatch-guard.mjs`），在组成作用域里注册 `ctx.tools.guard`：

- **主控专用工具**：`ask_user_question`、`enter_plan_mode`、`leave_plan_mode`、`exit_plan_mode`、`create_goal`、`update_goal`、`present` 由被委派调用方调用时以 `DELEGATED_CALLER` 拒绝，文案要求它把未决决定带回报告，状态写 `status: hand_back` 或 `status: blocked`。本部署只挂载其中四个；其余保留在冻结名单里，让规则在工具面变动后依然成立，而一个永不出现在调用里的名字没有成本。
- **纯等待命令**：调用方还有在跑的子代理时，命令只是等待（sleep、Start-Sleep、timeout、本机 localhost ping）加上无害空转的 `bash` / `pwsh` / `win_bash` 调用以 `ACTIVE_CHILD_SLEEP_FORBIDDEN` 拒绝。带真实工作的复合命令与任何 `run_in_background` 调用都不拦：这条规则针对空等，不针对后台工作。
- **身份先读持久血缘**：主判据是 `session.header.origin === 'subagent'`，兜底才是存活根集合（`agents.roots()`，且先确认调用方仍是它 id 当前登记的那个 agent）。宿主判不出身份的调用方，不按子代理算。
- **失败开放**：没有守卫接缝、读不到会话、读不到存活根、读不到子代清单——一律交给 harness。会猜的保护比会弃权的保护更糟。
- **只用一条接缝**：本行只注册 `ctx.tools.guard()`，不碰 `tools.register`、不碰 `tools.definitions`、不碰提示词装配，所以工具声明面逐字节不变，按前缀计费的线路不会因为这一行重建缓存。
- **不占设置卡字段**：本行从自己的 config 读 `enabled` / `coordinatorTools` / `shellTools`，关掉它用 profile patch——与 `subagent-routes` 同款，也正是[已退役的断路器](2026-10-17-liangshen-guard-retirement.md)的反面：那次的经验是，一个调不到参数的设置块只是文档面，不是控制面。

同一改动里同步了规则文本：调度者规则块新增常设子代理契约、报告协议、主控专用工具清单、按影响而非按工作量停手、精简增量任务书、不罚 hand_back、界面 Before/After 证据门、删除测试、R9（计划模式是用户的开关），反模式扩到 21 至 25 条。

## Alternatives considered

- **整包抄上游守卫**：否决，理由与[子路由守卫 note](2026-10-25-liangshen-subagent-route-guard.md) 记录的一致——上游模块带着设置采样、注入的 `hasRunningChildren` 接缝和插件面安装，这些都不是 preset 行该拥有的东西。紧凑移植让这套行为只有一个家。
- **只加规则、不加守卫**：否决。提示词本来就写着子代理不得问用户、不得开目标，而在工具面允许时它正是这么做的。只写在散文里的边界是偏好，不是边界。
- **在子代理作用域里注销这些工具**：否决。工具面对整个 preset 装配一次，按作用域摘除意味着为子代理维护第二份组成、第二份声明面，而且工具表变化会让 provider 的前缀缓存在会话中途失效。
- **把守卫做成设置卡开关**：否决。设置卡现在是四个 volatile 字段，没有一个负责挂载行；守卫是保护不是功能，要关它的部署往 patch 里写 `enabled: false`。
- **顺带拒绝子代理的 `todo_write`**：否决。子代理记自己的步骤是正当的，且私于它自己那一轮；拒绝清单管的是决定口，不是记账。
- **凡是 `sleep` 都拦**：否决。`sleep 0.2 && npm test` 与重试退避都是真实工作，分不清它与空等的守卫会拦掉调度者自己的工具。

## Consequences

- 被委派的调用方不再能问用户、开或关目标、提交计划。决定随子代理的报告回到调度者手上，那才是它能动手的地方。
- 还有子代理在跑的调度者不能再用一条 shell 命令空等；那一轮结束，完成通知会把它叫醒。
- 拒绝名单是冻结数据：将来工具面再加 `present` 或计划模式入口工具，不必改守卫；而永未挂载的名字只是永不命中。
- 两条拒绝都是可执行文案：都写清下一步该做什么，而不只是禁止什么，且各自被测试逐字钉住。
- 守卫接缝或会话血缘读不到的宿主，保持 harness 原本的行为；preset 照常挂载。

## Testing

- `packages/dsh-liangshen/tests/dispatch-guard.test.ts` 覆盖导出契约、身份判定（血缘、存活根、过期调用方、无 `agents` 服务）、纯等待表（等待、空转、混合命令、后台豁免）、子代探测（两种列表形态 + 注入回调）、每个已挂载决定口各一条拒绝、名单外工具放行、每一条失败开放路径，以及本行的关闭开关。
- `packages/dsh-liangshen/tests/preset-composition.test.ts` 钉住新行的挂载与默认开启。
- `packages/dsh-liangshen/tests/minimal-prompt.test.ts` 钉住重新同步后的规则集、R9 段与来源记录的新增条目。
- 守卫对**插件重新声明 preset 之后新建的会话**生效：正在运行的 `dsh web` 宿主需要重启，本次改动不执行重启。
