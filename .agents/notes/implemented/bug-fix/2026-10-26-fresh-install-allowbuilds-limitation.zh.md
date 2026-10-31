# Agent Note: 干净 profile 首次安装停在被忽略的构建脚本上，装了但没有挂载

Status: implemented

## Problem

干净 profile 第一次装不上这一族，而且失败的方向恰好是最不容易被发现的：聚合包已经写进 profile 的 `package.json` 与锁文件，`dsh.profile.bundles` 却始终没有这一行，于是 profile 说自己装了一样它并不加载的东西。

用 `dsh plugin --profile <name> add` 装 `@linxin666/dsh-web-all@<version>` 在干净 profile 上以 exit 1 结束，环境是 pnpm 11.9.0 加官方 CLI 0.2.1-rc.3，唯一的诊断信息是 pnpm 自己的那份清单：`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, ssh2@1.17.0`。这三个包经由聚合包的依赖树进来，而 pnpm 11 不执行 profile 没有批准过的 postinstall 脚本。

挂载之所以被跳过，是因为官方 CLI 只在安装命令 exit 0 之后才回写 profile（`dsh-plugin-manager`，`lib/types/operations.js:499`）。于是 exit 1 留下一个写了一半的 profile：依赖记下了，bundle 行没有，`dsh --dump-config` 里看不到这一行，而重复同一条命令只会复现同一个失败，不会自愈。

失败之后补审批修不回这次失败，而修不回来的方式正是危险之处：回写时的 reconcile 只遍历本次运行新加的依赖，所以同一个 `lib/types/operations.js` 里的 `if (beforeDeps.has(name)) continue`（约 106 行）会跳过运行开始时 profile manifest 里已有的每一个名字，而失败的那次已经把聚合包写了进去。补审批之后以 exit 0 结束的安装因此同样写不出 bundle 行，profile 停在一个绿色退出码后面的「装了没挂载」状态。

官方 CLI 只在 git 源插件失败时提示 `allowBuilds` 这条补救，注册表包既没有提示也没有线索。本仓自己的 `allowBuilds`（`pnpm-workspace.yaml:13`，五项全为 `true`）归开发工作区所有，从不抵达用户 profile。

这个坑比记录它的版本更老，这一点是查到的而不是断言的：[0.4.7 升级矩阵](../../../../docs/archive/2026-10-17-v0.4.7-upgrade-matrix.md) 第 15 行把同样的首次安装失败记为 `pre-existing, not a 0.4.7 regression`，第 110 行留着同一行 `ERR_PNPM_IGNORED_BUILDS`，而已发布的 0.4.9 复现结果一致。

## Decision

0.4.10 记录这条限制，不改安装器。[发布说明](../../../../docs/release-notes/v0.4.10.md) 在中英两个视图各加一条已知限制，写明触发条件、现象、真正能恢复的顺序（重置或换掉 profile、先批准这三项构建脚本、再做首次 add），以及这条限制不是本版引入的。

限制归本篇所有，发布说明只做摘要。下面两个候选修法都不在 0.4.10 里，缺陷未修复：它被记录下来了，没有被关掉。

源码、测试、工作区文件与各份 manifest 一律不动。本仓在内部修不了它：拒绝来自 pnpm 的构建脚本批准模型，而留下缺失 bundle 行的回写时机属于官方 CLI。

影响面只在首次安装。干净 profile 受影响。已经带着构建脚本审批的存量 profile 不受影响：这样的 0.4.9 profile 升级到 registry 上的 0.4.10 以 exit 0 结束，不要求新审批，`dsh.profile.bundles` 那一行不变也不重复，`--dump-config` 逐字节相同，重复执行仍然幂等，也就是这道门由审批状态决定，而不是由依赖集合是否变化决定。一个完全没有 `allowBuilds` 记录的旧 profile 在 pnpm 11.9.0 下升级到 0.4.10，是本篇实测过的那一档：命令以 exit 1 停在 `[ERR_PNPM_IGNORED_BUILDS]` 上，而升级已经落地且保持挂载，所以这样的用户手里是一个失败的退出码加一个已经生效的升级；补救是在 profile 自己的 `pnpm-workspace.yaml` 里补上这三项审批再跑同一条命令，以 exit 0 结束并让三项构建真正执行，不重装、不重置 profile。这个失败与上面那个一样仍未修复：本篇记录的是用户的自救路径，不是安装器改动。

