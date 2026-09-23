# Agent Note: PR maintenance run 2026-09-19 (fourteenth pass) — re-review porco-rosso skin contribution and audit open PR queue

Status: implemented

## Problem

继[第十三轮审查](2026-09-18-pr-maintenance-thirteenth-pass.zh.md)后在 `zhu1090093659/dsh-web` 执行第十四轮维护巡检。默认范围：明确分配给维护者账号 `zhu1090093659` 的 7 个开启状态 GitHub PR，不扫描 Issue。既有皮肤收录 PR #1607（红猪、最后流亡、白蛇主题皮肤，由 binlecode 提交）提交了 0f581d0f 与 38f3e9dc 以跟进上一轮评审意见，合并上游 `dev` 并将商业动漫原声音频替换为公有领域古典钢琴录音。其余 6 个既有 PR（#1626、#1603、#1526、#1488、#1479、#1399）维持既有修改意见，处于作者阻塞状态。

## Decision

复审 PR #1607 并提交 CHANGES_REQUESTED 审查意见；核实队列中其余 6 个 PR 维持作者阻塞状态。

- #1607（红猪、最后流亡、白蛇主题皮肤，由 binlecode 提交）复审为 CHANGES_REQUESTED（审查编号 5254413743）。对照仓库规范与内容贡献三项硬性门禁评估：
  1. 内容闸门 1（用户可见变更证据）：阻塞。PR 描述「用户可见变更证据」一节内嵌的 6 张截图链接为纯壁纸原图（`preview/light.jpg` 与 `preview/dark.jpg`），并非在真实 DSH Web 宿主界面（包含侧边栏、对话流、输入框、面板组件）下应用换肤的实机截图或试穿效果。
  2. 二进制白名单与规模上限：阻塞。随包携带 6 个 MP3 音频（在 `market/dist/` 中同步存在，共 12 处、体积超 22MB），违反仓库二进制文件白名单（`scripts/pr-review.mjs` 的 `ALLOWED_BINARY_EXT` 仅允许图片、字体、PDF、ZIP、GZ，禁止提交音频）；音频与构建产物导致总新增行数达 17,320 行（+17,320/-6），突破单 PR 10,000 行限制。此外，DSH Web 皮肤定位为纯界面视觉样式资产包，在 `hooks.mjs` 中植入黑胶播放器与本地音频超出皮肤范围。引导作者彻底移除所有 MP3 音频与播放器代码，重新生成市场清单。
  3. 内容闸门 2（版权与来源）：满足。`NOTICE` 与 `LICENSE`（CC BY-NC-SA 4.0）如实说明了官方出处与著作权标识，明确皮肤工程代码开源而官方美术素材不涵盖在内，符合分发合规要求。
  4. 内容闸门 3（美学鉴赏）：通过。多模态模型直接检视三套皮肤的双态壁纸产物，画面构图协调，色调光影自然，主体清晰无畸变，双态主文本对比度均超过 14:1（符合 WCAG AAA 标准），艺术质量过关。
- 6 个结转 PR（#1626、#1603、#1526、#1488、#1479、#1399）确认无新提交，维持作者阻塞状态：
  1. #1626（dsh-deepseek-web）：缺少上游自动化 CI 与 release 标签，`community.json` 格式有孤立逗号。
  2. #1603（纸墨皮肤）：`assets/fonts/` 缺少 SIL OFL 字体协议文本，正文遮挡与对比度待优化。
  3. #1526（dsh-round-rightclick）：缺少上游 CI 与 `lib/` 提交，与 `dev` 分支存在冲突。
  4. #1488（dsh-plugin-bwm-friend）：缺少 `subcategory` 导致 CI 失败，与 `dev` 分支存在冲突。
  5. #1479（dsh-voice-talk）：在宿主 0.1.5-rc.1 线上启动崩溃，与 `dev` 分支存在冲突。
  6. #1399（dsh-provider-signin）：草稿 PR，缺少 LICENSE 文本与 `llm-pi-ai` 依赖，与 `dev` 分支存在冲突。

## Alternatives considered

拒绝因替换为公有领域古典钢琴曲即合入 #1607：皮肤中心对音频的限制是工程结构性的，不只是版权合规。在 Git 仓库内提交数兆字节的二进制音频会永久膨胀仓库体积，触发 `scripts/pr-review.mjs` 的二进制白名单与单 PR 10,000 行规模红线。皮肤是视觉主题包，音频播放能力若有需要应作为独立媒体插件提供。

拒绝在未提供真实 DSH Web 换肤界面截图的情况下直接合入 #1607：内容闸门 1 明确要求提供真实宿主界面的双态实测证据，以验证界面在对应调色板下可读、布局无错位遮挡。用壁纸原图充当界面证据无法满足该门禁。

## Consequences

本轮巡检未合入任何 PR；分配给 `zhu1090093659` 的 7 个开启状态 PR 均处于作者阻塞状态，且均有记录在案的正式审查意见。本次审查未触及 Wallpaper Engine 运行时核心代码，无须通知协作者。

## Testing

在基于 `origin/dev` 通过 `wt switch --create review-pr-1607 --base origin/dev` 创建的隔离工作树中完成本地核验：
- 模拟合并 `refs/pull/1607/head` 到 `origin/dev`：ort 策略干净合入，无代码冲突
- `node scripts/dsh-skin validate packages/skins/skin-center/skins/{porco-rosso,last-exile,white-snake}`：PASS
- `node scripts/skin-hooks-registry.mjs --check`：OK
- `pnpm skin-center:check`：OK（仓库收录 44 套皮肤）
- `node scripts/market-build --check`：OK（tryon 校验通过，dist 一致）
- `pnpm test:scripts`：291/291 测试全部通过
- `pnpm docs:check`：文档门禁全数通过
- `pnpm i18n:check`：17 个命名空间、1442 个词条全部通过
- `node scripts/pr-review.mjs --skip-build 1607`：命中非白名单二进制（.mp3）与新增行超限（>10,000 行），判定 REJECT
- 多模态模型通过 `read_image` 直接检视 6 张皮肤预览原图：美学鉴赏判定通过
- 通过 `wt remove review-pr-1607` 清理工作树与临时分支
所有 PR 与审查状态均通过 GitHub API 验证。
