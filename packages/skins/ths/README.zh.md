# @linxin666/dsh-client-ui-skin-ths

[English](README.md) | 中文

dsh web GUI 的同花顺风格炒股皮肤。以客户端插件方式热插拔：`apply()` 设置 `data-dsh-ths` body 属性（整张样式表的生效范围）、渲染带实时行情签（上证指数）的品牌红标题栏、行情状态栏（上证指数 / 深证成指 / 创业板指，红涨绿跌配色）、自选股风格的侧边栏（红色行情线、行情行）和交易终端风格设置面板，并固定文档标题、注入「同」字 favicon；effect 清理器会收回全部写入——属性、两条栏、favicon，以及标题（除非会话标题已经覆盖了它）。样式表随 bundle 的 CSS-modules 自动注入，loader 会随条目一并移除。

皮肤只做呈现：不注入服务、不发 cordis 事件、不触及模型请求。深色调色板（`body[data-dsh-ths][data-ds-dark-theme]`）是夜间交易变体，基础主题系统依然在其下正常切换 token。滚动条别名保留在基础主题上，皮肤之下的滚动条契约不变。

## 安装（官方 bundle 方式）

推荐先装皮肤全家桶聚合包 `@linxin666/dsh-skins` 一次到位；只装本皮肤时用下列 link 命令。

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装本皮肤
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-ths
# 皮肤启用：dsh-skin use ths
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/ths
```

`$(pwd)` 指克隆全家桶仓库后的目录。

本地 link 安装前需先在全家桶仓库内构建产物（`lib/` 被 git 忽略、不随仓库提交）：
`pnpm install && pnpm -r build` 后再 link 安装。
通过 git 安装（`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`）时
`prepare` 脚本自动自包含构建 `lib/`，无需单独构建；pnpm ≥10 首次安装 git 依赖需先把
pnpm 打印的包键加入相应 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 列表再重试。

皮肤启用 / 切换用 `dsh-skin use ths`（本仓库 `scripts/dsh-skin` 辅助脚本）；同一时刻只激活一个皮肤。

同一时刻只应激活一个皮肤行——两个皮肤会同时注入窗口 chrome。移除该行（连同包）即可回到默认外观。

## 依赖

面板级 chrome（侧栏渐变、会话/详情面板表面）依赖 `ui-layout` 中 AppFrame 列携带的 `data-pane` 属性；没有它们皮肤依然生效，只是缺少各面板的表面样式。

## 模型体验

无。皮肤只改浏览器 DOM，不触及模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。

## 已知限制

- 加载页保持原样。外壳的启动页先于插件 bundle 渲染，皮肤从定型后的 UI 开始生效（属性一旦设置，启动页也能获得窗口边框，但内部卡片仍是现代样式）。
- 主题切换在皮肤内部。皮肤在 `data-ds-dark-theme` 两种状态下都钉住自己的调色板；在 Appearance 切换主题得到的是浅色/深色两套交易终端配色，而不是非皮肤外观。
- 行情单元格是装饰性的。状态栏里的指数数值是固定文案，只为外观，不跟踪实时行情。
