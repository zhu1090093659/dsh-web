# OUO Neko 收录验证记录（PR #1118）

验证对象：PR #1118（feat(pet): add OUO Neko v2 companion）完成分支 rebase 到
`origin/dev`（基线 ad3f49e99）后的真实 DSH Web GUI 接入验证。

## 环境

- 隔离 scratch 实例（不影响运行中的 dsh web / ~/.dsh）：DSH_HOME=/tmp/scratch1118/home，
  profile web（bundles: @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app），
  `dsh plugin --profile web add file:<重写聚合 tarball>`，家族包全部由本分支
  pnpm pack 提供（含 @linxin666/dsh-pet 0.3.3）。
- 服务：`dsh web --port 3091` → http://127.0.0.1:3091（keyless；首次引导点击
  "Configure later" 跳过 API key 配置）。
- 浏览器：headless Chromium（Playwright），1440×900。

## 验证结果

1. 注册表：页面同源 `GET /api/pet/pets` 返回 5 个条目，`ouo-neko` 列于首位，
   清单 `sprite2d.atlasRows: 11`（9 组动画 rows + 2 行 look），tracks 含
   idle / running-right / running-left / waving / jumping / failed / waiting /
   running / review，atlasUrl=/pet/ouo-neko/spritesheet.webp。
2. 设置选择器：设置 → 左侧「Pet」卡片。（截图 62；选项列表见脚本输出：
   Inherit / OUO Neko / 鲸鱼娘（原版）/ 鲸鱼娘（精致版）/ Koda / 知夏。）
3. 切换：选择 "OUO Neko" 并 Save 后 `GET /api/pet/state` 返回
   `pet.id=ouo-neko`、`name=OUO Neko`。（截图 63。）
4. 精灵切换：浮动精灵背景由 whale-girl 图集切为
   `url(.../pet/ouo-neko/spritesheet.webp)`，位置/尺寸一致（148×160）。
5. 动画：同区域 700ms 两帧截图字节不同（37819 vs 38339）——真实 GUI 中帧推进
   （截图 61-a / 61-b）。
6. 图集与 look 行：浏览器 canvas 解码 /pet/ouo-neko/spritesheet.webp →
   1536×2288（8 列 × 11 行，192×208 单元）；第 9/10 行共 16 个 look 单元
   非空 alpha（11339–16023 像素/单元，全部 > 0）。
7. 控制台/页面错误：无（pageerror：0，console error：0）。宠物设置卡片
   diagnostics 提示仅针对用户目录 koda/zhixia 的 v1 兼容（与本案无关）。

## 门禁

rebase 后仓库门禁全绿：pnpm typecheck / pnpm test（含 dsh-pet 全量）/
pnpm docs:check / pnpm aggregate:check / pnpm market:check（dist up to date 259 files）。
