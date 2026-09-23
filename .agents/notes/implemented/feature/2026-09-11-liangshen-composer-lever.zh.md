# Agent Note: The LiangShen lever in the new-session composer

Status: implemented

## Problem

梁神模式虽然装上了，开启方式却与其他预设毫无区别：在新建会话页打开预设选择器，从列表里挑一个。该模式立身之本就是「刻意不同的 agent 组合」，却没有任何可见的入口；而且这条聚合行在出厂设置里默认关闭，屏幕上根本没有任何东西提示这个模式存在。

切换窗口也比看上去窄。agent preset 在会话创建时固定，唯一受支持的例外是仍然为空的会话：`agentPresets.select` 会重新组合这样的会话并记录一条 `agent-preset/selected` 事件，其余一律以 `agent-preset/locked` 拒绝。任何声称能在对话中途切换模式的控件都是在说谎。

## Decision

插件新增浏览器半区，只负责一个控件：输入框工具行里的一台老虎机拨杆，经 `conversation.input.right` 槽认领——shell 把它渲染在同一张输入卡内、模型选择器（`conversation.input.model`）紧左侧；新建会话的 hero 用的是同一条工具行。

- 把拨杆拨下，为当前会话组合梁神模式；上拨则回到用户此前的预设，页面尚未见过任何选择时回退到部署默认预设。在任一方向上拖拽均根据当前状态切换模式，在已开启梁神模式下拉动拨杆同样会恢复上一预设，避免空转。
- 拨杆反映会话的 `agentPreset` 投影而非本地状态，因此刷新后展示的是真相；且只在会话仍为空时可操作——正是宿主接受的那个窗口。窗口之外整行控件什么都不渲染。
- 命中后播放特效：闪光、冲击环、火花，以及「模式名 + 文言文、二进制、摩斯三行」的横幅。特效由控制器只在宿主接受切换时推进的计数器驱动，因此被拒绝的切换不可能庆祝。`prefers-reduced-motion` 保留状态变化、去掉动画。
- 切换走浏览器会话已完成鉴权的 agent-preset Remote 命名空间（`agentPresets.list` 与 `agentPresets.select`）。不引入官方预设包的浏览器模块：本仓库的跨插件协作只走 cordis 服务与 Remote 面，不走 value import，浏览器 bundle 的纯度门禁也强制这一点。
- 控制器把自己读取的每个服务都写进 fiber 的 inject 清单——`slots`、`locale`、`sessions`、`remote`、`remote.agentPresets`。浏览器 context 是代理，读取未 inject 的服务会直接抛错，而嵌套服务名并不蕴含其父服务，所以 `remote` 必须与 `remote.agentPresets` 一起声明。每次读取另有一层保护：某个服务答不上来时拨杆保持惰性，而不是让本插件的 fiber 失败、把整条输入行一起带走。
- 拨杆以状态而非槽位限定在新建会话页：槽对每个会话都渲染，而组件对已开始的会话（摘要报告 `locked`）与预设缺席（`missing`）都渲染为空——运行中会话的输入框里留一个死控件，等于暗示一个宿主必然拒绝的切换。

## Testing

- `tests/lever-logic.spec.ts` 覆盖纯决策：状态判定（on / off / locked / missing）、可操作性，以及上拨回到哪个预设——包括已记住但 roster 不再提供的预设。
- `tests/lever-control.spec.ts` 在假客户端运行时上驱动控制器：各手势选择的预设、回退、locked 与 not-found 的拒绝映射、宿主原因的透传、被拒绝的切换绝不推进特效计数器、状态无法服务的手势，以及绑定命名空间的翻译函数。
- `tests/lever-ui.spec.tsx` 在 jsdom 下渲染组件：语义属性、`role="switch"` 状态、指针拨下、上拨与横向拖拽、键盘激活、locked 与 missing 状态渲染为空（快照离开这些状态后整行恢复）、拒绝提示行，以及每次命中只出现一次的特效。
- `tests/lever-control.spec.ts` 另外钉住服务解析与切换存活：`remote` 或 `sessions` 访问器被拒绝（inject 代理抛错）时拨杆必须惰性而不是抛错；Remote 调用永不应答的切换必须报超时，而不是永远停在忙碌态。
- 已用发布产物在真实 GUI 上跑通：新建会话页渲染出拨杆，拨下真实提交 `liangshen`（官方预设 chip 同步变化）并播放特效，上拨恢复 `standard`；宿主持久日志里有一一对应的 `agent-preset/selected` 事件。
- `pnpm --filter @linxin666/dsh-liangshen build` 经共享预设的纯度门禁与 CSS Modules 管线产出浏览器 bundle，所以跨插件 value import 或非平台外部依赖都会让构建失败。

## Alternatives considered

- 在新建会话 hero 的官方预设 chip 行里再加一个入口。否决：那是在同一屏上为同一字段重复官方预设控件，而需求是输入框内、模型选择器旁的控件。
- 引入官方预设包导出的 `writeDefaultPreset` 助手。否决：它改的是之后所有会话的默认值，而不是正在开始的这个会话；而且引入它属于 bundle 纯度门禁禁止的跨插件 value import。
- 改部署默认预设，而不是改会话预设。否决：那会静默改写之后每一个会话，且无法按会话回退；按会话 select 是更窄、可逆的动作。
- 用一个普通开关按钮。否决：需求就是拨杆，而且拨杆的行程本身也是「下拨开启 / 上拨返回」的提示，复选框表达不了。
- 为了动画而本地维护开关状态。否决：会话投影才是权威，本地状态会在刷新或经官方 chip 切换后漂移。
- 在手势发生时播放特效，而不是在宿主接受后。否决：被拒绝的切换会为一个并未发生的变更庆祝。

## Consequences

- 梁神模式在真正能选择该模式的屏幕上有了可见、一次手势的入口，插件的浏览器半区也随它所属的 preset 一起发布。
- 拨杆无法开启部署未安装的模式：预设缺席时它渲染为空——插件行被禁用时用户看到的也正是这种沉默。
- 超过十秒上限的切换报为超时并清除忙碌态。宿主可能其实已经提交（Remote 的应答可能在回程丢失），因此下一次会话读取会给出真实结果，拨杆不会再一直声称「正在切换」。
- 控件只在会话为空期间存在，对话开始后即消失；对话中途切换模式依然是设计上的不支持，而不是遗漏。
- 拨杆文案是可翻译命名空间（`liangshen`），包内自带 zh/en 字典，ru 镜像在 `dsh-i18n`；其 DOM 输出 `liangshen` plugin 组与五个 `lever*` part 值，并已登记进语义属性契约。
- 拨杆每次页面访问读一次 roster，并在 `agent-presets` 命名空间的 `settings/document-updated` 时重读，因此页面打开期间安装或删除预设都会让拨杆随之更新，无需刷新。
