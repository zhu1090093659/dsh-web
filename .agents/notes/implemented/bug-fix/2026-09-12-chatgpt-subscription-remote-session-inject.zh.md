# Agent Note: chatgpt-subscription remote.session inject hotfix in the local web profile

Status: implemented

## Problem

[rc.1 cohort 迁移笔记](../architecture/2026-09-10-sdk-cohort-0.1.5-rc.1.md)曾记录一个既有基线问题：web GUI 反复出现 `remote.session` inject pageerror。[task-board 修复](2026-09-11-taskboard-model-inject-pet-carry-and-preset-semver.md)移除了本仓库自己的肇事者之后，pageerror 依旧存在：每次 GUI 页面加载抛出两个未捕获的 `Error: cannot get property "remote.session" without inject`。

堆栈归因与实际下发的合并插件 bundle 逐行核对：官方 `@deepseek-ai/dsh-client-ui-model-selection` 服务的 `directoryFor` 读取 `this.ctx.remote.session`，而本地 `web` profile 挂载的 `@eddyskywalker/dsh-chatgpt-subscription`（0.2.12）在其 `conversation.input.right` slot 的 `inject` 回调里触发它——codex-subscription-quota 与 antigravity-quota 两个挂件调用 `ctx.modelDirectories.directoryFor(sessionId)`。该插件顶层 inject 只声明 `['slots', 'locale', 'modelDirectories', 'conversation']`，缺少点分键 `'remote.session'`，Cordis 客户端代理因此拒绝访问——与 task-board 修复过的缺陷同类。上游两侧均未修：dsh 0.1.5-rc.2 的 model-selection 保留该访问方式，chatgpt-subscription 0.2.18（npm 最新）inject 声明原样未动。

## Decision

对本地 profile 安装副本就地热修：`~/.dsh/profiles/web/node_modules/@eddyskywalker/dsh-chatgpt-subscription/lib/client.js` 顶层 inject 数组加入 `"remote.session"`，补丁前备份留在同目录（`client.js.bak-remote-session-20260912`）。本仓库源码零改动——缺陷与修复都落在第三方包里，此处没有可打补丁的源码归属方。热修沿用了 task-board 的修复模式，也等价于 `dsh-llm-verifier` 的做法（它同样读取 `remote.session` 且已声明）。

该修复天然易失：profile 内任何一次 chatgpt-subscription 更新都会覆盖补丁文件，pageerror 随之回归。届时重新补这一行，或等上游发布声明了该键的版本——重打补丁前先确认上游是否已修。

## Testing

- 修复前，用 CDP 错误钩子对运行中的 0.1.5-rc.1 宿主（端口 3080）采集：每次页面加载两个 pageerror；堆栈逐行命中 model-selection 的 `directoryFor` 访问点与 chatgpt-subscription 的 slot inject 调用点。
- 修复后，同一钩子刷新页面报告零 pageerror；GUI 框架、task-board 与输入区正常渲染。

## Alternatives considered

- 把 chatgpt-subscription 升到 npm 最新版：否决——检查了 0.2.18 的 tarball，inject 声明未变，升级修不掉这个错误。
- 只报上游、本地错误留着：否决——错误在用户日常 GUI 的每次页面加载都触发；一行本地补丁立即消除它，上游报告作为长期解并行推进。
- 改打官方 model-selection 服务、给 `remote.session` 读取加保护：否决——访问点位于宿主内置的官方插件里，宿主下次更新即回退，而且缺失声明是第三方调用方的契约缺口，不是服务方的错。

## Consequences

本地 web profile 由此带有一处树外补丁；profile 安装与插件更新会静默回退它。未来会话再见到该 pageerror 时，先查本笔记与备份文件，不必重新推导归因。同日补充（修正本笔记最初对崩溃循环的归因）：用户报告的 Chrome 反复关闭，经现场布控溯源到无关的 `demo2/wandering-earth-jupiter` 截图自动化——其 `tools/batch.sh` 以无差别 `pkill -9 -f "Google Chrome"` 收尾，且其 `tools/shots.sh` 的 headless 实例在截图后常挂起、直到 100 秒等待上限才被清理，因此每轮批次收尾都会 SIGKILL 机器上的所有 Chrome，用户的图形界面浏览器概莫能外。两次预测的死亡（12:50:11、12:55:48）与「png 落盘时间 + 100 秒」公式逐秒吻合；Chrome 逐 profile 的 `exit_type=Crashed`、崩溃转储全无、死亡秒快照中 Chrome 进程清零，共同构成取证特征。浏览器自动化守护进程与 Chrome 远程调试授权重启只提供噪声，不构成关闭。
