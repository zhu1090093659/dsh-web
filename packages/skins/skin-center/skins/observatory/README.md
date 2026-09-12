# 天文台 · Observatory

午夜靛 · 老黄铜 · 穹顶肋缝 · 时辰刻度

## 配色

| 角色 | 浅色 | 暗色 |
| --- | --- | --- |
| 画布 | `#f1efe9` | `#0a0c12` |
| 面板 | `#faf8f3` | `#0f121a` |
| 抬升面 | `#e6e2d8` | `#161a24` |
| 正文 | `#1b1d26` | `#e7e9ee` |
| 次要文字 | `#575a68` | `#8b90a0` |
| 描边 | `#d5d0c4` | `#232838` |
| 主色 | `#7a6530` | `#8e7a3e` |
| 强调 | `#9c8038` | `#c2a55a` |

对比度（正文 / 面板）：浅色 15.82:1，
暗色 15.41:1。

**这是暗色专用皮肤**：深色值同时写在 `:root` 与 `body[data-ds-dark-theme]` 上，
所以系统无论浅色还是深色，呈现的都是同一套；并用
`html { color-scheme: dark !important }` 压住跟随系统的原生控件。

## 背景：观测室底板 + 右侧立绘位

画布不是星图，是一张**生成的仪器底板**（scripts/observatory-plate.mjs），烘焙在
assets/dome-plate-light.svg 与 dome-plate-dark.svg 里。天文台不只是「看星星」，
它首先是一台仪器——所以母题是观测室本身：

  穹顶纬度环   四条极缓的同心弧，圆心远在画面上方，读作穹顶内壁的分带；
  穹顶肋缝     从同一圆心放射的接缝，向下张开，读作穹顶的扇形瓣；
  时辰刻度带   画面底部一条游标尺：长/中/短三级齿 + 十二时辰数字；
  铆钉排       刻度带下方一排黄铜铆钉，带高光——"这是铆起来的外壳"。

全部是线，没有一处面积填充。之前那版用星图加银河做底，问题就出在"面积型"的
东西一多就糊；线稿才立得住，也才像仪器。

构图预留了立绘位：底板在右侧约 40% 处被 SVG 内置的 mask 淡出成留白，并在立绘位
下方压了一道地平线弧与一枚极淡的承台光。所以立绘直接叠上去即可。

### 加立绘

1. 把图放到 skins/_assets/observatory/ 下（建议竖构图、透明底、主体偏右）；
2. 在 skins/_palettes.mjs 的 observatory 条目里加一行：
   background: { file: "standin.png", scrim: "linear-gradient(180deg, rgba(6,8,12,0.30) 0%, rgba(6,8,12,0.62) 100%)" },
3. 重新构建：node scripts/build-skin.mjs build observatory

构建会把它复制进 assets/，并在 skin.json 里声明 contributes.backgroundMedia
（明暗两模式指同一个文件）。scrim 用来压住立绘亮度、保住正文可读性——冰晶公主
那套就是这个做法。

## 会话顶栏：仪器窗框

顶栏（`[data-dsh-surface="session-header"]`）是全壳唯一一条横梁，按「仪表盘横梁」来做。
三件事全部只走线、不铺面：

  上缘黄铜轨   一条 inset 1px 的 b4 线，与 §1 整机外框的双线同族；
  穹顶肋缝     上缘 7px 内垂下 18px 间隔的极短竖线，与底板同一母题；
  左右铆钉     压在 10px 上内边距里的两枚铆钉，与面板接缝、新会话铭牌同族。

下缘那条 8px 游标刻度保持不动。顶栏 76px 的高度是在 `ConversationRoot` 里钉死的，
所以装饰全部走 `::before` / `::after` 与 `background-image` / `box-shadow`，不占布局。
明暗两模式靠 `--ob-b3/b4` 与 `--ob-rivet(-hi)` 自动翻转，没有硬编码色值。

> **不要用哈希类名定位。** 顶栏在源码里是 `css.header`（构建后形如 `rb_09W_header`），
> 但语义适配器已经给了稳定钩子 `[data-dsh-surface="session-header"]`
> （← `[data-slot="conversation.session.header"]`）。哈希类名每次官方重建都会换，
> 用 `node scripts/hooks.mjs` 查当前钩子表。

### ⚠️ 插槽出口陷阱（2026-09-12 实测踩到）

`data-dsh-surface` / `data-slot` 里凡是**插槽（slot）**的那几个，元素本身都带
`display: contents` —— **它不产生盒子，挂在上面的 `background-image`、`box-shadow`、
`::before` / `::after` 全部不绘制**。CSS 算得出来（`getComputedStyle` 有值），但屏幕上是空的，
属于最阴的一类静默失败。

实测（真实界面，observatory 暗色）：

  [data-dsh-surface="session-header"]   rect=[0,0,0,0]  display=contents  bgImage 有值但看不见

正确写法是**下探到出口的子元素**（那才是有盒子的那一层）：

  [data-dsh-surface="session-header"] > *       ← 真正的 .header
  [data-slot="details"] > *:first-child          ← 画 ::after 标签条时要限定一个，别画多遍

对照组：`[data-shell-overlay]`、`[role="dialog"]` 这类**不是插槽**的钩子有真实盒子，可以直接挂。

注意概念图（`_audit/observatory.mjs`）里的 `.topbar` 是个普通 div，**有盒子**，所以概念图
一直是「好看」的 —— 这类 bug 概念图抓不到，只能在真实界面上验。

## 构成

- `skin.json` — v2 清单
- `skin.css` — L1：全部 95 个 `--dsw-alias-*` 语义 token
- `patches.css` — L3：侧栏材质、首屏母题、输入卡、气泡、审批
- `preview/` — 预览图

无 hooks，无构建步骤。

## 安装

把本目录复制到 `~/.dsh/skins/observatory/`，然后在皮肤中心里选中它。

## 重新生成

在仓库根目录执行 `node scripts/build-skin.mjs build observatory`。
