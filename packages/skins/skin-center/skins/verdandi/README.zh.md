# 薇儿丹蒂 · 纯白圣誓 (Verdandi · White Vow)

[English](README.md) | 中文

面向 dsh Web GUI 的薇儿丹蒂「纯白之誓」主题皮肤：深红承担导航与会话冠带，
婚纱白承担阅读与编辑面，柔金只留给骑士纹章与交互刻线；亮色与暗色两种方案
都是完整实现。

## 这是什么

- **纯资产目录**：`skin.json`（v2 清单）+ `skin.css`（L1 token 层，含 v1 插件
  通过 `theme.overrideTokens` 安装的五个官方 `--dsw-alias-*` 别名）+
  `patches.css`（L3 自由选择器）+ `hooks.mjs`（唯一且已文档化的逃逸舱）+
  `assets/`。没有 package.json，没有构建步骤。
- **自 v1 插件皮肤逐字节移植**（`@hjbztlbr/dsh-client-ui-skin-verdandi`），
  使用 `scripts/dsh-skin-migrate-v2.mjs`。这里的 19 张栅格美术与 v1 bundle
  内联的常量逐字节相同；6 个 SVG 装饰出于同样原因仍以 data URI 内联在
  `hooks.mjs` 里。
- **栅格美术由 `assets/` 提供**：v2 管线把送达的 CSS 内联进 `<style>` 标签且
  不重写相对 `url()`，相对 `assets/...` 会以文档为基址解析从而 404。因此由
  hooks 用 `ctx.assetBase` 设置 27 个 `--vd-art-*` body 变量，位置与 v1 插件
  用内联 data URI 设置的位置完全一致。
- **类名已稳定**：v1 构建把 CSS-module 哈希（`DqQE8W_characterStage`）烤进了
  样式表与运行时；这里改为皮肤自有的 `vd-characterStage`、`vd-characterFigure`、
  `vd-figureLeft`、`vd-figureRight`，`patches.css` 与 hooks 使用同一组名字。
- **有意不声明 `contributes.backgroundMedia`**：v1 把亮暗场景画在会话区内部，
  取自 `--vd-art-workspace-*`，因此侧栏或详情栏展开时背景会随聊天列一起收缩；
  而 `backgroundMedia` 填的是固定全视口层，声明它会让同一张美术画两遍，并把
  背景铺到侧栏与详情栏之下。场景保持在 v1 的位置。
- **宽表收进卡片**：宿主对 ≥4 列的表会画得比消息栏更宽，并在悬停之前隐藏溢出——
  这假设助手消息是没有边框的裸文本块。本皮肤把消息画成带描边的纸卡，同一段出血
  会读成内容跑出卡片；`patches.css` 因此把包裹层收回 `width: 100%` 并让单元格
  换行，宽表与窄表一样在卡片内显示，代价是不再保留宿主的出血效果。

## 素材

`assets/` 下 19 个 WebP/JPEG 文件，运行时经 `ctx.assetBase` 解析。左右人物立绘、
亮暗工作区场景、侧栏婚纱 CG、助手头像组合、输入区戒指与详情栏彩蛋均取自游戏内
资源，权利边界见 `NOTICE`；三张白纱角饰与邀请函文件夹图标为本项目原创。

## 动态与装饰

`hooks.mjs` 是唯一可执行部分，且是 v1 插件客户端效果的直接移植：

- 装饰节点（`data-verdandi-decoration`）挂载在官方锚点上（侧栏、会话冠带、
  输入卡、详情栏、助手 Markdown 行），并在会话区内部构建角色舞台；
- 在 `body` 与会话区投影状态（`data-verdandi-workspace` / `modal-open` /
  `sidebar-size` / `phase` / `view`、`data-verdandi-header`、`data-verdandi-slip`）；
- 一个挂在文档根上的 MutationObserver、一个覆盖被测量目标的 ResizeObserver，
  以及每次变化一帧的动画帧调度；全部效果经 `ctx.onCleanup` 完整回收。

## 配色

- 导航：深红 `#8e2438`（深 `#681626`、暗 `#4e0f1d`）
- 阅读面：婚纱白 `#fffdfb`、暖纸 `#f8f2ed`
- 强调：柔金 `#c7a86b`（亮 `#e6d5a9`）
- 暗色方案：深红提亮为 `#9d2d43`，婚纱白转为 `#21151a`

## 权利

代码与原创装饰采用 MIT。取自游戏的素材不在此授权范围内，且保持非商业用途；
完整边界与署名链见 `NOTICE`。本皮肤为非官方作品，与游戏权利方及 DeepSeek
Harness 官方均无隶属或授权关系。

## 预览

`preview/light.png` 与 `preview/dark.png` 是创意工坊画廊使用的试穿渲染图。
