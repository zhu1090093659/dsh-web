# Agent Note: dsh-win-bash——钉摘要私有 bash 的 Windows 插件

Status: implemented

[English](2026-10-16-dsh-win-bash-pinned-bash.md) | 中文

## Problem

DeepSeek 模型的后训练以 bash 工具面为主，Windows 会话只有 pwsh 时模型会把 bash 语法打进 PowerShell，产生报错循环，浪费 token 与注意力（dsh-ops 的自报 benchmark 与该问题陈述同向；我们自己的 benchmark 尚未测过这一维度）。梁神 preset 曾自带 Git Bash（custom-bash.mjs），因无状态、无 OS 沙箱隔离、名不副实三宗罪在[梁神 shell 与分页](2026-09-17-liangshen-shell-and-paging-ptc-surface.zh.md)中退役，换回宿主持久 pwsh 栈——但该决策同时留下了「Windows 上没有真 bash」的缺口。

## Decision

缺口由一个**独立插件包**而非 preset 填充：`packages/dsh-win-bash`（npm `@linxin666/dsh-win-bash`）在 win32 x64 宿主上注册 `win_bash` 工具——每个会话一个持久的私有 bash 进程，状态跨调用保留。梁神「preset 不自带任何 shell 实现」的原则不反转：两者组合使用，互不接线。

- 载荷钉死：随包携带 Git for Windows MinGit v2.56.0.windows.2 的裁剪提取（89 个文件，15.99 MiB，含 22 份许可证文本与 PROVENANCE.md），`checksums.sha256` 记录每个文件的 SHA256，**挂载前整体验证**，摘要不符拒绝挂载；shell 只按绝对路径解析、绝无 PATH 回退，真正运行的是发布到包外 DSH home 下的校验副本，使运行中的 shell 锁不住包目录（[载荷缓存](2026-11-01-win-bash-payload-cache-outside-package.zh.md)）。OpenSSH/Heimdal/OpenSSL 家族经 PE 导入分析证明无人引用后剔除。
- 工具名 `win_bash` 而非 `bash`：避免与宿主/第三方同名工具互相静默替换。行 id `dsh-win-bash`、行 name 恰好等于包名，POSIX 上 `disabled: !!js process.platform !== 'win32'`。
- 帧协议：nonce 标记的引用 heredoc 经 `.` 源入——brace 组遇语法错误会吞掉结束标记永久卡壳，heredoc 则作为单个解析单元报错后继续，实测未闭合引号的下一次调用在同一进程正常返回。stdout 取自解析后的帧而非原始流，分帧标记永不到达模型。
- 权限：策略经 `sandboxPolicy` 服务解析，受限模式经 `sandbox.confine()` 派生；受限而无 confinement provider 的部署直接拒绝，绝不裸跑。该契约钉了两次：`tests/confinement.spec.ts` 结构性钉住（注入 provider 的 argv 才是被派生的那个，前台后台皆是），`tests/confinement-live.spec.ts` 则对**真实** ACL restricted-token runner 再钉一次——该 runner 随 DSH 宿主分发而不在本仓依赖树里，故由两个 `DSH_WIN_BASH_ACL_*` 环境变量指路；不给变量时那些测试如实 skip，绝不静默通过。**这次真跑查出本注此前只能回避的一条边界**：受限令牌下随包 MSYS 载荷根本起不来——`bash.exe`/`sh.exe`/`dash.exe`/`echo.exe` 都在 main 之前死亡，报 `NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-<hash>): 0xC0000022`（退出码 3221225794），系统 Git for Windows 同样失败（`couldn't create signal pipe, Win32 error 5`），故这是 MSYS/Cygwin 运行时对受限令牌的要求，不是本包裁剪所致。同一宿主上 `cmd.exe`/`node.exe`/`powershell.exe` 均能受限运行，所以 runner 与本包的 argv 接线是好的；**未证的仍是受限模式下任何 bash 命令**。第二条实测缺口：该 rung 的 denial 签名是英文的，非英文主机上被真实拒绝的 `cmd.exe` 越界写入会被归类成普通非零退出——同一条 live spec 把这条缺口钉住而非粉饰。
- 恢复对外可见：shell 退出、超时、中止都会销毁该 shell 并在下一次调用里说明状态已丢失，绝不静默换壳；shell 随 agent disposed 与插件卸载回收。

## Alternatives considered

