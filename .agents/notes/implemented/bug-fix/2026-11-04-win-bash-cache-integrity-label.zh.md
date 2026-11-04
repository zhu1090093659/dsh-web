# Agent Note: win_bash 核验载荷缓存的强制性完整性标签

[English](2026-11-04-win-bash-cache-integrity-label.md) | 中文

Status: implemented

## Problem

[#1996](2026-11-01-win-bash-payload-cache-outside-package.zh.md) 的修复把钉死的 MinGit 载荷发布到 `<DSH_HOME>/win-bash/runtime/<键>`，并从那份副本 spawn `bash.exe`。若 Windows 上 `DSH_HOME` 数据树带可继承的 Low Mandatory Level ACE（例如一次 standing 工作区授权），在其下新建的每个文件都会继承该标签。Windows 取父令牌与可执行映像完整性级别的较低者，于是 Medium 的宿主 runner 会起一个 Low 完整性 bash；Low 进程写不了 Medium 工作区与临时目录。用户在 `danger-full-access` 会话里遇到 `git add`、`mktemp` 与 Node 写文件全部 `Permission denied`，重启 DSH 或重建常驻 shell 都无效（issue [#2007](https://github.com/zhu1090093659/dsh-web/issues/2007)）。

既有的缓存校验只比 SHA256 清单与文件字节。包内载荷（无 Low 标签）与坏副本两者完全相同，因此哈希命中会让这棵不可用的树在重启、插件重载与更新后一直存活。缺陷在安全描述符，不在内容。

## Decision

`src/integrity.ts` 在不引入原生依赖、不需要提权的前提下读取 Windows 强制性完整性标签：按绝对路径调用 `%SystemRoot%\System32\icacls.exe <path> /save <file>`（绝不查 `PATH`），解码 UTF-16LE SDDL，把 `(ML;...;LW)` / `S-1-16-<低于 8192 的 RID>` 判为 `low-or-untrusted`。没有 SACL 即默认 Medium；High/System 标签与卷根的 `S:P(ML;OINPIO;NW;;;HI)` 都不是降级。SDDL 的 SID 写法与系统语言无关，因此本地化 Windows 上同样可用。全过程只读：不改任何标签、DACL、令牌或用户目录。POSIX 没有 Windows MIC，读取器直接返回 `medium-or-higher`。

`prepareRuntime()` 现在只在「字节校验通过且标签核验通过」时才复用缓存。它在三处核验候选目录的**整条现存祖先链**（可继承 Low ACE 可能事后传播到现存子目录）与已发布的 `bash.exe` 本身：复用前、发布前、发布后。`unknown` 不当作已核验。

候选根按序尝试。`cacheRoot()` 仍在 DSH home 下，保留 #1996 修复与探针隔离约定；`isolatedCacheRoot()` 位于每用户应用数据（或缓存）目录，末段由 DSH home 派生，因此独立的 `DSH_HOME` 仍得到自己的缓存，而可执行树离开带 Low 标签的数据树。`DSH_WIN_BASH_RUNTIME_HOME` 可覆盖其父目录。Low 树不复用、不执行；旧缓存以「弃用」完成迁移，而不是对某个 payload-key 目录做一次性修补。

所有候选都写不出来或不可核验时，改由校验过的包内树运行，`warn` 明确写出代价（`ERR_PNPM_EPERM`），沿用既有可用性规则。只有确实观察到 Low 标签、且连包内 `bash.exe` 也带 Low 时，才以 `unsafe-integrity` 拒绝挂载，并指明 `pwsh` 退路、覆盖变量，以及「无需改动工作区标签或沙箱策略」。不要求用户做任何操作、提权或改策略。`src/tool.ts` 未改：受限会话仍以 `SANDBOX_UNSUPPORTED` 拒绝。

## Alternatives considered

**只检查最近的现存祖先。** 否决：issue 明确指出 Low 标签究竟是创建时继承、还是事后传播到现存树，时间顺序未证明。检查整条现存链同时覆盖两种顺序，代价只是每次挂载多几次 `icacls` 调用（单次调用内已记忆化）。

**用 `icacls <path>` 的显示输出或 PowerShell `Get-Acl`**。否决：显示文本会本地化，`Get-Acl` 不暴露 SACL；`icacls /save` 输出的是 SID 缩写固定、编码为 UTF-16LE 的 SDDL。

**修用户 DSH home 上的 Low 标签，或要求用户降低工作区标签 / 改沙箱策略 / 提权运行 DSH**。否决：那会改动用户数据目录、需要本插件不具备的权限，而且把修复变成绕过而非根因修复。`icacls /save` 是只读的。

**把默认缓存整体搬出 DSH home**。否决：那会推翻已记录的 #1996 决策、破坏探针隔离约定，并让所有健康安装为一个只在 Low 标签树上出现的问题做迁移。隔离根是回退，不是新默认。

**一见 Low 标签就拒绝挂载**。否决：包内载荷干净时那是可用性倒退。降级路径保持可用，并明确报告。

## Consequences

- 在带 Low 标签的 DSH home 上，`danger-full-access` 会话从隔离根得到 Medium 完整性 bash；普通 Medium 工作区与临时目录无需改动工作区、策略或启动权限即可正常写入。
- 单靠哈希命中不再能让 Low 缓存存活：标签核验每次挂载都重跑，因此重启、插件重载与载荷更新都会弃用旧树。旧 Low 缓存目录保持惰性，DSH 停止时可删除。
- 正常路径与回退路径上运行的树仍在包外，#1996 保持修复；包内树降级仍带 `ERR_PNPM_EPERM` 警告。
- 挂载期每个候选多花几次 `icacls` 查询；标签在单次 `prepareRuntime()` 调用内记忆化，健康的首个候选通常只需一个候选。非 Windows 宿主零开销。
- `icacls` 不可用时标签为 `unknown`：不会声称该树已核验，会尝试隔离根，并给出明确警告而非静默降级。
- `unsafe-integrity` 是挂载级拒绝，`registerWinBash` 不会运行，`installPwshReplacement` 不安装，`pwsh` 保留在会话工具面上；`servingVerdict` 无需增加第三条会话级理由。

## Testing

- `tests/runtime-integrity.spec.ts`（21 条）固化 SDDL 解析（Low、继承 Low、Untrusted、Medium/High/System、无 SACL、混合 ACE）、隔离根的分离性与 DSH home 派生隔离、Medium 默认路径、Low 父目录、字节完好的旧 Low 缓存、发布后继承 Low、载荷更新、重复重启、包内树警告、`unsafe-integrity` 拒绝、`ERR_PNPM_EPERM` 降级、平台拒绝、清单拒绝与祖先链。
- `tests/runtime-cache.spec.ts` 增加两条 win32 x64 活体用例：真实的 `icacls /setintegritylevel (OI)(CI)L` 目录在目录本身与继承的 `bash.exe` 上都读出 `low-or-untrusted`；真实 Low 缓存父目录让 `prepareRuntime` 发布到隔离根，其 `bash.exe` 读出 `medium-or-higher`。两条都在清理前把标签恢复为 Medium。
- `pnpm --filter @linxin666/dsh-win-bash typecheck`、`test`（14 个文件 181 条）与 `build` 在 win32 x64 通过；`pnpm test:standards`、`pnpm docs:check`、`pnpm emoji:check` 通过。
