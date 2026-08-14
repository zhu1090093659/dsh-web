# Skin Center（GUI 内嵌皮肤中心）

`@linxin666/dsh-client-ui-skin-center`（cordis 插件 id `ui-skin-center`）把皮肤列表/试穿/应用
内嵌进真实 dsh Web GUI 的插件配置页，作为「Web UI 插件」组里的一张卡片
（设置 → 插件配置 → Web UI 插件 → 皮肤中心），与 task-board / pet / live-stats 等
全家桶插件同一套槽位（`web-ui.plugin.item`），不占设置页一级导航。

- 列表：展示「官方默认」+ 仓库里全部皮肤（qq98 / ths / xp / blue-fantasy / dragon-heir /
  minecraft）的名称、tagline、强调色；当前激活的目标带 Active 标记。
- 试穿：点击「Try on」后按需加载该皮肤的 client bundle——host 路由
  `/api/skin-center/bundle/<id>` 以同源 script 提供 `lib/client.js`（内核加载插件的同一机制），
  factory 注册到页面自己的 `window.__ModuleLoader__`，`window.__DSH_MODULES__.import` 物化
  （不是模拟器、不用 eval），chrome 立即生效；
  亮/暗切换走官方 theme 服务；「Exit try-on」完全还原——当前皮肤的样式、DOM、favicon、
  标题、body 内联样式全部恢复。「官方默认」也可试穿：点一下皮肤立即收回、回到官方外观预览。
- 互斥：试穿期间会按配方暂时收回当前激活皮肤的视觉写面（body 属性、背景内联样式、
  chrome 子节点、xp 的 footer taskbar），退出后原样恢复；同一时刻页面上只有一套皮肤。
- 应用：host 半区（`src/index.ts` + `src/routes.ts`）暴露 `/api/skin-center/apply` 与
  `/api/skin-center/bundle/<id>`（按需提供皮肤 bundle），
  点击「Apply / 恢复默认」即在服务端执行 `dsh-skin use <name>`（或 `use official`），
  写入 `~/.dsh/cordis.patch.yml` 后由 DSH 配置 watcher 秒级热载入，页面自动刷新生效——
  **无需重启 dsh web，无需复制命令**。应用失败时错误提示里附带终端兜底命令。
  host 依赖 `dsh-skin` CLI 在 PATH（`~/.local/bin/dsh-skin`，仓库 `scripts/dsh-skin`）。
  Windows 兼容性：`dsh-skin` 的 harness home 取 `$DSH_HOME`（缺省 `~/.dsh`），仓库根目录从
  脚本自身位置推导（可用 `DSH_SKIN_REPO` 覆盖），不依赖 `$HOME` 与固定路径；Windows 用户
  自建 `dsh-skin.cmd` 包装（内容 `node scripts/dsh-skin %*`）放入 PATH 目录即可。host 端在
  Windows 上经 shell 调用该命令——`execFile` 无法直接启动裸名 `.cmd`。

## 安装（官方 plugin bundle 方式）

推荐先装皮肤全家桶聚合包 `@linxin666/dsh-skins` 一次到位（含全部皮肤与皮肤中心）；
只装本包时用下列 link 命令。

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装皮肤中心
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/skin-center
```

`$(pwd)` 指克隆全家桶仓库后的目录。

skin-center 是符合 DSH 官方插件标准的自包含 bundle（`dsh.bundle.patch` 指向
`cordis.patch.yml`、`prepare` 用专用 tsdown 配置自包含构建，无项目引用、无类型检查），
也可经 git 安装：`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`
（`prepare` 会原地构建 `lib/`）。

本地 link 安装前需先在全家桶仓库内构建产物（`lib/` 被 git 忽略、不随仓库提交）：
`pnpm install && pnpm -r build` 后再 link 安装。

pnpm ≥10 安装 git 依赖前需先授权 `allowBuilds`（`prepare` 会原地构建），本地 link 安装则无此要求。

需要皮肤插件们（qq98 / ths / xp / blue-fantasy）在宿主里也可解析时，skin-center 才能
完整列出 / 试穿全部皮肤；skin-center 本身无互斥要求。

## 目录结构

```
skins/skin-center/
  package.json / tsdown.config.ts / tsconfig.json   # checkout 内构建所需的元数据
  src/index.ts                                       # host 侧：注册 /api/skin-center/* 路由
  src/routes.ts                                      # host 路由（代理 dsh-skin CLI）
  src/invariant.ts                                   # invariant 伴随插件（无断言）
  src/client/index.ts                                # apply：注册 Web UI 插件组卡片 + body 作用域
  src/client/SkinCenter.tsx                          # 卡片组件（官方默认 + 列表/试穿/亮暗/一键应用）
  src/client/try-on.ts                               # 试穿引擎（真实 loader + 互斥还原，含官方试穿）
  src/client/locales.ts                              # en/zh 文案
  src/client/skin-center.module.css                  # 面板样式（--dsw-* token，随皮肤自适应）
  src/client/generated/skins.ts                      # 生成：皮肤注册表（仅元数据，勿手改）
