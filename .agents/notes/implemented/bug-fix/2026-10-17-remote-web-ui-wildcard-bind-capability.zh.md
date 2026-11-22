# Agent Note: 局域网绑定块先问已安装的宿主接受哪些绑定地址

Status: implemented

由 [局域网转发器](../architecture/2026-10-20-lan-forwarder-replaces-bind-block.md) 部分取代：受管块已移除，能力探测现在决定运行时转发器可以监听哪个局域网地址、以及状态帧报告什么。这里记录的决策——先问已安装宿主接受哪些绑定、而不是猜——依然成立。

## Problem

`packages/dsh-remote-web-ui` 把局域网绑定开关实现为 profile `cordis.patch.yml`
里的一个受管块，开启态固定写入 `host: '0.0.0.0'`。自
`@deepseek-ai/dsh-host-webserver@0.2.1-rc.2` 起，webserver 的 `Config` schema
拒绝通配地址，该块因此被配置校验拒绝，此后每次 `dsh web` 启动都会失败
（issue #1893）。直接在已安装模块上调用 schema，即可得到这张接受表：

| `host` 取值 | 已安装 0.2.1-rc.2 的 `WebServer.Config({ host, port })` |
| --- | --- |
| `127.0.0.1` | 接受 |
| `::1` | 接受 |
| `192.168.1.5` | 接受 |
| `0.0.0.0` | 拒绝：`host "0.0.0.0" is an unspecified (wildcard) address, which is not supported` |
| `::` | 拒绝：同一条「未指定（通配）地址」拒绝 |
| `localhost` | 拒绝：`host "localhost" is not a concrete IPv4 or IPv6 address literal` |
| `example.com` | 拒绝：不是具体的 IPv4 或 IPv6 地址字面量 |

该块于是成了启动砖，而之所以插件无法自行脱困，来自已发布形态的三处性质：

- **插件只在 webserver 之后加载。** `src/index.ts` 声明
  `inject = ['webServer', 'typertGateway', 'connection']`，该行要等 webserver
  才挂载——而 webserver 再也起不来。重写该块的启动重断言、设置卡片与状态端点
  全在同一条注入边之后；本插件没有任何代码在拒绝发生之前跑过。
- **`disabled: true` 无济于事。** 被拒的字面量落在本插件先前写入的独立
  `- id: webserver` 行里。禁用插件行只是拿走了那行唯一的写者，行本身仍在
  原地，仍然固定着 schema 拒绝的值。
- **声明的主机下限恰好就是拒绝该块的那条线。**
  `peerDependencies['@deepseek-ai/dsh']` 与 `dsh.engines.dsh` 都写着
  `>=0.2.1-rc.2`（[dsh host floor tracks cohort](../architecture/2026-09-01-dsh-host-floor-tracks-cohort.zh.md)），
  于是在更早的线上合法固定过 `0.0.0.0` 的 profile，什么都没做错就升级进了这个
  状态。修复必须在本包声明的 cohort 之内成立，不能指望它之上。

CLI 的 `--host` 旗标喂的是同一个 `Config`，所以本 cohort 上
`dsh web --host 0.0.0.0` 同样被拒：通配字面量在插件与运维者手上的每条路径都
不可达。把本包带到这条线上的 cohort 迁移
（[SDK cohort 0.2.1-rc.2](../architecture/2026-10-17-sdk-cohort-0.2.1-rc.2.zh.md)）
适配了 webserver 的 `port` getter，未审查绑定守卫；本记录记下绑定的那一半。

## Decision

[归属记录](../architecture/2026-08-29-remote-control-reuses-official-ui.zh.md)
继续拥有受管块设计——标记、剥离重写、静态取值、同 id 整行替换、启动重断言与
`pendingRestart` 比较全部不变。本记录只取代其中的一个前提：该块可以固定通配
字面量 `0.0.0.0`。

