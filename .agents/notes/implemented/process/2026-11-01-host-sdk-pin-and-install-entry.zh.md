# Agent Note: The workspace pins @deepseek-ai to the running host's SDK tree

Status: implemented

## Problem

本检出由运行中的宿主通过 profile 的 `link:` 条目加载，因此 Node 解析插件的 `@deepseek-ai/*` 导入时会从插件目录向上走到本仓的 `node_modules`。有两条路径决定这次解析的结果：根 `node_modules/@deepseek-ai` 作用域目录，以及开发安装生成的逐包 `packages/<pkg>/node_modules/@deepseek-ai` 条目——对包自身的导入而言，后者优先于根目录。

宿主旁边多出一份 SDK 不会大声失败。多一个 cordis 会让服务注册落空，cohort 分裂会让类型身份分裂：既消费宿主核心类型又增补 cordis 的包会看到两份互不相关的 `Context` 声明；在 pin 覆盖到库之前，`packages/dsh-i18n` 在 tsgo 上正是这样失败的。plain `pnpm install` 不保证产出宿主实际运行的那套 cohort：声明的 range 可能解析到与已装宿主不同的版本。

## Decision

`scripts/host-sdk-link.mjs` 拥有这条 pin。它解析宿主 SDK 树（已安装 dsh 自身的 `node_modules/@deepseek-ai`、设置时的 `DSH_HOST_SDK_DIR`，以及 `current` 正在切换的窗口期内作为回退的带版本 node 构建），把根作用域目录链到它，并把宿主提供的每一个工作区条目重指到宿主副本。宿主不提供的那几个——例如 `dsh-client-ui-primitives` 这类纯客户端构建输入——保留 registry 副本，因为它们在构建期被打进 bundle，从不在运行中的宿主里解析。脚本幂等，从不删除宿主不提供的包，`--check` 只验证不写入（漂移即 exit 1），在没有宿主安装的机器上报告该事实并 exit 0，因此 CI 与贡献者检出不受影响。

`scripts/install-deps.mjs` 是安装入口（`pnpm run deps:install`）。pnpm 写入时不能让它贴着 pin 链接：根作用域目录是指向 root 所有的宿主树的软链，pnpm 会穿透它写入，于是必须在那里落一个作用域成员的安装会中途以 EACCES 失败。脚本先摘下根链接，运行 `pnpm install --ignore-scripts --frozen-lockfile --config.confirmModulesPurge=false`，并在安装失败时也把 pin 复原，因此坏掉的安装绝不会让运行中的宿主解析到 registry 副本。`--ignore-scripts` 是有意为之：cloudflared、ssh2、cpu-features 的 postinstall 钩子要从本机到不了的主机拉平台二进制，工作区 prepare 钩子会重建并不属于依赖安装的包。`--no-frozen-lockfile` 是改清单时的书面例外。

`build`、`test`、`typecheck` 在递归命令之前先跑 `host-sdk-link --check`，于是 registry 副本的 SDK 会在门禁处大声失败，而不是静默分裂 cohort。`pnpm-workspace.yaml` 关掉 `verifyDepsBeforeRun`：pnpm 11 的运行前依赖自检在它认为必要时以 headless 方式改写 `node_modules`，而对着 root 所有的宿主链接，这个自检只能以 EACCES 收场——连 `pnpm run deps:install` 本身都起不来。

