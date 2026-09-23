# Agent Note: PR 维护巡检 2026-09-18（第十一轮）—— 三个合入：dsh-workbench、island-life 与 remiel-starlit

Status: implemented

## Problem

针对 `zhu1090093659/dsh-web` 的第十一轮维护巡检，距[第十轮](2026-09-16-pr-maintenance-tenth-pass.md)两天。默认范围：分配给维护者账号的 12 个开放 PR —— 不扫描 Issue。前序巡检留存的 4 个 PR 均处于作者阻塞状态（#1526, #1488, #1479, #1399）。8 个新增 PR 待初审：2 个社区插件索引登记（#1620, #1602）按强制三轴标准（实用性、稳定性、兼容性）评估；6 个皮肤收录提交（#1603, #1607, #1608, #1614, #1616, #1617）按内容贡献三项闸门（变更证据、版权与来源归属、美学鉴赏）评估。

## Decision

合入 3 个 PR，5 个 PR 评审给出 CHANGES_REQUESTED，确认 4 个存量 PR 仍受作者阻塞，批准 6 个首次贡献者 workflow 运行以产出真实绿色的 CI 检查报告。

- #1620（dsh-workbench，由 liiydong 登记）合入为 7e24b3e06。实用性：为 AI 文档迭代（Markdown 转换为 docx/pdf/xlsx）补充了跨会话时间轴、悬停卡片与审批状态记录，并提供直读核心 `ctx.skills` 的技能库检索与源/产物配对。稳定性：零运行时第三方依赖，本地 120/120 项组件与路由自检通过，写请求做安全路径穿越防护，适配 DSH Web >=0.1.5-rc.1。兼容性：命名空间 `/api/dsh-workbench/` 独立，官方侧栏槽位与可选 betterSidebar 页签注册规范，fiber 卸载清理干净。提交的清单与生成器输出在 rank 77 上完全一致。
- #1608（island-life，由 wertyq111 提交）合入为 84331b4f9。致敬动森氛围的纯资产目录皮肤。变更证据：PR 描述与预览图附带清晰的亮/暗双态实测界面截图。版权：原创 AI 生成插画、原创光标、Apache-2.0 许可证与明确的商标免责声明。美学鉴赏：昼夜色彩和谐，文字对比度良好，3D 按键样式精致。
- #1617（remiel-starlit，由 oh-wang 提交）合入为 fbd5f6c22。绝区零角色同人纯资产皮肤。变更证据：附带清晰的亮/暗双态实际运行截图。版权：NOTICE 与 LICENSE 完整记录了米哈游官方角色素材非商业同人使用声明与工程 CC BY-NC-SA 4.0 许可。美学鉴赏：磨砂玻璃质感细腻，双态对比度达标。
- #1602（dsh-ppt-studio，由 zbsph 登记）评审为 CHANGES_REQUESTED。概念实用性良好，但干净克隆下 `npm test` 出现 3 项失败（smoke 自检中 referenceTemplate 与 reference/ 拷贝断言失败，且文档断言计数自证与实际 209 结果不符）；上游缺少 CI 工作流；rank 77 及文件尾部与 #1620 冲突。
- #1603（paper-ink，由 JinFuLee 提交）评审为 CHANGES_REQUESTED。在 `assets/fonts/` 随包打包了 27 个字体二进制文件（424 KiB），但缺少 SIL OFL 1.1 许可证文本、著作权归属声明及 README「来源与版权」章节；实际渲染视觉效果偏近单色平涂。
- #1607（porco-rosso, last-exile, white-snake，由 binlecode 提交）评审为 CHANGES_REQUESTED。PR 描述中缺少变更证据附件（仅文字描述）；随包打包了商业动画原声音频文件（MP3）及商业动画壁纸，缺少合法分发依据。
- #1614（hairline，由 stushansusu 提交）评审为 CHANGES_REQUESTED。亮暗两态预览图逐字节相同；缺少 LICENSE/NOTICE 文件；引用的第三方视频素材《哲风壁纸》缺少来源与许可依据。
- #1616（kaleido，由 stushansusu 提交）评审为 CHANGES_REQUESTED。`hooks.mjs` 包含运行时向外部 API `https://api.elaina.cat/random/` 动态拉取图片的逻辑，绕过皮肤加载器的相对路径与 CSS 白名单沙箱，泄漏用户行为，且引入未经验证的外部不可控内容。

4 个存量 PR（#1526, #1488, #1479, #1399）自上一轮评审后无新提交或回复，维持作者阻塞状态。

## Alternatives considered

拒绝手动顺延 rank 合入 #1602：上游测试在干净检出下失败，在修复断言并补全 CI 之前无法给出稳定性证明。

拒绝以"hooks 属于灵活通道"为由放行 #1616：通过运行时 `new Image()` 加载动态外链图片破坏了离线保证，泄漏网络请求，绕过 CSS 白名单与路径约束，违反内容版权闸门。

拒绝忽略 #1603 中的字体许可证缺失：在 npm 分发中直接随包打包第三方字体二进制文件而无 OFL 许可证文本，违反开源协议与内容闸门 2。

拒绝通过管理员权限绕过 CI：批准首次贡献者工作流运行，使 3 个合入 PR 的 CI 全部基于真实运行获得绿色通过。

## Consequences

origin/dev 包含 7e24b3e06（#1620）、84331b4f9（#1608）与 fbd5f6c22（#1617）。工坊目录现收录 77 个插件与 43 套皮肤。9 个 PR 保持开启（#1602, #1603, #1607, #1614, #1616, #1526, #1488, #1479, #1399），均带有正式 review 记录并处于作者阻塞状态。所审 diff 均未触及需要通知协作者的 Wallpaper Engine 领域文件。

## Testing

所有 3 个合入 PR 均在 GitHub Actions 上通过了仓库全部必需检查：CI checks（lint, typecheck, test, test:scripts, docs:check, i18n:check, emoji:check, market:check）、agent-notes-guard、plugin-mount 以及 PR contribution rules。在独立工作树上进行的本地测试验证了 `node scripts/community-index --check`（77 条）、`node scripts/market-build --check`（产物最新，2347 个文件）、`pnpm test:scripts`（291/0）、`pnpm skin-center:check`（40 个仓库皮肤）、针对新皮肤的 `dsh-skin validate`，以及对所有预览图和背景图的多模态视觉审查。所有合并与 review 状态均经 GitHub API 确认。