- **对已安装 schema 做能力探测。** 记忆化的 `wildcardBindSupported()` 直接问
  已安装的 `@deepseek-ai/dsh-host-webserver` 模块自己的 `Config` 是否接受通配
  字面量；模块无法被询问时（导入失败、抛出意料之外的错误）回答 false。宿主自己
  的 schema 是唯一不会与宿主漂移的权威，无论这条线叫什么名字。
- **两个构建入口都让该模块保持外置。** `tsdown.prepare.config.ts` 直接重导出 `tsdown.config.ts`，而不是重新调用一遍 `clientBundle`，因此开发、npm 与 git 安装构建共用同一份 external 清单。发布的插件不再捆绑 `WebServer`/`writeResponse` 实现（issue #2082）。
- **块只固定宿主接受的值。** `desiredBindHost(lanBind, startupHost, capability)`
  按此顺序判定：开关关闭时为 `127.0.0.1`；CLI `--host` 是具体地址字面量时用它；
  仅当探测报告支持通配时才用 `0.0.0.0`；否则用本机第一个可通告的局域网 IPv4——
  `src/lan.ts` 里 `lanIPv4Addresses()` 的首个候选，与二维码和控制台那行用的是同
  一个接口顺序；该列表为空时为 `undefined`。
- **拒绝写入，而不是拒绝启动。** 判定为 `undefined` 时完全不写块，并带着原因报告
  `lanBlocked`，而不是固定一个下次启动会被拒的字面量。在拒绝通配的宿主上，
  没有局域网地址的机器得到一张诚实的卡片，而不是一个再也起不来的 profile。
- **「非回环」取代 `=== '0.0.0.0'` 成为可达性判据。** GUI 是否在局域网上，由绑定的
  主机不是回环字面量决定，而不是与通配字面量相等：`lanBases`、状态里的
  `lanUrls`、防火墙摘要与启动时的局域网暴露警告全部改以此为据。具体接口绑定与
  全接口绑定对局域网的暴露是同一回事，旧判据会让本 cohort 唯一允许的绑定静默
  失去局域网可达性。
- **状态帧如实陈述能力。** 新增 `desiredHost`、`wildcardSupported`、
  `supportedHosts` 与 `lanBlocked`，设置卡片因此能说明将固定哪个地址、宿主拒绝
  通配、以及为什么什么都没能固定——而不是提供一个悄悄无效的开关。
- **关闭态仍然固定 `127.0.0.1`。** 同 id 补丁行整对象替换该行的 `config`，所以块
  依旧完整且为静态值，带着官方行的压缩键，开关往返的重放照旧可用。
- **遗留的 `0.0.0.0` 块需要一次手工清理。** 那份 profile 无法由插件修复，理由与
  它无法启动相同，且本版本的任何一次启动都不会重写它。文档化的编辑只删除两行
  标记与 `- id: webserver` 项——这正是 `stripManagedBlock` 一直采用的纪律。经
  YAML 文档 API 追加的行会落在标记区域内，删掉整段区域会把用户自己的行一并带走
  （[位移标记修复](2026-09-06-issues-1389-1390-1381-fixes.zh.md)）。

## Alternatives considered

- **用主机版本与 `0.2.1-rc.2` 比较。** 否决：拒绝是某一个 schema 的性质，不是版本
  事实。比较法必须自己正确建模预发布排序（普通字符串比较会把 `rc.10` 排在
  `rc.2` 之前），每个 cohort 边界都要重新学习一遍，而且对按版本字符串之外的
  方式打补丁或钉定的宿主仍然是错的。已安装模块可以一次调用回答真正的问题。
- **读已发布的 `Config` schema 文本或地址守卫，而不是执行它。** 否决：已发布的
  `lib/index.js` 是打好的 bundle，其中的文案不是契约，匹配源码或错误文本会把
  修复绑死在某一种构建形态上。该模块确实导出了若干主机谓词
  （`isWildcardHost`、`isLoopbackHost`、`normalizeBindAddress`、`bindUrlHost`），
  但它们描述的是地址类别，而接受与否由 schema 判定——包括文本匹配会判错的映射
  形式与回环形式。执行 `Config` 才能对块将要写入的那个确切取值给出答案。
