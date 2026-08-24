# 决策备忘录：配对手机即全量 /api 凭证（2026-08-23）

冻结记录一次安全语义审查的结论与候选方案。本备忘录不改代码、不改长期文档，仅把决策输入存档，供人工决策（见文末「需人工决策」）。历史快照，不修改长期文档。

## 结论先行

配对设备 cookie 是「SDK 特权集之外的全量 /api 凭证」：它通过本插件的 api/gate 后直达宿主 ApiProxy，任何方法（会话、工作区及宿主暴露的其他域）都可用；`/m/api` 白名单只约束手机 UI 自己走的那条代理通道，不约束该 cookie 的凭证效力。特权 15 方法（settings.*、credentials.*、agentPreset.*、host.pickDirectory/openPath、llm.discoverModels）由安装的 SDK 自己在 /api 桥上钉死为仅 loopback，因此「全量」的实际下限是这 15 项之外的一切（含完整会话控制权）。

与桌面 /remote 通道的声明不一致：/remote 通道把请求改写成回环形状再转发，会骗过 SDK 的 loopback 检查，所以它必须自带 loopback-only 拒绝；而手机直连 /api 保留原始 Host，拒绝由 SDK 原生提供。结果是同一枚凭证在两条通道上的声明强度不同（手机被描述为「受白名单限制、特权域不可达」，实际凭证未按域裁剪），且没有任何一方声明「第三方客户端拿 cookie 直连 /api」这一面的边界。

攻击路径成立的前提是 /api Host 围栏对该 origin 打开（`--host 0.0.0.0` 时 SDK 自动信任局域网字面量，或配置了 `--trusted-host`）；在该姿态下，LAN 明文嗅探无 Secure 属性的 cookie 即获得会话级控制权。威胁不是「管理后台被改」，而是「会话与 agent 控制权被接管」；最高价值的 settings/credentials 面由 SDK 兜底，本插件对此没有声明。

## 问题陈述与证据

### 1. /m/api 白名单只约束该代理，注释自认凭证是全量

- [mobile-api.ts](../../packages/dsh-remote-web-ui/src/mobile-api.ts) 31-38：注释原文「the paired-device cookie also passes the global api/gate for the full ApiProxy surface (gate.ts), so a paired phone is a full-control credential: the allowlist only constrains this /m/api proxy, not the cookie's reach.」——插件自身已承认该事实。
- 38-50：`MOBILE_ALLOWLIST` 仅 10 个方法（workspace.list、agentPreset.list、session.create/list/history/search/prompt/models/selectModel/rename），加上本地应答的 `mobile.preferences`（57 行）。
- 151-153：白名单外的方法在 /m/api 上 403（`method ${method} is not exposed to the mobile surface`）。
- 9-19（头注释安全模型）：宣称「privileged domains (settings, credentials, host actions, goals, subagents, …) are never reachable from the phone」——只对 /m/api 代理面成立，与 31-38 的自认矛盾。

### 2. api/gate：配对 cookie 通过全量 /api

- [gate.ts](../../packages/dsh-remote-web-ui/src/gate.ts) 81-99：`makeGateListener` 对非 loopback 请求只做一件事——`return isPairedDeviceRequest(service, request) ? next() : false`（97 行）。
- 87-88：loopback（127.0.0.1 桌面）直接 `next()`，不查 cookie。
- 94-96：注释「this listener only covers /api」——该门只覆盖 /api 前缀，方法级不设任何白名单。
- [index.ts](../../packages/dsh-remote-web-ui/src/index.ts) 381-382：`ctx.on('api/gate', gate)` 挂载；282-285：插件关闭时门保持挂载（关闭 `enabled` 会把门变成「全拒非 loopback」而非放开门），说明该门确实是 /api 面的最后关口。
- 113：`isPairedDeviceRequest` = 读 cookie + `service.touchDevice(deviceId)`。

### 3. 桌面 /remote 通道专门拦截 loopback-only 方法

