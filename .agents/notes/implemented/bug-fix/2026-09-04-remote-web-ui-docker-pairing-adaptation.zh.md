# Agent Note: remote-web-ui docker and reverse proxy pairing adaptation

Status: implemented

## Problem

当 DeepSeek Harness 运行在容器化环境（如 Docker 桥接网络）或反向代理后方时，服务探测到的容器内部虚拟网卡地址（例如 172.22.0.5）与宿主机的实际局域网 IP（例如 192.168.1.100）或代理域名不一致。

这导致了配对流程彻底死锁：
1. 生成的配对二维码携带了无法路由的容器内部私有 IP，宿主机局域网内的手机无法扫码连通。
2. 即使客户端手动通过宿主机局域网地址打开配对链接，由于请求头中的 Host 与容器内部探测到的网卡白名单不匹配，配对端点直接被 lanFence 安全栅栏拦截并返回 403 Forbidden。
3. 即使在未配对阻断页面尝试手动输入 128 位配对令牌，提交的 POST /api/pair/accept 请求在验证令牌前同样被 403 拦截，用户无法通过令牌完成设备配对。

## Decision

在严密保持安全边界的前提下，全面支持 Docker 容器桥接网络、反向代理及自定义局域网域名的配对：

- 令牌验证与动态授信：配对端点（POST /api/pair/accept 与 GET /pair-accept）允许来自私有/本地域名（RFC 1918 IPv4、IPv6 ULA、.local、.lan、.internal、.home.arpa 以及回环）且非跨站（sec-fetch-site != 'cross-site'，且当存在 Origin 时必须与 Host 一致）的请求进入令牌校验环节。一旦高强度密码学一次性令牌校验通过，立即将该请求的具体来源（Host:Port）动态记录至 dynamicTrustedHosts。（2026-09-09 修订：`GET /pair-accept` 与 `GET /pair-app` 属于顶层导航，现在也接受带这些标记的请求——见[配对入口导航栅栏](2026-09-09-pairing-entry-navigation-fence.zh.md)；POST API 路径仍要求非跨站标记。）
- 已配对设备自动再授信：当来自私有局域网 Host 的请求携带当前服务实例签发的合法已配对设备 Cookie 时，自动将其 Host 加入 dynamicTrustedHosts 并放行，保证重连和网络切换的平滑过渡。
- 显式授信配置与环境变量：在插件配置中增加 trustedHosts 选项，并支持 DSH_REMOTE_TRUSTED_HOSTS（逗号分隔的 Authority）及 DSH_REMOTE_PUBLIC_BASE_URL 环境变量，方便容器编排与静态网络预设。
- 配对面板 UI 升级：在桌面端配对面板中直观展示配对令牌明文，提供独立的一键复制令牌按钮，并补充 Docker 与反向代理网络拓扑下的操作提示。

## Testing

- packages/dsh-remote-web-ui/tests/docker-pairing.spec.ts 单元测试验证：
  - 容器内网卡为 172.22.0.5:3080 时，来自外部宿主机 192.168.1.100:3080 的令牌配对成功，后续心跳正常放行。
  - 外部宿主机发起 GET /pair-accept 成功 303 重定向到应用落地页，且该 Host 获得动态授信。
  - 跨站攻击伪造（sec-fetch-site: cross-site）与 Origin 不匹配请求在 API 路径上被严格阻断（403）；自[导航栅栏修复](2026-09-09-pairing-entry-navigation-fence.zh.md)起，入口页面的顶层文档导航不再受这些标记限制。
  - 非私有外部域名且未在白名单中的请求被严格阻断（403）。
  - 显式配置 trustedHosts 的场景正常放行。
- dsh-remote-web-ui 全套测试（31 个文件，338 个用例）全部通过。
- 全仓库 typecheck 与文档校验全部通过。
- 全仓库 i18n 检查（zh、en、ru 三语字典对齐）全部通过。

## Alternatives considered

- 强制用户使用 Host 网络模式：Docker 的 --net=host 模式在 Windows 和 macOS 的 Docker Desktop 上均不受支持，且强制容器与宿主机共享网络命名空间，破坏了容器端口映射与隔离机制。
- 完全移除 Host 请求头校验：完全放开 Host 校验会导致 DNS 重绑定攻击风险，公网恶意网页可诱导受害者浏览器向局域网未授权接口发起探测。
- 无差别向所有 IP 放开配对接口：仅对符合 RFC 1918 私网/本地地址段、满足严格同源策略（防 CSRF/跨站）并在密码学令牌校验通过后才动态授信，兼顾了安全性与容器环境的灵活性。

## Consequences

在 Docker、Kubernetes 容器环境或反向代理后方运行 DSH 的用户，现在可以直接通过配对令牌或反代局域网链接完成设备配对，无需调整底层容器网络模式。同时 DNS 重绑定与跨站请求伪造的防御边界在所有 API 与子资源请求上保持严密；配对入口页面接受来自任意来源的顶层导航，这是二维码链接本身的要求（见[导航栅栏修复](2026-09-09-pairing-entry-navigation-fence.zh.md)）。