- **保留 `0.0.0.0`，只在之后拒绝启动（issue 的方案 2）。** 半留半弃：「不让 profile
  变砖」的那一半以提早拒绝与显式的 `lanBlocked` 报告活了下来，「保留通配」的那一半被弃掉，
  因为本 cohort 上没有任何宿主接受它。保留该字面量只会保证局域网访问永远不成立，
  并把同一次失败挪到更糟的时刻。
- **原样继承 CLI 的 `--host`。** 否决：旗标是启动事实，不是能力事实，而
  `--host 0.0.0.0` 喂的是同一个 schema——原样继承等于复制那块砖。判定保留有用的
  那一半（运维者明确要求的具数字面量获胜），弃掉不可能成立的那一半。
- **完全不再写块，要求运维者自行绑定。** 否决：那是删除开关而不是修复开关。卡片
  存在的意义就是让不懂 CLI 的人能打开局域网访问，而要求手工
  `--host <地址>` 会让卡片无事可做。判定只在真正没有地址的机器上落到同样的
  「不写块」结局，并且如实说出来。
- **把块的迁移搬到另一个启动阶段——一个先于 webserver 加载的 cordis 插件。** 否决：
  profile 补丁是组合的输入，同一次启动里更早执行的改写，发生在那条被拒的行已经
  被读取并校验之后；而为了执行一次同启动顺序根本交付不了的修复再多发一个插件包
  没有意义。在宿主层面迁移用户 profile 不是本仓库的表面。

## Consequences

- 本 cohort 上的局域网访问需要一个具体接口地址。DHCP 租约变更挪动了机器地址时，
  需要再做一轮开关或启动，因为块固定的是一个字面量。
- 多网卡机器只固定一个地址：首个可通告候选，即 `lanIPv4Addresses()` 已用的同一
  顺序。旧的通配绑定下每个接口都应答；现在其余接口不再应答，对外通告的局域网
  URL 也只写被固定的那个地址。
- 遗留的 `0.0.0.0` 块仍需要上文描述的那次手工清理；本版本没有任何一次启动能修复
  它，而插件自己的写者永远不会去动一个它没有计划过的块。
- 本 cohort 上 CLI `--host 0.0.0.0` 这条路径已经消失，包的 README 如实说明：
  刻意的局域网暴露经设置卡片发生，由它固定具体地址。
- 状态帧新增四个字段。卡片读取它们来解释一台被拦下的机器，三份语言字典承载这份
  说明。
- 下一个宿主 cohort 只要发布接受通配的 schema，就能恢复通配绑定：探测跟随 schema，
  本记录的判定无需新增分支。

## Testing

- `## Problem` 里的接受表是实测而非推断：在 `packages/dsh-remote-web-ui` 内解析到
  的已安装 `@deepseek-ai/dsh-host-webserver@0.2.1-rc.2` 的
  `WebServer.Config({ host, port })` 接受 `127.0.0.1`、`::1` 与 `192.168.1.5`，
  并以所引原文拒绝 `0.0.0.0`、`::`、`localhost` 与 `example.com`。
- `desiredBindHost` 是纯函数，其直接单测覆盖已在 `tests/lan-bind-plan.spec.ts`
  中钉住；能力与地址列表两个入参扩展的是那份覆盖，而不是新增测试接缝。
- `tests/host-bind-capability.spec.ts` 还会解析 prepare 构建并钉住宿主 webserver 的 external；prepare 构建本身验证产物的 host bundle 导入该包，而不是定义 `WebServer` 或 `writeResponse`。
- 三份语言字典（zh、en、ru）与卡片文案由 `pnpm i18n:check` 覆盖；宿主半边的包内
  通道是 `pnpm --filter @linxin666/dsh-remote-web-ui test` 加 `pnpm typecheck`。
