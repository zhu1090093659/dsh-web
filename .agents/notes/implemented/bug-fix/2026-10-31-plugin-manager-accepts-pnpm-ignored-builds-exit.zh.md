# Agent Note: Plugin-manager 只在 profile 真的落地时才接受 pnpm 的跳过构建脚本退出码

Status: implemented

## Problem

在 pnpm 11 上，本网关驱动的 profile 变更可以在**已经写完 profile 之后**以非零码结束，而 `CliGateway` 把这个退出码当成了全部判决：任务结算成 `error`，并且尽管 profile 已经带上变更，后面每一项变更后校验都被跳过。

pnpm 11 在依赖被 `pnpm approve-builds` 批准之前不会运行它的构建脚本，而未获批准的依赖会让命令在收尾时失败：包已经解开，lockfile 已经记录，profile 的 `package.json` 也已经带上这个新依赖。2026-10-31 在隔离的 `DSH_HOME=/tmp/dsh-fix-0413` 中针对 DSH 0.2.1-rc.5 实测，它的 `dsh plugin` 转发到自己捆绑的 pnpm 11.9.0（宿主上的 pnpm 11.24.0 给出同样的退出）：

```
$ dsh plugin --profile web add @linxin666/dsh-web-all@0.4.12
dependencies:
+ @linxin666/dsh-web-all 0.4.12
Packages: +46
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, ssh2@1.17.0

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
dsh: plugin command failed; diagnostics: /tmp/dsh-fix-0413/profiles/web/.plugin-manager/logs/operation-W7Uzsv/pnpm.log
exit 1

profiles/web/package.json: "@linxin666/dsh-web-all": "0.4.12"   （已落地）
```

这个退出里没有任何东西属于这次发版：只要安装带进了一个声明构建脚本的依赖，pnpm 11 就会给出它——单装 `dsh plugin --profile web add cpu-features` 也一样——所以它是 pnpm 与依赖图的属性，不是某个版本的属性。

那次提前 return 跳过了 CLI 路径存在的全部校验：重复挂载剥离（B9）、「安装是否真的落地」读取（B8）、入口 id 重复检查（B5）、不可解析插入名检查（B6）、`--dump-config` 启动预检，以及更新路径上的精确版本门与它后面的失效行覆盖清理。直接驱动 `CliGateway`、对着真实 CLI 与真实 pnpm 跑（先装 `cloudflared@0.7.1`，再更新到 `0.7.3`），改动之前：

```
install: phase=error  profile dependency=0.7.1  node_modules version=0.7.1
update:  phase=error  profile dependency=0.7.3  node_modules version=0.7.3
```

`job.error` 就是 pnpm 的输出尾部，连 `[ERR_PNPM_IGNORED_BUILDS]` 那行都在。更新插件的人被告知失败，而新版本其实在磁盘上，那些本该拦下这份状态的校验一次都没跑过。

## Decision

1. **只有一种 pnpm 条件可以被重新读取，且只有 profile 能推翻它。** `reportsIgnoredBuilds(output)` 识别一次运行所捕获输出里的 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: …` 行。带这行的运行是被*容忍*的：任务执行器继续往下走，而不是按退出码结算。其他任何非零退出都保持今天的结算语义——`phase = 'error'`、`job.error` 设为输出尾部、不再继续校验——因此 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`、真正的解析失败、spawn 失败与超时，报的都和以前一模一样。
2. **决定权在本来就有的落地检查手里。** 被容忍的运行走那条未改动的链路，每个动作自己的读取就是判决：安装没有新增依赖、更新后的已装版本不是路由解析出的版本、卸载后依赖仍留在 profile 中，三者依然失败，且都发生在任何预检之前，理由就是 pnpm 的输出尾部——正是提前 return 会给出的那段文案。
3. **容忍退出码不多买任何东西。** B9、B5、B6、组合预检、精确版本门与失效覆盖清理全部照跑，也照样能把任务判成失败，因此一次「落地了但落出启动级坏状态」的被容忍运行会被拒绝，与成功退出时完全一样。
4. **pnpm 的话留在任务上。** 通过全部校验的被容忍运行结算成 `done`，并把该次运行的输出放进 `GatewayJob.warnings`，宿主再以 `console.warn` 记一笔。它不进 `job.notices`：那个台账的行形状 `{id, name, from, to}` 记的是控制状态迁移，而构建脚本诊断既不是一行也不是一个状态。`warnings` 与 `restartRequired` 用的是同一个可选的字符串数组事实通道，因此它随 `/status` 送到调用方，而不是在结算处被丢掉。
5. **迁移的安装步骤是同一次 pnpm 调用，同样处理。** `runMigration` 以相同方式容忍该退出，并保留原有兜底：目标没有出现在 profile 里就回滚迁移并报 pnpm 的输出尾部。回滚辅助函数自己的装回安装（`rollbackMigration`）刻意不动——它运行在迁移已经失败之后，它的报告讲的是回滚，不是警告。

