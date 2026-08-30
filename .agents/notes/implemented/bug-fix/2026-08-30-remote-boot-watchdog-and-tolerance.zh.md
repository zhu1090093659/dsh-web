# Agent Note: 远程手机界面的启动看门狗与启动失败容忍

Status: implemented

## 问题

配对手机打开远程界面时可能整页空白：只剩主题背景、右上角悬浮退出按钮和宠物召唤按钮——没有侧栏、会话区或输入框。在 WebKit 上对真实隧道复现（与用户手机截图逐像素一致），同一页面在 Chromium 上每次都能正常启动。带插桩的复现抓到了机制：

- 一次失败加载在开屏约 500 ms 处收到启动关键请求的 HTTP 429（Cloudflare quick tunnel 边缘对突发限流；手机重新配对时桌面面板同时刷新正是这种突发）。启动关键请求一死，SPA 什么都不挂载，也永远不会有东西重试——该次页面加载的空白是永久性的。
- 与空白无关，移动适配层样式标签曾被观察到丢失而 `dsh-remote-portrait` body 类仍在（外部 DOM 清理；移除者无法归因）。标签一丢，桌面专属抑制全部失效——宠物召唤按钮出现在手机上（用户截图右下角的深色方块），鲸鱼按钮/侧栏压缩逻辑退化。
- 官方 layout 门面在根入口尚未挂载时按契约抛错（`layout: panel actions not wired (root entry not mounted)`）；远程客户端在 apply 时（`flushCloseDetails`）和手势中都会调用它，慢的远程启动可能把该异常抛进插件 apply world 或 store subscriber。

## 决策

**启动韧性加在解析时引导脚本里；插件不再信任启动顺序。**

1. **启动看门狗**（`buildBootWatchdogScript`，拼进 `buildRemoteChannelBootScript` 的 IIFE、共用同一个非 loopback 门）：每秒轮询应用的会话表面（`[data-conversation-scroll]` 或 `[data-slot="conversation"]`）；15 秒仍不存在则整页重载一次。sessionStorage 闩（`dsh-remote-boot-reload`）保证启动持续失败时每次会话只自动重载一次；启动成功清除闩，之后的失败仍可恢复。看门狗不在 loopback 源上启用，任何一步都不抛错。
2. **容忍的 layout 调用**（`client/index.ts`）：`layout.toggleSidebar/closeDetails` 闭包和启动时的 `flushCloseDetails` 重放都吞掉 layout 门面的启动顺序异常——根入口挂载前面板动作本就是空操作，插件 apply world 不应因此死亡。
3. **样式标签再断言**（`client/mobile-adapt.ts`）：建标签逻辑提取为 `ensureAdaptStyle()`，层激活期间 600 ms 同步 tick 反复执行，丢失的标签在一个 tick 内回来，抑制不再静默失效。

## 已考虑的替代方案

- **客户端重试失败的启动请求。** 否决：失败可能命中几十个启动请求中的任何一个（包括 bundle 脚本——那时还没有任何应用代码可以重试）；通用 fetch 重试层还会与通道改写、模块系统传输相互干扰。
- **任何 error 事件都无条件重载。** 否决：GUI 本就有良性的逐插件报错（本地专用桥的 403 噪音是既有现象）；只有"应用表面缺失"才是可靠的"启动已死"信号，且闩防止真正故障下的重载循环。
- **修复适配样式标签的移除者。** 已排查、无法归因：仓库与官方代码里除 HMR 外没有移除 `style[data-plugin-css]` 标签的路径（此处 HMR 未启用，且 HMR 按 bundle id 匹配、与本标签值不符）。再断言让该机制无关紧要，症状已被测试覆盖。

## 后果

- 远程启动的瞬时失败代价是一次自动重载（第二次加载走热缓存），不再是用户要自己发现并手动刷新的死页。
- 看门狗随 host 服务的内联脚本下发，需 DSH 服务重启后才到达手机（host 在内存中持有该脚本常量）；客户端容忍与样式再断言是普通 bundle 变更，下次页面加载即生效。
- 抑制列表本身不变——手机镜像依旧不带桌面装饰，见[流复用 note](2026-08-30-remote-gateway-stream-mux.md)；再断言只是保住它的样式表。

## 测试

- 单测（`tests/remote-channel-boot.spec.ts`）：看门狗随服务脚本下发且带探测标记；loopback 不启用；等待期满后重载恰好一次并落闩；已落闩的第二次启动永不重载；启动成功清除陈旧闩。
- 单测（`tests/mobile-adapt.spec.ts`）：外部移除样式标签后一个 600 ms tick 内修复（恢复且仅一个标签、body 类完好）。
- 包全套：变更后 293 测试 / 27 文件全绿。
- 真实隧道（WebKit、iPhone 仿真）：修复前复现并定性了失败形态（约 500 ms 处 429、空壳）；修复后对再断言路径做了真实隧道验证。
