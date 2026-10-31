# AGENTS.md — dsh-task-board-github

任务看板的外部提供方扩展（GitHub Issues 同步）。本文件只写本包特有规则。

## 与看板的边界

- 本包是 `packages/dsh-task-board` 的外部提供方：它不 import 看板的任何
  `src/**` 内部实现，跨包协作只走看板的提供方契约（cordis 服务），由看板
  侧拥有登记面。契约的唯一事实源是看板的 `src/core/extension.ts`；本包在
  `src/core/contract.ts` 同形重述它，两侧半区都经 `ctx.inject(['taskBoard'], ...)`
  的依赖作用域取得能力面（host 半区 `registerExtension`，浏览器半区客户端面）。
- 看板声明的三个子席位（`task-board.detail.section`、`task-board.settings.section`、
  `task-board.card.decoration`）在 `src/client/index.ts` 以同形
  `declare module` 声明，不 value import 看板包；本包向三个席位都登记：
  详情区与卡片徽章随开关收放，配置区块（开关 + 仓库/凭据 + 连接测试）渲染在
  看板自己的设置卡内部——它是这块看板的提供方，配置就该与它所配置的看板同在
  一处，不再占家族设置列表的独立卡片席位。
- 远端关闭周期只在扩展内部记录 `remoteClose` 来源并经 `tasks.setStatus` 迁移：非 running 自动完成、running 延迟到结算后的同步、重开只回移自动完成卡片；同一关闭周期内本地移出已完成即覆盖，禁止打断执行、伪造执行记录或直接关闭/重开远端 issue。
- 看板的账本、列门禁、内容冻结与事件隔离都由看板执行：本包只读写
  `tasks.*` / `integration.*` 能力面。远端不可变身份索引是扩展自己的结构，
  在 `start()` 时从 `tasks.list()`／`tasks.linked()` 建立并随
  `onTaskDeleted` 维护；扩展自身不得抛出未捕获异常。
- 两侧半区都经 `ctx.inject(['taskBoard'], ...)` 等待看板的提供方服务：宿主
  半区登记 provider，浏览器半区安装三个席位；服务后到也能挂上（聚合的
  mount-children 不保证 `ctx.plugin` 的 apply 顺序），服务撤走即自动释放。
  聚合包仍把本包的行排在 `../dsh-task-board` 之后（见
  `packages/dsh-web-all/aggregate.yml` 注释），但那是加载顺序的可读性偏好，
  不再是正确性的前提。禁止改回一次性 `ctx.get('taskBoard')` 解析。
- GitHub 令牌只在宿主半区读写，解析顺序是 DSH 凭据库（`ctx.credentials`，
  由设置卡或配置工具经宿主路由一次性写入）→ `tokenEnv` 指定的环境变量 →
  `GH_TOKEN`。浏览器只在用户主动粘贴时单向发送一次，宿主永不回读：令牌不进
  设置命名空间、不进看板快照/摘要、不进 agent 载荷，路由与工具响应只给「是否
  已配置、来源、是否可写」。`/api/task-board-github/*` 只服务 loopback 请求
  （复用 `src/loopback.ts` 的栅栏），不得放宽为局域网可达。
- 配置写入只有一条路径：设置卡、宿主路由与 agent 工具都经 `src/host/setup.ts`
  落到 `ctx.settings.mutate`（volatile 字段）与 `ctx.credentials`；不要为某个
  调用方新增第二条写配置的代码路径。

## 半区分层

- `src/index.ts`：host 入口（Config schema、提供方登记与 `announceToAgent`
  公告）。
- `src/host/`：host 半区实现（GitHub REST 客户端、同步服务、提供方工厂、
  凭据解析（credentials.ts）、配置读写（configuration.ts）、共享配置面
  （setup.ts）、宿主路由（routes.ts）与七个模型可见工具）。
- `src/core/`：两侧共享的纯逻辑（契约同形声明、GitHub 领域类型与校验、
  标签投影、定时器席位，以及配置面的线形与仓库文本解析/列表编辑（setup.ts））。
- `src/client/`：浏览器半区（locales、设置区块与配置面板、三个席位、可见性
  谓词与完整 `owner/repository` 来源分组选择器）。文案一律经 locales 字典，客户端源码不出现裸中文。
- 开关语义：`enabled` 同时门禁 host（停轮询、停写回、注销工具、清空
  publish）与 client（撤下详情区/卡片徽章席位、停订阅）；看板总开关与本扩展
  开关叠加，两者都不改契约。**设置区块不随本开关撤下**：它是把开关打开的地方，
  只依赖看板服务（`installGitHubClientHalf` 的第三个参数），否则关掉扩展后
  就再也无法重新开启；扩展关闭时区块内以说明文案取代仓库/凭据表单。

## 共享副本

`src/mount-once.ts`、`src/loopback.ts`、`src/host/http.ts`、
`src/client/{settings-form.ts,PluginSettingsCard.tsx,settings-card.module.css,settings-entry-form.ts}`
与 `vitest.setup.ts` 是 `scripts/sync-shared.mjs` 生成的同步副本（文件头有
generated 注释），禁止手改；改动 shared/ 源后重跑 `node scripts/sync-shared.mjs`。
