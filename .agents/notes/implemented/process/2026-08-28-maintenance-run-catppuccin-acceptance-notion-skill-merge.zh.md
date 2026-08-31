# Agent Note: Maintenance run accepts catppuccin, merges notion-skill, reviews free-search and tokyo-night

Status: implemented

## Problem

第六次 /pr-issue-maintenance 例行维护，目标 zhu1090093659/dsh-web，默认范围（assignees 含 zhu1090093659 的开放 PR；不扫描 Issue）。[上一轮记录](2026-08-27-maintenance-run-delete-message-merge-four-registration-reviews.md)留下三个内容已齐、待清单项落实的索引 PR，两个挂起线程，以及一个被 owner 关闭、邀请以纯资产重投的皮肤 PR。本轮范围内共 8 个开放 PR；需要决定哪些已可收录、执行纯资产皮肤新惯例下的首次收录，并为两个从未审查的 PR（#1249、#1245）给出初审。

## Decision

- #1240（UnusWhite，catppuccin 重投）：核实后以 c98e4d947 合并。七个文件全部位于 `packages/skins/skin-center/skins/catppuccin/`，无 market/dist 产物、无 `.agents/notes` 文件，且皮肤目录与已关闭的 #1239 diff 为空，上轮资产级审查结论继续有效。在 PR head 上本地复测：`node scripts/dsh-skin validate` PASS（id catppuccin，1.0.0）、`node scripts/skin-center-catalog-check --check` OK（22 个目录皮肤）、builtin-skins vitest 40/40、order 1002 无冲突（dev 上既有的 order 101 重复与本 PR 无关）、README 中英双语、亮暗 preview 均为真实 GUI 截图。
- 用 admin 合并闭合流程缺口：纯资产皮肤惯例与 `market-build --check` 新鲜度测试（`scripts/market-build-clean.test.mjs` 的 "clean checkout (no shell dist) passes market-build --check"）在贡献者 PR 上结构性互斥——只改皮肤的 PR 永远无法让该检查变绿，因为 dist 重建属于维护侧收录时工作。#1240 的 PR CI 恰好只挂这一项（script tests 225/226 通过，失败信息只列出 catppuccin 的 dist 路径）。以 `gh pr merge --admin` 接受该已知红项合并，并在同一轮内于 dev 上重建 dist。
- 维护侧重建以 d551988a5 落地 dev：在合并后 tip 的 worktree 里跑 `node scripts/market-build`，写入 1148 个文件（22 skins、4 pets、42 plugins），把 catppuccin 加入 manifest.js、manifest/skins.json、sitemap.xml、styles.js、tryon-assets 并携带 `assets/skins/catppuccin/` 与其 zip；提交后 `market-build --check` 通过（tryon/ 经 hash manifest 校验，756 文件）。pets.json/plugins.json 仅日期戳变化。
- #1235（Zhiyi-Zhao，notion-skill）：两项阻塞在实际 diff（2 文件 +23 行纯尾部追加）与线程证据（安装、真实 whoami/search/page-blocks 调用、双 profile 卸载且 bundles 计数复原）中核实，本地 `community-index --check` 通过（42 entries）、manifest 尾部确认 rank 42。放行两个 action_required run（CI、agent-notes-guard）后批准，squash 合并为 d5a9034e9。rank 42 归 #1235 而非 #1224，依据先完成先服务：Zhiyi-Zhao 于 2026-08-27 12:48 UTC 完成阻塞清单，slywalker2006 为 19:50 UTC。
- #1224（slywalker2006，dsh-passwords）：三项阻塞逐项核实完成（真中文描述并改名「远程访问网关 / Access Gateway」且 id 不动、基于 fb646654 的 2 文件 +25 行尾部追加、覆盖 rollbackPatch 路径的部署/卸载/宿主恢复日志）。线程评论中给出内容通过结论；因 #1235 合并占据 rank 42，请作者再 rebase 一次（条目顺延 rank 43），已无内容阻塞。
- #1249（DDDMUC，dsh-free-search）：发出初审。已核实：npm dsh-free-search@0.4.15 tarball 与仓库 HEAD 内容一致（除换行符）、安装干净（18 包）、独立冒烟 `searchDdgLite` 与 `searchBing` 返回真实结果、桥接路由回环防护（`isLoopbackRequest` 覆盖 remoteAddress、Host、sec-fetch-site、origin）、key 解析凭据中心优先且有 ref 白名单、PR head 上 `community-index --check` 通过。两个阻塞：条目需中英披露 bundle patch 会全局接管宿主 `web.searchProvider`（卸载由 rollbackPatch 还原）且 keyed 引擎需各自 key；补部署复现（安装、零 key 真实搜索、设置面板可见、卸载还原 provider）。#1235 合并后的补充评论把目标位次改为 rank 43。
- #1245（djyx，tokyo-night）：发出初审，一个阻塞项。本地核实齐备：validate PASS、catalog check OK、builtin-skins 40/40、order 1003 无冲突、CC0 授权加 AI 生成署名、README 双语、亮暗 preview 真实。阻塞：随包分发的 `assets/tokyo-night-art.webp` 右下角烙有「AI生成 Xiaomi MiMO」水印徽标（解码 webp 确认，两种主题可见），会出现在每个启用该皮肤用户的屏幕上。非阻塞记录：patches.css 的 `.aionui-*` 选择器在当前 dev 上是活代码，待 aionui 清理落地后成为无害死规则。
- #1100（termanli，fulltext-search）：仍在等既有两件事（删除 `.agents/notes` 三件套、rebase 加再生成）；位次更新评论把目标改为 rank 43。
- #1144（deepsea）与 #1098（agent-plugins-market）：上轮以来作者无移动，继续挂起。
- #1240 与 #1235 的首次贡献门控手动放行（各两个 action_required run：CI、agent-notes-guard），沿用 #1185 先例。

## Alternatives considered

- 让 #1240 作者自行提交重建后的 dist 以满足新鲜度检查：否决——这会推翻 owner 在 #1239 上「market 发布产物属维护侧收录时工作」的裁定，而 #1087 自带 dist 的旧惯例正是被该裁定废止的。
- 让 `market-build --check` 容忍待收录皮肤：推迟。这是惯例/检查冲突的结构性修复，但属于需要单独决策与测试的仓库脚本改动；本轮 admin 越过加即时重建能让 dev 保持绿色，不动门禁本身。
- 因 #1224 回应最完整而让它先落地：否决，坚持中立的先完成先服务规则；两位作者上轮已被告知同样的再生成纪律。
- 手工解决 manifest 尾冲突以在本轮合入第二个登记：否决，沿用既定规则——再生成属于贡献者分支上必需检查之后的工作。

## Consequences

- dev 前进到 d551988a5，携带 dsh-notion-skill 登记（42 entries，rank 42）与 catppuccin 皮肤及新建 dist；tip 上 `market-build --check` 通过。
- 纯资产皮肤惯例自此有了可重复的收录路径：纯资产 PR、审查时接受 dist 检查已知红、admin 合并、维护侧在 dev 重建。后续皮肤收录照此执行，并关注被推迟的 `--check` 范围修复。
- 三位索引作者（#1224、#1249、#1100）被指向 d551988a5 上的 rank 43；大概率当日推送，下一轮运行前必须重读这些线程。
- #1245 阻塞在水印-free 背景图，#1249 阻塞在接管披露加部署复现；两者距收录都只差一次推送。
- 验证用克隆与 worktree 均在 /tmp 下，用后清理；除本 note 与重建提交落地 dev 外，未改动共享 checkout 状态。
