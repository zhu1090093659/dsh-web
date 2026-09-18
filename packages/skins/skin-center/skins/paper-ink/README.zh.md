# 纸墨 Paper Ink

[English](README.md) | 中文

一张纸、一瓶墨。层级靠明度不靠色相，分隔靠留白不靠边框和阴影——dsh web GUI
皮肤，以纯资产目录形态内置在皮肤中心包内。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（token 重映射）+
  `patches.css`（很窄的逃生舱）。无 package.json、无构建步骤；皮肤中心包是
  唯一加载器。
- **token 优先**：亮色值挂在 `:root`，暗色值挂在 `body[data-ds-dark-theme]`。
  官方 278 个 `--dsw-*` 语义 token **逐个重映射**——97 个颜色、181 个字体——
  另加官方组件直接读取的 50 个 `--dsw-static-*` 调色板条目。没有一处漏回
  加载器派生的调和色，也没有一处留着官方蓝。
- **同一个墨色，四档透明度**：文字层级是同一支墨的 100 / 78 / 70 / 56 百分比。
  不为了分层而发明第二种色相。
- **七级实心灰阶**：色块用 `--pi-l1`…`--pi-l7`，按相对亮度等比分级，相邻两级
  相差约 1.57:1，所以单色图表仍然读得出来。
- **三个状态色**：ok / warn / risk。「业务态」与链接 token 归墨色，info 按钮
  借 warn——出现第四个颜色，单色系统就不再是单色的了。
- **不发光、不渐变、不玻璃拟态、无阴影。** 两个 `--dsw-linear-*` 色带 token
  落成实心色调，`--dsw-mask-blur` 为 0，整组阴影是零尺寸透明阴影。

## 背景

`assets/paper-ink-light.jpg` 与 `assets/paper-ink-dark.jpg` 由
`contributes.backgroundMedia` 声明，亮暗各一张。每张是宣纸纹理打底，上面
**一笔**水墨：这一笔是圆笔尖沿一次运笔扫过的区域，笔尖的宽度与含墨量沿路径
变化，所以两端都收成尖，而不是断在一个齐口的胶囊上。暗色那张是同一张纸反过来
——墨底上的纸色笔迹。两张图里都没有渐变也没有光晕；笔迹内部的深浅是笔尖的
含墨量，不是色阶。

## 字体

`assets/fonts/` 自带 Inter、IBM Plex Sans Thai 与 IBM Plex Mono，用
`@font-face` 以相对路径引用（27 个子集文件，424 KiB）。拉丁与拉丁扩展承载
界面文字，泰文承载泰语界面；中文交给字体列表末尾的系统栈——中文子集好几 MB，
而每台桌面本来就有更好的那一套。三个字体家族均为 **SIL Open Font License 1.1**；
皮肤自身的代码与素材为 MIT（见 `skin.json` 的 `license`）。

## 补丁

`patches.css` 只有五条规则，每条都写明它为什么存在：皮肤背景在屏期间关掉输入区
默认的磨砂（把 `--dsh-input-card-blur` 归零，而不是再叠一层 backdrop-filter
去对抗它）、把官方壁纸承载面置透明、隐藏空会话态那圈光晕（本皮肤没有光晕），
以及改指两处 token 表之外的官方着色——文件类型图标色，与输入区发送按钮：它是
官方唯一一个不读主行动四件套、而读 `button-info-fill` 的实心控件。

## 预览

```sh
pnpm market:build                            # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=paper-ink&theme=light
node scripts/capture-previews paper-ink       # 重拍 preview/{light,dark}.jpg
```

## 已知限制

- 纯呈现层：只改浏览器样式，不触及模型请求。
- 不含 `hooks.mjs`，整套皮肤是纯声明式的。
- 中文界面沿用系统字体。这是刻意做的体积取舍，不是漏做；字体列表末尾就是系统
  中文栈，所以不会掉回衬线默认字体。
