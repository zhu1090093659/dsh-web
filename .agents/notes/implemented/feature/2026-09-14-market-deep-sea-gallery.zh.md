# Agent Note: dsh-market.com 站点的深海画廊改版

Status: implemented

## Problem

dsh-market.com 创意工坊首页此前把作品目录当作内部索引来呈现：页头、按分区切换的颁奖台，以及密集的卡片网格。负责人批准了新的视觉方向——深海画廊原型——把首页变成编辑式的入口：一句主视觉导语、一个人气推荐陈列，以及带个人收藏的发现网格。生产站点必须采用这套设计，同时不能丢掉已有行为：实时清单、投票与安装计数、Turnstile 门禁的点赞、按类别区分的详情媒体与安装说明、皮肤实时试穿链接，以及匿名页面访问统计。

## Decision

`market/src/index.html` 与 `market/src/app.js` 实现深海画廊版式，同时保留生产数据层。

- 背景：固定的 WebGL 流体波浪画布，其上叠加 screen 混合的鲸尾海景；鲸尾图片是站点自有资产 `market/src/assets/ocean-whale.webp`。
- 页头：品牌「DSH Market / 创意工坊」；导航分页 编辑推荐 / 探索 / 皮肤 / 宠物 / 插件 / 预设，默认 探索（新增的 `all` 类别）；搜索框；GitHub Star 链接。
- 导语与陈列：衬线主标题「让工具，长成你喜欢的样子。」，以及只在 探索 页显示的三角陈列（一张主卡加两张侧卡）。陈列按投票数排序皮肤，票数相同再看目录顺序。
- 发现列表：发现更多分区包含结果计数、排序下拉（按人气 / 按安装量 / 按默认 / 名称排序）、我的收藏筛选、标签行、四列卡片网格与加载更多。
- 筛选：插件与预设保留「一级分类 + 二级分类」的两级筛选；皮肤与宠物（以及任意搜索或收藏视图）显示带中文名的标签筛选。编辑推荐（后续新增，见[该决策记录](2026-09-16-workshop-editor-picks.zh.md)）不显示标签行，保持清单固定顺序，并禁用排序下拉。
- 收藏：我的收藏把 `kind:id` 列表按设备存进 `localStorage`（`dsh-market-saved`），在详情弹层里切换；收藏数据绝不发送到服务端。
- 卡片：皮肤显示亮色预览；宠物显示首帧预览并完整居中于固定比例的媒体区；插件与预设显示文字卡（图标、分类、描述）。皮肤、插件与预设名称仍然链接到 `item.repo`。
- 详情弹层：按类别区分的媒体与安装说明保持不变（皮肤亮/暗预览与实时试穿、宠物预览与精灵表、可复制的插件 npm 命令、预设安装步骤），末尾新增点赞按钮与「收藏作品」操作。
- 动效：页脚的「背景动效」开关同时切换 `window.marketWave.setEnabled(...)` 与 `.ocean.paused` 类；在 `prefers-reduced-motion: reduce` 下强制关闭。
- 深链：`#kind:id` 在加载时打开对应详情弹层，关闭时清除。
- 移除按分区切换的颁奖台。

## Build and asset pipeline

`scripts/market-build` 现在也会把 `market/src/assets/**` 镜像进 `market/dist/assets/**`，让站点能像引用其他静态资产一样引用鲸尾图片。重新生成的 `market/dist`（含 `manifest/*.json` 的 `generated` 日期）已提交。

## Markup contracts preserved

市场版式回归测试固定了四项站点契约，本次改版全部保留：HTML 中的 `data-kind="preset"` 页签、回链仓库的卡片名称所用的 `el('a', 'mk-card-name')` 与 `name.href = item.repo`、宠物媒体所用的 `media.classList.add('mk-card-media-pet')`，以及宠物完整展示规则 `max-height: calc(100% - 16px);`。

## Alternatives considered

- 直接上线独立原型产物（其 `dist/index.html`、`data.js`、`waves.js`、模拟点赞与安装量、模拟安装流程）：不取，因为这会用模拟数据与演示安装流程替换真实的 API 投票、安装计数与安装说明。
- 保留颁奖台版式只调整配色：不取，因为批准的方向改变的是信息架构（导语、人气陈列、发现网格、收藏），不只是颜色。
- 打包原型的子集字体（`DSH Editorial`、`DSH Chinese`、`DSH Sans`）：不取；系统 `Songti SC` 与 `Noto Serif SC` 回退已经承载编辑式观感，无需新增约 650 KB 二进制资产与一份字体许可。
- 采纳原型的「最新发布」排序：不取；生产清单没有发布日期，因此下拉提供 按人气 / 按安装量 / 按默认 / 名称排序。

## Consequences

- 首页默认打开 探索，它聚合四类作品（本版共 134 件）；其他页签仍然只显示单一类别。
- 收藏只存在浏览器本地，不影响安装量与投票统计。
- 鲸尾图片为 `market/dist` 增加约 41 KB 二进制资产；提交的 dist 仍可通过 `node scripts/market-build --check` 复现。
- 按安装量排序使用 `/api/stats` 的安装计数，接口不可用时退化为投票与目录顺序（静态预览服务器会显示离线提示）。
- 两个 README 引用的 `docs/screenshots/31-market-home.png` 已刷新为新首页。

## Testing

- `node scripts/market-build` 之后 `node scripts/market-build --check` 报告提交的 dist 与源码一致。
- `node --test scripts/market-layout.test.mjs scripts/market-build-clean.test.mjs` 通过（12 个测试），含干净检出下的 `--check` 夹具。
- 用 Playwright 驱动 Chrome 在 1512x950 与 390x844 下实测渲染页面：探索 落地页、皮肤/宠物/插件页签、插件一级与二级分类筛选、含亮暗预览的详情弹层、收藏开关与我的收藏筛选，以及移动端版式；没有预期外的控制台错误。