宿主不安装的三个纯客户端包（`dsh-client-store`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`）由工作区 `overrides` 固定到 `0.2.2-rc.1`，使解析结果保持在同一 cohort。清单声明 `^0.2.2-rc.1`；override 只统一解析结果，配套的 `packageExtensions` 键随之移动。

## Alternatives considered

**让 plain `pnpm install` 产出 cohort。** 否决：声明 range 解析到 rc.3，而宿主运行 rc.5，失败形态是静默分裂的 cohort 而不是安装报错——正是本次改动要消除的那一类失败。

**只钉根作用域目录。** 否决：开发安装会生成 `packages/<pkg>/node_modules/@deepseek-ai` 条目，对包自身的导入优先于根 pin，只链根目录会让每个声明 SDK devDependency 的包解析到别处。

**把宿主副本增补了宿主未提供模块的那些包留在 registry 副本上。** 否决：这些副本增补的是 `@deepseek-ai/cordis`，从 registry 副本出发该增补解析到 pnpm store 里的 registry cordis，而插件消费的是宿主 cordis，两份模块身份就此分裂，`Context` 上的增补全部消失——实测 74 个条目报 `Property 'slots' does not exist on type 'Context'`，`locale` 与 `uiWorkspace` 同样消失。这正是 pin 本来要防的 cohort 分裂，因此该方向不成立。判据是增补而不是声明：真正出问题的是宿主副本增补了一个宿主未提供的模块，而按「宿主副本声明了对宿主未提供包的运行时依赖」去数一个也选不出来。工作区清单声明 48 个 `@deepseek-ai` 包，宿主提供其中 44 个，这 44 个里有 11 个针对宿主未提供的 `dsh-client-ui-slots` 携带 `declare module '@deepseek-ai/dsh-client-ui-slots'` 增补；这 11 个都只把它列为构建期 devDependency，而 devDependency 不参与宿主副本运行时的解析。

**保留 pnpm 的运行前依赖自检，之后再修复 pin。** 否决：自检在每次 `pnpm run` 之前跑，对着 root 所有的链接只能以 EACCES 收场；安装入口之所以存在，就是为了在 pnpm 写入时先摘下 pin。

**通过改清单来推进三个纯客户端包。** 否决：cohort 字面量由许多仍然正确的清单承载，override 无需碰一个 rc.5 本就满足的声明即可统一解析。

**在本次改动里把整个工作区声明迁到 rc.5。** 否决：cohort 声明属于 cohort 链条与卫星仓，而本次改动只关乎本检出解析到什么。

## Consequences

- pin 只接受完整的宿主 SDK 树。Windows npm-global 探测读取 `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`；当前全局树缺少有效的 `dsh-session` 与 `dsh-agent` 清单标记，因此被拒绝而不是强行建立 pin。纯 registry 安装仍是 CI 与不完整安装的受支持回退。
- 完整的宿主树通过本机门禁。pin 生效时 `pnpm typecheck` exit 0，24 个包全部报 `typecheck: Done`、没有一个 `Failed`，`pnpm build` 也 exit 0——与 registry cohort 的结果一致，门禁区分不出两套 cohort。`host-sdk-link --check` 不核验宿主副本自身的导入能否解析，也不核验宿主包集合与 lockfile cohort 是否一致：它核验的是根作用域链到尺寸相符的宿主树、每个被 pin 的工作区条目解析到宿主副本，因此两套 cohort 之间的分歧在 typecheck 处暴露，而不是在 pin 检查处。
- `conversation.chat.turnTail` 这个槽位键经 `packages/dsh-message-edit` 与 `packages/dsh-web-settings` 的 `tsconfig.json` 里的 `paths` 映射解析：该映射把 `@deepseek-ai/dsh-client-ui-slots` 及其 `/*` 子路径指向该包自己的 `./node_modules/@deepseek-ai/dsh-client-ui-slots`，也就是插件实际导入的那份 registry 副本。宿主树不提供这个纯客户端包，而声明 `declare module '@deepseek-ai/dsh-client-ui-slots'` 增补的被 pin 客户端包——11 个，含 `dsh-client-ui-chat` 与 `dsh-client-ui-settings`——来自宿主副本，那些增补只能在宿主副本自身位置解析，而那里没有该模块；插件导入的 registry 副本因此保留未增补的 `SlotMap`，`PropsRuntime<K extends keyof SlotMap & string>` 把键约束收窄成 `never`。把说明符映射过去，增补就落回那一份。映射只声明在真正消费这类被增补槽位键的两个包里：铺开到整个工作区，等宿主提供 `dsh-client-ui-slots` 时它会盖过 pin——pin 把每个包的条目重指到宿主副本，而映射会覆盖这一点、把所有包钉死在 registry 副本上——那正是同一场 cohort 分裂，只是方向反过来。
- `user-questions/request` 处理器按可变的答案镜像通过类型校验：`packages/dsh-remote-bridge/src/core/questions.ts` 里 `QuestionAnswerItem.selected` 是 `string[]`、`QuestionAnswer.answers` 是 `QuestionAnswerItem[]`，属性级 `readonly` 保留，与宿主的 `AskUserQuestionAnswerItem.selected: string[]` 和 `AskUserQuestionAnswer.answers: AskUserQuestionAnswerItem[]` 对齐；`src/core/connection.ts` 的 `answersOf()` 返回它本来就构造的可变数组。该文件按字段镜像 `dsh-user-questions`，而它必须保持可赋值的那个处理器类型只在宿主副本进入编译程序时才出现：宿主树携带 `@deepseek-ai/dsh-user-questions`，lockfile 里没有任何条目安装它，它那条对 `@deepseek-ai/cordis` 的 `user-questions/request` 增补只在 pin 生效时进入编译，readonly 镜像对它是不可赋值的。
- 这条 pin 是本地开发契约：它不改任何清单、lockfile 或已提交产物，从不运行它的检出仍从 registry cohort 构建。
- `pnpm run deps:install` 是唯一能让有效运行宿主继续解析宿主 cohort 的安装路径。Windows 上入口经 shell 调用 `pnpm.cmd`；alpha.3 的重新解析已通过这条路径完成。
- pnpm 不再在本工作区跑运行前依赖自检，因此改清单后陈旧的 `node_modules` 会由安装与门禁命令报出，而不是被就地修复。

## Testing

- Windows 候选路径测试通过，真实全局树则因不完整被正确拒绝。没有强行建立 pin，也没有重启运行中的服务。
- `node scripts/install-deps.mjs --no-frozen-lockfile` 在 Windows 完成并安装 alpha.3 cohort；随后全量 `pnpm typecheck` 与完整 `pnpm test` 在 registry cohort 上通过。
- 本机的宿主树完整时，`node scripts/host-sdk-link.mjs --check` 打印 `host sdk: /usr/local/lib/nodejs/current/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai (0.2.2-rc.1, 330 packages)` 与 `check: ok (root exposes 330 packages, 226/226 workspace entries pinned, 39 host-absent left to pnpm)`；该树里没有任何 `slots` 包，`grep -c dsh-user-questions pnpm-lock.yaml` 为 `0`。
- `pnpm test:scripts` 有 552 个通过项与一个既有 Windows 文件权限失败：deploy-market 探针期望 `600`，Windows 返回 `666`。
- 本机在 pin 生效时的实测：`pnpm typecheck` exit 0，24 个包报 `typecheck: Done`、0 个 `Failed`；`pnpm build` exit 0；`pnpm sync-shared:check`、`pnpm aggregate:check`、`pnpm runtime-deps:check`、`pnpm libs:check`、`pnpm emoji:check`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm test:standards` 与 `pnpm test:scripts`（fail 0）全绿。
