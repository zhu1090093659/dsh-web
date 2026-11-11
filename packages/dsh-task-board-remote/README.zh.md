# dsh-task-board-remote · DeepSeek Harness (DSH) 任务看板的远端面

[English](README.md) | 中文

`@linxin666/dsh-task-board-remote` 把 dsh Web GUI 的任务看板放到远端面上。它是宿主半区，把看板的能力面接到 `@linxin666/dsh-remote-bridge` 的通用扩展缝上，因此已配对的手机读写的是浏览器读写的那同一份宿主账本——没有第二份权威，没有两套数据之间的同步协议，也没有自己的 HTTP 面。

## 功能

- **三个方法。** `board.snapshot` 逐字转发宿主快照；`board.options` 给出宿主模型目录以及看板的实时 meta；`board.apply` 把一个动作交给宿主自己的 `apply`。
- **一个主题。** `board.changed` 告诉声明了该能力的已配对手机「有变更」，载荷只有 revision。
- **判定归宿主。** 运行中锁、高权限绑定的人工确认门、子任务深度、调度次数预算，全部留在原处。拒绝就是宿主自己那句话，以 `board-refused` 穿过。
- **退化而不是失败。** 该行不声明任何注入服务：宿主没有桥、或没有看板时照常启动，只失去这一面。
- **桥里没有业务词。** 方法名、载荷、主题与错误码都在本包里；桥只负责分派与投递它拿到的东西。

## 前置

- `@linxin666/dsh-remote-bridge` 提供扩展缝与配对设备协议。
- `@linxin666/dsh-task-board` 提供看板能力面。

两者都不是硬依赖。任一缺席时本行什么都不注册，宿主不受影响。

## 线路面

| 方法 | 请求 `p` | 响应 `r` |
| --- | --- | --- |
| `board.snapshot` | `{}` 或 `{since}` | `{mode:"reset", token, snapshot, revision, tasks}`——宿主快照逐字转发外加增量键——或 `{mode:"delta", token, revision, changed, removed}` |
| `board.options` | `{}` | `{catalog, meta:{sessionDefaultPermission?, cardDefaults?, maxSubtaskDepth?}}` |
| `board.apply` | `{requestId, action}` | `{snapshot, revision}` |

客户端在 `hello` 的 `cap` 数组里声明 `board.v1`。未声明时三个方法回 `unknown-method`——方法对它而言不属于协议——主题也永不到达它。

另外声明了桥的 `delta.v1` 的客户端，可以把上一次应答的 `token` 当作 `since` 发回来，只会收到动了的部分——`mode:"delta"` 带 `changed` 与 `removed` 里的 id——或者在增量并不明显更小时再收一次整份看板。这件事的判定全归桥（协议 v1 §15）：本行只把看板自己的行交给它，并把应答包成看板的形状。什么都没声明、或没带令牌的客户端永远收到 `mode:"reset"` 与空 `token`，而它读的 `snapshot` 逐字未变——增量键都是可加可忽略的。配对判定在前，与协议方法完全一致。

`action` 是看板动作自身的 JSON 形态（`create`、`update`、`move`、`archive`、`restore`、`delete`、`settle`、`record-external-outcome`、`extension-action` 等），逐字穿过。不传 initiator：看板把该字段定义为发起动作的 DSH 会话 id，而手机不是会话——塞一个替身会把非会话身份写进执行审计，而工作区继承查询也把它当会话 id 读。

## 事件

| 主题 | 载荷 |
| --- | --- |
| `board.changed` | `{revision}` |

一波宿主通知合并为一帧，载荷永不携带任务表：客户端自己去取 `board.snapshot`，与浏览器半区对自己那条流的策略相同。revision 在投递时经一次快照读出，因为看板不提供只读 revision 的入口。

## 幂等与 revision

`requestId` 是幂等键，作用域为一条连接。同一个键重复调用直接回上一次的响应，不再施加动作。上一次回的是 `board-unavailable` 的键会被刻意遗忘，因为什么都没被施加，重试必须允许成功。客户端每次施加动作都要换新键。

revision 是落后检测，不是乐观锁：本地 revision 落后于事件的客户端先重取快照，宿主不会因为版本旧就拒绝写入。冲突按最后写入胜处理，客户端不得编造「他人正在编辑」的互斥状态。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `board-unavailable` | 看板未挂载、读取失败，或全量快照无法装进一帧 |
| `board-refused` | 宿主拒绝了该动作；`msg` 是宿主原文 |
| `invalid-args` | 请求信封不可用；什么都没到宿主 |
| `unknown-method` | 本客户端从未声明 `board.v1`，或该名字不属于本面 |
| `unpaired` | 本连接没有设备令牌 |

## 安装

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-task-board-remote
```

bundle patch 插入一行宿主半区。它没有 `disabled` 开关：两个服务都不在时它什么都不注册，否则运维还得记着去关掉一行。

## 已知限制

- 全量快照没有分页。任务大到超过 10 MiB 帧上限的看板只回 `board-unavailable`，客户端无法索取分片。
- 事件只说「有变更」，不说变了什么：每次刷新都是全量重取，宿主不提供增量。
- 为一个事件读取 revision 要付出一份完整快照的代价，因此超大看板的每一波合并投递都要做一次深拷贝。
- `board.options` 给出宿主此刻解析出的模型目录，客户端不得长期缓存。
