# Agent Note: PR maintenance run 2026-09-20 (sixteenth pass) — merge the whale-maid skin, the PerryLink community index and the reasoning-effort metadata; approve the doro pet pending a rebase

Status: implemented

## Problem

对 `zhu1090093659/dsh-web` 的第十六次维护巡检，接在[第十五次](2026-09-20-pr-maintenance-fifteenth-pass.md)之后。默认范围：分配（assignees）给维护者账号 `zhu1090093659` 的开放 PR，不扫描 Issue。本轮有四个 PR 需要处理：#1631（鲸鱼娘·望海皮肤）与 #1630（Doro 宠物）用新提交回应了第十五次巡检的修改意见，#1643（PerryLink 七个社区插件）与 #1641（reasoning-effort 条目 0.2.7 元数据）是新到的。另有七个遗留 PR（#1626、#1607、#1603、#1526、#1488、#1479、#1399）仍带既有修改意见开放。

## Decision

合并三个 PR，批准一个并等作者 rebase，遗留队列确认仍被作者阻塞。

- #1631（鲸鱼娘·望海皮肤，stushansusu 提交）：批准并合并为 `9f3cd753`。许可证意见已落实：皮肤目录带 `LICENSE`（CC BY-NC-SA 4.0 全文），`skin.json` 声明 `license` / `licenseUrl` / `attribution`，皮肤 README 双语各有一节许可证说明，根 `README.md` / `README.en.md` 的版权表各加一行——这张表本来就在根 README 而不是皮肤中心 README，贡献者的位置选择是对的。两项证据闸门成立：真实聊天窗口的亮 / 暗截图里正文、工具行与输入卡在半透明插画上都清楚可读，多模态鉴赏也未发现裁切、畸变、水印或低质素材。
- #1643（PerryLink 七个插件，PerryLink 提交）：按第三方插件索引登记的强制三维度分析后批准并合并为 `ebba8bd5`。实用性：七个插件场景互不重叠且都是实打实的能力（GitHub 工具链与审查机器人、MCP 管理控制台、本地文档知识库、TickTick 任务桥、插件体检、插件升级走廊、插件认证 MCP），元数据与上游仓库、npm 包名一致，与既有条目无重复。稳定性：七个仓库都公开、未归档、Apache-2.0 且带 LICENSE，npm 都已发布且 `repository.url` 与条目一致；`npm pack --dry-run` 确认每个发布包真的带 `cordis.patch.yml`、`package.json` 与 LICENSE，`dsh plugin` 能识别与挂载；`dsh-plugin-upgrade` 的 0.1.x 与 2.0.x 是同一位维护者、同一个 `repository.url` 发布的，不存在 npm 名易主。兼容性：peer 范围都包含仓库基线 0.1.5-rc.1。其余注意项写在 PR 上而不作为阻塞：`dsh-mcp-panel` 把 `@deepseek-ai/dsh-subprocess@0.1.6-alpha.1` 精确锁在生产依赖，七个包都没声明 `dsh.engines.dsh`，`dsh-cert-mcp` 的 MCP registry 发布工作流是红的，`dsh-plugin-doctor` 的徽章工作流败在自身 401 查询，还有三个包把构建工具放进了运行依赖。
- #1641（reasoning-effort 条目 0.2.7 元数据，Jamsharden 提交）：批准并合并为 `5c277196`。这不是皮肤 / 宠物那种内容闸门，而是既有条目的描述刷新，因此核对点是新描述与已发布产物是否相符：`@megen-lebar/dsh-reasoning-effort@0.2.7` 内的 `lib/official-levels.json` 正好 961 条模型记录、其中 737 条 `reasoning: true`，描述里点名的每个模型系列都能在该数据里查到。
- #1630（带洗澡模式、随机漫游与拖拽挣扎的 Doro 宠物，stushansusu 提交）：内容通过，合并被分支状态卡住。出处意见已落实：`packages/dsh-pet/THIRD_PARTY_NOTICES.md`、dsh-pet README 双语与根 README 版权表现在都写明 Doro 是《胜利女神：妮姬》桃乐丝的非官方同人衍生形象、角色及相关权利归 SHIFT UP、素材仅限个人非商业使用。引擎改动按本身质量复核后成立：`modes` 与 `roam` 解析 fail-closed，持久化的模式 id 会回对清单校验，切换模式会重置恢复余量，顺带修掉的两处也确实是缺陷（每次 verb 复制状态时丢掉 `restoreCarryMs` / `incomeCarryMs`；待机小动作的相位守卫让环境动作永远掷不出来）。它在 GitHub 上是 `CONFLICTING`，冲突只在生成物（`market/dist/manifest/*.json`、`packages/dsh-web-all/lib/client.js.map`、`scripts/lib-artifact-fingerprints.json`），因此 review 要求作者 rebase 到 `origin/dev` 后重跑 `pnpm build && pnpm libs:write` 与 `node scripts/market-build`；ruleset 不在 push 时撤销旧批准，所以批准保留有效。
- 七个遗留 PR（#1626、#1607、#1603、#1526、#1488、#1479、#1399）仍被作者阻塞：自上次 review 后没有新提交，修改意见仍挂着，也没有回复。#1399 仍是草稿。

