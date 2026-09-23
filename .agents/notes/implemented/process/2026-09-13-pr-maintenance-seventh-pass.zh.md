# Agent Note: PR maintenance run 2026-09-13 (seventh pass) — two merges cleared, two new registrations blocked on first review

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第七轮 PR 维护，紧接第六轮数小时后。默认范围：分配给维护者账号的九个开放 PR——第六轮结转的七个，加上当天上午新开的两条登记（#1526 dsh-round-rightclick、#1519 dsh-desktop-shell），不扫描 Issue。本轮要回答：哪些作者侧阻塞的 PR 有动静，两条新的第三方插件登记能否通过强制的三轴验收（实用性、稳定性、兼容性）。

## Decision

两个 PR 合入，两条首轮评审以 CHANGES_REQUESTED 发出，五个 PR 确认仍在等作者，四个首次贡献者工作流运行获得批准。

#1516（skin-center 气泡模糊滑杆）：作者修掉了第五轮唯一的阻塞项——blue-fantasy 的用户气泡改为 `blur(calc(var(--dsh-skin-bubble-blur, 10px) * 1.2))`，默认值与 alpha 规则的 120% 配比一样精确还原原始 12px——并把分支整理成单提交、rebase 到最新 dev。以合并提交 ffedeaeff 合入。

#1502（Miku 重设计）：作者推上了批准等待中的三个机械性提交（patches 注释里 emoji 改为文字、lib 重建、market/dist 重新生成、指纹重录）；批准前把追增量逐行核对过，确认既批准内容未变。以合并提交 527856ac0 合入。

两次合入撞上同一类冲突，把第五轮只隐含的规则固化下来：外部 PR 内容完整、评审已通过，而冲突仅限于 dev 越过 PR rebase 基点推进造成的生成产物（`lib/`、`scripts/lib-artifact-fingerprints.json`）时，由维护者本地合入，从合并后的源码重建四个 lib 包，用 `lib-artifact-check --write` 重录指纹，并在合并提交信息里写明解决方式——不再为又一次 rebase 打回作者。双方意图均可证明地保留，因为重建编译的就是合并后的源码；libs:check 兜底指纹契约。反向情形（评审完成前分支自身过时）仍归作者所有，第五轮对这同一个 PR 已经这样裁过。

两条新登记都倒在稳定性上，实用性两轮均获验证。#1526（dsh-round-rightclick）：代码质量不错——本地实跑上游 vitest 47/47 通过，唯一一条 HTTP 路由做了加固（fence 校验、64KiB 上限、数组式 spawn 不走 shell），命名空间干净，market/dist 已重新生成。阻塞项：条目的 `npm` 字段指向 npm 上不存在的包（E404 已验证；既有惯例是省略该字段、回退 github 安装），外加没有上游 CI 工作流、lib/ 未提交（安装时要在用户机器上靠 prepare 现场构建）。#1519（dsh-desktop-shell）：源码审计无恶意模式、npm 包与 PR 数字吻合，但插件默认创建登录自启快捷方式（只能用 `DSH_DESKTOP_NO_AUTOINSTALL=1` 关闭），而卸载不做任何清理——install.js 没有清理逻辑，客户端文案让用户自己删目录和快捷方式；默认常驻加卸载残留不能按现状收录。第二条阻塞：商店卡片描述必须写明仅 Windows、启动器装入 `%USERPROFILE%\dsh-desktop`、快捷方式创建，以及 restart 回退路径会 `taskkill /T /F` 强杀整个后端进程树。非阻塞备注：预编译的 DSHLauncher.exe 无法与随包源码逐字节互证；两个上游仓库都只有一天历史，没有维护轨迹。

例行事项：两条新 PR 的 `CI` 和 `agent-notes-guard` 卡在首次贡献者审批门后（action_required）；维护者已批准这四次运行，让必需检查得以执行。五个结转 PR（#1399、#1467、#1479、#1488、#1514）只读复核——均无作者动静，全部维持作者侧阻塞、既有评审继续有效。

## Alternatives considered

把 #1516 和 #1502 打回作者再 rebase 一次：否决——过时来自评审完成之后 dev 的推进，仓库自身契约就把「重建加 libs:write」定义为指纹冲突的解法，合入树上的全套门禁证明两侧改动都存活。

把 #1526 的 npm 404 当非阻塞备注：否决——#1467 与 #1318 的先例都把安装路径完整性和上游 CI 当作登记的稳定性阻塞项，安装字段 404 的条目直接破坏它所宣传的工坊安装路径。

因自启行为直接关闭 #1519：否决——审计过的代码没有恶意模式，行为在上游仓库有文档、也有关闭开关，插件默认项和条目描述都可以修；直接拒绝会丢掉一个真正有用、可挽救的贡献。

## Consequences

origin/dev 现在带有 ffedeaeff 和 527856ac0；GitHub 已把 #1516、#1502 标记为 MERGED，气泡模糊滑杆与 Miku 重设计进入集成分支。两次合入都没有触碰会触发域协作者通知的 Wallpaper Engine 文件（wallpaper.ts / we-player-source.ts 及其测试都不在两边的 diff 里）。七个 PR 保持开放、等待作者（#1399、#1467、#1479、#1488、#1514、#1519、#1526），每个都有成文的修改要求。合入即重建的规则一天内已落地两个先例。持续观察项：dsh-desktop-shell 预编译 exe 的来源验证问题、两条新上游的一天龄，以及第五轮记录的 subcategory 双门禁不一致——仍无人认领。

## Testing

两次合入都在专属 worktree 的合并树上完成构建与门禁：pnpm typecheck、test、docs:check、i18n:check、libs:check、aggregate:check、market:check（#1502 另加 skin-center:check）全部通过；集成后 worktree 已删除。#1502 的批准后增量在批准前以 git diff 对照拉取的 head 逐行读过。#1526 的上游套件（47 项 vitest）与 #1519 的（22 项检查，macOS 上 20 过、2 项失败为测试自身的 Windows 路径假设）由调查环节在临时克隆中实跑。PR 状态、评审发布与工作流批准均通过 gh pr view 与 actions runs API 确认。
