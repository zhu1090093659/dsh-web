# Agent Note: PR maintenance run 2026-09-20 (seventeenth pass) — merge the Doro pet and the 32-plugin PerryLink community index batch

Status: implemented

## Problem

对 `zhu1090093659/dsh-web` 的第十七次维护巡检，接在[第十六次](2026-09-20-pr-maintenance-sixteenth-pass.md)之后。默认范围：分配（assignees）给维护者账号 `zhu1090093659` 的开放 PR，不扫描 Issue。本轮范围内有九个开放 PR：#1630（Doro 宠物）已回应修改意见、可以干净合并；#1647（PerryLink 家族剩余 32 个社区插件）是新到的；另有七个遗留 PR（#1626、#1607、#1603、#1526、#1488、#1479、#1399）仍带未回应的修改意见开放。九者都没有协作者 review ——全部正式 review 都来自当前认证的维护者账号本身，因此「协作者已审查则跳过」这条不适用。

## Decision

合并两个 PR，其余七个确认仍被作者阻塞。

- #1630（带洗澡模式、随机漫游与拖拽挣扎的 Doro 宠物，stushansusu 提交）：合并为 `9556103a9`。第十六次巡检已经批准内容、只要求 rebase；之后到达的两个提交分别是重新生成的产物（`691f939a`）与 test-standards 测试修正（`a8e75343`），都不改变行为，因此对新 head 是复核既有批准而不是重新审议。三项宠物内容闸门都在该 head 上重核：变更证据（PR 内的 11 轨道总览、挣扎帧序列与各轨道预览，加上作者提供的注册表 API 响应——沿用第十五、十六次的接受尺度，而不是闸门字面要求的设置页截图）、版权与来源（`packages/dsh-pet/THIRD_PARTY_NOTICES.md` 已写明 Doro 是《胜利女神：妮姬》角色桃乐丝的非官方同人衍生形象、角色及相关权利归 SHIFT UP Corp.、素材仅限个人非商业使用，与 dsh-pet README 双语和根 README 版权表一致）、美学鉴赏（用支持图像输入的模型直接查看总览、挣扎帧序列与 idle / work-success / wash / move 预览：角色一致、透明通道干净、各轨道道具与语义相符、无裁切畸变或水印）。
- #1647（PerryLink 家族剩余 32 个社区插件，PerryLink 提交）：按三轴分析后批准并合并为 `2e21cd635`。实用性：没有一条与已登记的 85 条重复；与既有能力相邻的条目（dsh-memento 对既有几个记忆插件、dsh-draw 对 dsh-imagegen、dsh-session-sync 对 dsh-cloud-sync、dsh-talk 对 dsh-audiogen、dsh-fast 对 dsh-context 与 dsh-usage-panel）机制与覆盖面不同，分类与二级分类都落在既有枚举内。稳定性：32 个仓库都公开、未归档、Apache-2.0，带 `dsh-plugin` topic 与根目录 `cordis.patch.yml`，最近推送都是 2026-09-19，npm 均已发布且 `repository.url` 与登记仓库一致，tarball 实际包含 `cordis.patch.yml` + `package.json` + LICENSE，CI 与 plugin-doctor 最新运行全绿，各有 10 到 50 个测试文件。兼容性：声明的 peer 范围都接受本仓库基线的 `@deepseek-ai/cordis ^4.0.2` 与 `@deepseek-ai/dsh-* ^0.1.5-rc.1`（逐条用 semver 比对），索引 id 与 npm 名均不冲突。
- 其余注意项写在 PR 上而不作为阻塞，沿用第十六次对上一批 PerryLink 条目的处理方式：`dsh-team-rooms` 与 `dsh-background-agents` 互斥（工具名、`settings.section` id 与 storage domain 都相同），但商店会把两条同时列出且不给冲突提示；`dsh-skill-pack-security` 的 `cordis.patch.yml` 在 `provider/` 子目录而不是仓库根目录，走 git 通道安装需要指向该子目录；`dsh-plugin-kit` 的 patch 是有意的空数组，它是库而不是可挂载插件；`dsh-output-styles` 把 `@deepseek-ai/dsh-storage{,-json,-domain}` 以 0.1.5-rc.2 作为硬依赖，而 peer 范围又不含 0.1.6 线；有多个包把构建工具放在 `dependencies` 而不是 `devDependencies`；已发布的 `dsh-budget` 0.4.9 仍带缓存命中计价的缺陷（其 issue #4）。
- 七个遗留 PR（#1626、#1607、#1603、#1526、#1488、#1479、#1399）仍被作者阻塞：每一条的 head SHA 都等于它最近一次 review 所针对的提交，没有新工作可评审，既有修改意见继续挂着。#1399 仍是草稿。

