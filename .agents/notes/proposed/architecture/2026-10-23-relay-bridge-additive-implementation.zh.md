# Agent Note: 汇合桥的附加式实现——按实例 mode、长活凭据、对象侧换 socket

Status: proposed（已实现并有测试，尚未部署）

本文是[中继传输 v2 提案](2026-10-23-relay-bridge-transport.zh.md)的实现记录。那份设计定的机制在这一轮落成了可合并的代码；设计与它的读数仍然是权威，本文只记录落地时定下的实现决策、与设计的偏差、以及验收证据。

## 落在哪里

| 位置 | 内容 |
| --- | --- |
| `market/worker/migrations/0010_relay_lease_mode.sql` | `relay_leases.mode`，缺省 `quick`，翻转一个实例就是一行 UPDATE |
| `market/worker/src/relay-bridge.js` | `RelayBridge`（对象）与 `/api/relay/bridge` 的门（凭据校验、窗口限流、attach 标记） |
| `market/worker/src/relay.js` | `bridgeModeOf` 与数据面分流；quick 分支只在末尾多了回退标记两行 |
| `market/worker/src/relay-control.js` | claim 应答带该实例的 `mode` 与桥端点；bridge 模式的 claim 不收敛隧道、ingress 与 CNAME，一次 Cloudflare 调用都不发 |
| `market/worker/cloudflare.config.ts` | `RELAY_BRIDGE` 命名空间与 `RelayBridge` 类账本 |
| `packages/dsh-remote-web-ui/src/relay-bridge-connector.ts` | 插件侧连接器，从 `probe/relay-bridge/connector.mjs` 长出，与 quick 连接器并存 |
| `packages/dsh-remote-web-ui/src/relay-connector.ts` | claim 成功后启动桥、释放与销毁时停止 |
| `scripts/market-relay-bridge.test.mjs`、`packages/dsh-remote-web-ui/tests/relay-bridge-connector.spec.ts` | 新行为的测试 |

## 三个实现决策

1. **桥的凭据就是租约自己的 id 与 secret。** 设计只要求「长活凭据」，没有要求新铸一枚：id/secret 已经是实例唯一长期持有的一对，服务端只存 SHA-256 哈希、常量时间比较、限流窗口与注册端点共用。它放在升级请求的 `authorization: Bearer <secret>` 头里而不是 URL 里，claim 应答也只点名凭据形态（`credential: 'lease-secret'`）而不回声 secret——响应体里再放一份秘密没有收益，只有泄露面。推翻条件：若某天租约 secret 需要独立于 quick 路径旋转或吊销，就必须另铸一枚只服务桥的凭据。
2. **同凭据并发多连时最新的一连赢。** 对象的 attach 顶掉旧 socket（旧连接收 `1000 replaced`），旧 socket 上多路复用的流立刻失败（那个连接器已经不持有它们，继续等只会耗到 60 秒的头超时），新 socket 已经开始的流不受影响。因此「发布等于全网 socket 滚动重连」在对象侧是安全的：连接器用同一凭据重连即可，不需要新票、不需要新实例。
3. **mode 单独读，读不到就是 quick。** 设计说「只多读一列」，实现上是每个中继请求多一次 D1 读，换来部署顺序上的安全：Worker 若先于 0010 迁移上线，`SELECT mode` 失败只会让该请求留在 quick，而不是把整片中继答成 503。这一条是刻意的取舍，不是疏忽。

## 与设计的偏差

- 设计写 `relay_registrations` 增加 `mode` 列，本轮把 `mode` 放在租约表 `relay_leases`（claim 写的那张）。代价即上面第 3 条的那次额外读。
- 设计的观察面含「每 60 秒用 `getWebSockets().length` 采样」。采样需要一个 alarm，那是另一个生命周期与计费决策，本轮只落了 `x-relay-transport`、`x-relay-fallback` 与结构化日志（`bridge-attach` / `bridge-done` / `bridge-failed`）。
- 设计里的「转发的 `cf-ray`」未实现：响应上重复边缘自己已经给过的 `cf-ray` 没有收益。
- 设计写「Worker 把整个 Request 交给对象」。实现上对象把公开 origin 写进 `req` 帧的 `host` 字段，而不是依赖 `Host` 头穿过对象：Workers 里 Host 不能作为可信来源，而连接器必须拿到的是手机拨的公开 origin，不能是它自己上游拨的回环 authority。
- claim 应答不回声 secret（见决策 1）。

## 测试钉住的行为

- quick 实例照旧走 `*.trycloudflare.com`，且一次也不碰对象（现有测试全绿 + 代理分支只多两行）。
- bridge 实例由该实例的对象应答，响应带 `x-relay-transport: bridge`，quick 隧道一次也不拨。
- 对象在无 socket 时回 `409 no-connector`，Worker 在同一次请求里退回 quick，并给响应打 `x-relay-fallback: no-connector`。
- bridge 模式的 claim 一次 Cloudflare 调用都不发、应答里没有 `tunnel` 块；quick 的 claim 仍保持它原本的隧道加 CNAME 收敛顺序。
- 租约表读不出 mode（迁移未上）时留在 quick，不 503。
- 下游请求无法把自己伪装成连接器 attach（标记头在代理路径被剥掉）。
- 桥的门：非升级 426、未知 id 与错误 secret 一律 403、窗口超限 429，通过后才按 id 命名对象。
- 对象把公开 origin 写进 `req` 帧，含 `127.0.0.1` 的字面量不出现。
- 第二次 attach 顶掉第一次：旧 socket `1000 replaced`，请求只走新 socket。
- 连接器侧：连接器原样转发公开 origin 作 `Host`（本地控制面因此 403，而同一上游用回环 Host 直问会 200——这条差异就是连接器不能改写 Host 的全部理由）；无 `host` 时回退到实例自己的中继主机名；重连沿用同一凭据、两次 attach 的 `authorization` 相同；手机 WebSocket 经连接器往返。

## 验收读数

本地（`wrangler dev --local` 起真 Worker + 真对象，连接器是插件里的那个，上游是本机 DSH 宿主；`mode=bridge`）：`/remote-bridge/pair/token` 返回 `403`（`the request names a Host that is not this machine`，`x-relay-transport: bridge`），`/` 返回 `401`，WebSocket dial 14.9 ms、hello 5.0 ms（`auth: unpaired`）、后续请求往返中位 0.8 ms。

边缘（`dsh-relay-bridge-staging.1090093659.workers.dev`，跑完即删）：错误 secret 的升级 `403`、正确凭据的升级拿到 `101` 并让连接器进入 connected。数据面在 `workers.dev` 上无法验：`relayIdOf` 只认 `<id>.dsh-market.com`，而给 `workers.dev` 主机发一个不匹配的 `Host` 会被边缘直接 `403`。

## 上生产前还缺什么

- 按实例翻 `mode`（先 1%，再按 `last_seen_at` 分批），每批一行 UPDATE。
- 真实边缘上带中继主机名的数据面验证，需要一次带自定义域名的非生产飞行，或直接灰度第一台。
- 单对象可持 socket 数、每请求唤醒时长的实测（设计阶段 3 的剩余项）。
