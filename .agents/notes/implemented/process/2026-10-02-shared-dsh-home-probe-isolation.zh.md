# Agent Note: 共享 DSH home 的探测隔离出自己的 home 并回收自己起的实例

Status: implemented

## Problem

同一次工作会话里出现了两类故障，根因相同：探测进程跑在用户默认的 DSH home 上而不是自己的 home 上，而两次都剥夺了用户正在使用的东西。

**一个残留探针占住了任务看板的账本。** 任务看板只允许一个账本写入者：写入者把带 pid 与 token 的 `$DSH_HOME/task-board/ledger-v2.lock` 写下来，任何其他对着同一个 home 启动的宿主都会拒绝看板并指名占用者的 pid。一个 `dsh --profile rescue --no-open` 实例——本次会话早前作为后台探针启动、之后一直没停——持有这把锁。用户的桌面宿主因此失去看板，并被告知去关闭一个自己从未启动的进程。回收它不止杀一次：该探针是在一次工具调用里用 `&` 启动的，父 shell 早已退出，它已被 launchd 收养（父进程为 1），而且除了消息里指名的 pid 之外还存在第二个探针实例。每终止一个进程只是把锁让给下一个，因此单点精确 kill 并不能结束这次中断。

**一个辅助命令的清理动作删掉了仓库根清单。** 为了读取运行中 DSH 的版本，探针执行了 `npx --yes @electron/asar extract-file <app.asar> 'dsh/package.json' && python3 -c "..." ; rm -f package.json`，而工具调用的默认工作目录就是仓库根目录。`extract-file` 会把归档成员以自身 basename 写到当前目录，于是该命令把一个外来的清单物化成仓库的 `package.json`，紧随其后的 `rm -f package.json` 便删掉了仓库自己的根清单。该文件声明了 `dsh.bundle.patch`，整个安装层因此不再解析：插件管理器拒绝一个「declares no dsh.bundle」的路径安装，app-boot 对已声明的 profile bundle 抛同样的错。症状在很久之后、以另一种形式才到达用户——一次家族插件安装被拒。

**第二个辅助命令替换而不是删除了清单。** 2026-10-31，同样的命令形态在排查运行中的桌面应用时再次出现：`npx --yes asar extract-file "<app>.asar" package.json` 以检出目录作为工作目录运行，把该应用自己的清单写到了仓库的 `package.json` 上。写入的那一刻没有任何报错——文件照样可解析，只是身份变了（`dsh-trading-desktop` 取代了 `dsh-web`，且没有 `dsh.bundle`），于是工作区只显示出一个被修改的文件，读起来像一次有意的编辑。用户在从检出路径安装家族插件时，撞上了同一个插件管理器拒绝：`dsh-trading-desktop declares no dsh.bundle`。

## Decision

对共享 DSH home 的探测使用自己的 home，并停掉自己启动的一切。

- **探针把 `DSH_HOME` 指向一个临时目录**，约定为 `/tmp/dsh-verify-<topic>`。它的 profile、session、账本、设置、皮肤与宠物归自己所有，用户的 home 随之成为可读的事实而不是可写的场所。换端口不构成隔离：端口从来不是被共享的资源。
- **探针启动的每个实例都在同一会话内停掉。** 后台实例以受管后台作业启动，或记录其 pid，并在会话报告验证完成之前终止。停不掉自己实例的探针要如实说明，而不是报告成功。
- **会写当前目录的辅助命令在临时目录里运行。** 归档解包与同类辅助命令一律在 `cd "$(mktemp -d)"` 之下运行，绝不在检出目录里，使它的输出不可能落到仓库文件上。这类命令链中的删除要写绝对路径，而不是裸 basename。
- **先归因再终止。** 共享服务报告外来占用者时，先检查被指名的 pid，只终止能归因到探针的进程。用户正在运行的宿主永不被发信号，这是根 AGENTS.md 既有的规则。

## Diagnosing a foreign ledger owner

拒绝是可行动的，因为账本占用者在磁盘上可观测：

- `lsof $DSH_HOME/task-board/ledger-v2.lock` 指名持有进程，锁文件本身记录 `pid`、`token` 与 `startedAt`。
- `ps -o pid=,ppid=,lstart=,command= -p <pid>` 把孤儿（父进程为 1）与用户正在使用的宿主区分开，`lsof -nP -a -p <pid> -iTCP -sTCP:LISTEN` 显示它占用的端口。
- 与探针自身 profile 及启动时间相符的进程都归同一个探针：只回收消息里指名的那个 pid，会让它的同类再次拿到锁。

## Alternatives considered

**继续探测用户的 home，事后清理。** 否决：冲突发生在探测期间而非之后。对着共享 home 启动的实例已经夺走了用户的看板，事后停掉它并不能归还用户当时正在用的东西。

**让账本接管由其他 pid 持有的锁。** 否决：单写入者锁正是防止两个宿主交错写同一个账本的机制，拒绝是正确行为。缺陷是残留的写入者，不是锁。

**只把账本移出共享 home。** 否决：隔离是探针 home 的属性，不是某一个文件的属性。继续共享 session、设置与皮肤的探针，一边绕开最先被注意到的冲突，一边照样写用户的状态。

**在同一个 home 里靠端口隔离。** 否决：本次事件里的残留实例本就监听着自己的端口，却照样占有账本。端口不划分状态。

**解包产物后信任相对路径的删除。** 否决：删除命中的是当前目录里的任何东西，这正是它砸中仓库文件的原因。辅助命令必须在它输出应当落地的位置运行，而不只是从不该落地的地方被清理掉。

**恢复被删的清单，把事件当作本地失误处理。** 作为记录方式否决：删除在别处才以安装被拒的形式浮现（同一会话里更晚的另一个任务），因此原因应进持久记录，而不是只留在修复提交里。

## Consequences

- 流程写在 [dsh-web-web-qa](../../../skills/dsh-web-web-qa/SKILL.md)（临时 `DSH_HOME`、会话内回收、不写仓库根），规则只在根 [AGENTS.md](../../../../AGENTS.md) 的「运行中的 DSH 服务」一节陈述一次。同时遵守两者的探针不会碰到用户的宿主。
- 临时 home 会安装自己的 profile 依赖，因此探针为一棵私有目录付出网络与磁盘成本。这个成本是不共享 profile、session 与账本的价格。
- 任务看板的拒绝路径本就指名占用者 pid，并由 degraded-reason 与账本锁用例覆盖；本决策不改任何运行时代码。它的归属是 [task-board host failure diagnostics](../bug-fix/2026-09-13-task-board-host-failure-diagnostics.md)。
- 未暂存即被删除的工作区文件用 `git checkout -- <path>` 恢复；根清单对 `dsh.bundle.patch` 的声明，正是它缺失会让安装致命而非表面问题的原因。
- 被替换的文件用同样方式恢复，但只有读 `git status --porcelain` 与 diff 才会被发现：被覆盖的清单照样可解析，照样像有意的编辑。这道检查只花一条命令，因此在任何没有在临时目录里运行的辅助命令之后都执行一次，再继续依赖该检出的工作。
- 本决策的验证即修复证据：终止三个可归因的孤儿实例后，共享 home 的账本锁被释放；恢复后的清单重新可作为 bundle 解析（`readProfileManifest`、`resolveBundleDir` 与 `evaluatePluginCompatibility` 均接受该检出）。未新增测试；所检验的行为归属宿主，而非本仓库代码。
