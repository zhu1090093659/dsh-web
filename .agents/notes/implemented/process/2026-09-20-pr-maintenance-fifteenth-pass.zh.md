# Agent Note: PR maintenance run 2026-09-20 (fifteenth pass) — merge whale-mom pet bubble fix, review whale-maid and doro contributions, audit open PR queue

Status: implemented

## Problem

针对 `zhu1090093659/dsh-web` 进行第十五轮 PR 维护巡检，紧随[第十四轮巡检](2026-09-19-pr-maintenance-fourteenth-pass.zh.md)。默认范围：指派给维护者账号 `zhu1090093659` 的 10 个处于 open 状态的 PR，不扫描 Issue。本轮包含 3 个新入队 PR：#1640（DDDMUC 提交的 whale-mom 浅色气泡文字对比度修复）、#1631（stushansusu 提交的鲸鱼娘·望海新皮肤收录）以及 #1630（stushansusu 提交的朵拉 doro 新宠物收录）。其余 7 个延续 PR（#1626、#1607、#1603、#1526、#1488、#1479、#1399）此前均已要求修改，等待作者响应。

## Decision

评审并合入 Bug/视觉修复 PR #1640；对新皮肤收录 PR #1631 与新宠物收录 PR #1630 提交 CHANGES_REQUESTED 请求补充许可证与出处声明；核验队列中其余 7 个 PR 保持作者阻塞状态。

- #1640（whale-mom 宠物用量气泡浅色文字对比度修复，由 DDDMUC 提交）：审核通过并合入。
  1. 根因：浅色主题下，壳级规则 `[class*="chipLabel"], [class*="bubble"] { color: var(--dsh-skin-text-strong) }` 将气泡文字置为近黑色（`#05070d`），而 dsh-pet 的 `.bubbleUsage` 恒定为深藏青背景，导致用量提示不可读（#1636）。
  2. 修复与验证：在 `patches.css` 中追加高特异性守卫 `[data-dsh-pet-root] [class*="bubble"] { color: #f4f7ff; }`，恢复自带浅色文字。新增 `tests/whale-mom-pet-bubble-contrast.spec.ts` 静态断言守护，反向验证有效。skin-center 43 个测试套件全过，市场清单保持一致，对比度图证完整。
  3. 通过 GitHub API 完成合入，并同步拉取整合至本地 dev 分支。

- #1631（鲸鱼娘·望海新皮肤收录，由 stushansusu 提交）：评审结论为 CHANGES_REQUESTED。
  1. 内容闸门 1（变更证据）：提供了脚本导出的双态卡片预览图，建议补充实际聊天界面的运行截图。
  2. 内容闸门 2（版权与许可）：阻塞。皮肤目录 `packages/skins/skin-center/skins/whale-maid/` 缺少 `LICENSE` 文件，`skin.json` 缺少 `license` 元数据，README 对应表未登记。即使为作者原创素材，按内容贡献闸门要求也必须提供明确的开源许可协议文本（如 CC BY-NC-SA 4.0）方可收录。
  3. 内容闸门 3（美学鉴赏）：通过。多模态图证核验确认画风优良、赛璐璐平涂与半透明白纱层次清晰、亮暗双态光影和谐、正文面板对比度达标。

- #1630（朵拉 doro 宠物收录及漫游/洗澡玩法，由 stushansusu 提交）：评审结论为 CHANGES_REQUESTED。
  1. 内容闸门 1（变更证据）：提供了 11 轨总览图、拖拽挣扎序列与本地注册表证据。
  2. 内容闸门 2（版权与许可）：阻塞。Doro 为手游《胜利女神：新的希望 / 胜利女神：妮姬》（SHIFT UP）角色桃乐丝（Dorothy）的知名二创/梗衍生形象。PR 仅标注“由 stushansusu 以 MIT 许可证贡献”，未声明原作版权。按内容贡献闸门，第三方衍生角色须在 `packages/dsh-pet/THIRD_PARTY_NOTICES.md` 登记、补充非商业同人声明，并在 README 对应表中注明版权出处（对齐 Miku 宠物的 Piapro 规范）。
  3. 内容闸门 3（美学鉴赏）：通过。多模态核验 11 轨 802 帧 webp 序列，透明通道边缘干净，动画生动一致。

- 其余 7 个延续 PR（#1626、#1607、#1603、#1526、#1488、#1479、#1399）确认无新提交，持续保持作者阻塞状态：
  1. #1626（dsh-deepseek-web）：阻塞在上游无 CI 与 release 资产、`community.json` 格式错误。
  2. #1607（红猪、最后流亡、白蛇皮肤）：阻塞在携带非白名单二进制 MP3 音频导致规模超标、缺少真实 UI 截图。
  3. #1603（纸墨皮肤）：阻塞在随包字体缺失 SIL OFL 许可证文本与正文对比度反馈。
  4. #1526（dsh-round-rightclick）：阻塞在上游缺失 CI 与 lib、存在代码冲突。
  5. #1488（dsh-plugin-bwm-friend）：阻塞在缺失 `subcategory` 导致 CI 失败、存在代码冲突。
  6. #1479（dsh-voice-talk）：阻塞在当前 0.1.5-rc.1 宿主下启动崩溃、存在代码冲突。
  7. #1399（dsh-provider-signin）：草稿 PR，阻塞在缺少 LICENSE、依赖包缺失与存在代码冲突。

## Alternatives considered

跳过 LICENSE 要求先行合入 PR #1631 的方案被拒绝：内容贡献闸门明确规定维护者不得代贡献者补齐或背书来源，无明确许可证文本的素材不能进入工坊分发通道。

将 PR #1630 按纯粹 MIT 接受而不声明原作版权的方案被拒绝：Doro 形象源自 SHIFT UP 旗下《胜利女神：妮姬》，省略第三方声明会产生版权合规风险，破坏与现有 Miku 等第三方角色资产一致的版权治理标准。

## Consequences

合入 1 个修复 PR（#1640），对 2 个收录 PR（#1631、#1630）提出修改要求以补齐许可与出处声明，其余 7 个 PR 保持阻塞。改动未涉及 Wallpaper Engine 核心运行时文件，无需特别通知协作者。

## Testing

在隔离工作树（`wt switch --create review-pr-1640 --base origin/dev`）中执行本地验证：
- PR #1640 测试套件：`pnpm --filter @linxin666/dsh-client-ui-skin-center test`（43 个文件，661 个测试全部通过，含 `whale-mom-pet-bubble-contrast.spec.ts`）
- `node scripts/market-build --check`：通过（tryon 校验无误，dist 一致）
- `node scripts/skin-center-catalog-check --check`：通过（41 个仓库皮肤）
- `node scripts/skin-hooks-registry.mjs --check`：通过
- `node scripts/lib-artifact-check.mjs`：通过（4 个 committed lib 包与指纹吻合）
- `pnpm typecheck`：全工作区 22 个项目全部通过
- `pnpm docs:check`：文档门禁全部通过
- `pnpm i18n:check`：17 个命名空间，1438 个键，校验通过
- 多模态模型视觉核验（`read_image`）：
  - PR #1631 双态预览图（`light.jpg`、`dark.jpg`）：核验视觉品质与面板对比度
  - PR #1630 宠物素材（`doro-overview.png`、`doro-struggle.png`）：核验动作轨道与透明通道
- 集成分支整合：在本地 `dev` 合入并重新通过 `pnpm build && pnpm libs:write` 记录构建产物指纹
- 通过 `wt remove review-pr-1640` 与 `node scripts/pr-review.mjs --cleanup` 完成工作树回收。
