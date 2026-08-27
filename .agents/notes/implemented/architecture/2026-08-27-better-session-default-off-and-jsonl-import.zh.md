# Agent Note: better-session 默认关闭并附带 jsonl 到 sqlite 的迁移工具

Status: implemented

Supersession check: [better-session-replaces-chat-recovery](2026-08-27-better-session-replaces-chat-recovery.md) 持有接入机制的决定（bundle 展开、依赖锁定、chat-recovery 退役），相关事实仍然准确。本文件仅替代其"默认开启上线"这一点，并从现在起持有迁移工具的归属。同批改动在该注 Consequences 里追加指向本文件的链接。

## Problem

最初的方案让 better-session 装完即挂载，第一次重启暴露了两个叠加的事实：

1. 它的 bundle patch 把 `ctx.sessionPersistence` 换成一个空的 SQLite 库，既有 jsonl 会话在会话列表里整体消失（维护者机器实测：481 个日志、10 个项目完好躺在磁盘上，UI 里却不可见）。
2. 上游**没有任何导入工具**——grep 全部三个已发布包只找到一处拒绝 schema 迁移的注释——因此不存在官方支持的回头路，要么丢数据要么手改配置。

一个旗舰功能默认把用户自己的历史藏起来的聚合包，不具备发布条件。

## Decision

本次落地两块：

- **默认关闭的生成语义**（`aggregate.yml` 在外部行上新增 `"inactive": true`；`scripts/aggregate.mjs` 对该外部的每一个产物——harness patch 行与全部命名空间 insert 行——统一追加 `disabled: true` 覆盖行）。官方 jsonl 后端继续服务；npm bits 照常安装；`--check`、测试、文档同步更新。
- **单个管理工具** `scripts/dsh-better-session.mjs`（`status` / `migrate` / `enable` / `disable`）。migrator 解码旧版按项目分层的布局（`<root>/<project>/<segment>/session.jsonl.zstd`，拼接式 zstd 帧经 Node 原生 zlib zstd API 解码），以镜像 DDL 直插 RDB 库，逐条对齐 `@morlay/session-rdb@0.0.11`：丢弃 `assistant/chunk`、`ignorable` 与 packed chunk 行；上游 seq 存入 `f_original_seq`；桥接行稠密重编号；事件 id 成链；对被丢弃 seq 做 surface provenance 剪枝；三个 `INSERT OR IGNORE` 锚点保证重跑收敛。写入前拒绝异构库（application_id/user_version 指纹）、自动备份、默认 dry-run，执行顺序无关（推荐"先迁移后启用"，重跑安全）。

enable 向 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 写入标记线包围的覆盖块（三行 insert 翻成 `disabled: false`；jsonl 行保持禁用），借助 profile patch 层位于 bundle patch 之后的常规顺序生效。

## Alternatives considered

- **把 better-session 从聚合里彻底移除**直到上游提供工具链：否决——用户认可的能力已经接入评审完毕，bits 随包安装但默认休眠既保留"自包含安装"又给 opt-in 留出成熟期。
- **生成产物整段注释掉**：否决——仓库内首例注释行模式且无法程序化复用；`disabled: true` 覆盖用的是同一文件里已被验证的语法。
- **导入走 rdb 后端代码**（`PersistenceCoordinator`）：否决——需要运行中的 cordis 容器并让仓库脚本 import 本机 homebrew SDK 包，违反"不引用 DSH checkout"边界；直插 SQL 配合合成 fixture 契约测试是可行替代。
- **在 dsh 启动时自动迁移**：否决——后台静默改写 526 MB 主历史需要的保障远超维护脚本范畴，且方向错误的二次导入（sqlite 新行遇上后续 jsonl 尾巴）无人值守时更难收拾。

## Consequences

- 家族包的新装升级不再改变会话列表观感；启用变成显式、文档化的动作，代价一目了然。
- 排查期间发现的库路径同名问题（morlay 默认路径与官方 query-cache 命名同为根目录 `sessions.sqlite`）在本机验证无害：现役库带着 morlay 的 application id，指纹校验钉死行为。若 DSH 将来在同一路径激活自家存储， migrator 会响亮报错而不是写坏任何一方。
- 磁盘上并存两个目录命名年代（旧写入器的裸 UUID 段 vs 现行 `session-*` 段）；发现层两者都收——与官方 reader 行为一致。
- `pnpm-workspace.yaml` 中 release-age 排除条目在 0.0.11 仍算新版本期间必须保留。

## Testing

- `scripts/aggregate.test.mjs`：inactive 展开用例断言每个产物都带 disabled 覆盖；全量套件随再生产物通过（`pnpm aggregate:check`，19 行 / 17 依赖）。
- `scripts/dsh-better-session.test.mjs`（9 例）：多帧切分、torn-tail 标记、header 校验、丢弃/剪枝语义、dims 映射、稠密桥接 + head 游标写入、重跑收敛、托管块替换/移除、开关状态判定。
- 真实数据 dry run：481 个旧日志全部解码零失败（含裸 UUID 年代），逐会话报告 persisted/dropped 计数且不落盘。
- 启用后的运行态确认需用户自行重启 `dsh web`。