- [remote-methods.ts](../../packages/dsh-remote-web-ui/src/remote-methods.ts) 39-62：`LOOPBACK_ONLY_METHODS` 15 项，注释说明「mirrored from client-connection's PRIVILEGED_METHODS (pinned by tests/remote-contract.spec.ts against the installed SDK)」（41-43），并称「matching the SDK's own stance that the configuration plane is loopback-same-origin only」（43-44）。
- [remote-api.ts](../../packages/dsh-remote-web-ui/src/remote-api.ts) 110-132：`loopbackOnlyDenial`——`/api/pair/*`（111-113）、`/api/update/*`（114-116）、plugin-manager（117-119）、desktop-launcher（120-122）、settings-bridge（123-125）拒绝转发；126-130：`/api/<method>` 无子段形态且命中该集合时拒绝（129 行「stays unreachable from a paired remote desktop」）。
- 头注释 9-22：`/remote` 是「cookie 门控后改写成回环形状重发到 127.0.0.1」，所以 SDK 的 loopback 检查对 /remote 失效，通道必须自带拒绝（19-22）。
- 测试钉住：[tests/remote-contract.spec.ts](../../packages/dsh-remote-web-ui/tests/remote-contract.spec.ts) 25-27（集合与安装 SDK 完全一致）、[tests/remote-api.spec.ts](../../packages/dsh-remote-web-ui/tests/remote-api.spec.ts) 337-344（每个方法 403）、[tests/gate.spec.ts](../../packages/dsh-remote-web-ui/tests/gate.spec.ts)（门的策略）。

### 4. 手机同源直连 /api 不经上述拦截

手机浏览器与桌面都在宿主 origin 上。手机 UI 走 /m/api（由本插件路由、被白名单限制），但同一 origin 上直接 `POST /api/<method>` 的请求只经过：本插件 api/gate（cookie 通过）→ SDK 的 /api 桥（Host 围栏 + 特权集 loopback 检查）。`/m/api` 白名单和 `/remote` 拒绝逻辑都不在这条链路上。index.ts 242-246：手机 /api 流量走 /m/api 通道的动机是「该通道不受连接信任围栏约束」（可分发插件不能改围栏），而不是「手机没有 /api 凭证」。

### 5. cookie 属性：长寿命、无 Secure、明文可嗅

- [routes.ts](../../packages/dsh-remote-web-ui/src/routes.ts) 84：`const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60`（31536000 秒）。
- 328-336：Set-Cookie 明确「No Secure attribute: LAN pairing runs over plain HTTP (the cookie must work there)」，属性为 `Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`（334 行）。
- `Path=/`：cookie 随宿主 origin 的每个请求发送，/m/api、/remote、/api 通用。
- [index.ts](../../packages/dsh-remote-web-ui/src/index.ts) 273-276：LAN base 一律 `http://<address>:<port>`（明文）。
- 有效期实际由会话活性主导：[pairing.ts](../../packages/dsh-remote-web-ui/src/pairing.ts) 54-55 默认 `idleExpireMs` = 7 天；438-441 `touchDevice` 把 `lastSeenAt` 刷新为当前时间——任何持 cookie 的请求（包括攻击者的）都续活会话；14-17 stop()/revoke 是主动撤销的唯一途径（routes.ts 340-345：stop 端点带 loopbackFence，仅本机可撤销）。
- SameSite=Lax 只挡浏览器跨站子请求携带 cookie，不挡同 LAN 上带显式 Cookie 头的脚本/curl 重放。

### 6. SDK 侧事实（安装版本 0.1.1-rc.2）

安装的 `@deepseek-ai/dsh-client-connection@0.1.1-rc.2` dist 中（node_modules/.pnpm 路径，长期文档不引 node_modules 行号，此处仅作为行为依据）：

- `PRIVILEGED_METHODS` = 上述 15 项，与插件 `LOOPBACK_ONLY_METHODS` 完全一致（remote-contract.spec.ts 25-27 保证）。
- /api 桥处理器对命中集合的方法执行 `isTrustedApiRequest(request, [])`——空信任列表只放行 loopback Host——优先于转发（dist 注释：「Methods gated to loopback even on a trusted-host deployment」，「trustedHosts is a DNS-rebinding fence, explicitly not authentication, so the whole configuration plane stays loopback-same-origin」）。
- 结论：直连 /api 时特权 15 方法被 SDK 原生拒绝，与插件姿态一致；但 SDK 检查只认 Host 形态（含 sec-fetch-site 非 cross-site），不认「调用者是谁」——cookie 持有人在 SDK 眼中就是普通非特权调用者，特权集之外全部放行。

