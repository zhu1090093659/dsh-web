# @linxin666/dsh-client-ui-skin-whale-song

English | [中文](README.zh.md)

鲸吟（Whale Song）是 dsh web GUI 的深海鲸语女神主题，原创画面延续「深海鲸语女神」概念图气质：无文字纯氛围背景画（蓝发女神与鲸群居左、冰蓝星座网格与金色细线点缀、右侧大量留白）垫在半透明面板之下（大面积表面用带透明度的 token，画作透光），遮罩随基础亮/暗主题实时切换，冰蓝 / 浅青 / 深海军蓝 / 钴蓝冷色体系与金色点缀重映射到全部 dsh token。

以客户端插件方式热插拔。`apply()` 设置 `data-dsh-whale-song` body 属性（整张样式表的作用域）、以固定全视口背景绘制海洋画（base64 data URL + 按当前主题选择的阅读遮罩，`data-ds-dark-theme` 变化时实时切换）、注入官方 DeepSeek 蓝色鲸鱼 favicon（deepseek.com 原版图标，PNG data URL，非 SVG）；effect disposer 全部收回：属性、背景内联样式（恢复原值）与 favicon。样式表随 bundle 的 CSS-modules 自动注入，入口卸载时由 loader 一并移除。

皮肤只做呈现：不注入服务、不发 cordis 事件、不触及模型请求。深色形态（`body[data-dsh-whale-song][data-ds-dark-theme]`）是同一片海洋的夜航版本——深海军蓝纱幕盖在压暗的背景上——基础主题系统在底下照常工作。

## 安装（官方 bundle 方式）

推荐先装皮肤全家桶聚合包 `@linxin666/dsh-skins` 一次到位；只装本皮肤时用下列 link 命令。

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装本皮肤
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-whale-song
# 皮肤启用：dsh-skin use whale-song
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/whale-song
```

`$(pwd)` 指克隆全家桶仓库后的目录。

本地 link 安装前需先在全家桶仓库内构建产物（`lib/` 被 git 忽略、不随仓库提交）：
`pnpm install && pnpm -r build` 后再 link 安装。
通过 git 安装（`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`）时
`prepare` 脚本自动自包含构建 `lib/`，无需单独构建；pnpm ≥10 首次安装 git 依赖需先把
pnpm 打印的包键加入相应 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 列表再重试。

皮肤启用 / 切换用 `dsh-skin use whale-song`（本仓库 `scripts/dsh-skin` 辅助脚本）；同一时刻只激活一个皮肤。

## 背景图

`src/client/art.ts` 内嵌无文字纯氛围画（1920×1080 WebP，约 150KB）的 data URL；文件头注释里有精确的重生成步骤（`node scripts/embed-skin-art whale-song WHALE_ART <imagePath> 1920` 重新压缩嵌入）。原概念图的海报文字（DEEPSEEK / 鲸吟·深寻 / ARCHIVE）已重新生成移除，界面文字不与背景打架。亮色遮罩是冰纱，暗色遮罩是深海军蓝纱——都按图的最亮/最暗处调过，保证文字可读。

## 预览

亮色（[preview/light.png](preview/light.png)）· 暗色（[preview/dark.png](preview/dark.png)）— 0813 对默认 web profile 拍摄。

## 要求

环境通透性走 token 层（`--dsw-alias-bg-*`、`--dsw-specific-sidebar-fill`），与面板布局无关。刻意不用 `backdrop-filter`：带模糊的祖先会成为 fixed 后代元素的包含块，会把设置面板之类的浮层困在侧边栏列里。

## 模型体验

无。皮肤只改浏览器 DOM；这里没有任何东西触及模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。
