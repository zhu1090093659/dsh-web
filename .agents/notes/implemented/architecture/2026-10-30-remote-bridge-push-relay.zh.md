# Agent Note: 推送的第二条投递路，以及私钥为什么不下发

Status: implemented

## Problem

协议 §28 的通知靠一枚 ES256 私钥（Apple 的 `.p8`）签出的 provider token 送达，而那枚私钥躺在本桥所在的那台机器上。对开发者这是合适的形状，可 iOS App 一旦上架分发就不成立了：每位用户都得有一枚 Apple 只发给一个团队的密钥，而随 App 一起下发就等于把签名凭据变成公开凭据。

中心代发是最顺的答案，但这等于在桥与手机之间插进第二个参与方，而这条通道有三条规则，随手的那个版本一定会踩到：delta 广播路径上不许 await 任何上游（§28.5）；通知载荷不许带会话内容（§28.4）；为「根本无从被告知」的手机持有认领，就是让 agent 白等（§11.3）。

## Decision

- 通道现在只站在**两条互斥的路**之一：`direct`，本机自己的密钥替 APNs 签名；`relay`，由 `account.chatwithai.icu` 用任何部署都拿不到的那一枚密钥签名。`off` 是第三种状态：既无密钥也无 relayToken，也就是从来没有配过密钥的部署一直以来的样子。本机密钥永远优先；同一个事件绝不两条路都走。
- App 从账户服务取得一枚 relayToken——作用域是 `(userId, fingerprint)`，有效期 90 天——并经由 `push.register` 的可选字段 `relayToken` 交给桥。它落在该设备自己那一行名册的 `push` 块里，名册盘上 schema 因此从 2 升到 3，只是加一个字段。版本 2 的文件读回来一个字段不少、一台手机不掉配对，下次写入时改写成版本 3。
- `src/host/relay.ts` 每个事件只 POST 一个 JSON 体到 `POST /v1/push/relay`，带 `Authorization: Bearer <relayToken>`：通知是 `{event, sessionId, title, workspace}`，实况卡是 `{event: 'live-activity', sessionId, activityId, activityEvent, contentState}`。这份契约在两仓之间已经冻结；桥不再决定 APNs 的头部、bundle、environment 和通知文案——那些由服务端按 App 直接在那边做的登记决定。
- 中心对任何结果都答 200，包括 Apple 拒收的投递：`delivered` 记真正落地的条数，`dead` 记它判死并清理掉的登记数。一条谁都没接住的投递就按失败上报，而 `dead` 经 `PushSendResult.dead` → `isDeadPushToken` → 既有 `removePush` 与 `removeLiveActivityToken` 两条路径回到名册。没有新增第二套清理机制。
- **可达性是这条路自己的问题。** `DeviceRoster.relayTargets()` 报告持有令牌的那些行，`PushNotifier.enabled` 与 `LiveActivityNotifier.enabled` 通过一个 `available` 探针读它，`BridgeHub.#questionMode()` 在中继路上数 `relayTargets()`、在直连路上数 `pushTargets()`。中继模式下没有令牌的行，是本机无从告知的手机，提问不为它认领；两条路都没有的桥，与从未配过密钥的桥一样惰性——不读目标、不看时钟、不装定时器。
- `DSH_REMOTE_BRIDGE_RELAY_URL` 可以把中心挪到别的部署，缺省是 `https://account.chatwithai.icu`。挂载日志在读成名册之后用三行之一说明自己站在哪条路上：`push: direct (APNs key <kid> of team <team>)`、`push: relay (<url>)`、`push: off (no APNs key on this machine and no paired device holds a relay token)`。
- §28.5 的纪律在两条路上都没变：广播路径上没有任何一处 await 投递，传输层解析成 `{ok: false, reason}` 而不是 reject，也不重试、不排队。一次被拒就是一行日志加一条被丢弃的事件。
- 载荷仍然不带会话内容：标题是会话自己的名字（或固定文案），workspace 是目录的短名，正文是服务端那句固定文案——与直连路一字不差，因为 `buildPushNotification` 在两条路看到它之前就已经定好了。

## Alternatives considered

- **把 `.p8` 打进 App，或者让每台手机各持一枚。** 否决：一枚 Apple provider 密钥代表的是一个团队的全部通知。放进 App bundle，它就是一枚署着 Apple 名字的公开密钥；手机持有它，就能给这个服务的每位用户铸 token。
- **让中继做直连失败之后的兜底。** 两条理由否决。开发者机器上密钥只是过期，同一事件就会被发两次；而且真正生效的是哪条路，会取决于那一秒 APNs 的脸色——这种路由，运维既读不出日志也复现不了。互斥才是让「这条事件走哪去了」始终可回答的性质。
- **按设备分流：持有令牌的行走中继，只有 APNs 令牌的行走本机密钥。** 否决：这会把「载荷与去重必须一致」的代码路径翻倍，并让同一座桥按哪台手机醒着而用两种方式投递同一个事件。一座桥，一条路。
- **让桥自己去账户服务登记设备令牌。** 否决：桥手里没有任何用户身份，而 relayToken 的作用域正是那个身份。App 本来就用它的 session bearer 跟账户服务打交道，登记该发生在那边；桥只负责携带结果。
- **在行上放一个 `relay: true` 标志，而不是读令牌是否存在。** 否决：标志会和它所描述的凭据不一致——为真却没有令牌，就是一行看着可达、实则什么都投不出去。令牌在不在，是唯一不会漂移的事实。
- **中心不可达时先把通知排队、事后再发。** 被 §28.1 否决：排队的「有待回答的问题」会在用户已经答完时才到。丢掉才是诚实的做法。

## Consequences

- 托管投递从此依赖一个本仓不运行的服务。中继故障时，没有本机密钥的机器一条通知都发不出去——这里刻意不做静默的本地兜底，因为在运维恰好持有密钥时才生效的兜底不算兜底。
- `devices.json` 多存了一枚凭据：有效期 90 天、作用域是某次配对指纹的 bearer，能让服务端向那一台手机推送。它换不到任何会话访问权，也换不到桥的访问权——它唯一能挣到的是中心的 401——但它是手机的机密而非本仓的机密，设备被撤销时随行一起消失。
- 离线提问认领现在可以凭一行 relayToken 成立，这正是目的：托管部署上休眠的手机，拿到了配密钥的机器一直就有的那个认领窗口。
- `PushSendResult` 多了可选的 `dead` 标志，让「得知某条登记已经作废」的发送方直接说出来，而不必借用它从未收到过的 APNs 状态码。两个既有调用方仍通过同一个判断函数读它。
- 包 README 并不逐条列出环境变量，因此 `DSH_REMOTE_BRIDGE_RELAY_URL` 的说明落在本文；三个 APNs 变量仍由本文所延伸的[推送记录](2026-10-21-remote-bridge-push-notifications.zh.md)承载。
