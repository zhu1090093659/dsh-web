# Agent Note: Git-graph status reads run a three-spawn plan

Status: implemented
已退役，参见 [dsh-git-graph 包退役决策](../simplification/2026-11-03-git-graph-package-retired.md)

## Problem

一次 SCM 标签页就是固定数量的 git 子进程，而宿主在每次打开与每个轮询 tick 上都要付这笔钱。状态路径每次调用需要 5 次 spawn（`rev-parse --show-toplevel`、`rev-parse --abbrev-ref HEAD`、`status --porcelain`、合并的 `rev-parse --git-path` marker 探测，以及 `rev-parse --short HEAD`），分支列表再加第 6 次，于是一个标签页合计 15 个进程：status、branches、graph、worktrees。在 Windows 上冷启动一次 `git.exe` 约 0.7 s，这正是路由层已把轮询节奏压到 30 s 的原因；在其他平台上每一次 spawn 同样是完整的进程启动，而 SSE 循环会为每个订阅者重复其中两个视图。

## Decision

读取管线是 3 次 spawn，`status` 就是这三次：

1. `git rev-parse --show-toplevel --short HEAD` —— 一次调用同时取仓库根与缩写 head。
2. `git rev-parse --git-path <marker>...` —— 操作 marker 探测，保持不变，7 个 marker 一次 spawn。
3. `git status --porcelain=v2 --branch` —— 三个计数加分支头。

第 2 与第 3 步彼此并行；第 1 步先走，因为后两步都需要仓库根。于是 `status` 为 3 个进程，`branches` 为 4（多一次 `for-each-ref`），`graph` 为 2，`worktrees` 为 2，一个 SCM 标签页由 15 降到 12。

head 不能取自 v2 头部。`# branch.oid` 携带完整对象名，`git status --porcelain=v2 --branch --abbrev=7` 被 git 拒绝（`error: unknown option 'abbrev=7'`，exit 129），而分支胶囊与 SSE 变更键消费的都是 `rev-parse --short HEAD` 打印的缩写 id，其长度是 git 自己的自适应缩写。`--abbrev-ref` 与 `--short` 也无法共用一次 `rev-parse`：写成 `--abbrev-ref HEAD --short HEAD` 时分支会打印两次（该模式持续生效），两者对调则命令以 `Needed a single revision` 失败。

`status --porcelain=v2 --branch` 由 `host/status-porcelain.ts` 中的 `parseStatusV2` 解析，这是一个宿主本地模块：该路径只在宿主侧（浏览器半区从不 spawn git），把新的 argv 构造与解析器放在这里，可以让共享的 `core/git-command.ts` 及其解析器继续作为其余所有命令形状的唯一归属。

## Equivalence

v2 解析器由 `tests/fixtures/status-porcelain/` 下 18 个真实采集场景钉住，这些输出由 `capture.sh` 从真实的临时仓库采集，而非手写：clean、modified-unstaged、staged-modified、rename-staged、rename-plus-modify、含空格的路径（已修改与未跟踪各一）、未跟踪目录、非 ASCII 未跟踪路径、存在被忽略文件、`UU`、`AA`、近似的 `DU` 冲突、201 条脏记录、批量未跟踪、detached head、改动后恢复干净、unborn 分支。解析器在每个场景上与 v1 解析器的判定逐字段对照，取自 v2 头部的分支与旧的 `rev-parse --abbrev-ref HEAD` 来源在 18/18 个场景上一致。`manifest.tsv` 记录了每个场景的退出码与采集信息。

按 marker 的回退被逐字保留：当合并的 `--git-path` 探测以非零退出时，仍然逐个 marker 各起一次命令探测，因此单次 `rev-parse` 失败不会静默掩盖进行中的操作。`statusFlights` 依旧对同一路径的并发读取去重，这正是让超时的轮询不至于堆积的原因。

## Alternatives considered

- **从 v2 分支头取 head**：以实测否决——该头携带 40 位 oid，且 `--abbrev=7` 被 git 拒绝，交付出去的 head 长度会改变，随之改变的是 SSE 变更键 `root|branch|head` 与分支胶囊。
- **用一次 `rev-parse` 同时取分支与 head（`--abbrev-ref HEAD --short HEAD`）**：以实测否决——两种顺序都如上所述失败，而 marker 探测本身已在使用 `rev-parse`。
- **把 marker 探测并进 status 那一次 spawn（两次 spawn）**：否决——marker 探测是唯一带逐 marker 回退的步骤，把它并进 `status --porcelain=v2` 会扩大单条命令失败所能波及的面；回退的存在正是因为单次 `rev-parse` 失败绝不能掩盖进行中的操作。
- **从工作区路径而不是解析出的仓库根运行 status**：否决——git 会按当前目录过滤 `status`，位于根之下的路径只会报告工作树的一个子集。正因如此才先解析出根。
- **保留 5 次 spawn 的形状、改为拉长轮询间隔**：否决——成本是按调用与按订阅者计的，间隔再长，标签页一打开或 tick 一到仍要付 5 个进程；而该间隔已经长到交互新鲜度只能依赖客户端自己的刷新。

## Consequences

一次 status 调用由 5 次进程启动降为 3 次，一个 SCM 标签页由 15 降为 12，代价是更大的 status 负载：`--porcelain=v2` 为每个条目打印一条带自有字段布局的记录，在 18 个夹具上 v2 输出为 82294 字节、v1 输出为 13034 字节——字节数是 6.31 倍。这笔交换是有意的：字节在进程内被管道读取与解析，而每省下一次 spawn 就少一次进程启动，后者才是主导项（在 Windows 上尤其如此）。

v2 头部同时成为当前分支的第二个来源，因此将来该头部字段若有变化，等价夹具必须同步更新，且 `parseStatusV2` 必须继续返回与 v1 解析器相同的 `StatusCounts` 判定——分支胶囊与 worktree 管理器消费的是计数，不是记录文本。

宿主侧的 git 服务现在有两个归属不同的解析模块：分支、图与 worktree 解析器留在 `core/`，而 status 管线及其解析器是宿主本地的。新增一个 status 形状的命令，需要先决定它归属哪一边。

## Testing

`tests/status-porcelain-v2.spec.ts` 逐场景断言夹具上的等价性，包括与采集到的 `--abbrev-ref HEAD` 输出之间的分支一致性，以及 rename、已暂存+未暂存、冲突与未跟踪目录状态下的计数规则。夹具目录带有用于溯源说明的 `README.md` 与记录退出码的 `manifest.tsv`，因此重新采集的结果可以与解析器被钉住时的内容做 diff。

最接近的既有记录是 [Git worktree parallel sessions in dsh-git-graph](../feature/2026-08-26-git-worktree-parallel-sessions.md)（拥有 worktree 创建与会话隔离）与 [Git Graph branch chip portals into hero workspace row](../bug-fix/2026-08-31-git-graph-branch-chip-hero-portal.md)（拥有浏览器半区中胶囊的 DOM 位置）。两者都不拥有宿主读取路径的命令形状：worktree 决定会话在哪个树里工作，胶囊决定控件渲染在哪里，而本条决定一次仓库读取要付多少个进程。因此这是一份新记录，而不是对其中任一条的编辑。
