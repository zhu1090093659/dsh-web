# @linxin666/dsh-client-ui-skin-maid-atelier

[English](README.md) | 中文

DeepSeek Harness Web GUI 的纯展示层深海女仆工坊皮肤，包含双女仆宫殿背景、深海蓝装饰界面和响应式角色构图。

## 功能

- 根据当前亮色或暗色主题切换日间与夜间宫殿画面。
- 在对话界面两侧挂载独立透明女仆角色，并在对话开始后把角色移向更安全的边缘位置。
- 提供 Q 版侧栏与视口装饰、favicon、毛玻璃面板，以及稳定的加载、思考和工具运行动画。
- 运行时素材以数据 URI 内嵌在客户端 bundle 中，激活时不依赖远程资源服务。
- 停用或热切换皮肤时还原自身写入的全部 DOM 和 CSS 状态。

## 安装

可以安装本仓库的 `@linxin666/dsh-skins` 聚合包，也可以从 checkout 直接添加该皮肤包：

```sh
dsh plugin --profile web add ./packages/skins/maid-atelier
```

## 配置

可以通过 GUI 皮肤中心或仓库脚本启用皮肤：

```sh
scripts/dsh-skin use maid-atelier
scripts/dsh-skin use official
```

同一时间只启用一款受管理的皮肤。本包使用 `ui-skin-maid-atelier` 接线 id，并将样式限制在 `body[data-dsh-maid-atelier]` 下。

## 素材来源与许可

本皮肤及其素材以 **CC BY-NC-SA 4.0** 发布。禁止商业使用，必须保留署名，衍生作品必须采用相同许可。

完整署名链记录在 [NOTICE](NOTICE) 中：

1. **上善** — 鲸鱼娘角色形象原作者（[Pixiv](https://www.pixiv.net/users/62155430)、[Bilibili](https://b23.tv/8h5L4xz)）。
2. **zipzip** — 基于上善角色、使用 GPT Image 2 生成并加入 DeepSeek 元素的女仆鲸鱼娘二次设计（[Pixiv](https://www.pixiv.net/users/18604994)、[Bilibili](https://b23.tv/Pnw6nG8)）。
3. **Small-tailqwq** — DeepSeek 元素素材再设计与本皮肤实现。

完整许可文本见 [LICENSE](LICENSE)，可编辑素材源文件位于 `assets/`。

## 开发

```sh
pnpm --filter @linxin666/dsh-client-ui-skin-maid-atelier build
pnpm --filter @linxin666/dsh-client-ui-skin-maid-atelier test
```

提交的 `lib/` 产物由本目录源码通过仓库共享的客户端构建预设生成。

## 已知限制

- CC BY-NC-SA 4.0 禁止商业使用，可能不符合部分下游分发政策。
- 角色位置依赖稳定的公开 DOM 标记；视图未提供相应标记时使用保守回退布局。
- 内嵌素材会使客户端 bundle 明显大于仅调色板皮肤。
