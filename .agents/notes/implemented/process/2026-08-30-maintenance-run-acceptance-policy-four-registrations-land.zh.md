# Agent Note: 维护运行记录两级验收标准并落地四笔登记

Status: implemented

## Problem

所有者为社区登记类 PR 定下长期验收标准：只剩小问题（位次顺延、清单再生成、格式、分支过期等机械项）时维护者直接修好并纳入；仍有大问题（cohort 兼容证据缺失、来源不可信、只有作者能做的上游改动）时退回作者改好再合。本轮把该标准应用到八个开放 PR；位次账目为 44 条，#1098 已验证完整但被同日早前修复的 firewall 缺陷造成的红灯挡住。

## Decision

- 两级标准取代[前一份记录](2026-08-30-maintenance-run-firewall-unblock-rank45-award.md)中的"作者自行 rebase"惯例：机械项现在是维护者的工作，登记可以不经作者往返而落地。凡走 PR 合入的，合并闸门（必需检查绿、审查批准）仍然生效。
- #1098（dsh-agent-plugins-market，Sivan757）以正常流程合入为 rank 45（47167a1d6）：服务端 update-branch 刷新 PR 分支（无需联系作者），放行 action_required 的 CI 与 agent-notes-guard，更新后 head CI 全绿，批准并 rebase 合入，保持单提交形态。
- #1100（dsh-fulltext-search，termanli）、#1279（dsh-reasoning-effort，Jamsharden）、#1277（dsh-codekin，Nath-Vikky）由维护者侧落地为 rank 46/47/48（eafe5981d、127816890、d6cec6d74），PR 以 Co-authored-by 署名关闭。三个 fork 均不允许维护者编辑（termanli 与 Jamsharden 为 push:false，Nath-Vikky 的 fork 不可访问），且各自分支尾部与快速前进的 dev tip 冲突，不存在 PR head 路径。条目原文逐字插入 community.json（#1100 做了空白规整——其旧基底还使其 diff 无意删除了 dev 已有的两个条目和两个 npm 字段），清单用 scripts/market-build 重新生成，community-index --check（48 条）与 market-build --check 通过，dev CI 在承载全部三笔的树上全绿。
- #1144（dsh-deepsea）按新标准重新归类：大问题，留在作者处——既有阻塞（干净 clone 下上游测试与 typecheck 失败、telemetry 未实际门控第三方上传、无上游 CI）都是只有作者能做的上游改动。
- #1285（dsh-completion-guard）与 #1282（dsh-prompt-enhance）留在作者处：cohort 验证证据、以及运行中 alpha.1 cohort 上无法解析的 inject，按新标准均属大问题。
- 顺手的小修复：新落的 turnstile 笔记逐字引用了含 U+2728 的 wrangler 成功输出，触发 no-emoji 门禁再次变红；对引用做了净化（不失原义）并重录 sidecar（e5618309f）。期间两次 CI 运行被多会话高频推送的并发组取消；最终 tip 上的绿色运行验证了含全部四笔登记的完整树。

## Alternatives considered

- 保留作者 rebase 惯例：被取代——机械往返是观察到的瓶颈，所有者明确调整了标准。
- 用 --admin 越过检查强行合并过期 PR head：拒绝——冲突旧 head 的 rebase/squash 合入会把旧树带进 dev，静默删除 dev 已有的条目；直接把条目本身落到 dev 才是内容精确的。
- 向 fork 强推修正分支：为 #1100 尝试过，被 fork 权限本身挡住（push:false 或 fork 不可访问）——并非主动选择。
- 从 turnstile 笔记删掉含 emoji 的整句：拒绝——那是支撑诊断的逐字工具输出；仅净化字符保留证据。

## Consequences

- 账目现为 48 条；rank 45-48 依次为 dsh-agent-plugins-market、dsh-fulltext-search、dsh-reasoning-effort、dsh-codekin。下一个空位是 49。
- 允许维护者编辑的 fork 仍可走正常 PR 流程收口（update-branch、放行门控、批准、rebase 合入）；不允许编辑时，"维护者侧落地 + Co-authored-by 署名 + 关闭 PR"是兜底路径。
- #1285、#1282、#1144 等待各自作者；dsh-memory（yyspoem）按 issue #1290 以新 PR 重新进入，取下一个空位。