## Evidence

- 命令与结果：干净 profile 上用 `dsh plugin --profile <name> add` 装 `@linxin666/dsh-web-all@<version>`，pnpm 11.9.0，官方 CLI 0.2.1-rc.3，exit 1，报 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, ssh2@1.17.0`。
- 回写时机：`dsh-plugin-manager` 的 `lib/types/operations.js:499` 只为 exit 0 的安装执行 profile 回写，所以 exit 1 之后依赖记下了、`dsh.profile.bundles` 那一行没有。
- 失败之后的回写范围：`lib/types/operations.js` 里的 `if (beforeDeps.has(name)) continue`（约 106 行）让回写只遍历本次运行新加的依赖，而失败的那次已经记下了聚合包，所以补审批之后 exit 0 的安装同样不写 bundle 行；实测为 exit 0，`dsh.profile.bundles` 与 `--dump-config` 都无变化。
- 失败后的实测状态：`--dump-config` 里没有这个家族包的 bundle，同样的输入重复执行安装命令仍是同样的 exit 1。
- 这道门读的是审批状态，不是依赖集合：审批没有满足时，依赖集合未变的安装仍然以 exit 1 结束并报同样三项，所以「依赖未变」本身并不让重复安装成功。
- 工作区归属：`pnpm-workspace.yaml:13` 开头的 `allowBuilds` 块归开发工作区，用户 profile 有自己的 `pnpm-workspace.yaml`，不在它的覆盖范围内。
- 出路与各自的依据：先用官方 `--from-default-profile web` 重置 profile，在首次 add 之前把这三个名字写进 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds`，然后再 add；或者在一个没被这次失败污染过的新 profile 上照同样顺序做——这就是本机实测能挂载 bundle 的顺序。exit 1 之后再补审批不算出路，理由就是上面记下的回写范围。
- 审批是映射形式，每个包一个 `true`，列表形式不可用：`allowBuilds:` 下面写 `cloudflared: true`、`cpu-features: true`、`ssh2: true`，首次 add 即挂载（2026-10-31 在 DSH 0.2.1-rc.5 加其内置 pnpm 11.9.0 上实测，`dsh.profile.bundles` 得到聚合包，`--dump-config` 列出 25 个 `web-ui-*` 行 id）；而把同样三个名字写成列表，会被 pnpm 改写成形如 `'0': cloudflared` 的占位条目，重跑时还会回退已解析的包（`Packages: -10`）且不写这一行。
- 带着审批升级的实测：一个已有构建脚本审批的 0.4.9 profile 升级到 registry 上的 0.4.10，exit 0、不要求新审批、`dsh.profile.bundles` 那一行不变也不重复、`--dump-config` 逐字节相同、重复执行幂等。
- 无审批记录的存量升级：一个 `pnpm-workspace.yaml` 里完全没有 `allowBuilds` 审批记录的 0.4.9 profile，在 pnpm 11.9.0 加官方 CLI 0.2.1-rc.3 下升到 registry 上的 0.4.10，以 exit 1 结束并报 `[ERR_PNPM_IGNORED_BUILDS]`（cloudflared@0.7.3、cpu-features@0.0.10、ssh2@1.17.0），而升级本身已经落地且保持挂载：profile manifest 记的是 0.4.10，`node_modules` 里 25 个家族包全是 0.4.10，`dsh.profile.bundles` 里聚合包仍恰好一行，`dsh --profile <name> --dump-config` 以 exit 0 结束并列出该 bundle，25 个家族包声明的 60 个依赖 0 个不可解析；失败的是退出码与后续操作的干净度，不是升级结果或挂载状态，重跑同一条命令仍是 exit 1、不自愈。
- 这一情形的补救：在 `<profile>/pnpm-workspace.yaml` 里把 cloudflared、cpu-features、ssh2 写成 `true`（或走交互式 `pnpm approve-builds`），同一条升级命令以 exit 0 结束，三项原生/二进制构建真正执行（cloudflared 的 postinstall 生成 `bin/cloudflared`，cpu-features 经 node-gyp 生成 `build/Release/cpufeatures.node`，ssh2 生成 `sshcrypto.node`），版本与挂载状态不变，`--dump-config` 逐字节相同，不重装、不删 profile。
- 门读的是审批记录而不是构建产物：构建产物已经存在但审批记录缺席的变体同样以 exit 1 结束，状态同样已是 0.4.10 且已挂载。
- `--config.strictDepBuilds=false` 只买到挂载：干净首次 add 上以 exit 0 结束并写入 bundle 行，却在 profile 里留下占位条目（形如 `cloudflared: set this to true or false`），三项原生/二进制构建并不真正执行，没有 `bin/cloudflared`，也没有 `build/Release/cpufeatures.node`。
- 既有记录：[0.4.7 升级矩阵](../../../../docs/archive/2026-10-17-v0.4.7-upgrade-matrix.md) 第 15 行与第 110 行，以及对已发布的 0.4.9 复现出的同一失败。