## 攻击路径

1. 前提：`dsh web --host 0.0.0.0`（README.zh.md 81 行记载 SDK 自动信任局域网字面量）或配置 `--trusted-host`，使 /api 桥接受该 origin。默认 127.0.0.1 绑定时该路径不可达（只有 /m/api 可用）。
2. 嗅探：手机在 LAN 明文中使用 QR/面板给出的 `http://<lan-ip>:<port>`（index.ts 273-276）访问 /m/ 与 /m/api，每个请求携带 `Cookie: <cookieName>=<deviceId>`（Path=/ 且无 Secure）。同网段、共享 AP、恶意路由器、ARP 欺骗均可在路径上读到此值；Set-Cookie 更是在配对 accept 时明文下发一次。
3. 重放：攻击者直接用该值请求 `POST http://<lan-ip>:<port>/api/<method>`（任意 Host 头与 origin，不经 /m/api，也不经 /remote）。api/gate 通过（cookie 有效 → next()，gate.ts 97 行）；SDK /api 桥放行特权集之外的一切方法 → 完整 ApiProxy（会话创建/历史/搜索/发消息/模型切换、工作区列举、宿主暴露的其他域）。
4. 持久性：攻击者持续使用即持续 `touchDevice` 续活（pairing.ts 438-441），7 天空闲过期（54-55）只惩罚静止；365 天 Max-Age 只是浏览器端不丢失。唯一退出是 loopback 面板 stop()/revoke（routes.ts 340-345）。
5. 观察口：姿态探测（index.ts 384-410）只在「/api 围栏开放」时对面板/日志报警（408-410「unpaired clients reach the full host API」），不检测 cookie 是否被第三方持有；对「已配对凭证泄露」无信号。

缓解现状：SDK 特权 15 方法 loopback-only（settings/credentials/agentPreset 写域、host 对话框、llm.discoverModels 的探测面）；SameSite=Lax 挡浏览器跨站；stop()/revoke 可即时切断；7 天空闲过期兜底。这些都不改变「白名单外、特权集外的 /api 域对 cookie 持有人完全开放」这一事实。

## 与桌面通道声明的不一致

- /remote 通道声明（remote-api.ts 14-16、remote-methods.ts 43-44）：SDK 的 loopback-only 特权方法「对已配对远程桌面保持不可达」——因为该通道把请求改写为回环形状（remote-api.ts 4-7、19-22），SDK 的 Host 检查会被骗过，拒绝必须由通道自持。
- 手机面声明（mobile-api.ts 12-14；README.zh.md 75 行）：手机受 cookie 与显式白名单门控，「settings/credentials/host-action 域手机永远不可达」。
- 用户可读声明（README.zh.md 16 行）：「通用 settings.*、credentials.* 和 llm.discoverModels RPC 方法仍然仅限 loopback」；README.zh.md 81 行已知限制承认「/api 路由本体属于 SDK」及其姿态探测。
- 不一致点一：手机与桌面持同一凭证，两条通道的「受限」由不同机制实现（/remote 自持拒绝 vs /api 靠 SDK 原生），而 README 与注释把「受限」描述成手机的属性，未说明其在直连 /api 时只剩 SDK 特权集这一拼图。
- 不一致点二：凭证本身未按域裁剪——离开 UI 通道后，它的效力由「SDK 特权集 + /api Host 围栏」决定，插件层的白名单/拒绝只作用于各自通道。任何带 cookie 的第三方客户端（curl、桥接脚本、未来插件）走 /api 直连即绕过插件声明。
- 根因：插件的 /remote 通道必须自持拒绝（因为回环改写骗过 SDK），直连 /api 不需要（SDK 原生兜底），于是「拒绝逻辑有两处真相」；插件的注释只交代了 /remote 一侧，未交代 SDK 一侧的实际边界。测试钉住的是 /remote 与 SDK 集合（remote-contract.spec.ts），没有钉住「直连 /api + cookie」这一面的行为（它现在由 SDK 兜底，无人断言）。

