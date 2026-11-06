# 物料三 · 紫调 (md3)

给 dsh 写的 **Material Design 3** 皮肤，官方 Baseline 紫调原版。亮暗两套都直接用 MD3 官方 **Baseline** 调色板，
所有 `--dsw-*` 令牌按 MD3 颜色角色重映射，不做自创配色。

## 角色映射

| MD3 角色 | 亮色 | 暗色 | 落到 dsh 令牌 |
| --- | --- | --- | --- |
| surface | `#fef7ff` | `#141218` | `--dsw-alias-bg-base` |
| surface-container-low → highest | `#f7f2fa` → `#e6e0e9` | `#1d1b20` → `#36343b` | `bg-layer-1…4` |
| primary | `#6750a4` | `#d0bcff` | `brand-primary` / 主按钮 / 链接 |
| on-primary | `#ffffff` | `#381e72` | `label-primary-foreground` |
| primary-container | `#eaddff` | `#4f378b` | 用户气泡 `specific-bubble` |
| secondary-container | `#e8def8` | `#4a4458` | 侧栏激活项 / 行内代码 |
| tertiary | `#7d5260` | `#efb8c8` | 代码关键字色（预览） |
| error | `#b3261e` | `#ffd6d2` | `state-error-*` |
| outline / outline-variant | `#79747e` / `#cac4d0` | `#938f99` / `#49454f` | `border-l1…l4` |
| inverse-surface | `#322f35` | `#e6e0e9` | tooltip / toast |

## MD3 的三条规矩，这套皮肤怎么落

1. **高程靠色调，不靠阴影** —— surface 五级容器铺出层次，抽屉、卡片、输入框各占一档。
2. **状态层** —— hover 叠 8% 前景色、按下叠 12%（`patches.css` 里的 `rgba()` 状态层，`color-mix` 可用时走等价写法）。
3. **形状尺度** —— 圆角 4 / 8 / 12 / 16 / 28：小控件 4，卡片 12，气泡 20，浮层与输入条 28。

## 安装

```sh
cp -r md3 ~/.dsh/skins/md3          # 标准安装
cp -r md3 <PACK_HOME>/skins/md3     # 打包版桌面客户端（profile 自带 DSH_HOME）
```

在 **设置 → 皮肤中心** 里试穿 / 应用；无需重启，刷新页面即收录。

## 目录

```
md3/
├── skin.json       v2 清单（accent = #6750A4）
├── skin.css        MD3 角色 → dsh 令牌，亮暗两套
├── patches.css     状态层、3px 焦点指示器、标题字重、行内代码前景
└── preview/        亮 / 暗两态预览（真实宿主机截图，1910×973）
```

## 底板（backgroundMedia · 20 秒漂浮循环）

底板是一段 1440×810 / 10fps / 20 秒的**无缝循环视频**，几何线框在上面缓慢漂浮。

| 文件 | 用途 | 内容 |
| --- | --- | --- |
| `assets/float-light.mp4`（188KB） | 亮色底板 | 底 surface `#fef7ff`；线稿 `#79747e`；色团 `#eaddff` / `#e8def8` / `#ffd8e4` |
| `assets/float-dark.mp4`（204KB） | 暗色底板 | 底 surface `#141218`；线稿 `#cac4d0`；色团 `#4f378b` / `#4a4458` / `#633b48` |
| `assets/bg-*.png` | 静态兜底（= 视频首帧） | 想关动效就把 `src` 指回它、`type` 改回 `image` |
| `tools/float.html` | 动画渲染页 | `?theme=dark&t=12.3` 给出该时刻的精确画面 |

**为什么是无缝的**：每个元素的位移都是周期 `T = 20s` 的整数倍正弦（x 用 1 倍频、y 用 2 倍频），`t = 20` 时状态与 `t = 0` 完全相同，首尾相接不跳。七个线框体各带不同相位、±12–26px 振幅，再叠 ±0.09rad 的慢自转与 ±3% 的呼吸；三枚色团动得更小更慢（远景），主色细环随色团走，形成很轻的视差。实测接缝帧差 `YAVG 0.167`，与普通相邻帧 `0.161` 同级——看不出拼接点。

**怎么重做**：

```sh
# 1) 逐帧渲染（200 帧 = 20s × 10fps）
chrome --headless=new --window-size=1440,810 \
  --screenshot="frames/dark-007.png" "file:///…/tools/float.html?theme=dark&t=0.70"
# 2) 编码成循环视频
ffmpeg -framerate 10 -i frames/dark-%03d.png -c:v libx264 -crf 30 \
  -pix_fmt yuv420p -movflags +faststart -an assets/float-dark.mp4
```

**宿主侧怎么放**：`backgroundMedia.type: "video"` 让皮肤中心用 `<video muted loop autoplay playsinline object-fit:cover>` 铺满底板层，自带合成层；每段只有 ~200KB、10fps 的近似静止画面，解码开销很低。底色仍是 surface 令牌原色，所以合成后画布还是精确的 `#fef7ff` / `#141218`。

**不想要动效**：把 `skin.json` 两处 `src` 换回 `assets/bg-light.png` / `bg-dark.png` 并把 `type` 改成 `image`；或者把皮肤中心卡片的「遮蔽」滑杆拉满，直接压掉底板。

（`tools/float-*.html` 是作者侧的逐帧渲染页，不随皮肤发布；包内只保留被 manifest 引用的媒体和静态兜底首帧。）

## 备注

- 1.1.0：底板改成 20 秒无缝循环视频（`backgroundMedia.type: video`），几何体缓慢漂浮；静态版仍留在 `assets/bg-*.png`。
- 1.0.1：修掉 hover / 按下状态层把整行填成实心前景色的 bug（`currentColor 8%` 是渐变色标位置，不是透明度）；改为带 alpha 的颜色叠加，并在支持 `color-mix` 的浏览器上用前景色 8% / 12%。

- 无 `hooks.mjs`：底板是预渲染的 20 秒循环，其余全部静态色值，滚动与会话切换零额外开销。
- MD3 的字阶本来配 Roboto；字体归 dsh 的「字体设置」管，本皮肤不抢用户的选择。
- 未重映射的 `--dsw-*` 由加载器按母色 `#6750a4` 衍生，官方新面板也保持紫色调。