# AGENTS.md — dsh-web-all

全家桶聚合载具包：安装它 = 全部功能插件 + 皮肤全家桶一个包装齐。本包无自有插件
逻辑，只有两件事：把 child 插件的 insert 行汇总成 `cordis.patch.yml`，以及提供
可选的 compat 补丁层（`web-ui-compat` 行：语义 DOM 钩子 + 响应式契约 + 启动遮罩）。
家族插件各自的界面由各自的加载器行下发，不经过本包。

## 聚合机制

- `cordis.patch.yml` 是各 child 的 insert 行拼接（含每源注释头）；仓库内子包经
  package.json 的 `workspace:*` 拉入，安装单包即全部就位。
- 已迁出为独立仓库的家族子插件（皮肤中心、宠物、社区插件索引、预设中心）走
  `rows:` 外部行：依赖写成显式 semver 范围，行 `name` 直接是真实包名（不经共享壳
  包装），浏览器半区由卫星自带的 loader entry 挂载、不再内联进本包 bundle。代价
  是这些行没有壳的 fault-isolation；收益是卫星客户端改动不再要求重建本包。
- **家族行直挂真实包**（issue #1901）：仓库内子插件的行 `name` 就是它自己的包名，
  行 id 仍是 `web-ui-*`。官方 `dsh-client-modules` 只把浏览器半区挂在「`name` 等于
  包名」的那一行上，所以裸行是「装哪个插件才下载哪个界面」的前提：旧做法让家族行指向
  本包子路径，浏览器半区只能由 compat 的 `lib/client.js` 内联下发（单文件 2.9 MB，
  远程转发下每个页面都要先下完整份副本）。
  代价与收益见 [Agent Note](../../.agents/notes/implemented/architecture/2026-10-18-aggregate-family-rows-mount-real-packages.md)：
  裸行不再有壳的启动期 fault-isolation，换来的是一行一插件、一行一开关。
- **子路径导出只剩兼容壳**：`tombstones:` 里的每个家族子路径（含 `#1901` 之前的
  12 个仓库内家族）都导出到共享壳 `lib/shells/shell.js`，供老 profile 里记录的
  子路径行名继续解析；它们不再产出 patch 行。子路径下必须有扫描器标记 manifest
  （`src/shells/package.json`，构建复制到 `lib/shells/`）：无 `dsh` 声明 +
  `type: module`，阻止 client 模块扫描器的 nearest-package 走查到达包根（否则
  与 compat 行构成同包多来源，扫描器 reconcile 直接抛错）。子路径 exports 键由
  生成器维护，勿手改。DSH 0.2.1 起插件展示元数据不再读取子路径旁最近
  `package.json`：生成器同时维护 `./<family>/icon` 与
  `./<family>/locale/{en,ru,zh}.json`，内容在 `shell-metadata/` 下，官方
  插件列表因此每行显示独立的 `web-all/<family>` 标题、家族图标，以及标题下方那条
  灰色用途说明（`meta.description`）。
- 家族行的用途说明只有一个事实源：`aggregate.yml` 的 `shellNotes` 段（每个家族
  子路径一条 zh/en/ru）。生成器把它写进 `shell-metadata` 的 `meta.description`；
  缺行、未知或重复 id、zh 超过 20 汉字、zh 与 en 同串一律让生成器报错。ru 随包附上
  是因为官方 `readPluginMeta` 枚举整个 `<specifier>/locale` 目录、按文件名取语言，
  而子路径的文件无法由 dsh-i18n 代为导出。
- 包根 `icon.svg` + `package.json` 顶层 `icon` 是官方插件列表的卡片图标（官方
  展示元信息字段，见 [Agent Note](../../.agents/notes/implemented/feature/2026-09-23-family-plugin-icons.md)）；
  家族每个包都带同名素材（独立安装时各自生效），聚合子路径行经各自的
  `<specifier>/icon` export 复用包根图标。该资源必须留在 npm `files` 白名单内。
- `aggregate.yml` 是唯一手写清单：`patchFrom` 贡献 insert 行（嵌套聚合递归展开、
  按顺序、带源注释），`deps` 解析各子包 name 写入 dependencies（`workspace:*`），
  `shellNotes` 提供家族行的用途说明（机制见上文家族行条目）。
- `rows:` 段是仓库外的 npm 外部行（单行 JSON flow mapping，`{"id","name"}`）：解析
  从本包 node_modules 出发（`require.resolve('<name>/package.json')`，因此外部包必须
  导出 `./package.json`），渲染在全部 `patchFrom` 行之后。行 id 仍走 `web-ui-*` 命名
  空间，与 `patchFrom` 时期逐字一致；外部包声明 `dsh.bundle.patch` 时展开它自己的
  patch 行（bundle-only 包不能被 loader 直接 import）。
