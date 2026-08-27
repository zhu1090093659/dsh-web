# Agent Note: better-session 的启用入口以性能设置卡内嵌子节发布并自动迁移

Status: implemented

Supersession check: [better-session-default-off-and-jsonl-import](../architecture/2026-08-27-better-session-default-off-and-jsonl-import.md) 持有默认关闭的上线策略与迁移语义，均不受影响。本文件为其补充面向用户的操作面——启用子节——并把导入核心下沉进包，使该操作面与 CLI 共享同一实现。

## Problem

最初的 opt-in 路径只有文档加一个仓库内 CLI：从 npm 安装全家桶的用户必须手改 profile patch 文件（手写 YAML），且没有仓库 checkout 就完全无法迁移旧会话。切换动作附带的存储更换警告也只存在于 README 的散文里，离决策时刻太远。

## Decision

开关直接内置于 `@linxin666/dsh-perf`——启用 better-session 本身就属于会话性能治理，其管理面顺理成章落在 perf 包，而不是新增家族成员——把决策放进现场：

- **子节而非平级卡片**：管理面渲染在 设置 → Web 插件 的**性能引擎卡片内部**（perf 自己的 `web-ui.plugin.item` 条目），在表单字段之下以分隔线隔开。同日早些的草案曾注册第二个组条目（槽位 id `better-session`、order 145）；GUI 实测显示它落成了与 dsh-perf 平级的无样式条目，不符合要求的二级形态，因此移除了独立注册，改由 `PerfSettingsCard` 直接挂载 `BetterSessionCard`。卡面保留第三方来源声明（[morlay/better-session](https://github.com/morlay/better-session)，MIT），实时展示两个存储的计数与当前状态；启用/停用都包在确认弹窗里，弹窗文案逐条列出 README 承诺过的代价。文案注册进共享的 `dsh-perf` 词典（`bsm.` 前缀键，不设独立命名空间），样式为自包含的内联 CSS。
- **启用流程**：确认 → 子进程导入全部旧 jsonl 日志到 `sessions.sqlite`（现有库自动备份；库不存在则按镜像 DDL 引导创建）→ 向 profile patch 写托管覆盖块。导入失败时 profile 保持原样。profile 层在长生命周期宿主上热重载，因此启用即时生效；已打开页面刷新一次即可。
- **核心共享**：解码/投影/入库代码原样迁入本包（`src/bsm/*`，并经 tsdown companions 编译为独立产物 `lib/better-session-import.mjs`）。host 半区以子进程执行它，解码不再阻塞服务事件循环；`scripts/dsh-better-session.mjs` 改为导入同一产物的薄壳——语义自此只存在一份。

不设 settings 命名空间：本卡没有可保存的偏好，真正驱动行为的状态是 profile 文件里的补丁行，两个入口都把它当作唯一真源。

## Alternatives considered

- **像 dsh-ssh 那样用 settings 命名空间的 enabled 开关**：否决——上游各行走的是 loader 层 disabled 标志而非 config 载荷；翻转 settings 值会与组合实际运行的东西脱节。
- **直接借用 dsh-plugin-manager 的启停路由**：否决——plugin-manager 面向任意插件逐条编辑，而 better-session 需要"三行 insert + 永久 jsonl 禁用"的原子块，这正是本包要固化的契约。
- **启用后在启动时自动迁移**：否决——彼时 RDB provider 已在进程内持有库文件，批量导入与首个活跃会话产生竞态、回滚路径含糊；确认时刻官方 jsonl 仍在服务，才是干净窗口。
- **导入器留在 scripts/、host 用 shell 外部调仓库路径**：否决——npm 安装没有 checkout，复制两份必然漂移。

## Consequences

- opt-in 不再依赖仓库 checkout：声明、警告、迁移、切换随聚合包一体发布。
- 不新增家族成员，也不新增 Web 插件组条目：管理面位于性能卡内部，随 perf 一起出现/消失，并继承其折叠卡外壳。
- 子节的状态读数依赖能读到聚合清单文本：npm profile 场景通过 `DSH_WEB_AGGREGATE_PATCH` 或 cwd 上溯解析；都不可达时报「状态未知」而不是猜。

## Testing

- 包内 vitest（54 例）：编码/断尾/header 校验、丢弃/剪枝/dims 镜像、稠密桥接 + head 游标 + 真实目录形态（含裸 UUID 年代）的幂等重跑、托管块替换/移除、分层姿态判定；另有三例 renderToString 规格锁定嵌套 DOM 契约（dsh-perf 属主子节、`bsm.` 前缀文案键、动作集随姿态翻转、确认弹窗标记）。
- CLI node:test（4 例）：argv 契约、提醒门控下经由真实 `$DSH_HOME` 路径的启用写入、出厂关闭姿态下的 status JSON 形状、以及"合成 zstd 日志上的 migrate 干跑不落盘"——最后一例来自一次真实迁移审计：当时 CLI 以裸标识符调用 `runImport`（任何 migrate 调用直接 ReferenceError）且备份发生在写入之后；绑定与"先备份后写入"的时序由此用例钉死。
- 重生成后的聚合产物（19 行 / 17 依赖）由 `pnpm aggregate:check` 验证；dump-config 下只有三个 better-session insert 行及其 disabled 覆盖，没有单独的卡片条目。
