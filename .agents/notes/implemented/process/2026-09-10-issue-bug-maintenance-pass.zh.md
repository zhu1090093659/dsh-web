# Agent Note: 2026-09-10 Bug Issue 维护巡检

Status: implemented

## Problem

仓库当时有十个开放 Issue，其中八个是 Bug 报告，且全部分配给同一位协作者。owner 要求只处理这批 Bug（包括已经分配给协作者的那些），不动增强类请求。

## Decision

六个 Bug 已复现、在 `dev` 上修复并关闭，每条的验证证据都留在对应讨论里：

- #1450 与 #1455（梁神预设 schema 与持久化消息来源）——提交 `6d2cf827`，见[记录](../../bug-fix/2026-09-10-preset-schema-and-message-source.md)。
- #1458（scene-resource URL 编码）——提交 `16241a86`，见[记录](../../bug-fix/2026-09-10-scene-resource-url-encoding.md)；已在 Issue 里通知渲染器域协作者，符合该域的仓库规则。
- #1447（任务看板归档闸门）——提交 `b0151d32`，见[记录](../../bug-fix/2026-09-10-task-board-archive-non-running.md)。
- #1453（插件管理生效状态）——提交 `7375afad`，见[记录](../../bug-fix/2026-09-10-plugin-manager-effective-enablement.md)。
- #1442（根别名聚合包钉版）——提交 `058c981c`，见[记录](../../bug-fix/2026-09-10-root-alias-exact-aggregate-pin.md)。

剩余两个 Bug 报告都在巡检后按 owner 决定关闭，各自在讨论里留下已验证的立场：

- #1452：崩溃需要 DSH 宿主低于聚合包声明的最低版本（`>=0.1.5-rc.1`）。把 `dsh-better-sidebar` 退回 0.18.0 能保护低版本宿主，但会推翻当天的 [0.1.5-rc.1 挡位决定](../architecture/2026-09-10-sdk-cohort-0.1.5-rc.1.md)，且旧构建没有针对 rc.1 的冒烟，因此当时把选择留给 owner。owner 随后给出处理决定：以"升级宿主"回复并关闭，挡位钉版保持不变。该讨论现在明确让报告者升级到最新 DSH（0.1.5-rc.1，npm 的 `latest` 标签），并把聚合包钉回 0.3.19 保留为无法升级时的回退方案。
- #1397：根因是官方 `@deepseek-ai/dsh-tools` 内部用私有 `Symbol` 作注册键，0.1.5-rc.1 仍然如此，本仓库没有修复位置。按 owner 指示关闭而不是在本地保留跟踪项：讨论里记录了带行号的上游根因、上游两行修复（`Symbol(` → `Symbol.for(`）与本地临时方案。

当时开放的另外两个增强类 Issue（#1439、#1448）按范围外处理，未做任何改动。

## Alternatives considered

- 巡检期间以"受支持宿主上无法复现"关闭 #1452。当时否决：会掩盖契约执行缺口（宿主不读 `dsh.engines.dsh`，只有网关更新通道会拦截低版本更新），并替 owner 预支产品决定；owner 随后的指令给出了该决定，关闭说明里也明确写出了升级要求。
- 单方面把 `dsh-better-sidebar` 退回 0.18.0。否决：与挡位记录里明确否决该升级的结论冲突，且旧版本从未针对 rc.1 冒烟。
- 为 #1397 打补丁改 DSH 宿主或 `dsh-tools`。否决：改 DSH checkout 超出本仓库边界，且下次安装即失效。
- 在本地保留 #1397 作为上游跟踪项。巡检后 owner 否决：本仓库没有可跟踪的工作项，讨论里已带上根因、上游修复与临时方案；上游发版后可以新开 issue。

## Consequences

- 已无开放的 Bug 报告；剩下两个开放 Issue 是范围外的增强请求。
- 每个修复都带自己的 Agent Note，记录了验证命令与被否决的方案，复现证据不随 Issue 讨论沉淀而丢失。

## Testing

全部修复经完整门禁后进入 `dev`：在提交 `058c981c`（已推送到 `origin/dev`）上 `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm aggregate:check`、`pnpm test:scripts`（272 个用例）全部通过。
