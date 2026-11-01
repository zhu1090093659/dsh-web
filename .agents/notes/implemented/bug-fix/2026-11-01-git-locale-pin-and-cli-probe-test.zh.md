# Agent Note: Host-dependent gates: the git overwrite guard's locale and the CLI probe test

Status: implemented

## Problem

本仓有两道门禁依赖它们所运行的机器，而不是被测的代码。

第一处是产品缺陷。git-graph 的写动词靠匹配 git 的 stderr 文案来归类失败的命令：`packages/dsh-git-graph/src/core/git-command.ts` 里的模式表把 "The following untracked working tree files would be overwritten by checkout" 变成 `untracked-changes-would-be-overwritten` 守卫，并抽出 UI 在文案里点名的受阻文件。git 会把这段文案本地化到宿主语言，于是在 `LANG=zh_CN.UTF-8` 的宿主上，这次拒绝以中文到达，匹配不到任何模式，被归类为 `internal`：用户拿到的是通用失败，而不是点名哪些文件挡住了切换——偏偏在只有这条守卫有用的机器上丢掉了它。这个依赖在套件里表现为随机器而变的红：`tests/git-service.spec.ts > classifies an untracked-file overwrite with the blocked paths` 在本机失败，而在同一个 git 二进制（2.53.0）下用 `LC_ALL=C` 通过——因为该 spec 里朴素的 `execFile` runner 继承了宿主环境，生产路径也一样：官方 subprocess 服务在调用方不覆盖时合并环境。

第二处是测试读了宿主。`packages/dsh-plugin-manager/tests/gateway.spec.ts > dshSpawnCommand > keeps the binary as-is off Windows` 断言 `/usr/local/bin/dsh` 原样 spawn，而生产的探测是对该路径读 shebang：在装过 dsh 的机器上，这个路径是指向随包 `lib/bin.js` 的软链，命令解析成 `node` 加脚本。那条期望只在该路径没有 dsh 的机器上成立。

## Decision

dsh-git-graph spawn 的每个 git 子进程都跑在 `GIT_CHILD_ENV = { LC_ALL: 'C', LANG: 'C' }` 之下，常量声明在 `host/git-runner.ts` 并作为 spawn spec 的 `env` 字段传入。`LC_ALL` 是压过其他所有语言变量的那一项，`LANG` 覆盖丢掉前者的子进程环境；其余不必钉，因为只有消息目录在赌注里。这条 pin 落在 runner 而不是分类器：模式继续按 git 的英文字符串写，而必须产出这些字符串的是子进程自己的环境。它是对服务环境的一次有意例外，而不是插件的通用语言策略——输出不被当作文案匹配的子进程没有理由丢掉用户的语言。

`tests/git-service.spec.ts` 的替身 runner 传入同一个 `GIT_CHILD_ENV`，于是分类是被宿主真正收到的文案检验的；`tests/git-runner.spec.ts` 断言 spawn spec 带着这条 pin。

CLI 探测测试改为注入 API 本就暴露的 shebang 探测（`readHead`），不再让默认探测去读宿主自己的文件，并为咬到它的那条分支补两个用例：Node 脚本 CLI 走它旁边的 `node`，没有同级 `node` 时回退到 `process.execPath`。生产行为不变——Node 脚本 CLI 仍由解释器执行，这正是包自己的规则所要求的。

`host/git-runner.ts` 同时修掉了过期的头部说明：单消费者共享模块合并（927268192）之后它就不再是同步副本，而旧文案会让下一个编辑者去改一个已不存在的 `shared/` 源。

## Alternatives considered

**连本地化文案一起匹配。** 否决：翻译目录不是契约——每种语言都要自己的模式，受阻文件抽取还要读列表格式，而新一版 git 可能重写其中任何一条。

**不读拒绝文案，改为预检该条件**（例如拿 `git status --porcelain` 与目标树比对）。否决：那是重新实现 git 自己的检查，而用户这次切换真正撞上的是 git 的判定；预检若与它不一致，要么挡住 git 本会允许的切换，要么放行一次随后仍被同一段未解析文案拒绝的操作。

**在插件进程里设置语言**（`process.env.LC_ALL = 'C'`）。否决：那会改掉整个宿主进程的语言——日期、排序以及每一个其他子进程——不是本插件有权决定的。

**只钉生产、让 spec 的 runner 保持环境继承。** 否决：那个 spec 是模式与真实 git 唯一的相遇处，它必须收到宿主收到的同一份环境；保持继承等于留下一道随机器而变、在非英语宿主上因与被测改动无关的原因而失败的测试。

**保留 CLI 探测测试读宿主，改选一个 dsh 永不占用的路径。** 否决：那是把耦合藏起来而不是去掉，而且下一个机器布局出现时要重新挑 fixture。

## Consequences

- 守卫文案在每台宿主上都稳定，套件不再依赖宿主语言：此前红的那个用例在 `zh_CN.UTF-8` 下通过，无需 `LC_ALL=C`。
- git 子进程看到 `LC_ALL=C`，因此插件若把 git stderr 呈现出来，即便在本地化宿主上也是英文。插件只通过被归类的守卫文案呈现 git 自己的文本，而那些按构造就是英文锚定的。
- 这条 pin 对 subprocess 的环境清洗不可见：`env` 条目合并到它清洗过的父环境之上，子进程环境的其他部分不变。
- CLI 探测测试不再依赖宿主自身的安装布局；新增的两个用例钉住了旧 fixture 从未覆盖的 POSIX Node 脚本分支。

## Testing

- `tests/git-runner.spec.ts` 断言默认 argv 路径下 spawn spec 的 `env` 为 `{ LC_ALL: 'C', LANG: 'C' }`。
- `tests/git-service.spec.ts` 在本机自身的 `LANG=zh_CN.UTF-8` 下 30/30 通过：覆盖守卫读的是子进程被钉住的英文拒绝文案。改动前同一文件在本机是 29/30，`LC_ALL=C` 下 30/30。
- 整个工作区套件在本机自身的 `LANG=zh_CN.UTF-8` 下通过（33s）：此前两处红都消失了，且 `pnpm test:standards` 报告没有文件因这两个新用例而新增违规。
- `packages/dsh-plugin-manager` 32 个文件 459 个用例通过（含两个新增 POSIX 用例），其 typecheck 通过。
- `packages/dsh-git-graph` 14 个文件 192 个用例通过；其 typecheck 仍报 AGENTS.md 记录的 host SDK pin slot 名报错（`src/client/chips/BranchChip.tsx`），本次改动触及的文件没有报错。
