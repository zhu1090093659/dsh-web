# AGENTS.md - dsh-win-bash

DSH web GUI 插件 dsh-win-bash。包级规则：只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局/包级规则。

## 本包要点

- **host-only 包**：只有 `src/index.ts`（host 半区）与 `src/shell.ts`、`src/tool.ts`、
  `src/background.ts`、`src/protocol.ts`、`src/runtime.ts`、`src/config.ts`、`src/gate.ts`，
  以及 `src/dsh-home.ts`（sync-shared 生成的同步副本，禁止手改）。
  没有 `src/client/`，因此 `shared/tsdown.client.ts` 自动跳过浏览器 bundle；`dsh.client` 不声明。
- **可用性门控跟随梁神预设声明**（`src/gate.ts`）：挂载时向 agent-preset 注册表
  查询是否声明了 id `liangshen` 的预设，未声明即不注册工具（绝不注册一个总会报错
  的工具），`syncWithLiangShen: false` 为逃生口。门控读的是注册表的公开 `list()`
  （定义名册，含激活失败的条目），不依赖该 SDK 包——只用结构化镜像，签名依据写在
  `gate.ts` 模块头。
- **门控不得从 apply 里 await**：注册表的 `list()` 会对每个已声明预设做审计，必要时
  await 宿主 loader 树（`diagnostic` → `loader.await()`），而当前行的激活本身正是那棵树
  在等的任务，两边互等即死锁。因此 `apply` 同步返回，判定在 `mountWithGate` 的续延里
  完成；fiber 在判定期间被销毁就不再注册。注册表关闭时不挂声明变更事件（它只声明
  `agent-preset/selected`，那是单会话的持久日志事件，与名册无关），开关切换经插件管理器
  刷新行后生效。
- **门控的两段等待都有上限**：先 `settleHostTree` 等宿主 loader 树（同一组内的行并发挂载，
  不能假设梁神行先跑完），再读名册；首读未命中则按 `GATE_POLL_INTERVAL_MS` 在
  `GATE_DECLARATION_WAIT_MS` 内重读——声明方插件在自己的激活返回之后才发布预设，两者
  先后不固定，迟到的声明不能被判成拒绝。两段都有界，任何一段超时都不挂死宿主启动。
  `GateOptions` 是测试缩减这些时限的唯一入口，不要在测试里用真实秒级等待。
- **工具名固定 `win_bash`，行 id 固定 `dsh-win-bash`**，且行的 `name` 恰好等于包名。
  改名会撞上宿主自带的 `bash`/`pwsh` 行，或让 loader 静默丢弃同行 id 的其它行
  （见 packages/AGENTS.md 的行 id 纪律）。
- **随包载荷不许回退**：shell 只按绝对路径从校验过的载荷树解析，绝不查 `PATH`。
  任何「顺手用系统 Git 的 bash」的改动都违反本包存在的理由。
- **运行时那棵树必须在包外**：`prepareRuntime` 先校验包内 `runtime/win32-x64`，再把副本
  发布到 `$DSH_HOME/win-bash/runtime/<载荷键>`（键 = 清单里 path 与摘要的摘要），并从
  该副本 spawn。常驻 bash 一旦跑在包目录里，pnpm 覆盖安装时的 rename 就会失败
  （`ERR_PNPM_EPERM`），更新与卸载都得先停宿主——这正是本包不能退回包内执行的原因。
  副本按内容寻址：只改 JavaScript 的发布复用已有副本，校验不过的副本先重建再运行。
  缓存写不出来时降级为已校验的包内树并 warn，**不得**因此拒绝挂载（那是可用性倒退，
  不是安全边界）；载荷校验失败仍然是硬拒绝。`resolveRuntime` 仍是「只解析包内树」的
  入口，供载荷审计与测试使用。
- **载荷完整性是挂载前置条件**：工具注册之前先跑 `prepareRuntime`（校验整份
  `checksums.sha256`，且校验的是即将运行的那棵树）；改载荷必须重算清单，否则挂载会被拒绝。
  `PROVENANCE.md` 是载荷的唯一事实源（上游 URL、摘要、裁剪规则、许可证对照）。
- **帧协议改动必须带协议单测**：`src/protocol.ts` 的 heredoc 框架决定了「命令语法错误不会
  卡死 shell」这一核心保证；`tests/protocol.spec.ts` 的 fixture 必须按 bash 实际写出的字节构造。
- **恢复策略对外可见**：shell 退出、超时、中止都会销毁该 shell，且必须在下一次调用的结果或错误里
  说明状态已丢失；不得静默换壳。
- **截断事实属于模型可见契约**：`src/shell.ts` 算出的 `stdoutTruncated`/`stderrTruncated`/
  `stdoutLostHead`/`stderrLostHead`/`frameOverflow`/spill 路径必须在 `src/tool.ts` 的
  `output.schema` 里声明，并由 `renderResult` 写进模型读到的文本。可见文本是流的**尾部**，
  开头可能从一个半行开始；没有这条提示，模型无法把被截断的结果和本来就短的结果区分开。
