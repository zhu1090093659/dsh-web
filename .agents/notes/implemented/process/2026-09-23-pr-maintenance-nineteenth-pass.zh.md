# Agent Note: 2026-09-23 PR 维护运行（第十九轮）——把 16 个分配到人的外部 PR 全部对齐到已适配 0.1.7-alpha.2 的 dev

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第十九轮维护，接续[第十八轮](2026-09-21-pr-maintenance-eighteenth-pass.md)。请求的范围是默认范围——分配给维护者账号 `zhu1090093659` 的开放 PR，不扫描 Issue——外加一条约束：`dev` 已适配 0.1.7-alpha.2 宿主 cohort 并积累了大量改动，因此每个外部贡献的 PR 都必须先对齐到当前 `dev`，其状态才有评估意义。当时范围内有 16 个开放且已分配的 PR，没有一个分支是基于 `dev` 当前指向的提交，其中 5 个存在冲突。

本轮交付的是对齐本身，而不是评审结论。任何 PR 的评审状态都不应改变：其中若干仍停在早前轮次留下的、尚未回应的变更请求上，`#1399` 仍是草稿。

## Decision

16 个 PR 全部通过对齐处理：把 `origin/dev` 合并进 PR head，再把产生的合并提交以**普通（非 force）推送**推回贡献者 fork。对齐基线是 `fea8333c`，即记录 0.1.7-alpha.2 兼容性扫描的 `dev` 提交；本轮开始时它还在本地、先被推送到 `origin/dev`，在此之前对齐的 13 个 PR 使用的是它的祖先 `4a573867`，同样是有效的 `dev` 提交。

- 15 个 PR 只需合并；其中 13 个由 git 自行解决了绝大多数文件，凡是冲突文件一律是生成物。
- 4 个皮肤/宠物 PR（`#1679`、`#1671`、`#1603`、`#1607`）还需要刷新入库的构建产物：合并后的源码使其已提交的 `lib/` 与 `market/dist` 相对实际交付内容变陈旧。
- `#1666` 还必须先在工作树里执行 `pnpm install --frozen-lockfile`，否则市场构建根本起不来：该工作树入库的 `lib/` 是针对更旧的 zod cohort 构建的，`scripts/market-build` 直接以 `z.…volatile is not a function` 崩掉。
- 冲突一律靠重新生成解决，绝不手工编辑生成文件：
  - `packages/dsh-community-plugins/community.json`——取 dev 的 119 条与 PR 新条目的并集。git 自动合并的情况会先校验、必要时修回精确的 `dev + pr_new`；真正冲突时用 stage-2/stage-3 blob 按同样方式合成。1666、1626、1526、1488、1479、1399 各自贡献一个 id（`dsh-attention-health`、`dsh-deepseek-web`、`dsh-round-rightclick`、`dsh-plugin-bwm-friend`、`dsh-voice-talk`、`dsh-provider-signin`）。
  - `market/dist`（`manifest.js`、`manifest/*.json`、`styles.js`、`sitemap.xml`）——先 `git checkout origin/dev -- market/dist`，再基于合并后的源码跑 `node scripts/market-build`。
  - 4 个包入库的 `lib/` 与 `scripts/lib-artifact-fingerprints.json`——`pnpm build`，随后 `node scripts/lib-artifact-check.mjs --write`，再 `node scripts/market-build`。`#1671` 与 `#1603` 连指纹文件本身都冲突。
- 本轮早前留在 PR 上的两条记录是错的，已在对应 PR 上更正：`#1607` 的 `pnpm libs:check` 失败与 `#1679` 的 `pnpm market:check` 失败曾被写成「贡献者既有缺陷」，实际都是对齐本身造成的陈旧，重新生成并把刷新后的产物推回后即转绿（`#1607` `6aa228f2`、`#1679` `1235915b`）。
- 每个 PR 收到一条中文评论，写明基线提交、合并提交、重新生成了哪些文件、哪些门禁通过、以及未使用 force push。若先前评论记录了后续已修复的失败，就再补一条更正评论，而不是让错误结论继续挂着。
- 评审状态刻意不动：12 个 PR 仍显示 `CHANGES_REQUESTED` 或 `REVIEW_REQUIRED`，`#1399` 仍是草稿，本轮没有给出任何结论、批准或关闭。

## Alternatives considered

用 rebase 把每个 PR 挪到 `origin/dev` 上被否决：那会重写贡献者的提交，因而必须对 fork 强制推送，而本仓库对贡献者 fork 的规则禁止这样做；合并提交保留原始提交，相对旧 head 只多一个可评审的 diff，贡献者也能正常 `git pull`。

