# Agent Note: 宠物精灵挂载进插件根容器；远程流套接字启用保活探测

Status: implemented

## Problem

实测轮暴露了两个手机镜像问题：

1. **宠物在手机上从未真正隐藏。** `mobile-adapt.ts` 在竖屏表面抑制 `[data-dsh-plugin="pet"]`，宠物插件的 apply 也确实创建了这个根容器——但 `PetSprite` 把整个浮动层 `createPortal(float, document.body)` 到了根容器之外：精灵、气泡与用量公告全部逃逸出被隐藏的根。规则只藏住了空容器；用户一直看到宠物——它的浮动气泡还在小屏上盖住了对话。QA 仿真当时只测了容器（`display:none`），漏掉了 portal 出去的精灵；真实手机暴露了它。
2. **流式回复数分钟后才到手机。** 桌面（环回）秒收；手机侧的回复（主机侧 07:50:19 已生成）约 07:53-54 才显示。证据指向经隧道的长连 mux WebSocket 半开：服务端写入被内核接受，手机却收不到，只有等操作系统级重传超时后才重连 + 流重建基线，回复才出现。

## Decision

**精灵蒙皮挂载进宠物自己的根容器。** `PetSprite` 新增 `portalTarget?: Element`（默认 `document.body`）；`PetDockEntry` 透传；apply 把已创建的 `[data-dsh-plugin="pet"]` 容器传下去。根现在拥有整个表面——精灵、气泡、面板、用量公告——根键竖屏抑制器即可把宠物作为一个整体隐藏，L2 语义契约（"根拥有其部件"）也不再被逃逸的部件破坏。视觉布局不变（浮动层仍是 `position: fixed`，容器是无样式 div）。

**远程流代理为套接字启用保活。** `proxyLoopbackUpgrade` 对外层与内层两条 socket 开启 TCP keepalive（20 秒）：半开的隧道路径几秒内被探测到，两条腿都被销毁，手机的 mux 客户端随即重连、会话流立刻重建基线，而不是等操作系统 RTO。

## Alternatives considered

- **用 CSS 选择器直接隐藏 portal 出去的浮动层。** 否决：浮动层没有稳定语义属性（只有哈希后缀类名），且 frames2d/live2d 两种渲染器的深层 DOM 各不相同。存在即稳定键的正是拥有它的根；问题在于根没有真正拥有这个 portal。
- **保留 body 层 portal 但打标签。** 否决：复制了根容器的职责，还把表面劈成两个根。
- **在被重写的套接字上做应用层保活 ping。** 在本层否决：浏览器 WebSocket API 不能发协议级 ping，应用层帧需要 SDK 配合。

## Consequences

- 手机镜像真正抑制宠物：`[data-dsh-plugin="pet"]` 的 `display:none` 现已覆盖精灵、气泡与用量公告（QA 实例实测：根 `display:none`，精灵元素位于根内）。
- 桌面表现不变（根无样式，浮动层保持固定定位）。
- 半开隧道/边缘缺口现在数秒内恢复，而不是数分钟；会话流在客户端重连后重建基线。
- 网络环境仍是风险：本机 fake-ip TUN 代理曾把 Chrome 整体卡死（curl 正常而 Chrome 外网全挂）并引发过 cloudflared QUIC/1033——保活加固了插件自己的 socket，但无法修复上游传输。

## Testing

- dsh-pet：463 测试 / 39 文件全绿，含新增 portal-target 用例（浮动层进入指定根；缺省回退 document.body）。
- dsh-remote-web-ui：283 测试 / 26 文件全绿；typecheck 与构建通过。
- 实测（QA :3191，iPhone 仿真）：`[data-dsh-plugin="pet"]` 根 `display:none` 且精灵位于根内——手机表面不再渲染任何宠物相关元素。
