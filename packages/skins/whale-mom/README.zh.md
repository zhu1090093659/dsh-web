# @linxin666/dsh-client-ui-skin-whale-mom

[English](README.md) | 中文

鲸鱼妈妈（Whale Mom）是 dsh web GUI 的深海母子主题：一幅无文字的氛围画作（鲸鱼妈妈与幼崽、暖奶油色光线、金线点缀）铺在全透面板之后——大面板使用 alpha 混合 token，其不透明度由皮肤中心的"背景遮挡"滑杆驱动（`--dsw-skin-scrim` 变量，滑动时面板即时重绘），遮罩随基础亮 / 暗主题实时切换，深蓝 / 奶油 / 金色配色系映射到全部 dsh token 上。

它是一个热插拔客户端插件。`apply()` 设置 `data-dsh-whale-mom` body 属性（整个样式表的作用域），把画作绘制为固定全视口背景（base64 data URL，附当前主题选择的阅读遮罩，`data-ds-dark-theme` 变化时实时切换），并注入鲸鱼印记 favicon（内联 SVG data URI，无静态资源文件）。其 effect 清理器全部收回：属性、背景内联样式（恢复之前的原值）与 favicon。样式表随 bundle 经 CSS-modules 自动注入，入口销毁时由 loader 移除。

皮肤纯呈现：不注入服务、不发 cordis 事件、不触达模型请求。暗色配色（`body[data-dsh-whale-mom][data-ds-dark-theme]`）是同一片海洋的夜航版本——压暗背景上的深海军蓝面纱——底层基础主题系统照常工作。

## 安装

皮肤内置在家族聚合包 `@linxin666/dsh-skins` 里（装它 = 全部皮肤一次到位），由皮肤管理器接线——本包不声明 `dsh.bundle`（skin.json 的 `wiring.bundleWired: false`），`dsh-skin use` 会把 insert 行写进 profile 自己的 patch：

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

用 `dsh-skin use <id>`（monorepo 里的辅助脚本 `scripts/dsh-skin`）激活或切换；同一时刻只激活一款皮肤。

## 背景画作

`src/client/art.ts` 以 data URL 内嵌这幅无文字氛围画（1920×1080 JPEG，约 250KB）；其 README 注释给出了精确的再嵌入步骤（`node scripts/embed-skin-art whale-mom WHALE_MOM_ART <imagePath> 1920` 重新编码）。画作无文字，UI 文字绝不与背景打架。亮色遮罩是薄薄的冷色面纱，暗色是深海军蓝面纱——两者都调校到在最亮与最暗的画作区域上文字依然可读。

## 全透面板

面板不透明度是 token 级的（`--dsw-alias-bg-*`、`--dsw-specific-sidebar-fill`），每个基准 alpha 都挂 `var(--dsw-skin-scrim, …)` 表达式：皮肤中心的"背景遮挡"滑杆（0..1）一次驱动全部面板，0 时保持默认遮罩不变。侧边栏的基准透明度是独立变量（`--dsw-skin-sidebar-alpha`，亮 / 暗默认都是 0——完全由滑杆驱动），可在控制台实时微调：

```js
document.body.style.setProperty('--dsw-skin-sidebar-alpha', '0.4')
```

消息气泡同理，走第二个变量（`--dsw-skin-bubble-alpha`，默认 `0.5` = 半透明）：用户气泡 token（`--dsw-specific-bubble`）与模型输出 / 思考气泡 token（`--dsw-skin-bubble*`）的 alpha 都从它解析。皮肤中心卡片把它暴露为「气泡不透明度」滑杆（默认 50%），无需控制台：

```js
document.body.style.setProperty('--dsw-skin-bubble-alpha', '0.7')
```

## 预览

亮色（[preview/light.png](preview/light.png)）· 暗色（[preview/dark.png](preview/dark.png)）

## 要求

环境透明度是 token 级的，与面板布局无关。刻意不用 `backdrop-filter`：模糊祖先会成为固定定位浮层的包含块（设置面板会被困在侧边栏列里渲染不出来）。

## 模型体验

无。皮肤只改浏览器 DOM，不触达任何模型请求。

#### KV 缓存影响

无；本包既不组装也不发送任何 provider 请求。