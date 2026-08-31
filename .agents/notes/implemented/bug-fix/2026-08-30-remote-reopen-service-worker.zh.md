# Agent Note: Remote reopen dead-ended on the harness browser-auth 401

Status: implemented

## Problem

手机扫码配对（隧道或局域网）之后，过一阵子再从手机打开远程界面——历史、书签、标签恢复——落到 harness 的纯文本 401 页（"dsh web authentication required; reopen the URL printed by dsh web."），Safari 有时还会把该响应下载为 `pair-app.txt`。配对本身没有失效；是重开路径在结构上就是断的。

四个事实叠加构成缺陷：

1. 应用壳的捕获脚本把地址栏 `history.replaceState` 到 `/`，于是所有持久入口（历史、书签、标签恢复、主屏）记录的都是插件不拥有的路径。
2. `/` 由 harness `frontend-static` 兜底座应答，它对每次 index/SPA 兜底文档请求强制 `authorizeIndex()`（即 harness 浏览器认证校验）。
3. 不依赖 cookie 的手机流程（[remote control reuses the official UI](../architecture/2026-08-29-remote-control-reuses-official-ui.md)）从不给手机发 harness 浏览器认证 cookie——这是刻意设计：替手机铸一枚会让孩子官方 SPA 直连 `/api`、越过连接围栏并绕开配对门，而本 cohort 没有任何组件发出 `api/gate`，停止将失去实际约束力。
4. 次生因素：配对会话空闲 7 天即被清除，因此即使收藏了 `/pair-app?device=` 链接、或重点旧的二维码链接（会回退到设备 cookie），一周不用也会失效。

已在运行中的自动隧道上实测：`GET /` 逐字返回 harness 401 文案，而带无效设备的 `/pair-app` 返回插件的双语失效页——插件路由都活着，只是重开根本到不了它们。

## Decision

应用壳现在注册一个由插件提供的**重开 service worker**：

- 新增 exact 路由 `/pair-app.sw.js`（`PAIR_PATHS.appServiceWorker`），与 `/pair-app` 同条件注册（同一个 `indexDocument` 判定），走同一条手机面向栅栏，不限流，`cache-control: no-store`，`service-worker-allowed: /`。路径位于根级，默认的脚本目录 scope 已覆盖 `/`。
- 捕获脚本（`appShellCaptureScript`）在写入设备 id 并 replaceState 到 `/` 的同一段里注册该 worker。
- Worker 行为：只拦截**对 `/` 的 GET 导航**。网络优先：携带同源凭据重新请求 `/pair-app`——配对有效则拿到当前应用壳并刷新 `lastSeenAt`（每次重开都在为会话续期）；被拒绝则把原导航放行（插件不在时由 harness 如实应答）；网络失败则回退缓存的壳（CacheStorage 中的 `dsh-remote-shell-v1`），短暂离线的打开仍能进入应用。install 预热缓存；activate 清理异名缓存并接管客户端。
- `pairingFailurePage`（配对不再有效时由 worker 在 `/` 交付）现在同时覆盖两种入口——`/pair-accept` 上的死链接、`/` 上的过期会话——并说明重新配对即可恢复。
- `DEFAULT_IDLE_EXPIRE_MS` 7 → 30 天：worker 的活跃刷新意味着只有真正弃用才会耗尽窗口，而 30 天与周边流程所依赖的浏览器凭据生命周期一致。`idleExpireMs` 配置本就存在，可按部署覆盖。
- 仅限安全上下文：纯 HTTP 局域网源永远不会注册该 worker（https/localhost 之外没有 service worker）；局域网重开意味着重新扫码。两份 README 的已知限制均已记录。

## Alternatives considered

- **地址栏留在插件自有路径**（放弃 replaceState 到 `/`）。否决：replaceState 是为了让官方 SPA 停在 canonical root；把 `/pair-app?device=` 留在地址栏会把有效设备凭据持久化进浏览器历史与同步备份——比 worker 更差的取舍，还要先做一轮未经验证的 SPA 路径兼容。
- **为配对手机铸 harness 浏览器认证 cookie**（插件可以为任意 authority 兑换启动令牌）。架构上否决：有了那枚 cookie，官方 SPA 会直连 `/api`、通过连接围栏、绕开配对门——本 cohort 没有任何组件发出 `api/gate`，停止将不再能切断设备。这正是无 cookie 设计要避免的。
- **同时拦截深层 SPA 路径**而不只是 `/`。否决：SPA 始终位于 `/`（replaceState），深层路径入口在实践中不会出现；外科手术式的拦截把对官方 UI 的影响面压到最小。
- **只写文档「坏了就重扫」。** 否决：从手机重开是这个功能的主要移动路径；每次恢复标签都确定性 401 是缺陷，不是限制。

## Consequences

- 配对有效期内，隧道（https）手机重开直接回到应用；撤销依然有牙——worker 的网络优先校验落在 `/pair-app`，被撤销设备在 `/` 看到双语重扫页。
- 每次重开多两个小的同源请求（worker 更新检查与 `/pair-app` 壳刷新），设计上均被栅栏保护且不限流。
- 纯 HTTP 局域网重开仍会撞 harness 401，需要重扫（局域网内成本很低）；已写入文档。
- 插件被禁用或卸载后，残留的 worker 把导航放行给 harness——与之前相同的死路，没有新增失败模式。
- 30 天空闲默认对新部署与既有部署一视同仁（常量供 schema 默认使用）；在 profile patch 里固定 `idleExpireMs` 的部署不受影响。

## Testing

- `tests/routes.spec.ts`：`/pair-app.sw.js` 以 `text/javascript`、`no-store`、`service-worker-allowed: /` 应答；外来 authority 403；无 index provider 时不注册；打过补丁的应用壳注册该 worker；失效页文案断言更新。
- `tests/app-sw.spec.ts`（新增）：在 mock 的 worker scope 上跑决策矩阵——处理器注册、非导航/非根请求忽略、网络优先应答与缓存刷新、拒绝时放行、离线缓存回退、空缓存放行、异名缓存清理、脚本根级路径。
- 包内 306 个测试全绿；仓库 `pnpm typecheck`、`pnpm test`、`pnpm docs:check` 通过；包内 `tsdown` 构建干净。