手工处理冲突的生成文件——只取 dev 的 `market/dist` 就收工，或直接改 `community.json` 的 JSON 而不校验结果——被否决：这些文件是由检查脚本重新推导的字节产物，手工编辑要么过不了 `market:check`，要么让入库产物与其声称代表的源码静默脱钩。

只对齐 5 个冲突 PR（仅看冲突报告会得到的结论）被否决：另外 11 个 head 同样带着 `dev` 变更之前构建的入库产物，而 `#1607`/`#1679` 证明了合并干净仍可能门禁失败。

因为 `#1607` 的 `libs:check` 在合并前就失败就放过它，在确认重新生成路线可行后被否决：该失败就是 PR 自己入库产物与源码不符，本轮的职责正是让每个 PR 可合入、可评估，而重新生成恰恰是本仓库要求这类 PR 合入前完成的步骤。

本轮顺手把 SDK cohort 升到 0.1.7-alpha.2 被否决：注册表的 `alpha` tag 确实发布了 `0.1.7-alpha.2`，但 cohort 变更属于有自身评审与灰度流程的 `dsh-sdk-upgrade` 授权流程，不是对齐贡献者分支的副产品。

## Consequences

16 个贡献者分支现在都带着一个来自 `dev` 的合并提交（`fea8333c`，其中本轮较早对齐的 13 个是其祖先 `4a573867`），在 GitHub 上均为 `MERGEABLE`。作者们可以普通 `git pull`，无需处理任何历史重写。

4 个皮肤/宠物 PR 现在内部一致——入库的 `lib/`、`market/dist` 与指纹都与其交付源码匹配——所以它们仍欠的内容门禁（`#1679`、`#1671`、`#1603`、`#1607`）现在只需判断内容本身，即本仓库的本地功能证据、第三方版权出处声明与美学评审要求。它们此前的陈旧问题已经关闭。

本轮没有改变任何评审结论，因此仍停在未回应变更请求上的 9 个 PR 与 1 个草稿，与第十八轮结束时一样仍被作者阻塞。

有一项环境事实已确认，记录在此而不采取行动：本仓库自身的 SDK cohort 固定在 `0.1.7-alpha.1`（`package.json` 为整套 `@deepseek-ai/dsh-*` 声明 `^0.1.7-alpha.1`，`pnpm-lock.yaml` 解析为 `0.1.7-alpha.1`，`node_modules/@deepseek-ai/dsh-agent` 为 `0.1.7-alpha.1`），而正在运行的宿主应用是 `0.1.7-alpha.2` 且其自身依赖锁在 `0.1.7-alpha.2`；注册表的 `alpha` dist-tag 是 `0.1.7-alpha.2`。也就是说「已适配 0.1.7-alpha.2」描述的是 `docs/archive/` 记录的源码层兼容工作，不是已安装的 cohort；若刷新 lockfile，caret 范围会解析到 `alpha.2`。

对 `.agents/notes/implemented/` 做了一次取代性检查，没有发现哪条 note owns 本轮所用的流程。最接近的记录是[第十六轮](2026-09-20-pr-maintenance-sixteenth-pass.md)，它记录了把 `origin/dev` 整合进本地 `dev` 时用重新生成解决生成物冲突；本轮复用该机制并把它扩展到贡献者 fork 分支，所以两条 note 互相交叉引用而不合并，没有任何早期 note 被取代。

本轮的 note 提交按第十八轮先例留在本地：所有对齐结果都已通过 GitHub 到达贡献者 fork，而当前请求要的是 PR 对齐，不是发布这条 note。

## Testing

每个 PR 都在自己独立的 `wt` 工作树里处理，工作树由主检出创建、以 `git fetch origin refs/pull/<n>/head` 为来源，共享的 `dev` 检出从未被切换。

本轮结束后的权威状态来自 `gh pr view` / `gh pr list`（不是本地日志）：16 个 PR 均为 `state=OPEN`、`mergeable=MERGEABLE`，且 `headRefOid` 等于本轮推送的合并提交。