```

## 机制要点

- 皮肤枚举：`generated/skins.ts` 由 `scripts/skin-center-bundles` 生成（读
  `skins/<name>/skin.json`，校验 `lib/client.js` 存在）。**只含元数据，不内嵌 bundle 文本**：
  冷启动不解析 ~700KB 的 base64 美术资源，且生成文件跨机器可复现（无构建机绝对路径）。
- 试穿加载：host 路由 `/api/skin-center/bundle/<id>` 按需提供 `lib/client.js`
  （同源 script，`<script>` 标签加载——与内核 `defaultLoadBundle` 同一机制），bundle 体调用
  `window.__ModuleLoader__.load` 只注册 factory；`window.__DSH_MODULES__.import(package)`
  物化模块（CSS `<style data-plugin>` 自动注入）；`surface.apply(miniCtx)` 挂载，
  miniCtx 只实现 `effect(cb)`（皮肤唯一依赖）。不依赖 eval，因此不要求 CSP 放行
  `unsafe-eval`——只要求同源 script 可加载（页面自身加载插件 bundle 亦然）。
- 失败语义：bundle 路由 404（皮肤未安装 / `lib/client.js` 未构建）或网络失败时，
  script 的 error 事件触发，试穿报通用错误并完整还原激活皮肤；加载与还原之间不会留下半套
  皮肤（tryOn 的 catch 分支负责恢复）。
- 退出还原：先跑皮肤的 disposer（属性/chrome/favicon/标题/背景全撤回），再
  `invalidate(package)` + 删 style 标签，最后把激活皮肤的视觉快照原样恢复。
  官方默认试穿 = 同一套收回配方但不挂载任何皮肤，退出同样原样恢复。
- 激活皮肤检测：`window.__DSH_BOOT__.entries` 只含启用条目，与注册表 package 比对；
  无匹配即官方默认。
- 一键应用：host `/api/skin-center/apply` 代理 `dsh-skin use <name>` / `use official`
  （CLI 是 managed 区段与 symlink 的唯一权威）。DSH 长驻表面自带配置 watcher
  （`watchUserPatches` + config-only HMR），patch 写入后数秒热载入、无需重启；
  浏览器刷新页面取新 boot 图即生效（client 插件图行增删不在 `dsh-client-hmr` 语义内）。

## 构建（仓库内 tsdown，无需 DSH checkout）

皮肤中心与皮肤一样，用仓库内共享 tsdown 预设构建（`shared/tsdown.client.ts`
处理 CSS Modules 注入与平台外部化；类型来自官方 NPM SDK devDependencies）：

```sh
# 1. 重新生成注册表（皮肤元数据变化后重跑；bundle 文本按需走 host 路由，无需重生成）
node scripts/skin-center-bundles
#    皮肤 bundle 自身变化只需重建对应皮肤（tsdown），GUI 下次试穿即取到新文本

# 2. 在仓库内构建
cd ~/code/dsh-web-ui && export NPM_TOKEN='<token>'   # 若仍使用私有 scope 认证
pnpm --filter @linxin666/dsh-client-ui-skin-center run bundle
```

## 安装（个人环境接线，不在 checkout 提交）

```sh
# 1. profile symlink（与 qq98/blue-fantasy 同款）
ln -sfn ~/code/dsh-web-ui/packages/skins/skin-center \
  ~/.dsh/profiles/node_modules/@linxin666/dsh-client-ui-skin-center

# 2. ~/.dsh/cordis.patch.yml 增加（放在 dsh-skin managed 段之外，勿动该段）：
#   - insert:
#       - id: ui-skin-center
#         name: '@linxin666/dsh-client-ui-skin-center'

# 3. 配置 watcher 秒级热载入；刷新页面即在 插件配置 → Web UI 插件 组里看到皮肤中心卡片
```

## 试穿互斥的还原配方（try-on.ts）

| 皮肤 | body 属性 | 额外处理 |
| --- | --- | --- |
| 全部 | 收回 `bodyAttr`（CSS 失活） | 快照/清空 body 背景内联样式（blue-fantasy 鲸鱼背景）；摘除 body 直接子节点中非 `#root` 的 chrome（实测仅皮肤 chrome）；中性化观察器防幽灵写回 |
| xp | 同上 | 额外注入 neutralizer CSS 隐藏 sidebar footer 的 taskbar/开始按钮（其规则未按属性作用域） |

退出试穿 = 试穿皮肤 disposer（真实代码路径）→ 模块 invalidate + 样式清理 → 激活皮肤快照原样恢复。

## 验收对照（README 顶层契约）

- [x] 插件配置 → Web UI 插件 组里出现皮肤中心卡片，无 console 报错
- [x] 列表含官方默认 + 全部皮肤，当前激活有标记
- [x] 试穿真实生效（chrome/背景/标题/favicon），亮/暗正确；官方默认可试穿
- [x] 退出完全还原；互斥（不出现两套标题栏）
- [x] 一键应用：host API 执行 `dsh-skin use`，watcher 热载入，页面自动刷新生效（无重启）；失败附命令兜底
- [x] 回归：dsh-skin CLI（含 `use official`）、网页 Gallery、官方 GUI 不受影响
- [x] 按需加载：冷启动不解析 ~700KB 内嵌 base64（`generated/skins.ts` 仅 5KB 元数据），试穿按需取 bundle；无 eval（CSP 无需 `unsafe-eval`）
- [x] e2e 截图见 `docs/e2e/skin-center/`