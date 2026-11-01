# Durable Object 汇合桥探针（非生产）

这份代码是一个测量仪器，不是设计稿：它证明「Worker 留在门口 + 按实例 id 分片的 Durable
Object 汇合桥」能承载真实的协议 v1 中继流量，并量出延迟。对应
[中继传输 v2 提案](../../.agents/notes/proposed/architecture/2026-10-23-relay-bridge-transport.zh.md)
的「最小可证伪实验」阶段 3。

## 组成

| 文件 | 角色 |
| --- | --- |
| `src/probe.ts` | 探针 Worker 与 `RelayBridge` 类，两者在同一个模块里 |
| `connector.mjs` | 本机连接器，迷你 cloudflared：WSS 连探针，把字节转到 `http://127.0.0.1:55220` |
| `probe.mjs` | 桌面测量卡：dial、hello、`session.titles` 往返中位数，以及流式到达时间 |

Worker 侧只做两件与对象无关的事：校验连接器票据，把请求按 `idFromName(PROBE_INSTANCE)`
交给该实例的对象。其余一切——HTTP、请求体、响应体、WebSocket 升级——都由对象与连接器
socket 配对后按流 id 多路复用。

手机侧的 origin 是 `wss://<worker>.1090093659.workers.dev`，路径就是协议 v1 的 `/ios/v1`。

## 帧契约

控制帧是 JSON 文本 `{t, id, ...}`，载荷帧是二进制 `[kind:u8][streamId:u32be][payload]`。

| 方向 | 帧 | 载荷 |
| --- | --- | --- |
| 对象到连接器 | `req` / `end` | `id`、`method`、`url`、`headers`；体块另行分帧 |
| 连接器到对象 | `res` / `fin` / `fail` | `id`、`status`、`headers`；体块另行分帧 |
| 对象到连接器 | `ws-open` / `close` | `id`、`url`、`headers` |
| 连接器到对象 | `ws-accept` / `ws-fail` / `ws-close` | `id`、`code`、`reason` |
| 双向 | 二进制 kind 1 / 2 / 3 | HTTP 体块 / WebSocket binary / WebSocket text（UTF-8） |

## 运行

```sh
# 1. 部署（票据只用来开一次门，见下文）
#    探针是非生产测量仪器：PROBE_INSTANCE 已在 cloudflare.config.ts 声明，不必每次给。
#    票据不进配置，先生成到文件（--text @文件 按字节原样读，写文件不要带换行），
#    部署后作为 secret 下发；每下发一次，连接器手里的旧票就作废。
printf '%s' "$(openssl rand -hex 24)" > /tmp/relay-bridge-ticket
cf deploy
cf workers secrets update CONNECTOR_TICKET --worker dsh-relay-bridge-probe --type secret_text --text @/tmp/relay-bridge-ticket

# 2. 本机连接器
PROBE_WORKER=wss://<worker>.workers.dev PROBE_INSTANCE=shadow-1 PROBE_TICKET=<票据> \
  node connector.mjs

# 3. 桌面卡
node probe.mjs wss://<worker>.workers.dev

# 4. 真机（客户端仓库的 DEBUG 驱动，只读使用）
xcrun devicectl device process launch --console --device <udid> -- \
  dev.dsh.Whale -WhaleOrigin wss://<worker>.workers.dev -WhaleSession first
```

## 两条必须记住的读数

1. **连接器不能把 `Host` 改写成回环字面量。** 宿主把 `/remote-bridge/pair/token` 的门禁
   建成「socket 地址 + `Host` 都是本机」两个条件；一个把 `Host` 改成 `127.0.0.1:55220`
   的连接器会让这个端点从公网 origin 上返回 200，而现网中继返回 403。`connector.mjs` 因此
   原样转发客户端给出的 `Host`。
2. **票据是一次性的，且一次性是对对象而言。** 对象把「票据已用」写进自己的存储，因此
   连接器重连需要换一张票**并**换一个实例 id（新对象）。本探针不测重连。
