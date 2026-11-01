# Agent Note: A win_bash shell's private temp directory is reclaimed with it

Status: implemented

## Problem

`packages/dsh-win-bash/src/shell.ts` 的 `shellTempDir()` 每启动一个 shell 就在机器 temp 根下建一个私有目录 `dsh-win-bash-<pid>-<uuid8>`，并把它注入为该 shell 的 `TMPDIR`/`TMP`/`TEMP`，让 bash 的整个 mkstemp 家族待在一个目录里，而不是共享 temp 根。这个隔离是对的，缺的是收尾：`terminate()` 只给进程发信号并等它退出，`dispose()` 与 `disposeAll()` 只调 `terminate()`，`run()` 里进程自己结束的那条分支只删注册表条目，整个包没有任何删除调用（唯一的 fs 导入是 `mkdirSync`）。`LiveShell` 甚至没记下这个路径，收尾时即便想删也找不到。

结果就是每个 shell 永久留一个目录，包括每次 `exit` 后重建、每次超时、每次中止、每一个 `run_in_background` 任务。凡是按 TEMP 落中间产物的命令——apktool 解包、pip/npm 安装、tar 解压、安装器——内容都留在里面。Issue [#1993](https://github.com/zhu1090093659/dsh-web/issues/1993) 在一台机器上实测到 75 个目录、167,174 个文件、5.83 GB，单调增长，其中 14 个 apktool 目录的路径超过 260 字符，`Remove-Item -Recurse` 根本删不掉。每次宿主重启还会把上一个进程的所有目录变成 pid 已不存在的僵尸目录。

## Decision

`LiveShell` 记住自己拥有的 `temp` 目录。`ShellRegistry.ensure()` 只创建一次，同一个路径既交给 `shellEnvironment` 也存进记录，收尾时不再重新推算一个可能算错的名字。

`removeShellTempDir(temp)` 用 `rm({ recursive: true, force: true, maxRetries: 3, retryDelay: 100 })` 删一个目录，并吞掉所有失败。重试是 Windows 那一半：刚退出的子进程未必已经释放自己的句柄，rm 会报 `EBUSY`/`EPERM`，几次短重试把这种情况变成真正的回收。吞异常是收尾那一半，与 `terminate()` 对进程既有的处理一致：目录删不掉的 shell 不能让已经开始的销毁流程失败。

shell 的三种结束方式都会调到它：`terminate()` 在 `waitForExit()` 之后（于是 `dispose()`、`disposeAll()` 以及超时/中止路径都覆盖到）、`run()` 里命令自己结束 shell 的 `shell.exited` 分支、以及后台任务的结算处理（`BackgroundCommand.temp`，在进程自己退出、经 job 钩子被 kill、以及 starter 根本没 spawn 三种情况下删除）。

`sweepOrphanShellTempDirs()` 是崩溃兜底，也是唯一能覆盖「宿主在删之前就被杀掉」的手段。它列出 temp 根，从每个 `dsh-win-bash-<pid>-<uuid8>` 目录名里取 pid，删掉进程已不存在的那些（`process.kill(pid, 0)`，其中 `EPERM` 记为存活）。属于本进程或任何存活 pid 的目录一律保留，所以共享同一 temp 根的第二个 DSH 实例不会丢掉自己 shell 的目录。每个目录独立尝试：删不掉的那个被上报并跳过，不中断整轮。`apply()` 每次挂载跑一次，独立于挂载主线，只在实际删掉或失败时记日志。

## Alternatives considered

**每次调用后删目录，而不是等 shell 结束。** 否决：该目录就是 shell 的 `TMP`，内容属于 shell 的生命周期而不是某一条命令。按调用删会破坏「上一条命令留在 `$TMP` 里的东西」，并把一个已经不存在的 `TMP` 交给下一条命令。

**用进程退出钩子（`process.on('exit')`）代替下次启动清扫。** 两条理由都否决：`exit` 处理函数里不允许跑异步工作，几 GB 目录的递归删除做不了；而且真正要覆盖的崩溃/强杀根本不会走到退出钩子。

**为删不掉的目录持久化一份「下次清理」清单。** 否决：目录名里的 pid 已经把清单能告诉下次启动的信息都告诉它了，而且不用写、不会损坏、不会丢状态。清扫本身就是那份清单。

**按时间回收（删除超过 N 小时的 `dsh-win-bash-*` 目录）。** 否决：一个会话完全可以合法地把一个 shell 开得比任何阈值都久，年龄规则会删掉正在运行的 shell 的 `TMP`；而且它根本无法区分「活得久的 shell」和「已经死掉的 shell」。pid 才是精确的归属判据。

**`terminate()` 里不等删除，全部交给清扫。** 否决：清扫发生在下次启动，于是一个长期运行的宿主会把自己本会话的每个目录都攒到重启为止——正是 issue 报的单调增长。删除必须发生在拥有该目录的进程还在跑的时候。

## Consequences

- shell 结束时，它的目录以及命令写在 TEMP 里的内容一并消失：正常使用不再增长 temp 根。
- 收尾开始做文件系统工作：`dispose()`、`disposeAll()` 和调用的退出路径都会等这次删除，受重试预算约束。病态的目录树因此可能让收尾多花这几次重试的时间；失败被吞掉，并由下次启动的清扫重试。
- 归属 pid 存活的目录永不删除，所以共享 temp 根的实例之间不会删掉对方正在用的 shell。代价是活着的进程漏下的目录要等那个进程结束。
- 清扫每次插件挂载跑一次：一次 temp 根 `readdir`，加上每个僵尸目录一次删除。只在实际回收或失败时记日志，干净启动保持安静。
- `shellTempDir()` 增加可选 base 根（默认机器的 `tmpdir()`），这才让测试能驱动真实文件系统而不碰机器自己的 temp 根。

## Testing

- `tests/shell-temp.spec.ts`（新增）在真实文件系统上固化目录契约：shell 的目录存在且以归属 pid 命名；删除会带走嵌套内容但保留共享根；第二次删除是空操作；清扫删掉进程已不存在的目录（真实退出过的子进程）、保留进程存活的目录（真实存活子进程）与本进程自己的目录、忽略其他所有名字形态（含 `dsh-workspace-changes-*` 目录与非目录）、把拒绝删除的目录上报而不是中断整轮、把读不到的根报为空。
- `tests/shell.spec.ts` 针对随包载荷新增两条：用 `exit` 结束 shell 的命令不留目录；销毁会话时目录连同命令写在 `$TMP` 里的文件一起消失。
- `tests/background.spec.ts` 新增两条：结算的后台任务删除分给它的目录；进程根本没 spawn 的任务同样删除。
- `pnpm --filter @linxin666/dsh-win-bash typecheck`、`test`（12 个文件 147 条）与 `build` 通过。
