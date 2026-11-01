# Agent Note: The workspace pins @deepseek-ai to the running host's SDK tree

Status: implemented

## Problem

本检出由运行中的宿主通过 profile 的 `link:` 条目加载，因此 Node 解析插件的 `@deepseek-ai/*` 导入时会从插件目录向上走到本仓的 `node_modules`。有两条路径决定这次解析的结果：根 `node_modules/@deepseek-ai` 作用域目录，以及开发安装生成的逐包 `packages/<pkg>/node_modules/@deepseek-ai` 条目——对包自身的导入而言，后者优先于根目录。

宿主旁边多出一份 SDK 不会大声失败。多一个 cordis 会让服务注册落空，cohort 分裂会让类型身份分裂：既消费宿主核心类型又增补 cordis 的包会看到两份互不相关的 `Context` 声明；在 pin 覆盖到库之前，`packages/dsh-i18n` 在 tsgo 上正是这样失败的。plain `pnpm install` 不会产出宿主实际运行的那套 cohort：清单声明 `^0.2.1-rc.3`，操作者宿主运行 `0.2.1-rc.5`，而该 range 解析到 rc.3。

## Decision

`scripts/host-sdk-link.mjs` 拥有这条 pin。它解析宿主 SDK 树（已安装 dsh 自身的 `node_modules/@deepseek-ai`、设置时的 `DSH_HOST_SDK_DIR`，以及 `current` 正在切换的窗口期内作为回退的带版本 node 构建），把根作用域目录链到它，并把宿主提供的每一个工作区条目重指到宿主副本。宿主不提供的那几个——例如 `dsh-client-ui-primitives` 这类纯客户端构建输入——保留 registry 副本，因为它们在构建期被打进 bundle，从不在运行中的宿主里解析。脚本幂等，从不删除宿主不提供的包，`--check` 只验证不写入（漂移即 exit 1），在没有宿主安装的机器上报告该事实并 exit 0，因此 CI 与贡献者检出不受影响。

`scripts/install-deps.mjs` 是安装入口（`pnpm run deps:install`）。pnpm 写入时不能让它贴着 pin 链接：根作用域目录是指向 root 所有的宿主树的软链，pnpm 会穿透它写入，于是必须在那里落一个作用域成员的安装会中途以 EACCES 失败。脚本先摘下根链接，运行 `pnpm install --ignore-scripts --frozen-lockfile --config.confirmModulesPurge=false`，并在安装失败时也把 pin 复原，因此坏掉的安装绝不会让运行中的宿主解析到 registry 副本。`--ignore-scripts` 是有意为之：cloudflared、ssh2、cpu-features 的 postinstall 钩子要从本机到不了的主机拉平台二进制，工作区 prepare 钩子会重建并不属于依赖安装的包。`--no-frozen-lockfile` 是改清单时的书面例外。

`build`、`test`、`typecheck` 在递归命令之前先跑 `host-sdk-link --check`，于是 registry 副本的 SDK 会在门禁处大声失败，而不是静默分裂 cohort。`pnpm-workspace.yaml` 关掉 `verifyDepsBeforeRun`：pnpm 11 的运行前依赖自检在它认为必要时以 headless 方式改写 `node_modules`，而对着 root 所有的宿主链接，这个自检只能以 EACCES 收场——连 `pnpm run deps:install` 本身都起不来。

