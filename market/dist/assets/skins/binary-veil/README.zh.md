# @linxin666/dsh-skin-binary-veil

[English](README.md) | 中文

二进制面纱（Binary Veil）—— dsh web GUI 的代码雨皮肤，以纯资产目录形态收录在
皮肤中心内。把一支黑白剪影片逐帧重绘成 0/1 数字场：亮部整片变成下落的代码雨，
剪影原样压在数字之上。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（全量 token 重映射）+
  `patches.css`（L3 氛围层与机壳）+ `assets/binary-veil-loop.mp4`
  （852×480、30fps、3:52、H.264 + AAC、静音循环）+ `preview/`（截图）。
  无 package.json、无构建步骤；皮肤中心是唯一加载器。
- **背景**：离线烘焙好的视频，通过 `contributes.backgroundMedia` 声明（亮/暗遮罩
  由皮肤中心背景控件拥有）。刻意做**居中 + 覆盖式铺满**：裁切只会吃掉原片自带的
  两侧黑边栏，构图不会被切。
- **token 优先**：十二个调色板颜色重映射全部 `--dsw-*` 别名；强调色 `#6bff9e`
  就是数字本身的荧光绿，面板走墨绿玻璃，代码雨才能贯穿到屏幕边缘。
- **机壳**：等宽字体只给机壳（侧栏、输入卡、标签页），分区标题 10px 大写宽字距，
  选中行左侧 2px 数字绿标记，输入卡一圈绿发丝边。
- **选择器只用官方挂点**：全部落在皮肤中心的语义挂点上（`data-dsh-part`、
  `data-dsh-surface`、`data-dsh-plugin`）或标准 ARIA（工作区列表用
  `[role="treeitem"]`），不匹配任何 CSS-Modules 哈希，官方重新构建不会把皮肤打坏。
- **无 hooks.mjs**：纯声明式，不执行任何代码。

## 预览

```sh
pnpm market:build
# 然后打开 market/dist/preview.html?skin=binary-veil&theme=dark
```

## 背景怎么来的

片段由黑白源片离线逐帧烘焙，效果不在运行时计算 —— 所以皮肤对渲染器是零每帧开销。

## 许可与素材来源

皮肤样式（skin.css、patches.css）以
[CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 发布。
背景片段由皮肤作者贡献，源素材权利归其所有，详见 `skin.json` 的 `author` 字段。
