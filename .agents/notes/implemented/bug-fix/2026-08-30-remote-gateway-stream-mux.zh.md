# Agent Note: 网关流复用套接字走门控远程通道

Status: implemented

## Problem

官方界面适配改造后，扫码进入 `/pair-app` 的手机端并没有镜像 PC 上运行的 DSH：应用要求用户重新选择工作区、会话列表显示"暂无会话"——与全新实例的形态完全一致。工作区注册表与会话存储都在主机侧，任意同主机浏览器看到的都是同一份数据；数据存在，但手机端客户端没有收到。

## Decision

**门控通道现在覆盖官方流套接字。** 钉定的 0.1.2-alpha.1 线上客户端只打开一条常驻 WebSocket——Typert 网关多路复用流 `/api/remote.mux`——所有 Remote 流（工作区 follow、会话 feed、子代理谱系等）都走这条套接字。通道重写表里残留的是该版本已不存在的旧路径（`/api/events.mux`、`/api/events.host`），因此手机的 mux 从未被重写到 `/remote/api/remote.mux`：它直连隧道源站，被连接插件围栏与浏览器认证 cookie 拒绝（手机无 cookie 也无围栏信任），全部流随之失效。修复：

- `wsPaths` 现在包含 `/api/remote.mux`（外加侧边栏/ssh 终端）；解析期引导补丁与运行时补丁共用同一规则表。
- 主机注册精确升级路由 `/remote/api/remote.mux`，映射回内环 `/api/remote.mux`，保留无 cookie 凭据所依赖的 `device` 查询参数。
- 删除过时的 `events.*` 常量；契约钉定测试断言 mux 路径。

移动端保持"仅桌面"抑制项不变：宠物、ssh、skill-explorer、task-board、git-graph、perf、usage 等表面在竖屏触控手机镜像上一律隐藏——手机镜像刻意不带桌面装饰。

## Alternatives considered

- **不再列精确路径，而是代理 `/api` 下所有 WS 升级。** 否决：webserver 按精确路径派发升级，连接插件拥有 `/api/remote.mux` 路径；通用前缀代理会与网关自身升级路由竞争。精确镜像保证每条套接字一个路由，且每条前面都有设备门。
- **在手机镜像上显示宠物（把它从竖屏抑制列表移除）。** 同一轮中考虑过，被用户否决：浮动宠物会占住狭小视口，手机镜像按设计就是不带桌面装饰的，因此抑制是需求而非需要撤销的缺陷。

## Consequences

- 手机端工作区/会话 feed 经门控通道送达；镜像与 PC 显示相同的工作区与会话。
- 引导脚本多一条路径项；环回源不受影响。
- 通道覆盖面与 cohort 精确对齐：未来 SDK 若更换流套接字路径，必须同步更新 `wsPaths` 与 `REMOTE_UPGRADE_PATHS`（两者出自同一规则表）——契约钉定测试会在漂移时失败。

## Testing

- 单元：mux 路径重写规则（运行时补丁 + 引导脚本）、精确升级路由 `/remote/api/remote.mux` → 内环 `/api/remote.mux` 且保留 `?device=`、移动适配样式表仍然抑制宠物及其他桌面表面。包套件：283 个测试 / 26 个文件全绿。
- 实测（QA 实例 :3191，DSH_HOME=/Users/zcl/dsh-qa-home）：全新浏览器上下文 + iPhone 仿真经 LAN 源配对后落地 `/pair-app`；工作区列表与会话加载成功（侧边栏与桌面标签逐行一致），竖屏层维持宠物抑制。无 cookie 浏览器直接刷新裸 `/` 仍会撞 harness 索引门——重新扫码即可进入；这是已知边界而非回归。
