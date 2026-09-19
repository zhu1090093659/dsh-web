# porco-rosso（吉卜力·红猪侠）

[English](README.md) | 中文

吉卜力工作室经典动画《红猪》（1992）同人主题：萨伏亚 S.21 掠过亚得里亚海秘密海湾与平流天河。浅色为羊皮纸暖白与竞速炽红（秘密海湾），深色为深邃夜空与幽蓝星辉（平流天河），`--dsw-*` 调色板在亮/暗两态下完整重映射，主文本对比度达 14.2:1（WCAG AAA 级）。

## 安装

皮肤中心是唯一的加载器：先装它（或装全家桶聚合包），再从
[创意工坊](https://dsh-market.com) 把本皮肤安装到 `$DSH_HOME/skins/porco-rosso/`，
然后在「设置 → 皮肤」里试穿或应用。切换是原子的，无需重启。

## 构成

- `skin.json` — v2 清单：`contributes.stylesheet` / `patches` / `backgroundMedia`
  （light → `assets/porco001.jpg`，dark → `assets/porco002.jpg`，各带实测校准遮罩）
- `skin.css` — L1：基础色 + 全部 `--dsw-*` 调色板重映射（亮色 `:root`、暗色 `body[data-ds-dark-theme]`）
- `patches.css` — L3：磨砂透光面板、输入框定制、界面矢量图标（`assets/savoia-hero.svg` 与 `assets/porco-emblem.svg`）
- `hooks.mjs` — 运行时增强：昼夜壁纸平滑过渡与原声播放器
- `assets/` — 核心昼夜壁纸、矢量图标与公有领域立体声古典氛围钢琴（萨蒂《Gymnopédie No. 1》与肖邦《降E大调夜曲》）
- `NOTICE` — 角色与美术素材版权出处声明
- `LICENSE` — CC BY-NC-SA 4.0 许可证文本

## 预览

亮色（[preview/light.jpg](preview/light.jpg)）· 暗色（[preview/dark.jpg](preview/dark.jpg)）

## 版权声明

动画作品、角色形象及飞行艇机械设定出自宫崎骏导演、吉卜力工作室制作的《红猪》（紅の豚），版权归吉卜力工作室及原出品方所有。`assets/` 中的背景壁纸取自吉卜力官方公开发布的高清剧照，本皮肤作者不主张其权利；此处使用仅为个人、非商业的学习研究与同人展示，与吉卜力工作室无隶属或商业背书关系。

皮肤工程代码（`skin.json` / `skin.css` / `patches.css` / `hooks.mjs` 与调色板重映射）由作者制作，按 CC BY-NC-SA 4.0 发布——该许可**不涵盖**上述官方美术素材。详见 [NOTICE](NOTICE)。

> © Studio Ghibli
> © 1992 Studio Ghibli - NN
