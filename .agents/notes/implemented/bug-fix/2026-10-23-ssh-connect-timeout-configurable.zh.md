# Agent Note: SSH 连接超时可配置，并指明卡住的阶段（issue #1931）

Status: implemented

## Problem

dsh-ssh 把 `DEFAULTS.connectTimeoutMs` 固定为 15000 毫秒，并直接传给 ssh2 的 `readyTimeout`；该超时覆盖连接就绪前的整段流程：TCP 连接、SSH 密钥交换与用户认证。某台主机密码认证约需 20 秒——banner 与密钥交换都在 1 秒内完成——却在 15 秒时以 ssh2 的 "Timed out while waiting for handshake" 失败，而服务端稍后其实接受了凭据。`SshEngine` 以 `new SshEngine(store)` 构造，插件配置与主机条目都无法改变该值，而 `ssh_exec` 的 `timeoutMs` 只约束连接就绪后的远程命令。唯一补救办法是改源码。

错误文案加重了误判：ssh2 对三个阶段的超时使用同一句话，于是认证卡顿看起来像握手损坏或端口不可达。

## Decision

`connectTimeoutMs` 是一个插件配置字段，而不是按主机覆盖。它与其他 dsh-ssh 设置一样是 `volatile()`，默认 `DEFAULT_CONNECT_TIMEOUT_MS`（30000），允许 1000-600000 毫秒。`apply()` 通过实时配置引用把它交给引擎构造函数，`loader/volatile-update` 调用 `SshEngine.setConnectTimeout()`，因此设置编辑无需重新挂载即可到达运行中的实例。该值写入 `engine.opts.connectTimeoutMs`——所有连接路径本来就通过 `connectChain` / `buildConnectConfig` 读取的同一个对象；exec、PTY、SFTP、隧道与集群执行因此天然共享它。

默认值从 15 秒提高到 30 秒。报告中的主机约需 20 秒，30 秒留出余量，又不至于让不可达主机像卡住一分钟。

`connectClient` 记录 ssh2 是否发出过 `handshake`（密钥交换完成），并在失败为 ssh2 的 `client-timeout` 时，把文案换成能指明阶段的版本，点明共享预算与该设置。握手前文案指明 TCP 连接或密钥交换；握手后指明用户认证。TCP 连接与密钥交换不再细分，因为 ssh2 在 TCP socket 与完成握手之间没有公开事件——唯一信号是私有的 `_sock`，本决策明确不依赖它。

## Alternatives considered

- 在 `dsh-ssh.json` 中按主机保存 `connectTimeoutMs` 并加表单字段。暂缓而非否决：对混合清单更灵活，但为一个插件级上限已解决的问题新增存储字段、校验、PATCH 语义、投影与表单/i18n 面。引擎按每次连接读取该值，因此日后可在不改动本决策的前提下加入主机覆盖。
- 只把默认值提高到 30 秒并保持固定。否决：PAM / LDAP 更慢的主机会在另一个数字上撞同一堵墙，而 issue 的核心正是操作者无法调整客户端。
- 复用 `ssh_exec` 的 `timeoutMs` 覆盖连接阶段。否决：该参数是单命令预算，计时从通道打开后才开始；把它扩展到连接/认证会让长命令与慢登录无法区分，并改变既有的工具契约。
- 通过 `client._sock` 把 TCP 连接、密钥交换与认证拆成三条文案。否决：依赖 ssh2 未文档化的字段，而两阶段拆分已经消除了报告遭受的误判（认证卡顿被标成握手）。
- 在工具面上提供按连接的 `readyTimeout` 覆盖。否决：Agent 不能配置主机，按调用覆盖会让命令的等待时间悄悄远超操作者设置的预期。

## Consequences

- 存量主机的上限从 15 秒变为 30 秒。不可达主机报超时的时间翻倍，用户可把设置调回旧值。
- 设置编辑对之后建立的连接生效。池化连接在断开或被丢弃前继续服务；该超时只约束连接路径。
- 超时文案点明阶段与设置。匹配该路径 ssh2 原文的代码或支持材料不再成立。
- `ssh_exec` 与 `ssh_cluster` 的工具描述写明其 `timeoutMs` 从连接就绪后开始，且不会延长 `connectTimeoutMs`。
- README（中英）承载用户侧配置契约；本记录承载取舍理由。

## Testing

- `tests/connection-pool.test.ts` 固定 30 秒默认值、`handshake` 之后的认证阶段超时、其之前的连接/密钥交换阶段超时，并保持非超时错误原样。
- `tests/engine.test.ts` 验证 `setConnectTimeout()` 更新之后连接所读取的选项对象。
- `tests/announce-default.spec.ts` 与 `tests/settings-surfaces.spec.ts` 固定 schema 默认值与 `connectTimeoutMs` 的 volatile（设置页）状态。
- 包测试（`pnpm --filter @linxin666/dsh-ssh test`）、包 `typecheck` 与 `build` 在本次改动上通过。