宿主不安装的三个纯客户端包（`dsh-client-store`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`）由工作区 `overrides` 固定到 `0.2.1-rc.5`，于是解析产出的是宿主的 cohort，而不是一半 rc.5 一半 rc.3。清单继续声明 `^0.2.1-rc.3`，rc.5 满足该 range；override 只统一解析结果，配套的 `packageExtensions` 键随之移动。

## Alternatives considered

**让 plain `pnpm install` 产出 cohort。** 否决：声明 range 解析到 rc.3，而宿主运行 rc.5，失败形态是静默分裂的 cohort 而不是安装报错——正是本次改动要消除的那一类失败。

**只钉根作用域目录。** 否决：开发安装会生成 `packages/<pkg>/node_modules/@deepseek-ai` 条目，对包自身的导入优先于根 pin，只链根目录会让每个声明 SDK devDependency 的包解析到别处。

**保留 pnpm 的运行前依赖自检，之后再修复 pin。** 否决：自检在每次 `pnpm run` 之前跑，对着 root 所有的链接只能以 EACCES 收场；安装入口之所以存在，就是为了在 pnpm 写入时先摘下 pin。

**通过改清单来推进三个纯客户端包。** 否决：cohort 字面量由许多仍然正确的清单承载，override 无需碰一个 rc.5 本就满足的声明即可统一解析。

**在本次改动里把整个工作区声明迁到 rc.5。** 否决：cohort 声明属于 cohort 链条与卫星仓，而本次改动只关乎本检出解析到什么。下面的 typecheck 限制经此迁移并未改变，因此它也不是挡住解析的理由。

## Consequences

- 这条 typecheck 限制是实测而非理论，且 rc.5 override 并不能消除它：pin 从宿主树服务 239 个工作区条目，宿主的 85 个客户端包用 `declare module '@deepseek-ai/dsh-client-ui-slots'` 声明各自的 slot 名，而那些增补活在未安装该包的宿主树里，于是退化为独立的 ambient 声明，同时 `skipLibCheck` 掩盖了失败解析。`packages/dsh-message-edit`、`packages/dsh-git-graph`、`packages/dsh-web-settings` 因 slot 名不满足约束而 typecheck 失败，把三个纯客户端包迁到 `0.2.1-rc.5` 已执行过且这些报错逐字节不变——不要再把它当作修复重试。`packages/dsh-remote-bridge` 也 typecheck 失败，原因无关：`0.2.1-rc.5` 把 `AskUserQuestion` 处理器类型改成了两个调用签名的联合，需要代码适配。纯 registry 安装（CI、没有宿主 DSH 的贡献者）没有这些报错。
- 这条 pin 是本地开发契约：它不改任何清单、lockfile 或已提交产物，从不运行它的检出仍从 registry cohort 构建。
- `pnpm run deps:install` 是唯一能让运行中的宿主继续解析宿主 cohort 的安装路径。在装有宿主的机器上，plain `pnpm install` 预期会在 root 所有的链接上失败，而不是静默替换 pin。
- pnpm 不再在本工作区跑运行前依赖自检，因此改清单后陈旧的 `node_modules` 会由安装与门禁命令报出，而不是被就地修复。

## Testing

- `node scripts/host-sdk-link.mjs --check` 报告 pin 在位：宿主树 306 个包、239/239 工作区条目已钉、41 个宿主不提供的条目留给 pnpm。
- `pnpm test:scripts` 495 个用例通过；`pnpm libs:check`、`pnpm runtime-deps:check`、`pnpm aggregate:check`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm test:standards`、`pnpm emoji:check` 在同一棵树上通过。
- 本机的 `pnpm test` 有两处环境性红，都与这条 pin 无关：在 `zh_CN.UTF-8` 下一个 `dsh-git-graph` git-service 用例把 git 的本地化 stderr 归类为 `internal`（同一用例在 `LC_ALL=C` 下通过）；一个 `dsh-plugin-manager` gateway 用例期望 `/usr/local/bin/dsh` 被原样保留，而本机该路径是指向 Node 脚本的软链，于是 spawn 命令用 node 包了一层。这两个包都未被本次改动触碰。
- `pnpm typecheck` 仍报上面三个纯客户端包的 slot 名报错与 `dsh-remote-bridge` 的签名报错；纯 registry 检出没有它们。
- `pnpm run deps:install` 本身在本次验证中没有重跑：pin 已在位且 `--check` 通过，而重跑会重装整个工作区。因此摘下、安装、复原这条路径由脚本自身的头部契约与这次 check 担保，而不是由本次改动里的端到端安装担保。