## Alternatives considered

**把任何「变更已落地」的非零退出都当成成功。** 否决：落地并不等于 pnpm 同意了这次运行。被注册表拒绝的解析可能让先前已装的版本原样留着，于是「版本没动」的更新与成功更新无从区分——那条告诉使用者该怎么做诊断会被丢掉了。

**匹配人类可读句子（Ignored build scripts）而不是诊断码。** 否决：那句话是 pnpm 的文案，将来的版本可能改写或翻译，而方括号里的码是 pnpm 保持稳定的机器可读 token。匹配文案还会被仅仅引用它的日志行触发。

**只看退出码、把输出当警告记下来，而不重读 profile。** 否决：profile 才是「变更是否发生」的唯一权威，而这个缺陷本身就是调用方信了单一来源。重读用的正是成功路径本来就要做的那次检查，若容忍而不重读，等于又发一套更弱的「落地」定义。

**把警告放进 `job.notices`。** 否决：那个数组是冲突行台账（`ControlChange`），三个字段都是层级状态。pnpm 诊断要挤进去就得凭空造一个状态迁移，而台账现存的每个读取方还得再把它过滤出去。

**只要退出码非零就回滚安装。** 否决：今天那个已落地状态根本不会被看到，而这些包正是使用者要的。因为 pnpm 跳过一个可选的原生构建就把一份正确的安装回滚，是把警告变成数据丢失。

**容忍退出后再跑一次 CLI 确认变更。** 否决：这次确认本身又是一次经由同一个 pnpm 的 profile 写入，会继承同样的退出与同样的条件；重读 profile 更便宜，而且回答的是真正要紧的那个问题。

**把被容忍的退出结算成 `done` 且不留记录。** 否决：一个没被构建的可选依赖，正是下一次启动会报成「原生模块缺失」的东西，而一个没有记录的任务留不下任何可归因的线索。

## Consequences

- 安装、更新、卸载或迁移只要包真的落地，就以它本来的成功面貌被报告，pnpm 的输出尾部挂在任务上，而不是被报成一次同时跳过全部校验的失败。
- 这个条件是 pnpm 的，不是这次发版的：决定它的是「profile 是否新增了一个带构建脚本的依赖」，因此下一个带构建脚本的包无需在这里改代码就有同样的行为。
- 浏览器半区暂时不读 `warnings`。`src/client/index.ts` 里的 `GatewayJobWire` 读的是 `phase`、`plugin`、`error` 与 `restartRequired`，而 notice 台账自「插件管理」Tab 移除后就没有渲染方，因此更新区块显示的是它正常的成功路径（重启提示），输出尾部可以在 `/status` 与宿主日志里拿到，直到有人为任务警告做出客户端界面。把这件事写在这里是刻意的：警告被记录下来了、没有被吞掉，但它还没有出现在屏幕上。
- 被跳过的构建脚本仍然是跳过状态。网关只是不再把这次运行叫失败；批准构建脚本仍然要使用者自己去跑 `pnpm approve-builds`，记录下来的输出里写着这件事。
- spawn 失败的结算未受影响：spawn 失败根本不产生输出，因此不携带任何诊断，仍然结算成失败（[spawn 失败记录](2026-10-12-plugin-manager-spawn-failure-settlement.md)）。应用自有 profile 的原生路径读的是官方管理器自己的判决而不是退出码，同样保持不变（[应用自有更新路径](2026-09-26-plugin-manager-app-owned-update-path.md)）。

## Testing

`tests/gateway-jobs.spec.ts` 用脚本化的 CLI 从两侧覆盖这个决策，夹具就是真实 CLI 产出的那段 pnpm 输出。被容忍的安装与被容忍的更新都结算成 `done`，`plugin` 有值，`warnings` 等于输出尾部，并断言它们的 `--dump-config` 探测确实跑过——那是链路的最后一道门。什么也没新增的被容忍安装、以及把旧版本留在原地的被容忍更新，仍然是 `error` 且带 pnpm 的输出尾部，并且一次探测都没到过。一次落地了却带着 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 的更新仍然是 `error`，文案就是那段输出。插入项指向不可解析包的被容忍安装被 B6 回滚，且没有任何预检；组合无法启动的被容忍更新在预检处失败。依赖已消失的被容忍卸载、以及安装步骤已落地的被容忍迁移，都结算成 `done` 并带上警告。把 `reportsIgnoredBuilds` 关掉会让其中六个测试失败，因此它们钉住的是决策本身，而不是仅钉住结果。

实测：上面那个两段式场景在隔离 `DSH_HOME` 里经由 `CliGateway` 对着真实 CLI 与真实 pnpm 跑，两段都报 `phase=done`，`plugin.version` 等于磁盘上的版本，`warnings` 带着 `[ERR_PNPM_IGNORED_BUILDS]`；包测试套件（451 个测试）全绿。
