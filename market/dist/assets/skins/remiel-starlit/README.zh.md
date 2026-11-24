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

### 0.1.3

- 锁定的侧栏透明度不再使系统的「降低透明度」无障碍开关失效。宿主在
  `@media (prefers-reduced-transparency: reduce)` 内把侧栏提到填充色的 90%
  （`AppFrame.module.css`），原先的 `!important` 会盖掉它。本版在同一媒体查询内
  重述宿主取值，由宿主的两段 `color-mix` 逐步推得：浅色 0.7478 × 0.90 = 0.673，
  暗色 0.58 × 0.90 = 0.522。
- 移除 `[data-dsh-surface]` 选择器：该属性在 `semantic-attrs-v1.md` 有登记，
  但当前没有任何插件产出，这些选择器永远匹配不到；规则改由 `[data-pane]`
  与类名兜底承担。
- **跨平台取舍，明确记录**：0.1.2 把三个平台统一钉到 macOS 的合成值（侧栏 0.30），
  Linux 与纯 web 宿主因此比 0.1.1 更透明（0.1.1 用的是未被稀释的 0.74）。
  这是「三平台观感一致」的既定代价，不是需要按平台回撤的回归。

### 0.1.2

- 平台一致性：锁死面板透明度，使 macOS 与 Windows 上的表面观感一致。官方
  shell 给侧栏用了两条平台专属表达式——macOS 走
  `color-mix(in srgb, color-mix(in srgb, var(--fill) 97%, #7a9bf0) 40%, transparent)`，
  把本皮肤的 0.74 alpha 稀释到约 0.299；Windows 直接用 `var(--fill)`（0.74）。
  且只有 Windows 的帧本体额外铺一层 `var(--fill)`，导致 0.62 的中栏合成到约
  0.901。新增段落对每个表面写定 `rgba` 并用 `!important`（侧栏浅色 0.30 /
  深色 0.29、帧本体中和为透明、中/右/底栏钉在 `bg-base`），把两个平台收敛到
  作者本机的结果。取值等于 macOS 的实际合成值（0.74 × 0.40），因此作者本人
  的观感不变（alpha 仅差 0.0008）。
- 移除 0.1.1 沿用下来的 git-graph 泳道配色与 composer 选择器 chip 段落：两者都以
  `data-gitgraph-*` 为锚点，而该属性唯一的生产者 `dsh-git-graph` 插件已下线，
  在当前安装里匹配不到任何元素，故删除而非留作死选择器。
- 锚点使用 dsh-web-all 兼容层补打的稳定钩子（`[data-pane="sidebar"]`、
  `[data-dsh-frame]`），CSS-Modules 类名只作兜底。已在真实页面验证：把同一组
  选择器改成红色探针后，侧栏确实变红。

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