## 候选方案

### 方案 A：下沉 loopback-only 到 api/gate

把 /remote 通道此刻自持的 loopback-only 拒绝（remote-methods.ts 46-62 集合 + remote-api.ts 126-130 的形态判断）下沉到插件门（gate.ts），使「非 loopback 请求命中集合即 403」成为 /api 面上的插件级保证。

- 行为影响：配对流（/m/api、/remote、桌面 loopback）零变化——正常 /m/api 不涉及该集合，/remote 已有同样拒绝，桌面 loopback 不受门约束；直连 /api 的 cookie 持有人将失去特权集访问——但 SDK 现在已如此拒绝，因此运行行为几乎无差异。真正的边际价值是纵深防御：SDK 检查被某版本移除/改写（或在 SDK 引入真认证层前，Host 围栏被其他途径绕过）时不再依赖 SDK 内部拼图。
- 兼容风险：与 SDK 原生检查构成「两处真相」——未来 SDK 若把某方法移出特权集（先例：模型目录 `llm.providers`/`llm.models` 被 SDK 明确移出，「deliberately NOT here」），插件钉住的集合会先于 SDK 拒绝（或双方漂移不一致），表现为新的 403 或放行，且方向不可预测；需要 remote-contract.spec.ts 之外再增加一条反向契约（插件集合不得大于 SDK 集合）；实现需精确匹配 `/api/<method>` 无子段形态，并确认兄弟路由（/api/pair/* 等）不入门；属安全语义改动，按 packages/AGENTS.md 必须同步 README 安全模型与门测试，工作量中等；若 SDK 未来引入真认证层并由其接管 /api 准入，本方案退化为冗余。

### 方案 B：文档如实声明「配对 = SDK 特权集之外的全量控制权」

修改 mobile-api.ts 头注释与 README 安全模型/已知限制：明确「/m/api 白名单只约束手机 UI 通道；配对 cookie 本身是通过 /api 的凭证，特权集之外一切方法对任何持 cookie 者可达；LAN 明文下 cookie 可被嗅探，365 天 Max-Age 与使用即续活；停止/撤销是唯一即时出口；建议使用隧道/HTTPS 路径或按需 stop()」。

- 行为影响：零代码行为变化，只改表述；现有「privileged domains never reachable from the phone」「手机永远不可达」等过度承诺被撤下或限定于 /m/api 通道。
- 兼容风险：极低；属于 packages/AGENTS.md 安全语义文档要求（README 中英配对 + README.i18n.yaml 重录 + `pnpm docs:write-pair` + `pnpm docs:check`）；措辞风险在「如实声明」与「吓退用户」之间的平衡，需人工把关；只要保留 SDK 兜底表述（settings/credentials 仍仅 loopback）即为准确。

### 方案 C：维持现状

保留现有注释与 README 表述，不做任何变更。

- 行为影响：无。
- 兼容风险：风险不在运行时而在「承诺」——维护者与审计方会持续按「手机受白名单限制」的声明推断攻击面，导致安全评审反复标记或误判；用户从 README 得到的安全预期高于凭证实际强度；本问题已由插件自己的注释（mobile-api.ts 31-38）承认，属于「代码自认、文档外宣」分歧，是长期文档债。

## 需人工决策

本备忘录只固化问题与选项，处置由人决定。当前判断：该缺陷不构成紧急阻断（SDK 已把最高价值域固定在 loopback），但属既有「安全语义与凭证实际强度不符」问题，建议尽快采纳方案 B（零行为风险，立即消除承诺偏差）；方案 A 仅当团队愿意维护第二条集合真相、且接受与 SDK 内部演进的绑定成本时跟进，否则应等待 SDK 引入真认证层后由宿主侧统一解决；方案 C 不推荐（把已知不一致继续留在代码与文档里）。另需人决定的独立项：cookie 生命周期（31536000 是否下调、是否在可用通道上补 Secure）与「LAN 明文是硬需求」的权衡是否重新审视。
