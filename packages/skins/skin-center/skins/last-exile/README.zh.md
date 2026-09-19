# last-exile（最后流亡·先锋艇）

[English](README.md) | 中文

GONZO 经典科幻动画《最后流亡》（2003）同人主题：克劳斯与拉薇的先锋艇飞跃安纳托雷晴空与大风暴区。浅色为舱板橄榄黄铜与晴空云海（`vanship.jpg`），深色为暴风暗夜与克劳迪亚反重力幽蓝（`grandstream.jpg`），`--dsw-*` 调色板在亮/暗两态下完整重映射，主文本对比度达 14.1:1（WCAG AAA 级）。

## 安装

皮肤中心是唯一的加载器：先装它（或装全家桶聚合包），再从
[创意工坊](https://dsh-market.com) 把本皮肤安装到 `$DSH_HOME/skins/last-exile/`，
然后在「设置 → 皮肤」里试穿或应用。切换是原子的，无需重启。

## 构成

- `skin.json` — v2 清单：`contributes.stylesheet` / `patches` / `backgroundMedia`
  （light → `assets/vanship.jpg`，dark → `assets/grandstream.jpg`，各带实测校准遮罩）
- `skin.css` — L1：基础色 + 全部 `--dsw-*` 调色板重映射（亮色 `:root`、暗色 `body[data-ds-dark-theme]`）
- `patches.css` — L3：维多利亚复古工业磨砂面板、先锋艇仪表盘思考卡片、联队徽章（`assets/vanship-emblem.svg`）
- `hooks.mjs` — 运行时增强：昼夜壁纸平滑过渡与原声播放器
- `assets/` — 核心昼夜壁纸、矢量徽章与公有领域/开源立体声古典钢琴（德彪西《月光》与《第二号蔓藤华彩曲》）
- `NOTICE` — 角色与美术素材版权出处声明
- `LICENSE` — CC BY-NC-SA 4.0 许可证文本

## 预览

亮色（[preview/light.jpg](preview/light.jpg)）· 暗色（[preview/dark.jpg](preview/dark.jpg)）

## 版权声明

动画作品、角色形象及先锋艇机械设定出自 GONZO 制作、村田莲尔负责角色原案的《最后流亡》（LAST EXILE），版权归 GONZO、村田莲尔及原制作委员会所有。`assets/` 中的背景壁纸取自官方公开发布的宣传画与剧照，本皮肤作者不主张其权利；此处使用仅为个人、非商业的学习研究与同人展示，与 GONZO 无隶属或商业背书关系。

皮肤工程代码（`skin.json` / `skin.css` / `patches.css` / `hooks.mjs` 与调色板重映射）由作者制作，按 CC BY-NC-SA 4.0 发布——该许可**不涵盖**上述官方美术素材。详见 [NOTICE](NOTICE)。

> © 2003 GONZO / DIGIMATION - FlyingDog
