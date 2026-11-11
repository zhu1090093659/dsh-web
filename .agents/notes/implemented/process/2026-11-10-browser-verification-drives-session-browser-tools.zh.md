# Agent Note: 浏览器验证走会话挂载的浏览器工具，而不是临时写 Playwright 脚本

Status: implemented

## Problem

仓库里唯一的浏览器自动化是 Playwright 挂载 lane，而验证类说明从未说过该用哪个浏览器去驱动。web-qa 技能要求验证真实的 GUI 并为它留下截图，却没指定驱动方；同时 `playwright.config.ts`、`tests/e2e/mount.e2e.ts` 与 `scripts/e2e-mount.sh` 给每个会话提供了一个始终在场、长得就像浏览器的东西。漂移是无声的：会话临场写一个 Playwright 脚本，它跑通了，而报告里的截图来自另一个浏览器和一个空的 scratch profile，不是用户正在看的那个表面。这条 lane 为每一次「看一眼」都收全额成本——打包聚合包、装进 scratch profile、再起一个宿主，之后断言才开始跑：它是门禁，不是观察手段。

## Decision

验证需要浏览器时，由会话挂载的浏览器工具驱动，Playwright 是兜底而不是默认。

- **规则与做法各有一个家。** 一行规则写在根 [AGENTS.md](../../../../AGENTS.md) 的 Development Workflow 一节；[dsh-web-web-qa](../../../skills/dsh-web-web-qa/SKILL.md) 拥有做法——哪些工具驱动一次检查、什么时候 Playwright 仍然正确、报告里的证据如何交代驱动方。
- **浏览器工具在场时就优先用它。** `browser_navigate`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_screenshot`、`browser_console` 及其同类作用在真实 URL 上的 GUI、用户在跑的那个 profile 上，因此被测的设置、皮肤、会话与任务看板都是真实的。
- **Playwright 保留两件工作。** 它仍是已提交的可复现 lane（`pnpm test:mount` 经 `scripts/e2e-mount.sh` 与 `tests/e2e/mount.e2e.ts`），本决策不改动它；它仍是兜底：会话没有挂载浏览器工具，或需要工具给不了的脚本化重复时使用。
- **证据要交代驱动方。** 带截图的报告写明截图由两者中的哪一个产生，读者才能区分「用户自己 GUI 的渲染」与「scratch 实例的渲染」。

## Alternatives considered

**GUI 验证一律用 Playwright。** 拒绝：它起自己的浏览器和自己的 scratch 宿主，验证的是孤立环境里刚挂载的 bundle，而不是用户正在用的表面，其截图记录的是没人关心的渲染；每看一眼还要付一次打包、安装与宿主启动的代价。

**删掉 Playwright lane，挂载结论全部用浏览器工具手验。** 拒绝：该 lane 是确定性的机器检查——DOM 标记、console 前缀、崩溃条——并且在 CI 与 pre-push 里无人值守地跑。手验会把这一切换回一次性的「看一眼」，把 lane 消除掉的抖动重新引入。

**不表态，让每个会话自己选。** 拒绝：仓库里只有 Playwright，沉默就等于选它，而这正是本决策要纠正的漂移。默认值必须有人负责。

**把整套做法写进根 AGENTS.md。** 拒绝：根文件承载一到三行的全局规则并链接归属，把工具级做法放进去会让每个会话都要读的文件膨胀。

## Consequences

- GUI 验证现在观察的是运行中的 GUI：截图呈现用户所见，被测状态属于该 profile，而不是空 profile。
- 已提交的挂载 lane 不变，CI 与 pre-push 继续拥有确定性的挂载门禁。
- 没有浏览器工具的会话回落到 Playwright 并如实说明，证据因此仍然诚实。
- 浏览器工具作用在用户运行中的宿主上，其余边界由既有规则承担：不重启运行中的服务、不起替代服务器、检查结束关闭临时浏览器任务空间（见[共享 DSH home 探测隔离](2026-10-02-shared-dsh-home-probe-isolation.md)）。
- 本决策不改运行时代码；它的门禁是 `pnpm docs:check` 的链接与配对检查，以及对两个被改技能的人工复核。