## Alternatives considered

拒绝把 #1630 的提交在本地解冲突后直接推到 `dev`：冲突都在生成物上，本地重新生成是机械操作，但把第三方贡献走维护者分支会绕过既定的外部贡献流程，而作者是响应的——同一位作者的姊妹 PR #1631 在提出要求后几小时内就完成了 rebase。

拒绝把 #1643 卡在缺少 `dsh.engines.dsh` 上：`docs/plugins.md` 要求每个发布包声明它，但索引契约并不检查它，索引里已有条目（包括这位作者已收录的 `dsh-auto-review` 与 `dsh-permission-rules`）也有不少没声明，而且索引只存链接不搬代码。该项作为后续建议写在 PR 上。

拒绝把 `dsh-plugin-upgrade`「0.1.x 发布早于当前仓库创建」的时间线直接判为同名抢注风险：直接查 npm 后确认 0.1.3 与 2.0.1 的维护者与 `repository.url` 都相同，包历史是连续的。

## Consequences

三个 PR 已进入 `origin/dev`（`9f3cd753`、`ebba8bd5`、`5c277196`），并由 `9f7fbe93b` 整合进本地 `dev`；#1630 已批准、等作者 rebase；七个遗留 PR 仍开放且被作者阻塞。本轮没有改动 Wallpaper Engine / 渲染器相关路径，无需通知该域协作者。本地 `dev` 仍带着更早会话留下的未推送提交（四个功能与测试提交，以及若干维护巡检记录），本次没有推送，因为当前请求没有授权把这些无关的未推送工作发布出去；不过 `origin/dev` 已包含全部被接受的提交，三次合并都走了 GitHub 合并流程。

## Testing

每项内容闸门都在从当时的 `origin/dev`（`3b323e53`）新建的独立 `wt` 工作树里执行，测试前先把 PR head 合进去。

- #1631：`node scripts/dsh-skin validate packages/skins/skin-center/skins/whale-maid` PASS；`pnpm skin-center:check` OK（42 个内置皮肤）；`node scripts/market-build --check` tryon 校验通过（756 文件）、dist 最新（2394 文件）；`node scripts/verify-docs.mjs` 干净；皮肤中心测试 43 文件 / 662 用例全过。
- #1643：`node scripts/community-index` OK（85 条目）；`node scripts/market-build --check` dist 最新；七个包逐个 `npm pack --dry-run` 确认发布包内含 `cordis.patch.yml`、`package.json` 与 LICENSE；`npm view` 确认已发布的 `dsh` 清单、peer 范围与仓库地址。
- #1641：`node scripts/community-index` OK（78 条目）；`node scripts/market-build --check` dist 最新；直接统计已发布的 `official-levels.json`（961 条模型、737 条 reasoning）。
- #1630：`node scripts/dsh-pet validate packages/dsh-pet/assets/doro` valid；dsh-pet 测试 44 文件 / 539 用例全过；`pnpm --filter @linxin666/dsh-pet typecheck` 干净；`node scripts/market-build --check` dist 最新（3207 文件）；`node scripts/lib-artifact-check.mjs` OK；`pnpm aggregate:check` OK；`node scripts/verify-docs.mjs` 干净；并对轨道总览图、挣扎帧条与各轨道预览做了多模态查看。
- 整合：本地 `dev` 合并 `origin/dev` 时两处生成物冲突用重新生成解决（`pnpm build && pnpm libs:write`、`node scripts/market-build`），随后 `libs:check`、`market-build --check`（2394 文件）与 `aggregate:check` 均通过；四个 `wt` 工作树用 `wt remove --no-delete-branch` 回收。
