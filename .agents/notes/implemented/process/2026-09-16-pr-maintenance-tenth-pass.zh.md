# Agent Note: PR maintenance run 2026-09-16 (tenth pass) — 三次合入：一个新登记、三套皮肤、一个完成 0.1.5 适配的登记

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第十次维护巡检，距[第九次](2026-09-15-pr-maintenance-ninth-pass.md)一天。默认范围：分配给维护者账号的八个开放 PR，不扫描 Issue。本轮要回答四个问题：从未评审过的 dsh-usage-panel 登记（#1583）能否通过三轴强制评审；#1582 的作者是否修掉了星辉教团预览图阻塞项；#1467 的作者是否解决了 engines 声明阻塞项；其余五个 PR 有没有动静。

## Decision

合入三个 PR，批准六次首次贡献者的 workflow 运行，五个 PR 确认仍等作者。两个维护者侧手法首次落地并成为先例：代跑 dist 重建后推送到贡献者 fork，以及索引尾部同位置冲突的并集解法。

- #1583（dsh-usage-panel，AlfredChaos 登记，Devin 全程 AI 编码）三轴全部通过，合入为 ecc7aecdf。实用性：插件从会话日志重建历史 token 账单，这是内置实时台账（`@linxin666/dsh-usage`，启用后才开始计数、30 天保留）在结构上做不到的——fork/resume 去重配合 seed 边界 epoch 是差异点，所以是与现有能力互补而非重复。稳定性：上游 MIT、三个 release 与 npm 同步、CI 绿、TypeScript 带测试、唯一运行时依赖 zod；数据只读（sessionQuery 加投影冷快照，10 分钟 stale-while-revalidate），投影单元、保温定时器、RPC 路由都随 fiber 释放。兼容性：settings.section id `usage-stats`、RPC 路径 `/api/usage-stats/overview`、投影键 `usagePanel`、cordis 行名在仓库内均无冲突；devDependencies 对齐官方 0.1.5-rc.2 SDK。提交的 `market/dist/manifest/plugins.json` 被证明与生成器输出逐字节一致，`community.json` 首条目的重缩进是纯空白改动。记录一个缺口：已发布的 0.2.3 tarball 早于上游的 `dsh.engines.dsh` 下限提交，该声明随下个版本带上。
- #1582（hive-maw / ember-fall / astral-choir 三套皮肤）合入为 5a0b7029d。作者把星辉教团预览图换成真实实拍，并把三套的 light 全部重拍为浅色主题下的暗壳实拍，与第九次要求一致；六张图全部从 PR head 下载并逐一目检，截图里的工作区名评估为非敏感（作者曾主动提出可以重拍）。作者的环境克隆不动这个 monorepo（约 128MB 处连接重置），market/dist 由维护者代跑重建：暂存分支先把最新 dev 合进 PR head，market-build 重新生成全部 3113 个文件（38 skins），经一次性 remote 推送到 fork 的 PR 分支（`maintainerCanModify` 已授权）。随后 CI 在 24 个文本路径上失败：作者的提交里 18 个皮肤源文件是 CRLF 行尾（每套的 LICENSE、README.md、README.zh.md、patches.css、skin.css、skin.json），而仓库约定是 LF（`.gitattributes` 的 `eol=lf`，全部已收录皮肤均为 LF），CI 上的逐字节 dist 比较因此不可能通过。修复是在 PR 分支上行尾规范化的提交（6661cbcbb）加按规范后源重建 dist（4ef3ebc7a），之后 CI 全绿。
- #1467（dsh-thread-tools）合入为 83c22ba65。作者选择了第二轮评审给出的首选路径：在 `src/store-access.ts` 完成 0.1.5 宿主线的适配，运行期解析两种存储形态（服务级 `load()`/`inspect()` 或每会话 `open(id, 'read')`，调用前绑定方法），并且不收窄声明而是两条线都补验证——`dsh.engines.dsh` 改为 `>=0.1.2-rc.1 <0.1.6`，新增 `dev/verify-0.1.5/verify15.mjs` 集成验证脚本（真实 0.1.5 安装上 6/6；0.1.2-rc 套件保持 24/24），上游 CI 在 7ef9a96 上绿，提交的 `lib/` 构建验证与源同步。本轮还顺手修了一个真 bug（thread_create/thread_fork 立即 dispose 新 agent 的句柄，导致新建会话寻址不到）。这个 PR 与 #1583 都往索引尾部追加条目，产生同位置冲突；解法是把 origin/dev 合进 PR 分支并做并集解析（两个条目都保留，规范格式），再确定性重建 dist（thread-tools rank 75、usage-panel 76），推送到 fork。工坊插件列表从 74 条增至 76 条。

五个在途 PR（#1576、#1526、#1488、#1479、#1399）在既有评审之后没有任何提交或回复——各自的 `updatedAt` 仍等于最后一次评审的时间戳——全部维持等作者状态，只读复核。

## Alternatives considered

#1582 在 CI 红灯时用 `--admin` 强合被否决：失败是真实发现（CRLF 源破坏 dist 契约），不是卡住的门禁；把行尾规范化加重建推到 PR 分支能拿到完全诚实的绿灯——与第九次否决 admin 绕行的理由一脉相承，只是从「卡住的运行」延伸到「真实失败」。

先重建 #1582 的 dist 再把 dev 合进暂存分支的做法执行过一次并已纠正：第一次重建烤进去的是 #1583 之前的 74 插件 manifest，合并时会与 dev 上的 75 插件状态冲突。先把 dev 合进暂存分支让 PR 合并零冲突，这一步现在已是该手法的一部分。

把 #1467 弹回作者做第二次 rebase 被否决，与[第七次](2026-09-13-pr-maintenance-seventh-pass.md)的规则一致：过期来自 dev 的前进（本分支重建后 #1583 才合入），两条独立尾部条目的并集可证明地保留了双方意图，确定性重建定义产物一侧。

要求 #1582 作者因工作区名可见而重拍被否决：名字是中性字符串，会话标题不含敏感内容，再来一轮截图往返只会拖延一个可修复的 PR，没有防护收益。

## Consequences

origin/dev 带 ecc7aecdf（#1583）、5a0b7029d（#1582，含行尾规范化与 dist 重建）、83c22ba65（#1467，含冲突解决合并）。目录现为 76 个插件、41 套皮肤。五个 PR 维持开放等作者（#1576、#1526、#1488、#1479、#1399），各有在案评审。`maintainerCanModify` 之下维护者介入贡献者 fork 的先例现在有两个：第七次的生成产物冲突就地重建合入，以及本次的暂存分支代跑（合 dev、规范行尾、重建、一次性 remote 推送），面向无法本地跑工作区的贡献者。dsh-usage-panel 的 engines 下限缺口随上游下个发布自愈。本轮没有评审任何触发协作者通知的 Wallpaper Engine 域文件。

## Testing

#1583 在专用工作树（基于当时最新 origin/dev 合并）跑了全量门禁：typecheck、test、test:scripts（283/0）、docs:check、i18n:check、libs:check、market:check 全过，另有 community-index OK（75）和「重新生成后与提交内容 diff」的一致性证明。#1582 的证据是合并树上的 `dsh-skin validate`（3x PASS）与 `skin-center:check`、从 PR head 抓取的六张预览图逐一目检、以及 PR head 自身 CI（干净检出 `market-build --check`）只在规范化提交后转绿。#1467 的证据是 community-index OK（76）、并集解析后的 `market-build --check`、上游克隆检查（engines 声明、store-access 形态解析、lib/ 新鲜度）与上游 CI。所有合并、批准与最终状态均经 GitHub API 确认。