## Alternatives considered

拒绝把 #1647 拆成几个小批，或仅因批次大而拒绝这 32 条：索引没有记载条数上限，这批是同一位作者的一个家族、按与已合并的七条批次相同的形态登记，而且整批可以在一次核对里按登记契约要求的证据完成。贡献者愿意拆分的表态已记录在 PR 上，但批次大小本身不是缺陷。

拒绝把 #1647 卡在上面的注意项上：索引只存链接、不搬代码，上游是库或锁了依赖并不使条目不可登记，而 `dsh-team-rooms` 与 `dsh-background-agents` 的冲突由上游自己声明。这与第十六次处理上一批 PerryLink 条目的理由一致。

拒绝在合并前把 32 个插件在本机 profile 里逐个挂载：纯链接的索引条目不搬运也不挂载插件，真要做就得把 32 个第三方 bundle 连同各自的外部前提（Ollama、语言服务器、IM 凭据、仅 Windows 的原生辅助程序）装进这台共享机器。实际完成的验证覆盖仓库身份、npm 发布、tarball 内容、peer 范围接受度与 CI，未验证的边界同时写在这里与 PR 上。

拒绝因为时间过去了就重新评审七个遗留 PR：它们的 head 与上次 review 时完全相同，对同一份代码再出一个结论只会改变 review 状态而不增加证据。

## Consequences

`origin/dev` 现在载有 `9556103a9`（#1630）与 `2e21cd635`（#1647），本地 `dev` 已快进到 `2e21cd635`。社区插件索引从 85 条增至 117 条，`packages/dsh-pet/assets/doro` 成为仓库侧第八个内置宠物。七个 PR 仍开放且被作者阻塞。本轮没有评审中的改动触及 Wallpaper Engine / 渲染器路径，无需通知该域协作者。只记录未修：`dsh-team-rooms` 与 `dsh-background-agents` 的互斥在商店里对用户可见，除非索引日后增加冲突字段，否则仍属上游文档层面的事。`maint-1630` 与 `maint-1647` 两个任务分支在工作树回收后仍然保留，因为 `wt remove` 只在 `-D` 下才会删除它们，而本流程不授权该操作。本地 `dev` 带着本次维护记录的提交未推送，因为当前请求没有要求发布它；被接受的 PR 提交都已通过 GitHub 进入 `origin/dev`。

## Testing

每个 PR 都在各自用 `wt` 从 `origin/dev` 创建的工作树中验证，测试前先合入 PR head。

- #1630（`maint-1630`）：合入 `refs/pull/1630/head` 无冲突；`node scripts/dsh-pet validate packages/dsh-pet/assets/doro` 有效；`pnpm --filter @linxin666/dsh-pet typecheck` 与 `build` 干净；dsh-pet 套件 44 文件 / 539 测试全过；`node scripts/market-build --check` dist 同步（3230 文件）；`node scripts/lib-artifact-check.mjs` OK；`pnpm aggregate:check` OK；`pnpm test:standards` OK；`node scripts/verify-docs.mjs` 干净。802 帧资产清单、11 条轨道与注册表条目都在合并后的树上核实，`loadPetRegistry` 从 `assets/*` 解析，因此无需改代码即可出现。
- #1647（`maint-1647`，基线为 `9556103a9` 的 `origin/dev`）：合入 `refs/pull/1647/head` 无冲突；`node scripts/community-index` OK（117 条）；`node scripts/market-build --check` dist 同步（3230 文件）；`pnpm market:check` OK；`node scripts/verify-docs.mjs` 干净；`pnpm i18n:check` OK；`pnpm emoji:check` OK；`pnpm test:scripts` 343/343 通过。32 条的上游证据以只读方式采集——用 `gh api` 读仓库、许可证、topic、patch、工作流、测试与 issue；在临时目录里用 `npm view` 与 `npm pack --dry-run` 读发布信息、身份与 tarball 内容；再用 semver 对基线逐条比对 peer 范围。
- 每次批准之后、每次合并之前都重读了 GitHub 状态：`mergeStateStatus` 为 `CLEAN`、`reviewDecision` 为 `APPROVED`，且全部必需检查（`CI checks`、`plugin-mount`、`Validate PR contribution evidence`、`guard-agent-notes`）为绿。
- 未验证：32 个插件都没有在本机 profile 里挂载运行，#1630 的宠物也没有在运行中的 GUI 里切换过去，因此上游的运行时结论依据的是上游 README、其测试树与 CI，而不是本机执行。
