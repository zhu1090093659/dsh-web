# remiel-starlit（蕾米埃尔·星翎）

[English](README.md) | 中文

米哈游《绝区零》角色同人主题：樱粉 / 冰蓝 / 夜靛半透明玻璃。浅色如晨雾羽光
（`calm` 场景），深色以紫红与靛黑承接夜靛舞台（`nocturne` 场景），
`--dsw-*` 调色板在亮 / 暗两态下完整重映射（static / alias / specific / aion）。

## 安装

皮肤中心是唯一的加载器：先装它（或装全家桶聚合包），再从
[创意工坊](https://dsh-market.com) 把本皮肤安装到 `$DSH_HOME/skins/remiel-starlit/`，
然后在「设置 → 皮肤」里试穿或应用。切换是原子的，无需重启。

## 构成

- `skin.json` — v2 清单：`contributes.stylesheet` / `patches` / `backgroundMedia`
  （light → `assets/remiel-calm.jpg`，dark → `assets/remiel-nocturne.jpg`，各带原有遮罩）
- `skin.css` — L1：基础色 + 全部 `--dsw-*` 调色板重映射（亮色 `:root`、暗色 `body[data-ds-dark-theme]`）
- `patches.css` — L3：滚动条 / 选区 / 链接 / focus、aion 右侧面板、composer，以及
  `[role="dialog"]` 设置弹窗的方形专属背景（引用 `assets/remiel-settings-*.jpg`）
- `assets/` — 场景图与设置弹窗方图
- `NOTICE` — 角色版权与素材来源声明

本皮肤是纯声明式实现：不含 `hooks.mjs`，背景与弹窗全部经 `contributes` 与 CSS 承载。

## 变更

### 0.1.1

- 修复亮色与暗色的可读性对比度。暗色块不再镜像反转 `--dsw-static-neutral-*`
  梯度：这组 token 在官方主题里是与主题无关的绝对色板，而宿主用它们铺面的
  组件（deliverables / plan / schedule / forge / changed-files 卡片的底板取自
  `--dsw-static-neutral-850`）在反转后成了浅底配浅字。`--dsw-static-neutral-00`
  保持白色，因为宿主把它当白色叠加层用（图标底板、阴影发光、侧栏闪烁高亮）。
- 亮色半透明表面降低透明程度（`bg-base` 0.42 提到 0.62，`sidebar-fill` 0.60
  提到 0.74，以及 `layer-1..3`、气泡、输入框、选择器），使三级与说明文字压在
  背景图较暗区域时仍然可读；相应地加深了这三档文字色。
- 补齐 `--dsw-alias-link` 与 `--dsw-alias-toast-label`。这两个此前从未重映射，
  链接因此落到官方那套在本皮肤表面上发灰的粉色上。

实测：暗色卡片底板与 `label-primary` 由 1.28:1 提升到 11.07:1，全部表面/文字/
主题组合均通过 WCAG AA 4.5:1。

## 预览

亮色（[preview/light.jpg](preview/light.jpg)）· 暗色（[preview/dark.jpg](preview/dark.jpg)）

## 版权

角色与素材出自米哈游《绝区零》(Zenless Zone Zero)，版权归米哈游所有。`assets/` 中的
背景图与设置弹窗方图取自米哈游官方公开素材（官网下载），本皮肤作者不主张其权利；此处
使用仅为个人、非商业的粉丝同人展示，与米哈游无隶属或背书关系。

皮肤工程（`skin.json` / `skin.css` / `patches.css` 与调色板重映射）由作者制作，
按 CC BY-NC-SA 4.0 发布——该许可**不涵盖**上述官方素材。详见 [NOTICE](NOTICE)。

依据《绝区零》官方「素材使用及同人创作」公告，此处为非商业性质的个人使用，并放置
官方要求的著作权标识与法律宣告：

> © All rights reserved by miHoYo
>
> Other properties and any right, title, and interest thereof and therein
> (intellectual property rights included) not derived from 《绝区零》 belong to
> their respective owners.