- `tombstones:` 段保留已退役、已迁出或已改为裸行的子路径 exports 空壳（指向
  `lib/shells/shell.js`），避免老 profile 残留旧行名时 Node 抛
  ERR_PACKAGE_PATH_NOT_EXPORTED。迁出为独立仓库的 `pet` / `skin-center` /
  `community-plugins` 三个子路径，以及 `#1901` 之前以子路径装配的 12 个仓库内
  家族子路径，都必须留在本清单里。
- `retiredPlugins:` 段（单行 JSON flow mapping，`{"family","plugin"}`）是壳的退役登记
  唯一事实源：生成器把它写进 `src/retired-plugins.generated.ts`（`RETIRED_FAMILIES` /
  `RETIRED_PLUGINS`），`src/shell.ts` 由生成模块派生。老 profile 里残留的家族行 `name`
  仍是子路径 `@linxin666/dsh-web-all/<family>`（靠 `tombstones:` 保证可解析），壳从该行的
  `config.plugin` 读到已退役的真实包名后走静默 no-op（不 import、不记 degraded），手写副本
  不会再把一次正常退役报成插件损坏。family 必须已在 `tombstones:` 段、plugin 不得同时是
  `deps` 依赖，两条都由生成器报错钉住。
- `familyIds:` 段（`<子包行 id>: <聚合行 id>` 映射行）解耦两处 id：子包的独立安装行 id
  住在 loader 全局 id 空间，被官方 bundle 占用时必须换（#1794），而派生规则会把新的独立
  行 id 一并改名，连带移动已发布的聚合行 id 与家族子路径导出。覆盖后独立行改名、聚合行
  逐字不变，老 profile 无需迁移；值必须在本聚合 `web-ui-*` id 空间内且指向本聚合真实
  挂载的行，生成器对死键、越界值与撞名一律报错（`node scripts/aggregate.mjs --check`）。
- `patches:` 段（单行 JSON flow mapping）对本聚合自插入行做整对象 config 覆写：
  用于播种行级默认（如 enabled:false），渲染在全部 insert 之后；
  id 必须是本聚合已存在的行，settings 一经用户改动即优先于播种值。
- `inactive:` 段（行 id 字符串清单）声明出厂默认关闭的自插入行：渲染为尾部
  `disabled: true` 裸覆盖。新装用户该整行不加载，其设置入口也不会出现（裸行不挂载
  就没有浏览器半区）；用户在插件管理按行开启（写入用户层 disabled:false 覆盖，
  优先于本默认）。锁定的核心行（settings/plugin-manager）禁止列入。
- 宿主半双入口：本包经两个入口 artifact 加载（lib/index.js 走 self 行、
  lib/shells/shell.js 走老 profile 的子路径行），构建把共享代码拆成 chunk——每个
  入口持有自己的模块拷贝，任何模块级可变状态都会静默分裂（2026-09-09 事故：路由
  重复注册告警 + 健康路由伺服另一拷贝的空账本）。跨条目/跨拷贝的状态一律走
  `src/state.ts` 的 globalThis 注册表（Symbol.for 键），禁止模块级可变单例。

## 新增 / 改动插件

- 往全家桶加**仓库内**插件，必须同步改 `aggregate.yml`（`patchFrom` + `deps` 各加
  一行）并重跑生成，否则子包不被拉入/不展开。
- 加**仓库外 npm 插件**，改 `rows:`（`{"id","name"}` 一行）**并**手写 package.json 的
  显式 semver 依赖——生成器保留非 `deps` 段的依赖，不会替你写入。
- 生成脚本在仓库根 `scripts/aggregate.mjs`（不在包内），只写本包与它拥有的
  aggregate 缓存，幂等可重跑；`--check` 模式只校验、有漂移退出 1，是 CI 门禁。

## 提交前检查

```sh
node scripts/aggregate.mjs --check
pnpm aggregate:check
```

- 构建顺序：`#1901` 之后本包的客户端 bundle 只是 compat 补丁层，不再内联任何
  子插件客户端源码——子插件改动只需重建该子包（`pnpm dev:watch` 在开发期自动覆盖）。
  重新往本包内联家族代码会让每个页面重新承担整份副本，`scripts/client-bundle-contract.test.mjs`
  对此设了门禁。`rows:` 外部行同样不内联。