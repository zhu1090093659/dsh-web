# white-snake（白蛇·缘起浮生）

[English](README.md) | 中文

追光动画经典巨作《白蛇：缘起》与《白蛇：浮生》国风同人主题：西湖烟雨断桥借伞与永州雪岭巨蟒宿命。浅色为素绢水墨与碧玉翡翠绿（`broken-bridge.jpg`），深色为寒潭玄青与月华冷玉白（`snake-destiny.jpg`），`--dsw-*` 调色板在亮/暗两态下完整重映射，主文本对比度高达 15.7:1（WCAG AAA 级）。

## 安装

皮肤中心是唯一的加载器：先装它（或装全家桶聚合包），再从
[创意工坊](https://dsh-market.com) 把本皮肤安装到 `$DSH_HOME/skins/white-snake/`，
然后在「设置 → 皮肤」里试穿或应用。切换是原子的，无需重启。

## 构成

- `skin.json` — v2 清单：`contributes.stylesheet` / `patches` / `backgroundMedia`
  （light → `assets/broken-bridge.jpg`，dark → `assets/snake-destiny.jpg`，各带实测校准遮罩）
- `skin.css` — L1：基础色 + 全部 `--dsw-*` 调色板重映射（亮色 `:root`、暗色 `body[data-ds-dark-theme]`）
- `patches.css` — L3：东方素绢磨砂卡片、碧玉发丝微光描边、碧玉簪与水墨线稿（`assets/white-snake-emblem.svg` 与 `assets/white-snake-hero.svg`）
- `hooks.mjs` — 运行时增强：昼夜壁纸平滑过渡与西湖留声播放器
- `assets/` — 核心昼夜壁纸、矢量图标与公有领域立体声水墨禅意钢琴（萨蒂《Gnossienne No. 1》与《Gnossienne No. 3》）
- `NOTICE` — 角色与美术素材版权出处声明
- `LICENSE` — CC BY-NC-SA 4.0 许可证文本

## 预览

亮色（[preview/light.jpg](preview/light.jpg)）· 暗色（[preview/dark.jpg](preview/dark.jpg)）

## 版权声明

动画电影、角色形象及场景设定出自追光动画制作的《白蛇：缘起》与《白蛇：浮生》，版权归追光动画及联合出品方所有。`assets/` 中的背景壁纸取自追光动画官方公开发布的高清剧照与海报，本皮肤作者不主张其权利；此处使用仅为个人、非商业的学习研究与同人展示，与追光动画无隶属或商业背书关系。

皮肤工程代码（`skin.json` / `skin.css` / `patches.css` / `hooks.mjs` 与调色板重映射）由作者制作，按 CC BY-NC-SA 4.0 发布——该许可**不涵盖**上述官方美术素材。详见 [NOTICE](NOTICE)。

> © Light Chaser Animation Studios
