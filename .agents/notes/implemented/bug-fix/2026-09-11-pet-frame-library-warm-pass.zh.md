# Agent Note: Pet frames2d warm pass decoded the whole frame library

Status: implemented

Supersession check: 当前活跃 note 中没有负责宠物渲染器帧加载的记录。[Combined-plugin DOM mutation cost](2026-09-11-combined-plugin-mutation-cost.md) 负责的是逐 mutation 的 observer 扇出，未触及宠物自身的启动成本；已退役的 dsh-perf 系列记录的是官方渲染管线，而非插件资产加载。

## Problem

`frames2d` 在挂载时遍历配置中的每一条 track 来预热解码缓存（在 phase 可达 id 之后又追加 `Object.keys(config.tracks)`）。实际发布的宠物远不止几条循环：仓库内置的 `jyn` 拥有 16 条 track / 1164 帧 / 82.6 MB 的 512x683 webp 缩略帧，其中 7 条 track 属于只有用户主动切换皮肤后才会播放的皮肤。

在一次临时 DSH Web 宿主上实测（使用本地 workspace profile、系统分配端口、无头 Chromium 1440x900、宠物 `jyn` 且激活 `orca-link` 皮肤，resource timing 缓冲提升到 8000 条）：挂载后的前 5 秒内页面就拉取了 **1145 帧宠物帧 / 78.9 MB**，整页 decoded 负载达到 **96.0 MB**，并随播放持续小幅增长。所有预热过的帧都会在页面生命周期内常驻解码缓存，因此常驻集合是上千张 512x683 图像（每张约 1.4 MB，尚未计入浏览器侧淘汰），而且这次预热发生在启动阶段：两个启动长任务（65 ms、192 ms）中包含渲染器的 `createImageBitmap`/`decodeFrame` 工作。

## Decision

- **用 `prefetchAhead` 取代整库预热**（`packages/dsh-pet/src/client/renderers/frames2d.ts`）。每绘制一帧，只为当前真正在播放的 track 追加最多 `PREFETCH_AHEAD`（12）帧的预取；原有并发池仍把解码并发限制在 8。
- **未播放的 track 与未选中的皮肤不再被预取。** 相位切换、玩法覆盖或皮肤选择都会立即播放：`paintCanvas` 仍以 `jump = true` 请求首帧，把该帧插到预取积压之前，随后的 look-ahead 窗口再跟上新 track。
- 经典 `<img>` 回退路径保持同样有界的行为（其 `loadFrame` 通过 `Image` 回退解码），两条路径都不会退回无界预热。

## Measured effect

同一宿主、同一页面，`[data-dsh-frame]` 出现后前 5 秒的宠物帧流量：

| 指标 | 改动前 | 改动后 | 变化 |
| --- | --- | --- | --- |
| 宠物帧请求数 | 1145 | 98 | -91% |
| 宠物帧解码字节 | 78.9 MB | 5.26 MB | -93% |
| 整页解码负载 | 96.0 MB | 22.4 MB | -77% |

剩余的 5.3 MB 就是可见动画本身：播放会走完 78 帧的 idle track，look-ahead 窗口随之跟进，所以 idle 循环保持热态，其余 15 条 track 留在磁盘上。5 秒到 30 秒的流量持平（改动前 1145 增至 1158，改动后 98 增至 111）。

同一页面上的行为校验：`canvas[data-dsh-pet-frames2d]` 以 512x683 渲染，间隔 1.5 秒采样的三次像素哈希互不相同，说明播放仍在推进；无 `pageerror`、无控制台错误。

## Alternatives considered

- **保留整库预热。** 否决：它就是被测出的成本，而且 16 条 track 中有 7 条不切换皮肤根本无法播放。
- **只预热相位可达与玩法可达的 track。** 否决：收益不足——对本宠物仍要在挂载时预热约 44 MB / 605 帧；而玩法/覆盖 track 集合是在播放时依据 manifest 与所选皮肤解析的，挂载时并不存在可静态枚举的"可达集合"。
- **保留预热但推迟到 `requestIdleCallback`。** 否决：只是把突发挪出关键路径，并未减少——同样的 82 MB 与同样的上千张常驻位图依旧会到达。
- **用 LRU 上限淘汰已解码位图。** 本次否决：渲染器成立的热路径前提是"只解码一次，之后只绘制"，淘汰会导致每轮循环重新解码。当前常驻内存已收敛到真正播放过的 track；若单条播放 track 本身就过大，作为后续跟进问题。
- **在空闲时预热下一个相位的 track。** 在该窗口尺寸下不需要：切换会立即请求首帧，其后 12 帧的 look-ahead 足以覆盖。

## Consequences

- 宠物的启动成本从此与屏幕上播放的动画相关，而不是与已安装宠物库的体积相关。
- 从未播放过的 track 在切换时会为首帧付出一次 fetch + decode（同源，首次播放后走 HTTP 缓存）。队列插队保证该帧优先于预取积压，look-ahead 窗口覆盖其后各帧。
- 已重建 `packages/dsh-pet/lib` 与 `packages/dsh-web-all/lib`（聚合包内联了家族 client 源码）。正在运行的 DSH 服务在重启前仍会提供旧 bundle。
- 测量环境：临时 `dsh --profile web --port 0` 宿主，`DSH_HOME` 指向一个临时目录，其中 `profiles/web` 软链到真实 profile，并复制 `pet.json` / `skin-center-active.json`、软链 `skins/` 目录。3080 端口上正在运行的服务全程未被触碰。

## Testing

- `packages/dsh-pet/src/client/renderers/frames2d.test.ts`：有界窗口用例改为断言"首帧 + 12 帧 look-ahead"（13 张位图），不再断言整条 24 帧 track；新增用例断言挂载只拉取正在播放的 track，且选择皮肤只拉该皮肤的 track；插队与失败重试用例保留原有断言并更新注释。`packages/dsh-pet` 41 个文件 / 493 个用例全绿，`pnpm typecheck` 通过。

局限：测量环境是无头临时宿主而非运行中的 GUI，且常驻位图的 GPU 纹理内存未直接测量——只测了 fetch/decode 流量。
