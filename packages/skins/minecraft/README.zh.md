# @linxin666/dsh-client-ui-skin-minecraft

[English](README.md) | 中文

dsh web GUI 的体素化皮肤，按 Minecraft 主菜单风格打扮：一幅程序化绘制的像素风全景天空盒（方块山丘、像素云、方块树、草方块）在 CSS 3-D 立方体里缓缓飘在应用背后——与游戏标题画面的同一套全景运动，从零绘制而非使用 Mojang 的受版权保护贴图。按钮穿着经典 MC 组件精灵（灰色石板、黑色描边、黄色悬停标签、点击压下），输入框变成告示牌（带角钉的木牌），面板浮动为半透明石板，调色板映射到青金石蓝、草绿、石灰与金沙。

以客户端插件方式热插拔：`apply()` 设置 `data-dsh-minecraft` body 属性（整张样式表的生效范围）、渲染 chrome 并钉住文档标题；其 effect 清理器收回每一处写入。样式表随 bundle 的 CSS-modules 自动注入，loader 会随条目一并移除。

本皮肤只做呈现：不注入服务、不发 cordis 事件、不触任何模型请求。

## 安装

皮肤内置在家族聚合包 `@linxin666/dsh-skins` 里（装它 = 全部皮肤一次到位），由皮肤管理器接线——本包不声明 `dsh.bundle`（skin.json 的 `wiring.bundleWired: false`），`dsh-skin use` 会把 insert 行写进 profile 自己的 patch：

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

用 `dsh-skin use minecraft`（monorepo 里的辅助脚本 `scripts/dsh-skin`）激活或切换；同一时刻只激活一款皮肤。

## 构建与测试

```sh
pnpm build   # tsdown: lib/index.js + lib/client.js (self-contained preset)
pnpm test    # vitest: apply/dispose contract spec
```

## 发布到皮肤中心

```sh
node scripts/skin-center-bundles    # re-embed this skin into skin-center's registry
pnpm --filter @linxin666/dsh-client-ui-skin-center build
node scripts/gallery-build          # refresh the gallery manifest/bundles
node scripts/capture-previews       # re-shoot preview/light.png + preview/dark.png
```

然后提交全部（lib/、preview/、再生成的 registry/gallery）并开 PR。
