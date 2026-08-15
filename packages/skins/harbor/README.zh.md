# @linxin666/dsh-client-ui-skin-harbor

[English](README.md) | 中文

夕港（Harbor）是 dsh web GUI 的黄昏港口主题，由 dsh-skins 原版 harbor 皮肤适配而来：动漫少女黄昏港口背景（暮光蓝天空渐入日落橙，人物居中偏左、右侧留白）垫在半透明面板之下，阅读遮罩随基础亮/暗主题实时切换，深暮蓝（#141a2e 系）底与日落橙（#ff9d5c / #ffb46b）主色重映射到 dsh alias token 层。

以客户端插件方式热插拔。`apply()` 设置 `data-dsh-harbor` body 属性（整张样式表的作用域）、以固定全视口背景绘制港口画（base64 data URL + 按当前主题选择的阅读遮罩，`data-ds-dark-theme` 变化时实时切换）、注入港口 favicon（内联 SVG：深蓝圆角底、日落橙日轮、深色水面）；effect disposer 全部收回：属性、背景内联样式（恢复原值）与 favicon。样式表随 bundle 的 CSS-modules 自动注入，入口卸载时由 loader 一并移除。

皮肤只做呈现：不注入服务、不发 cordis 事件、不触及模型请求。黄昏配色是皮肤的底色，亮暗两种形态保持一致；只有遮罩不同——亮色是薄暮纱、暗色（`body[data-dsh-harbor][data-ds-dark-theme]`）是更深的夜色纱——基础主题系统在底下照常工作。

## 安装（官方 bundle 方式）

推荐先装皮肤全家桶聚合包 `@linxin666/dsh-skins` 一次到位；只装本皮肤时用下列 link 命令。

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装本皮肤
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-harbor
# 皮肤启用：dsh-skin use harbor
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/harbor
```

`$(pwd)` 指克隆全家桶仓库后的目录。

本地 link 安装前需先在全家桶仓库内构建产物（`lib/` 被 git 忽略、不随仓库提交）：
`pnpm install && pnpm -r build` 后再 link 安装。
通过 git 安装（`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`）时
`prepare` 脚本自动自包含构建 `lib/`，无需单独构建；pnpm ≥10 首次安装 git 依赖需先把
pnpm 打印的包键加入相应 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 列表再重试。

皮肤启用 / 切换用 `dsh-skin use harbor`（本仓库 `scripts/dsh-skin` 辅助脚本）；同一时刻只激活一个皮肤。

## 背景图

`src/client/art.ts` 内嵌原版港口画（1600×900 WebP，约 83KB）的 data URL；文件头注释里有精确的重生成步骤（`node scripts/embed-skin-art harbor HARBOR_ART <imagePath> 1600`）。亮色遮罩是薄暮纱，暗色遮罩是更深的夜色纱——都按天空最亮处与水面最暗处调过，保证文字可读。

## 预览

亮色（[preview/light.png](preview/light.png)）· 暗色（[preview/dark.png](preview/dark.png)）— 0815 对默认 web profile 拍摄。

## 要求

环境通透性走 token 层（`--dsw-alias-bg-*`、`--dsw-specific-sidebar-fill`），与面板布局无关。刻意不用 `backdrop-filter`：带模糊的祖先会成为 fixed 后代元素的包含块，会把设置面板之类的浮层困在侧边栏列里。

## 模型体验

无。皮肤只改浏览器 DOM；这里没有任何东西触及模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。