| PR | fork 分支 | 合并提交 | 基线 | 对齐后门禁 |
| --- | --- | --- | --- | --- |
| 1679 | Yuji6278 dev | `1235915b`（修复） | `4a573867` | 三门禁通过 |
| 1671 | Sddft97 feat/skin-verdandi | `60cb042d` | `fea8333c` | 三门禁通过 |
| 1603 | JinFuLee feat/skin-paper-ink | `97ee6766` | `fea8333c` | 三门禁通过 |
| 1607 | binlecode feat/add-skins-porco-exile-snake | `6aa228f2`（修复） | `4a573867` | 三门禁通过 |
| 1399 | chunjin666 feat/community-register-provider-signin | `44fd585b` | `fea8333c` | 三门禁通过 |
| 1666 | donghangxunlang-cmd add-dsh-attention-health | `ea6cc71d` | `4a573867` | market:check 通过 |
| 1626 | zgrajdnhj7806-svg feat/community-dsh-deepseek-web | `d82c43fa` | `4a573867` | market:check 通过 |
| 1526 | hmr-BH add-hmr-bh-dsh-round-rightclick | `d1d959ed` | `4a573867` | market:check 通过 |
| 1488 | Lawrencezeng818 community/register-bwm-friend | `24486fa8` | `4a573867` | market:check 通过 |
| 1479 | duoduoqian708 feat/community-voice-talk | `7402be0e` | `4a573867` | market:check 通过 |
| 1685 | DDDMUC fix/whale-mom-plugin-page-readability | `01e43688` | `4a573867` | market:check 通过 |
| 1684 | tr1v3r feat/community-dsh-ltm | `6990e5da` | `4a573867` | market:check 通过 |
| 1681 | PerryLink add-perrylink-dsh-laya | `e5399011` | `4a573867` | market:check 通过 |
| 1673 | zhy5 feat/community-plugins-dsh-wx-bridge | `65bd495a` | `4a573867` | market:check 通过 |
| 1659 | aklnaaw feat/skin-claude | `d4e84dd2` | `4a573867` | market:check 通过 |
| 1658 | mengge237 community-dsh-model-priority | `549a6da5` | `4a573867` | market:check 通过 |

逐 PR 证据：

- `#1671`：只冲突 `scripts/lib-artifact-fingerprints.json`；经 `pnpm build` + `libs:write` + `market-build` 后，`market:check` 报 `dist up to date (3264 files)`，`skin-center:check` 报 `OK (43 repo catalog skins)`，`libs:check` 报 `OK (4 committed lib/ packages match their sources)`；相对 `dev` 的 diff 是新皮肤 `verdandi`（assets、`skin.css`、`patches.css`、`skin.json`、预览图）、它在 `market/dist` 的副本以及刷新后的指纹。
- `#1603`：冲突在 `market/dist/manifest.js`、`manifest/skins.json`、`sitemap.xml`、`styles.js`；同样重新生成；`3268` 个文件、`43` 套皮肤、`libs:check` `OK`；相对 `dev` 的 diff 是新皮肤 `paper-ink` 及其 `market/dist` 副本。
- `#1399`（草稿）：冲突在 `market/dist/manifest.js`、`manifest/{pets,plugins,skins}.json` 与 `community.json`；社区文件按并集解析为 dev 的 119 条加 `dsh-provider-signin`；`market:check` 报 `dist up to date (3230 files)`、`42` 套皮肤、`libs:check` `OK`；相对 `dev` 的全部 diff 就是 `manifest/plugins.json`（+12）与 `community.json`（+11）。
- `#1607`：修复前 `market:check` 通过（`3280` 个文件）而 `libs:check` 失败；经 `pnpm build` + `libs:write` + `market-build` 后三门禁全部通过，提交 `6aa228f2` 已推送。
- `#1679`：修复前 `market:check` 失败并报 `market/dist stale — … assets/skins/endfield-baker/patches.css, styles.js, tryon-assets/skins/endfield-baker/patches.css`，而 `skin-center:check` 与 `libs:check` 通过；重新生成后三门禁全部通过（`3253` 个文件），`1235915b` 已推送。
- `#1666`：市场构建最初在工作树入库的 `packages/skins/skin-center/lib/index.js` 处崩于 `z.number(...).volatile is not a function`；在该工作树执行 `pnpm install --frozen-lockfile` 换掉不匹配的 cohort 后，同一个构建报 `dist up to date (3230 files)`。相对 `dev` 的剩余 diff 是 `manifest/plugins.json`（+12）与 `community.json`（+11）。
- 12 个纯社区 PR 各以 `node scripts/market-build --check` 验证（均为 `dist up to date (3230 files)`），并用 `gh pr view` 核对 head 与可合并状态。

未验证：没有任何对齐后的 PR 在运行中的 GUI 里挂载，所以这里的一切都不是运行时行为的证据；`#1679`、`#1671`、`#1603`、`#1607` 的皮肤/宠物内容门禁仍欠；12 个纯社区 PR 没有做完整 `lib/` 重建，因为它们都不涉及入库 `lib/` 的包；本轮没有合入任何 PR。