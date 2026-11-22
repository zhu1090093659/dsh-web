# Agent Note: dsh-ssh 生命周期、资源安全与热路径加固

Status: implemented

## Problem

对 `packages/dsh-ssh` 的全量审计发现宿主插件入口、连接池、终端会话、SFTP 传输、JSON 存储、HTTP 路由 / 工具 / 隧道以及 React 面板客户端存在七组运行时生命周期、数据一致性与资源泄漏缺陷：

1. **配置同步误杀在线终端**：`src/index.ts` 的 `ctx.config.onChange` 在任意易变设置（如 `terminalFontFamily`、`connectTimeoutMs`）变更时无条件重建全部路由、工具与 `dshSsh` 服务，触发 `terminalSessions.dispose()` 并关闭所有在线 WebSocket PTY。
2. **连接池握手挂起、在途竞态与 UTF-8 截断**：`connectClient` 未在 `ready` 前监听 `'close'`（`ssh2` 收到横幅后若对端干净关闭会清除 `readyTimeout` 并只触发 `'close'`，导致队列永久死锁）；`doAcquire` 在 `dropAlias`/`dispose` 后仍可能回写 `engine.pool`，且目标连接关闭时未清理跳板 `hops`；`withClient` 等待 `acquireQueue` 时未响应 `AbortSignal`；`execCommand` 按单个 `Buffer` 分片解码并在截断输出时按 UTF-16 码元切分多字节字符。
3. **终端背压卡死与 O(N^2) 滚屏淘汰**：`TerminalSessionRegistry` 在 `ws.bufferedAmount > HIGH_WATER` 时暂停远端流却没有 WebSocket 排空恢复钩子，跨分片直接调用 `.toString('utf8')`，用 `Array.prototype.shift()` 淘汰旧分片，且未校对非有限终端尺寸或非字符串负载。
4. **SFTP 递归上传缺层与窗口速率失真**：`mkdirRemote` 用宿主机 `dirname` 处理远端路径，且递归上传未建立嵌套子目录；`fastTransfer` 用窗口字节增量除以自传输开始的总耗时来算 `speedBps`，使瞬时速率随时间持续衰减。
5. **主机存储缓存原地污染、N 次串行落盘与路由泄漏**：`HostStore` 在校验全部字段前就原地修改 `this.cache.file` 条目，导致校验失败后内存缓存永久脏污；`importFromSshConfig` 每条主机写一次磁盘；`save()` 使用固定 `.tmp`；`PATCH /api/dsh-ssh/hosts` 只检查原始 `body` 而非解析后的 `resolved`（仅传 `managedKeyId` 切密钥时不淘汰旧连接池）；下载路由的 `Content-Disposition` 仅剔除双引号且客户端中途断开时泄漏 `ReadStream` 与 `0600` 临时文件。
6. **集群错误丢失与隧道 / ProxyCommand 生命周期缺口**：`cluster` 丢弃了超时或取消时的 `result.error` 并三处重复校验不一致的选择器；`sshTunnelTool` 在 `startTunnel` 返回 `state: 'failed'` 时仍返回 `ok: true`；`tunnel.ts` 的 `forwardOut` 未处理已销毁本地 socket、监听绑定期间缺少 `inFlight` 保护、缺少监听后 `error` 事件清理，且 `stopTunnel` 在 `inFlight > 0` 时直接关闭共享池连接；`proxy-command.ts` 正常退出后未清理 `2s` `SIGKILL` 升级定时器，且 `stdin` 出错会叠加监听器。
7. **前端表单清空失效、双次请求、重挂载双倍回放与错误吞没**：`HostFormDialog` 把清空后的 `description`/`environment`/`location` 转成 `undefined` 导致 PATCH 不清空；`HostsTab` 挂载即发两次 `listHosts`、批量测试共用单个 `testingAlias` 状态、操作后刷新丢弃当前搜索词；`TerminalTab` 面板切换卸载重挂载时（`renderedRef.current === undefined`）未先清空 `retainedScreens`，导致宿主回放把历史输出加倍写入保留屏；`PanelController.appendTerminalOutput` 用 `shift()` 且不裁剪超过 `256 KiB` 的单块；`SshApi` 可能两次触发 `onExit`、上传漏掉末尾无换行或解码尾字节、下载出错未中止 `FileSystemWritableFileStream`；`TunnelsTab` 把 `state: 'failed'` 当成功处理并缺少卸载保护。

## Decision

在不改动外部协议、工具 Schema、配置契约及 `scripts/sync-shared.mjs` 生成副本的前提下，按边界逐项收敛：

