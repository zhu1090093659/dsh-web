# Agent Note：聚合包 client bundle 挂载壳的家族子插件

状态：implemented

## 问题

故障隔离壳（2026-09-01，`4b25dd771`）在宿主重启后生效，web GUI 的全部家族
客户端表面随即消失：一级设置分区（创意工坊、皮肤中心、使用统计、Web 插件、
宠物）、宠物 dock、任务板/ssh 表面全部不见了，而直挂行（dsh-i18n、
dsh-better-sidebar、@linxin666/dsh-perf、
@eddyskywalker/dsh-chatgpt-subscription、@linxin666/dsh-session-archive）
照常工作。

根因：壳把每条家族 patch 行折叠为 `name: '@linxin666/dsh-web-all'`（真实
插件放进 `config.plugin`），而客户端模块扫描器
（`@deepseek-ai/dsh-client-modules`）从 **loader 的条目**推导浏览器 bundle
图——它永远看不到壳 apply 内部创建的 cordis 子插件。子插件的 client bundle
因此从未到达浏览器：没有 `settings.section` 注册、没有 dock、没有卡片。
宿主半区正常（服务经作用域链可见），所以启动审计与宿主侧检查从未发现。

## 决策

聚合包的 client bundle 现在携带子插件——宿主壳的客户端镜像：

- `scripts/aggregate.mjs` 为每条带 client face 的壳包裹子行发射
  `packages/dsh-web-all/src/client/children.specifiers.json`、
  `children.generated.ts` 与 `children.modules.d.ts`（当前 16 个；
  `SHELL_EXEMPT` 的 dsh-i18n 与无 `dsh.client` 的惰性行排除在外）。发射物
  归生成器所有，`aggregate:check` 覆盖。
- 生成的模块静态导入每个子包的 `./client` 规范名。构建出的 `./client`
  产物是 loader 工厂文件（求值时调用 `window.__ModuleLoader__.load`），
  因此 web-all 的 tsdown 配置把这些规范名别名到子包**源码**；tsc 通过生成的
  ambient 声明读取类型，不跟随工厂产物。共享预设新增 `clientPlugins`
  透传，让别名先于 bundle 纯度门执行。
- `src/client/mount-children.ts` 把每个子包作为嵌套 client 插件挂载（各自
  声明的 inject、独立子 fiber），错误捕获与宿主壳同构：单个子包失败单独
  降级并打一行 console，家族 bundle 的 fiber 保持 active，启动审计仍看到
  健康的树。
- 运行时护栏防双实例：包 id 已出现在浏览器 boot payload 的子包（本机的
  perf、session-archive 等直挂行）跳过；共享的
  `Symbol.for('dsh-web.mounted-plugins')` 注册表（mountOnce 符号）保证跨
  模块实例只有一个判定。

## 后果

- `@linxin666/dsh-web-all` 的 `lib/client.js` 从约 14 KB 增至约 2.5 MB
  （家族客户端代码随单一产物走；loader 按单条目 serve）。对自托管控制台
  可接受；拆分需要 loader 支持非条目 bundle。
- 直挂共存改为运行时去重，profile 可以继续为活跃开发的包保留仓库直连的
  直挂行，而不会双挂 client 半区。
- 新增带 client face 的家族包只需 `node scripts/aggregate.mjs` + 重建，
  挂载清单自动再生。

## 验证

- 实例 GUI（profile `web`，仅刷新页面——无重启）：设置导航恢复（Web 插件 /
  皮肤 / 宠物 / 创意工坊 / 使用统计 与 Codex 订阅 / 侧边卡片 / 会话归档管理
  并列），宠物 dock 与任务板 DOM 指纹在位，无降级 console 行。
- `packages/dsh-web-all` 测试 19/19（含新增 `client-children-mount.spec.ts`：
  跳过/守卫/隔离语义）。
- 全仓 `pnpm test` 退出码 0；`pnpm typecheck`、`pnpm i18n:check`、
  `pnpm docs:check`、`pnpm aggregate:check` 全绿。
