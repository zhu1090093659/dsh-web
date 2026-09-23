# 虫巢 · Hive Maw

几丁质壁 · 卵囊光点 · 隧道肋弧 · 垂棘刻度

## 配色

| 角色 | 值 |
| --- | --- |
| 画布 | `#060a07` |
| 面板 | `#0b120c` |
| 抬升面 | `#121b14` |
| 正文 | `#e2eadf` |
| 次要文字 | `#93a694` |
| 描边 | `#24352a` |
| 主色 | `#63a871` |
| 强调（生物荧光） | `#8fe3a6` |
| 危险（女王红眼） | `#c4544a` |

**暗色专用皮肤**：深色值同时写在 `:root`、`body`、`body[data-ds-dark-theme]` 三处，
系统无论浅色还是深色都呈现同一套；`:root { color-scheme: dark !important }` 压住原生控件。

## 母题

- 侧栏/详情栏接缝：几丁质双缝 + 一列卵囊光点（`[data-pane]::after/::before`）
- 会话顶栏：斜向几丁质 hatch 横梁 + 两端卵光点 + 下缘鳞状垂缘
- 输入卡：四角甲壳弧缘 + 上缘卵链
- 工作区：卵室柜格（点阵 + 外框 + 取景角标）
- 首屏：隧道肋环 + 卵囊簇 + 深处一对红眼（`assets/hive-hero-dark.svg`）
- 整机外框：几丁质双线（overlay 伪元素）
- 审批卡：全场唯一的红，45° 斜纹

## 构成

- `skin.json` — v2 清单（严格过 skin-manifest-v2.schema.json）
- `skin.css` — L1：官方 token 表 97 个非字体 token 全量重映射
- `patches.css` — L3：壁面 / 接缝 / 横梁 / 输入卡 / 首屏 / 柜格 / 外框
- `assets/` — 背景图与三件线稿 SVG
- `preview/` — 预览图

无 hooks（`facets.client` 缺省），无构建步骤。

## 接口兼容

catalog（origin=user、零警告）/ active / verify（valid）/ stylesheet / patches /
assets / preview / uninstall（纯资产目录）全接口实测通过；
主 CTA 四件套齐备，前景 `#081209` 对填充 `#63a871` 对比度 6.7:1。

## 安装

把本目录复制到 `~/.dsh/skins/hive-maw/`，在皮肤中心选中即可；
或直接编辑 `~/.dsh/skin-center-active.json` 的 `active` 字段。