- 把 bash 重新做进梁神 preset。否决：2026-09-17 决策的「preset 不自带 shell」原则仍成立，独立包让宿主与 preset 都不背二进制分发面。
- 探测系统 PATH 上的 Git Bash。否决：版本与字节不可控，正是钉摘要要排除的形态（dsh-ops 同样把系统回退列为安全降级）。
- 每个命令新起进程（退役的 custom-bash.mjs 形态）。否决：无状态 shell 正是当年退役理由之一。

## Consequences

- 包首版仅 Windows x64；ARM64 与其他平台拒绝挂载（如实告警）。
- 已接入 dsh-web-all 聚合家族（聚合行 `web-ui-win-bash`，家族子路径 `@linxin666/dsh-web-all/win-bash`，`familyIds` 显式映射锁定短名），随全家桶默认安装；根 patch 不接，profile 挂载由聚合承担。打包期的「重下载钉版资产并 diff checksums」校验脚本仍为后续任务。
- **可用性只跟随平台与载荷**：随包载荷校验通过即在受支持的 Windows x64 宿主上注册 `win_bash`，与梁神预设是否启用无关。梁神声明门控与 `syncWithLiangShen` 开关已移除（[移除消息编辑与 win-bash 门控](../simplification/2026-11-14-retire-message-edit-and-win-bash-gate.zh.md)）；注册在 apply 内同步完成，注册错误记日志而不以未处理拒绝逃逸。实现与约束见 [packages/dsh-win-bash/AGENTS.md](../../../packages/dsh-win-bash/AGENTS.md)。
- 宿主对未声明 `isConcurrencySafe` 的工具一律按 exclusive 调度（fail-closed），同一持久 shell 不存在并发帧竞争。
- 渲染出的文本不带终端转义序列。原始流仍是保真的太字节（管道模型正是本工具存在的理由），但带色的流读不成文本：Windows 上的着色库按 `platform === 'win32'` 而不是按「有没有接终端」决定，所以已经在环境里设好的 `TERM=dumb` 关不掉任何东西，管道里的 `vitest`、`pnpm` 照样吐 SGR。因此 `src/tool.ts` 的 `renderResult` 剥掉 CSI/OSC 序列，并把进度条原地重绘的那一行收敛到最后一帧（裸 CR 才算重绘，CRLF 行尾原样保留）。截断提示在剥离之后拼接，本工具自己的文字不受影响。`tests/escapes.spec.ts` 钉住颜色、OSC 载荷、重绘收敛、CRLF 保留与无转义时原样返回。
- **shell 阶梯（仅 Windows）**：win_bash 挂载成功后，宿主 pwsh 经 `agent.ctx.tools.restrict` 从各会话的模型可见面隐藏（src/pwsh-replacement.ts）——刻意只隐藏、不在执行层拒绝：刻意直调 pwsh 仍正常执行，这是阶梯的下层退路（win_bash 优先 → pwsh 承担 Windows 原生工作与 bash 失败后的兜底；本包不携带 PowerShell 载荷，该段归宿主）。`replacePwsh: false` 为并存逃生口。隐藏按 agent 作用域施加、随 agent disposed 与插件卸载逐条恢复；宿主 pwsh 行晚挂载时经 `tools/change` 补隐藏（restrict 对未知名抛错，不在场不是判定）；预占 lifts 槽位防 tools/change 自激。POSIX 为绝对 no-op（模块首行平台门，任何读取/监听/restrict 之前返回）。win_bash 的工具描述首句（目录截断窗口内）承载「Windows 命令工作优先于 pwsh」的行为指引，机制事实放在窗口外。

## Testing

- 包内 119 个测试（协议帧、注册表恢复、载荷校验、配置、挂载门控、vendored bash 实跑、confinement 结构性契约与对真实 ACL runner 的 confinement）；验收期间修复的四个真实缺陷（双流共享游标、帧重复解析、stdout 误读原始累加器、begin 标记未锁存）各有回归测试。其中 8 条受限真跑测试仅在 `DSH_WIN_BASH_ACL_RUNNER`（端到端那条另需 `DSH_WIN_BASH_ACL_PROVIDER`）指向真实安装时执行，否则带明确前置条件断言地 skip——绿色的测试套件绝不意味着真检查被静默跳过。
- 独立复跑：`pnpm --filter @linxin666/dsh-win-bash build/test/typecheck` 全绿；`verify-docs`、`emoji-audit`、`test-standards`、`aggregate --check`、`sync-shared --check`、`runtime-deps-check`、`family-dsh-engines` 通过；载荷 89/89 摘要核验一致，bash 实跑报告 5.3.15(2)-release。
