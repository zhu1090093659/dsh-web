# Agent Note: 命名隧道模式——手机配对一次，跨重启免重新配对

Status: implemented

## Problem

手机的远程访问一直走插件的自动快速隧道，而 Cloudflare 每次启动都会铸造新的 `trycloudflare.com` 域名。每次 `dsh web` 重启都等于更换公网 origin：手机保存的书签失效，且新域名对手机浏览器是全新的 Cookie 上下文，已持久化的设备会话（`remote-web-ui-devices.json` 本就跨重启安全）永远无法匹配——每次重启都被迫完整重新配对。2026-09-02 的故障（profile patch 行在改成壳布局时丢掉了 `autoTunnel`）把这一代价暴露出来：配置修复并重启服务之前，手机完全无法进入。

## Decision

- **新增命名隧道模式**：`dsh-remote-web-ui` 新增 `tunnelToken` 设置（Cloudflare 命名隧道 Token），插件自行运行 `cloudflared tunnel run --token`，指向在 Cloudflare 控制台配置的固定公共主机名。主机名永不变化，手机配对一次，书签与配对 Cookie 跨重启持续有效。
- **优先级与校验**收敛在纯规划器（`src/tunnel-plan.ts`，`tunnelPlanOf`）：`autoTunnel`（快速隧道）优先于 `tunnelToken`；命名模式要求同时具备 Token 和指向同一固定主机名的有效 `publicBaseUrl`（Token 本身不携带主机名）——否则模式关闭，并给出指明缺失项的警告。
- **生命周期复用**：命名进程由 `namedTunnelHandle`（`src/tunnel.ts`）包装，在首个边缘连接注册后通过与快速隧道相同的 `url` 事件一次性上报固定 URL——管理器的 URL 超时、崩溃退避重启、停止语义、phase 监听与姿态探测对两种模式完全一致。
- **密文处理**：`tunnelToken` 在 section schema 中声明 `role('secret')`，设置面存储时脱敏；卡片经 `secretField` 编辑，从不回读明文。
- **UI 与文案**：设置卡片新增令牌字段（位于自动隧道开关与局域网状态之间）；包内 zh/en 文案，ru 镜像进 dsh-i18n 中央字典。README 补充配置步骤（控制台 ingress 映射、Token、公网地址），安全模型中关于主机名抖动的条目改为指向新模式。

## Alternatives considered

- **仅局域网绑定（0.0.0.0）**：零代码且已上线，但手机离开家庭网络即失联；保留为互补选项，不解决随时随地访问。
- **零代码独立命名隧道**（`cloudflared service install` + 手动填 `publicBaseUrl`）：今天就能用，但隧道生命周期游离在插件之外（不随 `dsh web` 自启、无退避、无卡片状态）；手动 `publicBaseUrl` 路径继续支持偏好该方式的用户。
- **深链携带设备凭据**：能软化重新配对，但修不了"旧域名已死"——用户每次重启后仍要从桌面拿新地址。

## Consequences

- 只要部署使用固定主机名（命名隧道，或地址稳定的局域网绑定），配对设备会话就真正实现了设计初衷"重启后免重新配对"。
- 隧道目标端到端改为联合类型（`quick`/`named`）：`TunnelManager.start` 两者皆收，factory seam 参数类型扩展（既有注入方不受影响），设置同步经唯一规划器驱动全部行为。
- 错误 Token 或 Cloudflare 边缘不可达表现为标准隧道失败态（phase `failed` + 退避），不是启动错误；有 Token 但无公网地址时隧道按设计保持关闭。
- 快速隧道仍是无账号默认；未设置 `tunnelToken` 的部署行为完全不变。零配置的跨重启能力本身由固定域名中继（2026-09-02-stable-hostname-relay.zh.md）承接——在快速隧道前钉一个固定的 dsh-market 子域名、用户零配置；本模式保留为自带域名的替代路径。

## Testing

- `tests/tunnel.spec.ts`：命名模式管理器流程（固定 URL 上报、幂等、目标变化重启、崩溃退避）、裸字符串快速模式兼容，以及 `namedTunnelHandle` 适配器（仅首次注册上报、exit 透传、stop 时解除监听）。
- `tests/tunnel-plan.spec.ts`：优先级矩阵——快速模式胜出并带忽略键列表、命名模式要求 Token + 有效公网地址、空值/非法值保持关闭。
- 包级 `tsc -b` 与完整 vitest 套件（321 测试、29 文件）通过。
