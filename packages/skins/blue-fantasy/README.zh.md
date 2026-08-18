# @linxin666/dsh-client-ui-skin-blue-fantasy

[English](README.md) | 中文

蓝色幻想是 DreamSkin 社区「DeepSeek-鲸鱼娘」Codex 桌面主题（MIT，作者 powerdog996）在 dsh web GUI 上的移植：鲸鱼插画背景垫在半透明面板之下（大面积表面用带透明度的 token，画作透光），遮罩随基础亮/暗主题实时切换，periwinkle 靛蓝调色板重映射到全部 dsh token。

以客户端插件方式热插拔。`apply()` 设置 `data-dsh-blue-fantasy` body 属性（整张样式表的作用域）、以固定全视口背景绘制鲸鱼图（base64 data URL + 按当前主题选择的阅读遮罩，`data-ds-dark-theme` 变化时实时切换）、注入官方 DeepSeek 蓝色鲸鱼 favicon（deepseek.com 原版图标，PNG data URL，非 SVG）；effect disposer 全部收回：属性、背景内联样式（恢复原值）与 favicon。样式表随 bundle 的 CSS-modules 自动注入，入口卸载时由 loader 一并移除。

皮肤只做呈现：不注入服务、不发 cordis 事件、不触及模型请求。深色形态（`body[data-dsh-blue-fantasy][data-ds-dark-theme]`）是同一张图的夜航版本——深靛蓝纱幕盖在压暗的背景上——基础主题系统在底下照常工作。

## 安装

皮肤内置在家族聚合包 `@linxin666/dsh-skins` 里（装它 = 全部皮肤一次到位），由皮肤管理器接线——本包不声明 `dsh.bundle`（skin.json 的 `wiring.bundleWired: false`），`dsh-skin use` 会把 insert 行写进 profile 自己的 patch：

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

用 `dsh-skin use blue-fantasy`（monorepo 里的辅助脚本 `scripts/dsh-skin`）激活或切换；同一时刻只激活一款皮肤。

## 背景图

`src/client/art.ts` 内嵌主题的 `background.jpg`（2278×1280）压缩为 1920×1079 JPEG q76（约 210KB）的 data URL；文件头注释里有精确的重生成步骤。亮色遮罩是冰纱，暗色遮罩是深靛蓝纱——都按图的最亮/最暗区域调过，保证文字可读。

## 预览

亮色（[preview/light.png](preview/light.png)）· 暗色（[preview/dark.png](preview/dark.png)）——在 0807 基线裸 web profile 上截图。

## 要求

环境半透明是 token 级的（`--dsw-alias-bg-*`、`--dsw-specific-sidebar-fill`），与面板布局无关。刻意不用 `backdrop-filter`：带模糊的祖先会成为 fixed 覆盖层的包含块（设置面板会被锁进侧边栏）。

## 模型体验

无。皮肤只改浏览器 DOM，不触及模型请求。

#### KV Cache 影响

无；本包不组装也不发送任何 provider 请求。
