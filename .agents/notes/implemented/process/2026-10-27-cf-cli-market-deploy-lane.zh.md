# Agent Note: 市场部署车道跑在 cf CLI 上

Status: implemented

## Problem

市场部署车道此前驱动的是 wrangler CLI：`deploy-market.yml` 全局安装 wrangler，`scripts/deploy-market` 依次调用 `wrangler d1 migrations apply dsh-market --remote`、`wrangler deploy`、`wrangler secret put` 与 `wrangler secret list`，每个 Worker 目录用一份 `wrangler.jsonc` 描述自己。Cloudflare 的 `cf` CLI 取代了这套工具，而它的项目模型在四处落到这条车道上：cf 只在 `cloudflare.config.ts` 所在的那个目录里解析 Worker 清单，而祖先目录的 `package.json` 会被发现、但不会被修改，所以每个 Worker 目录都必须自带 `package.json` 与自己的 `node_modules`；Wrangler 专有的键在该清单里没有对应项，移进生成的 `wrangler.config.ts`；`cf d1 migrations apply` 收的是 D1 数据库 ID 而不是数据库名；没有可安装的全局 wrangler——清单必须声明自己的 dev-server（这里是遗留的 `wrangler` bundler），并由该目录自己的 `node_modules` 提供。于是 Worker 配置无法被本仓用于一切 Cloudflare 操作的那个 CLI 读到，而这条车道依赖的又是一个已经不再安装的工具。

## Decision

- `market/worker/cloudflare.config.ts` 是 Worker 的清单：名称、compatibility date、entrypoint、observability、`assets.runWorkerFirst` 列表、通配 zone 路由 `*.dsh-market.com/*` 的 `triggers.fetch`、`*/30 * * * *` cron 的 `triggers.scheduled`、`DB`（D1）、`TELEMETRY_VIEW`（service）、`RELAY_BRIDGE`（Durable Object）与 `ASSETS` 绑定，以及 Durable Object 类账本 `exports.RelayBridge = exports.durableObject({ storage: "sqlite" })`。自定义域名仍由控制台管理、哪里都不声明，与之前一致。
- `market/worker/wrangler.config.ts` 承载 Wrangler 专有、而 `cloudflare.config.ts` 没有对应项的那一个键 `assetsDirectory: "../dist"`：cf 把打包委托给 Wrangler（`bundler=wrangler`），所以 `cf build` 与 `cf deploy` 会打印 "Delegating to Wrangler"，静态资产目录只能放在那个文件里。
- Worker 目录是一个独立的 npm 包——`package.json` 加已提交的 `package-lock.json`，`devDependencies` 为 `cf` 与 `wrangler`，与 `market/shell` 同形——且它不是 pnpm workspace 成员，所以车道用 `npm ci --prefix market/worker` 显式安装它。
- `market/telemetry-view/cloudflare.config.ts` 声明 `tv.dsh-market.com` 自定义域与 `MARKET` 服务绑定；`probe/relay-bridge/cloudflare.config.ts` 声明 `PROBE_INSTANCE` 文本绑定、`BRIDGE` Durable Object 绑定与其类账本。三份 `wrangler.jsonc` 全部删除。
- `scripts/deploy-market` 驱动 `cf`：`cf d1 migrations apply <数据库 ID> --dir migrations`，然后 `cf deploy`，再用 `cf workers secrets list --worker dsh-market` 证明 `TURNSTILE_SECRET` 与 `ASSET_ATTEST_SECRET` 已绑定（点赞与安装、以及资产校验路由缺绑定即失败关闭）。刷新 secret 时把值暂存在 0600 文件里，上传命令是 `cf workers secrets update <NAME> --worker <WORKER> --type secret_text --text @<路径>`；非 TTY 环境下 `--type` 是必需的，缺了 cf 会直接答 `--type is required (one of: secret_text, secret_key)`、连请求都不发。文件引用让明文既不进命令行、也不进会打印命令与参数的失败日志。
- 受限重试策略与 Ray ID 诊断包裹每一次 `cf` 调用；它们由 [Deploy Market 通道对被限流的 Cloudflare API 做重试，而不是在第一个 429 上失败](../bug-fix/2026-10-27-market-deploy-retries-throttled-api.zh.md) 拥有。
- CI 全局安装 `cf@latest` 并跑 `npm ci --prefix market/worker`；全局 wrangler 那一步已删除。

## Alternatives considered

- **继续用 wrangler CLI，并在每个 Worker 目录里钉住它。** 否决：本仓的 Cloudflare 工具是 `cf`，wrangler 已不再全局安装，而一条自带 wrangler 的车道会为一条部署路径养出第二份 CLI 契约——它自己的认证、自己的配置格式、自己的 secret 命令。
- **把 secret 值放在命令行上。** 否决：每一行失败日志都会打印命令与参数，一次上传失败就会把 secret 公开进 job 日志；0600 文件引用同时把值挡在 argv 与日志之外。

## Consequences

- 车道的 Cloudflare 命令是 `cf`；Wrangler 保留为 cf 委托打包的那个 bundler，装在 Worker 自己的依赖树里；真正的 Wrangler 失败仍被重试策略判为瞬时失败——它的签名覆盖两个 CLI 的输出形状。
- `.cloudflare/` 是 cf 的构建与类型产物目录，已进 .gitignore。
- D1 这一步现在认的是数据库 ID，敲错的库名不会再被静默迁移：`cf d1 migrations apply` 要求 ID。
- cf 还是 beta CLI（这条车道上是 1.0.0-beta.26），而 Cloudflare 会在 cf 结束 beta 后继续维护 Wrangler 18 个月，所以车道的 bundler 那一半没有断崖。
- 车道的步骤顺序不变——迁移、部署、secret 核验——所以重试预算、siteverify 配对探针与 `market-build --check` 预检全都照旧适用。
