# @linxin666/dsh-client-ui-skin-trading

[English](README.md) | 中文

dsh web GUI 的炒股皮肤（交易终端）：把 DeepSeek 聊天界面变成一台带实时行情的行情终端。以客户端插件方式热插拔：`apply()` 设置 `data-dsh-trading` body 属性（整张样式表的生效范围）、渲染带 K 线品牌标的标题栏（含实时行情快签）、滚动行情跑马灯（A股 / 港股 / 美股 / 指数 / 加密 / 外汇，红涨绿跌）、市场时段状态栏（A股 / 港股 / 美股 盘中状态、港美股指数格、工作区计数、连接状态），并固定文档标题、注入 K 线 favicon；effect 清理器会收回全部写入——属性、三条栏、favicon，以及标题（除非会话标题已经覆盖了它）。样式表随 bundle 的 CSS-modules 自动注入，loader 会随条目一并移除。

## 实时行情：三级数据源，逐级降级

1. **dsh-fun-ticker**：已安装时，跑马灯直接跟随插件同源代理（`/plugins/dsh-ticker/api`，宿主端 Binance / Frankfurter / eastmoney / Sina 源）读出你的自选列表——在 fun-ticker 设置页改自选，皮肤跑马灯跟着变。
2. **dsh-longbridge**：已安装且配置好时，状态栏港美股指数格渲染长桥券商快照（`/longbridge` loopback RPC `panel/snapshot`），分组标签显示「长桥」。
3. **独立公共行情**：两个插件都没装时，皮肤仍能显示实时报价——腾讯 `qt.gtimg.cn`（A/港/美股，script-tag 加载）、币安 24h 行情（加密）、Frankfurter 欧央行汇率（外汇）；状态栏指数格回退到同一批公共源，标签显示「指数」。所有拉取路径失败都安全降级为 `--` 单元格——断网也不会让终端 chrome 崩掉。

皮肤只做呈现 + 只读：不发 cordis 事件、不触及模型请求。深色调色板（`body[data-dsh-trading][data-ds-dark-theme]`）是夜间终端变体（TradingView 风格石墨色），基础块是亮色交易白天。

## 安装（官方 bundle 方式）

推荐先装皮肤全家桶聚合包 `@linxin666/dsh-skins` 一次到位；只装本皮肤时用下列 link 命令。

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装本皮肤
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-trading
# 皮肤启用：dsh-skin use trading
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/trading
```

`$(pwd)` 指克隆全家桶仓库后的目录。

本地 link 安装前需先在全家桶仓库内构建产物（`lib/` 被 git 忽略、不随仓库提交）：
`pnpm install && pnpm -r build` 后再 link 安装。
通过 git 安装（`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`）时
`prepare` 脚本自动自包含构建 `lib/`，无需单独构建；pnpm ≥10 首次安装 git 依赖需先把
pnpm 打印的包键加入相应 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 列表再重试。

皮肤启用 / 切换用 `dsh-skin use trading`（本仓库 `scripts/dsh-skin` 辅助脚本）；同一时刻只激活一个皮肤。
同一时刻只应激活一个皮肤行——两个皮肤会同时注入窗口 chrome。移除该行（连同包）即可回到默认外观。

## 依赖

- `dsh-fun-ticker` 与 `dsh-longbridge` 均为可选：装了会升级跑马灯与指数格，没装静默降级。
- 未装插件时，跑马灯直接请求公共端点（qt.gtimg.cn / api.binance.com / api.frankfurter.dev）；
  网络屏蔽这些域名时仍显示 chrome，只是单元格为 `--`。
- 工作区计数格通过 `@deepseek-ai/dsh-client-connection` 句柄读 `workspace.list` RPC；
  无连接时显示 `--`。

## 模型体验

无。皮肤只改浏览器 DOM 并读取行情源，不触及模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。

## 已知限制

- 加载页保持原样。外壳的启动页先于插件 bundle 渲染，皮肤从定型后的 UI 开始生效。
- 主题切换在皮肤内部。皮肤在 `data-ds-dark-theme` 两种状态下都钉住自己的调色板；
  在 Appearance 切换主题得到的是亮/暗两套交易终端配色，而不是非皮肤外观。
- 市场时段只按工作日与小时建模；交易所节假日仍显示为开市。
- 美股报价经腾讯源为纽交所/纳指常规时段口径；加密与外汇全天候，只要网络可达即显示实时值。
