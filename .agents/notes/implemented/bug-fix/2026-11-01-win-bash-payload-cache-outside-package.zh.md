# Agent Note: win_bash 从包外发布的副本运行载荷

Status: implemented

## Problem

`packages/dsh-win-bash` 把钉死的 MinGit 载荷装在 npm 包内（`runtime/win32-x64`，91 个文件、约 16 MiB），并从那个绝对路径 spawn `bash.exe`。Windows 不允许 rename 或删除一个装着运行中可执行文件的目录，而 pnpm 导入包正是用 rename 把 staging 目录换成目标目录——`node_modules/@linxin666/dsh-win-bash_tmp_<pid>_<n>` -> `@linxin666/dsh-win-bash`——于是一个只要有会话跑过一次 `win_bash` 命令的部署，此后每次更新、卸载或重装本包都会失败于 `[ERR_PNPM_EPERM] [importPackage ...]`，直到宿主重启或 `bash.exe` 被杀（issue [#1996](https://github.com/zhu1090093659/dsh-web/issues/1996)）。常驻 shell 正是本包存在的理由，所以这是「载荷位置」与「进程模型」之间的冲突，而不是任何一方的缺陷。

两处连带事实让它值得真修而不是写进已知限制：失败的 import 会在 profile 的 `node_modules` 里留下 `*_tmp_*` 目录；而失败偏偏发生在用户正要更新的时候——插件管理器的更新路径，或 `dsh plugin --profile desktop update`。官方 `@deepseek-ai/dsh-tool-bash` 不会遇到它，因为它执行的是一次性 `bash -c`，可执行文件本来就不在包目录内。

## Decision

载荷仍随包发布；**真正运行的那棵树**是包外的校验副本。`src/runtime.ts` 的 `prepareRuntime()` 成为挂载期入口，`apply()` 改调它而不是 `resolveRuntime()`：

- **缓存按内容寻址。** `payloadKey()` 对清单里排序后的 `path + 摘要` 行取摘要并保留 16 个十六进制字符，于是目录名本身就说明了它装着哪一份载荷。只改 JavaScript 的发布复用已发布的副本；任何一个载荷文件变了就会得到新名字。
- **缓存位于 DSH home 之下**：`$DSH_HOME/win-bash/runtime/<键>`，经家族共享的 `resolveDshHome()` 解析（新增的 `packages/dsh-win-bash/src/dsh-home.ts` 是 `sync-shared` 生成的副本）。选 `DSH_HOME` 而不是 `%LOCALAPPDATA%`：仓库既有的探针隔离约定已经规定验证实例用自己的 `DSH_HOME`，隔离的宿主因此自动得到隔离的缓存，不必再学第二套约定，测试与探针也永远不会写进用户的缓存。
- **命中必须自证。** 副本自己的清单必须复现期望的键，且每个文件都要哈希正确，才会被 spawn。于是「清单连同文件一起被整体换过」的目录读作未命中而不是命中：键是清单的摘要，改任一摘要就改了名字。
- **未命中先校验、再复制、再校验。** 包内树先过 `resolveRuntime()`——消息与拒绝理由不变——然后复制进目标旁的 `.staging-<键>-<pid>-<uuid8>` 目录，rename 落位，返回之前再校验一次副本。因此一个已发布的名字永远只指向一棵完整且校验过的树。
- **缓存写不出来不算拒绝。** 改由校验过的包内树运行，`apply()` 记一条警告，写明缓存路径、包内路径与 `ERR_PNPM_EPERM`。因为一个打包期的隐患就扣掉 shell，只会把打包问题变成一台本来能用的机器上的能力缺失；而载荷校验失败仍然一律拒绝，有缓存也一样。
- **所有 shell 的路径都来自 `RuntimeReady`。** `shell.ts` 本来就是从调用方拿 `{ bash, bin }`，所以常驻 shell、每个后台任务以及 `PATH` 前缀一起改到发布副本，无需改动该模块。

## Alternatives considered

**pnpm 改动包之前先停掉所有 shell**（issue 的第三条建议：`disposeAll` 生命周期钩子）。否决：改动可能来自另一个进程里的 `dsh plugin` CLI，它够不到运行中宿主的 shell 注册表；卸载本包自身正是必须能成功的改动之一；而且「shell 已停」与「另一个会话又起了一个」之间仍留竞态，等于绕一圈回到同一个 EPERM。

**把载荷拆成 `node_modules` 之外的独立缓存包。** 否决：多出一份要定版本、要发布、要钉的产物，而 pnpm 仍然拥有它安装的那棵树——包外副本无论哪条路都得存在，所以这只增加发布面而不减少副本。

**每次命令都从包内 spawn 一个新的 `bash -c`。** 否决：那等于放弃常驻 shell，而常驻正是本包存在的理由（见[钉死 bash 的决策](../feature/2026-10-16-dsh-win-bash-pinned-bash.md)）。

**把 `replacePwsh` 默认值改成 false 当作安全出口**（issue 的第四条建议）。否决：这等于给每个 Windows 会话再摆一个可见 shell 来绕开打包隐患，并且推翻 shell 阶梯的决策——`pwsh` 只在 `win_bash` 真正服务不了该会话时撤下，那是能力判断，不是 workaround。

**自动清理旧的载荷目录。** 否决：一份载荷一个目录，本来就被载荷版本数限住；而清理会和正在复制或正在运行旧载荷的第二个宿主抢同一份数据（运行中的可执行文件本来就拒绝删除，仍在旧版本的宿主也会重新发布到同一个名字）。

## Consequences

- 更新、卸载或重装 `@linxin666/dsh-win-bash` 不再取决于「没有会话用过 `win_bash`」：包目录里不再有运行中的可执行文件。
- 过渡期仍要重启一次。当安装的是本改动之前的版本时，它的 `bash.exe` 仍从包内运行，所以第一次升级到带本改动的版本仍需要停掉 `bash.exe` 或重启宿主，与 issue 描述一致。
- 副本已发布时挂载没有额外开销；需要发布时付一次 16 MiB 复制（加上两棵树本来就要做的校验）。挂载保持同步，因此这份开销落在宿主启动时，每份载荷版本一次。
- 缓存增长是一份载荷一个目录，各约 16 MiB，位于 `<DSH_HOME>/win-bash/runtime/`。DSH 停止时删除它是安全的：下一次挂载会重新发布。
- 运行的那棵树是校验过的；命中缓存时不再重算包内树的哈希。包内树因此只是来源，一棵被篡改但缓存有效的包内树会保持惰性而不会被 spawn。
- 仍在被活的 shell 占用的副本无法替换：重建时的删除会被拒绝，挂载带着同一条警告回退到包内树，而不是失败。
- 第一次发布中途被强杀的宿主会留下一个 `.staging-*` 目录。它是惰性的——名字不是载荷键，没有挂载会把它当载荷——需要人工删除。

## Testing

- `tests/runtime-cache.spec.ts`（新增 11 条）在真实文件系统上用 fixture 载荷固化契约：首次挂载按清单导出的键发布到缓存根且不留 staging 目录；第二次挂载复用该副本（注入的复制步骤一旦被调用就抛错）；被破坏的副本与被重写清单的副本都会从包内载荷重建；不可写的缓存回退到包内树并给出一条写明 `ERR_PNPM_EPERM` 的警告；复制中途失败不留 staging 目录；包内载荷校验失败即拒绝且什么都不发布；包内树事后被破坏时已发布副本继续服务；POSIX 宿主在触碰缓存之前就被拒绝；默认缓存根跟随 `DSH_HOME`。
- `tests/runtime-cache.spec.ts` 还在真实 Windows x64 宿主上 spawn 随包载荷的已发布副本（`cd /usr/bin && pwd -W`），断言解析出的 MSYS 根就是缓存根下的副本——这才证明复制出来的树是可运行的，而不仅仅是字节相同。
- `tests/mount.spec.ts` 把 `DSH_HOME` 指向临时目录，于是一次挂载不再写进跑测试那个人的 home。
- `pnpm --filter @linxin666/dsh-win-bash typecheck`、`test`（13 个文件 158 条）与 `build` 通过；`test` 在 win32 x64 上执行。