## Impact

- 干净的首次安装受影响：家族装上了却没挂载，而 CLI 输出里没有任何一处点出缺失的 bundle 行。
- 已经带着审批的存量 profile 从 0.4.9 到 0.4.10 行为没有任何变化，而审批状态从未记录过的 profile 会照常升级、照常挂载，然后以 exit 1 结束，用户读到的失败发生在活已经干完之后。
- 手工自救的用户必须改 profile 自己的 `pnpm-workspace.yaml`；开发工作区的批准清单不会随包一起走。
- 这个状态在重试时不自愈，所以停在 exit 1 的用户手里留着一个能解析这个包、却什么都不加载的 profile。

## Candidate fixes

- 由本仓的安装入口写 `allowBuilds`。走我们自己流程的人都不会再踩这个坑，也是唯一能让首次安装无人值守跑通的候选。它还必须落在首次 add 之前而不是失败之后，因为回写会跳过本次运行没有新加的依赖，事后补写挂不上 exit 1 那次已经记下的东西。但它改变安装行为、要写用户拥有的文件，并且需要针对干净 profile 与存量 profile 分别验证，因此不该塞进一次文档改动里。
- 用文档引导用户。没有行为变化，也是 0.4.10 采取的做法，但只帮得到事后去翻文档的人：CLI 在我们任何文档出现在他眼前之前就已经 exit 1 了。这份指引必须连顺序一起写，不只写这三个名字，因为失败之后补审批留下的正是本篇记录的那个静默半挂载。

## Alternatives considered

- **在这次改动里直接补安装入口。** 属于推迟而不是否决：记录这条限制的改动只是文档，而一个会写进用户 profile 的安装器需要这份改动不具备的验证。
- **改本仓的 `pnpm-workspace.yaml`。** 否决：它配置的是开发工作区，用户 profile 读自己的文件，这次编辑碰不到它想修的那个失败。
- **不记录。** 否决：这个失败只是一个退出码加一个 `--dump-config` 看不出来的半挂载 profile，用户分不清「没装」和「装了没挂载」，下一个读代码的人还得从头把这条链重新挖一遍。

## Consequences

- 用户在会踩到它的地方就能看到这条限制，0.4.10 发布说明的两个视图各有一条，推理留在本篇。
- 在两个候选修法之一发布之前，干净 profile 在 0.4.10 上仍可复现该失败。
- 以后真要修，得移动这个决策而不是编辑它：已发布状态变了，本篇要么把修复记成一条取代记录，要么被一条带着验证的新记录取代。
- 后续的安装器改动必须把审批写在首次 add 之前而不是失败之后，因为回写会忽略本次运行没有新加的依赖。
- 两种失败形态必须分开读：干净首发失败后补审批再重跑，是 exit 0 却没有 bundle 行的静默半挂载；存量 profile 无审批升级，是 bundle 行本来就在、版本已升、命令却以 exit 1 结束。把首发那套描述套到升级上，或者反过来，都会让人在「要不要重装」上得出错误结论。
- 依赖集合、协议以及所有挂载路径的行为都不变，因为这里除文档之外没有改动任何东西。