- **幂等配置同步**：在 `src/index.ts` 记录已注册的 `enabled` 与 `announceToAgent` 状态，仅在对应结构开关翻转时重建路由/工具/服务或设置面板入口。
- **模块私有 `WeakMap` 连接池生命周期与流式解码**：在 `src/engine/connection-pool.ts` 用模块私有 `WeakMap<PoolEngine, PoolLifecycle>` 维护代际编号与销毁标记，阻止被淘汰或已销毁后的在途 `doAcquire` 回填，同时不改变 `PoolEngine` 结构接口；PTY 与 `execCommand` 统一用 `StringDecoder('utf8')` 解码。
- **WebSocket 排空恢复与扁平数组 O(1) 队列**：在 `terminal-sessions.ts` 通过 `ws.send(payload, session.onDrain)` 触发背压恢复；服务端与 `PanelController` 均以平铺数组加头指针实现 O(1) 缓冲淘汰与超限单块按码点对齐的尾部裁剪。
- **POSIX SFTP 目录缓存与窗口速率**：SFTP 统一走 `posix` 路径、`ensureRemoteDir` 单次 `stat` 快路径及单次上传前缀 `Set<string>` 缓存；`fastTransfer` 按相邻两次上报的时间窗计算 `speedBps`。
- **不可变存储写入与批量导入**：`HostStore` 全部写操作先完成全字段校验再构造新不可变对象与 `StoreFile` 快照（严格保持旧格式无 `keys` 字段）；`listKeys` 单遍 `Map` 构建反查表；`importFromSshConfig` 内存累加后单次 `save()` 并采用带进程号与随机后缀的临时文件；`routes.ts` 基于 `resolved` 判断连接失效，用无控制字符正则字面量的逐字符函数净化下载文件名，并在客户端提前断开时等待 `ReadStream` 关闭后再清理临时文件。
- **共享集群选择器与隧道 / ProxyCommand 守卫**：在 `src/engine/cluster.ts` 导出 `hasClusterSelector` 统一三处校验并保留 `result.error`；`ssh_tunnel` 与 `TunnelsTab` 正确识别 `state: 'failed'`；`tunnel.ts` 在 `forwardOut`、绑定窗口及 `stopTunnel` 检查 `socket.destroyed` 与 `record.inFlight`；`proxy-command.ts` 退出时清理升级定时器并防抖 `stdin` 错误监听。
- **客户端状态单向收敛**：`TerminalTab` 重连前无条件清 `retainedScreens`；`HostsTab` 合并挂载加载并按别名独立追踪测试态、保留搜索词；`HostFormDialog` 显式提交空串以清除可选字段；`SshApi` 与 `TunnelsTab` 保证 `onExit` 单次触发并正确中止/清理未完成传输流。

## Alternatives considered

- **直接向 `PoolEngine` 接口添加 `generation` 与 `disposed` 字段**：否决，因为测试用结构体字面量构造 `PoolEngine`，改公共字段会破坏类型兼容性；改用模块私有 `WeakMap` 保持零破坏。
- **用 `str.length * 3` 粗略估算滚动保留字节上限，或放弃终端背压暂停**：否决，粗算在纯 ASCII 与纯中文间误差三倍，不暂停会在远端高频输出时持续堆积 WebSocket 缓冲。
- **引入重型外部状态机重写连接池或客户端面板**：否决，超出缺陷定位与稳健性修复边界，局部不可变更新与守卫足够清晰且低风险。

## Consequences

- **Bench A（`HostStore.importFromSshConfig` 导入 200 个主机块到空存储）**：基线中位耗时 31.21 ms（5 次实测 `[31.47, 30.93, 30.51, 31.21, 32.45]` ms）降至中位 0.80 ms（5 次实测 `[0.75, 0.80, 0.93, 1.03, 0.56]` ms），通过批量落盘消除 199 次冗余序列化与原子重命名。
- **Bench B1（`TerminalSessionRegistry` 10,000 次 256 B UTF-8 写入）**：基线中位耗时 8.89 ms（`[10.07, 8.89, 7.92, 9.75, 7.01]` ms）变为中位 13.84 ms（`[14.40, 13.42, 13.35, 13.84, 13.95]` ms）；额外约 4.95 ms（约 0.49 us/块）来自 `StringDecoder` 流式解码与精确 UTF-8 字节计数，换取不劈裂多字节字符以及小块高频场景下的 O(1) 淘汰（70,000 次 4 B 写入耗时 24.4 ms）。
- **Bench B2（`PanelController.appendTerminalOutput` 10,000 次 256 B UTF-8 写入）**：基线中位耗时 9.14 ms（`[9.38, 9.14, 7.60, 8.24, 9.70]` ms）降至中位 1.51 ms（`[1.94, 1.82, 1.39, 1.51, 1.40]` ms），消除迭代器开销与 `Array.prototype.shift()` 头部搬移。
- **无外溢接口或翻译包耦合**：`sync-shared.mjs` 同步文件、词典文案、样式布局与 `dshSsh` 对外服务签名均保持原样。