- **后台任务必须拥有自己的进程**（`src/background.ts`）：会话的持久 shell 位于 subprocess
  provider 的托管进程范围内，销毁该范围会杀掉其中所有存活进程，所以壳内 `&` 起的任务会随壳
  而死。后台一律走独立 pinned 进程 + `ctx.jobs` 注册，输出经 registry 的 pull 源（
  `handle.collected.*.readFrom`），不得自行无界缓冲。
- **`ctx.jobs` 只做结构化镜像**（同 `src/gate.ts` 的先例）：本包不依赖 `@deepseek-ai/dsh-jobs`，
  只用 `src/background.ts` 头部抄录的公开签名。组合没有该服务时**诚实拒绝**
  （`BACKGROUND_UNAVAILABLE`），绝不静默退化到前台执行——那会让调用方等到命令结束，
  然后随那个 shell 一起死。`enableRunInBackground` 与「是否有 registry」共同决定该参数是否
  被声明：声明一个部署无法兑现的能力，就是在教模型错的事实。
- **本工具只支持 `danger-full-access`，且这是声明而不是限制实现**：任何其他模式在任何
  进程启动之前以 `SANDBOX_UNSUPPORTED` 拒绝（`src/tool.ts` 的 `assertUnconfined`）。
  **不要**为了「支持受限」把 `confine()` 重新接回来——受限下这个载荷起不来，接回来只会
  得到一个每条命令都死在 main 之前的 shell，并让工具声称一个从未拦住任何命令的边界。
  契约由 `tests/sandbox-mode.spec.ts` 钉住，前台与后台两条路径都在内。
- **策略读必须带上调用会话**：`sandboxPolicy.resolve({ session })`。会话自身的
  `sandbox/mode` 优先于部署默认；不带会话去读，用户已限制的会话就会经由部署默认摸到这个
  shell。`tests/sandbox-mode.spec.ts` 有一条用例专门钉这个（部署默认 full-access + 会话
  覆盖 read-only → 必须被拒）。
- **回退契约：win_bash 是首选 shell，不是唯一 shell**。凡是它服务不了的场合，都必须有一条
  通往该平台原生 shell 工具的可见退路，两层都要守：
  ① **能力层**——pwsh 的撤下必须跟随「win_bash 是否真能服务这个会话」，而不是「是否已
  挂载」。`src/pwsh-replacement.ts` 的 `servingVerdict` 是唯一的判定点，它必须覆盖 win_bash
  的**每一条**拒绝理由，目前两条：会话模式不是 `danger-full-access`；以及**会话没有工作
  目录**（`SessionHeader.cwd` 在 SDK 里是可选的，而 `tool.ts` 会因此拒绝——只看模式会漏掉
  这条，会话读作 full-access 却一条命令都跑不了）。判定为 `unknown`（读不到策略服务、
  无会话、`resolve` 抛错、模式不在词表内）时与 `refuses` 同样处理，绝不撤下。
  漏掉任一条 = 会话既看不到 pwsh 又用不了 win_bash，一个 shell 都没有。
  ② **消息层**——每一条模型可见的拒绝/失败（`SANDBOX_UNSUPPORTED`、
  `BACKGROUND_UNAVAILABLE`、无策略服务、`ShellUnavailableError` 的握手类）都必须指明退路
  （`src/shell.ts` 的 `NATIVE_FALLBACK_HINT`），否则模型会反复重试一个不会恢复的 shell。
  Windows 上原生 shell 是 `pwsh`：写「bash/pwsh」是错的，宿主在 Windows 上只有 pwsh。
- **已测得的载荷边界：受限模式下 MSYS 载荷根本起不来**。win32 x64 / Windows 10.0.26200 上，
  `bash.exe`/`sh.exe`/`dash.exe`/`echo.exe` 在 restricted token 下都在 main 之前死亡：
  `NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-<hash>): 0xC0000022`，退出码
  3221225794（0xC0000142）；系统 Git for Windows 同样失败（`couldn't create signal pipe,
  Win32 error 5`），故这是 MSYS/Cygwin 运行时对受限令牌的要求，不是本包裁剪造成的。
  `cmd.exe`/`node.exe`/`powershell.exe` 在同一 runner 下均正常，所以 runner 与本包的 argv
  接线是好的，**未证的是受限模式下任何 bash 命令**。这条事实不得被写成「已通过」。
- **不要为「受限支持」重造被删掉的验证**：`tests/confinement.spec.ts` 与
  `tests/confinement-live.spec.ts` 曾验证「spawn 的是 confine() 返回的受限 argv」，随受限
  支持一起删除。若将来真要在受限下服务会话，前提是先解决 MSYS 在受限令牌下起不来这件事
  （上游 `dsh-sandbox-windows-acl` 的令牌/SID 列表），再重建那两条验证；在那之前任何
  「受限已验证」的说法都是错的。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-win-bash typecheck
pnpm --filter @linxin666/dsh-win-bash test
pnpm --filter @linxin666/dsh-win-bash build
```

改动了受限路径或本包文档时，另跑：

```sh
pnpm test:standards    # 新增测试的 BDD/Given-When-Then/无 sleep 纪律
pnpm docs:check        # owning note 及其 zh/i18n 侧车一致
```
