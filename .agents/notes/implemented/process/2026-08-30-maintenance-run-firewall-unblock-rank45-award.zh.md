# Agent Note: 维护运行解除 dev CI 阻塞（firewall 平台缺陷）并将 rank 45 授予 dsh-agent-plugins-market

Status: implemented

## Problem

[前一份记录](2026-08-29-maintenance-run-free-search-merge-four-registration-verdicts.md)的后续运行，默认范围（assignees 包含 zhu1090093659 的开放 PR；不扫描 Issue）。八个开放 PR 在范围内。rank 45 的竞争中有三个内容已完整的候选（#1098、#1279、#1277），而必需检查 CI checks 自 3c3d5644（2026-08-29）起在 dev 的每个提交上都是红的，阻塞了全部登记合入。本轮要决定：红灯是否阻塞合入、rank 45 归谁、两笔已刷新的评审是否闭环。

## Decision

- dev CI 故障定位到单个测试：`packages/dsh-remote-web-ui` 的 `tests/firewall.spec.ts` "reports unmanaged platforms as ok"（包内 277/278 通过；plugin-mount 绿；dev 自身 tip 上失败完全相同）。根因：`computeFirewallSummary` 把 backend 参数默认为 `firewallBackend()`，测试里显式传入的 `undefined` 会触发对真实操作系统的探测——在 darwin 上确定性地通过，在 Linux CI 上探测到真实的 ufw/iptables。缺陷产生于 lan-bind 加固窗口 7512174d..3c3d5644。
- 直接在 dev 修复（bb3d1588f）：探测移到 `firewallSummary` 调用点，显式 `undefined` 在任何平台上都确定地表示"无 backend"，生产行为不变（唯一内部调用点自行传入 `firewallBackend()`）。验证：包 typecheck 干净、本地 296 个包测试全部通过、dev CI 在 bb3d1588f 上恢复绿。
- rank 45 按 first-complete-first-served 授予 #1098（dsh-agent-plugins-market，Sivan757）：head 7550afa70（2026-08-29 14:54）是最早同时满足内容完整与"基于 44 条基底的纯 rank-45 追加"的推送。head 本地验证：`node scripts/community-index --check`（45 条）与 `node scripts/market-build --check`（hash manifest 一致，756 文件）通过；plugin-mount 绿；action_required 的 CI 与 agent-notes-guard 已放行，后者已通过。合入仅被当时仍红的必需检查推迟；已请作者 rebase 到 bb3d1588f 换取绿运行，绿后即合入。
- #1279（dsh-reasoning-effort，Jamsharden）评审闭环：条目已声明核验版本（0.1.1-rc.2 与 0.1.2-alpha.1），并披露卸载不会删除写入 llm-pi-ai 的思考配置；PR 模板已补全。排入 #1098 合入后的 rank 46。
- #1277（dsh-codekin，Nath-Vikky）评审闭环：条目已披露真实存档路径（DSH 主目录下的 `codekinsave/state.json`）、首启从 `tracewild/state.json` 的无损迁移与卸载保留；该 PR 的 CI 失败被确认为同一个 dev 侧既有缺陷。排队 rank 47。
- 无移动、不动作：#1285（cohort 验证与描述阻塞仍在）、#1282（仍占 rank 44，其 inject 在 alpha.1 cohort 无法解析）、#1100（仍占 rank 43）、#1245 与 #1144（按既记录阻塞停靠）。
- 已呈报并由所有者定夺的事实：提交 dd376dcb（"Add dsh-memory plugin to community index"，作者 yyspoem，2026-08-29 23:29）曾被直接推上 dev，现已不可从 origin/dev 到达——05:18 推送的 5eaa7b0f3 替换了分支线且未包含它。dev 仍为 44 条，位次账目不受影响。所有者选择走正常流程重新登记，而非维护者侧恢复；外联 issue #1290 已告知 yyspoem（账号创建于直推前数小时，非协作者）提交被覆盖的情况与重新提交要求：条目与重新生成的 manifest 同在一个 PR、按模板附测试证据（安装、记忆写入、tool 召回、卸载）、描述与仓库当前的 tool-based recall 实现一致。上游插件真实且活跃（yyspoem/dshstore，dsh-memory@0.1.0，cordis.patch.yml + dsh/ 布局）；其 PR 合入后在排队的 45/46/47 之下取下一个空位。

## Alternatives considered

- 用 ruleset 的 owner bypass 让 #1098 越过红灯合入：拒绝——合并闸门禁止在必需检查失败时合入，且故障属于 dev，应当在 dev 上承担修复而不是绕过。
- 在诊断闸门之前先要求全部候选 rebase：拒绝——失败在 dev 侧，任何 rebase 后的 head 都会原样再失败，徒耗作者往返。
- 把 firewall 测试改为平台条件执行（darwin 上 `it.runIf`）：拒绝——这会把该测试从 Linux CI 中整体移除，并保留 `computeFirewallSummary(port, lan, undefined)` 探测真实系统的陷阱。
- 维护者侧恢复 dd376dcb：拒绝——外部作者的直推被丢弃是归属决定；走正常登记流程重新获得位次即可。

## Consequences

- dev 从 700a74e09 前进到 bb3d1588f，携带 firewall 修复；登记管线的必需检查恢复绿色，rebase 后的登记 head 无需改测试即可跑绿（修复在 src，不在 spec）。
- 位次队列明确：45 = #1098（待其绿色 rebase）、46 = #1279、47 = #1277；#1285 仍须先清掉 cohort 验证阻塞才能入队。dsh-memory 只能通过新的 PR 重新进入，取合入时的下一个空位。
- `computeFirewallSummary` 的契约现为"undefined 即无 backend"；需要平台探测的调用方自行传入 `firewallBackend()`（`firewallSummary` 即如此）。
