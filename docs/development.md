# 开发流程（development）

dsh-web 是 DeepSeek Harness Web 的插件 monorepo（皮肤以「皮肤」插件的资产包形式存在）。本文定义
贡献者日常流程；仓库规则见根 [AGENTS.md](../AGENTS.md)，包级规则见
[packages/AGENTS.md](../packages/AGENTS.md)，文档标准见 [AGENTS.md](AGENTS.md)。

## 环境准备

- Node.js >= 24.9 与 pnpm 11；
- 依赖解析官方 NPM SDK（registry.npmjs.org）。仍使用私有 scope 认证时需
  `NPM_TOKEN` 环境变量（真实令牌只放环境变量，勿提交）；token 配置放
  用户级 `~/.npmrc`，项目 `.npmrc` 只留 scope 映射（见
[plugins.md](plugins.md)）。

## 分支模型

- `dev`：开发分支（集成分支），本地开发与远程 PR 的统一目标；提交 /
  提 PR 前先 `git fetch origin && git rebase origin/dev` 同步上游最新代码。
- `main`：稳定分支，只接收从 `dev` 合入且测试通过的代码；`dev` 上
  验证通过后由维护者合入 `main`（发布 tag 仍从 `main` 打）。

## 日常循环

```sh
pnpm install
pnpm build             # 全仓构建
pnpm dev:watch         # 监听重编浏览器产物（dsh web 宿主自动刷新 GUI）
pnpm typecheck         # 全仓类型检查（原生编译器）
pnpm lint              # 语法级 lint（Oxlint，不需要类型程序）
pnpm test              # 全仓单测
pnpm test:standards    # 测试纪律门禁（BDD 结构 / 确定性时间 / 断言质量）
pnpm docs:check        # 文档一致性（链接 / README / i18n 配对）
pnpm i18n:check        # 双语与第三语言俄语键集一致性及 CJK 泄漏审计
pnpm emoji:check       # 手写源码无表情符号审计
pnpm libs:check        # 校验已提交 lib/ 产物与源码指纹一致性
pnpm coverage:check    # 覆盖率棘轮（Tier 2，各包按核数有界并发跑，上限二）
```

改动提交前至少跑 `pnpm typecheck && pnpm lint && pnpm test && pnpm test:standards && pnpm docs:check && pnpm i18n:check`；涉及聚合包或市场时运行对应 `pnpm aggregate:check` / `pnpm market:check`；皮肤、宠物与社区插件索引的门禁在各自的独立仓运行；CI 会全量跑所有门禁。

## 测试与门禁

业务测试纪律是仓库契约，由 `scripts/test-standards.mjs` 机械执行，规则与理由写在脚本头部：`no-arbitrary-sleep`（确定性时间用 `vi.useFakeTimers()` 配 `advanceTimersByTime()` 或带超时的 `waitFor`，不写 `setTimeout` / `sleep` 等待）、`no-ad-hoc-mock`（不用 `vi.mock` / `vi.spyOn` 打补丁，注入假实现或用真实后端）、`bdd-title`（`it` / `test` 标题以被测角色开头，如 `user ...`）、`given-when-then`（测试体写明前置条件、动作与可观察结果）、`call-count-only-assertion`（只断言调用次数不构成验证）、`tautological-assertion`（`toBeDefined()` 之类只重申值存在）。

历史测试按「文件 → 规则 → 计数」记入 `scripts/test-standards-baseline.json`：新测试文件从零基线开始，全部规则即刻生效；已有文件的计数只允许下降，修正后运行 `pnpm test:standards:write` 收紧基线。确需例外时在违规行尾或文件头部注释块写 `test-standards-allow: <原因>`，与 `i18n-allow:` 同一约定。

仓库工具测试（`scripts/`）只受机械规则约束，业务行为测试（`packages/`、`tests/`）适用全部规则；纯算法单测放在前者，用户可见行为放在后者。

覆盖率棘轮由 `scripts/coverage-gate.mjs` 执行：逐包跑 `vitest --coverage`，把 lines / statements / functions / branches 记入 `scripts/coverage-baseline.json`，任一指标低于基线超过 0.5 个百分点即失败（插桩本身有约 0.04 个百分点的抖动，故留容差），提升后运行 `pnpm coverage:write` 收紧。全部包都解析到 vitest 4.x；六个自带 vitest 的包同时声明同主版本的 `@vitest/coverage-v8`，其余包由根 devDependency 经 Node 解析提供；升级某包 vitest 主版本必须同步升级其 provider，否则门禁直接报错而不是静默跳过。门禁传 `--coverage.excludeAfterRemap`：内联了第三方依赖的构建产物（如聚合包的 shell bundle 内联 `@deepseek-ai/schemastery` 与 cosmokit）否则会把依赖自身的未映射文件算进该包，把 dsh-web-all 从约 92% 压到约 51%。生成副本不计入所属包的覆盖率：`scripts/sync-shared.mjs` 的 MANIFEST 把 `shared/client/settings` 与 `shared/host` 的模块逐字节复制进消费包，门禁经其 `copyEntries()` 派生 `--coverage.exclude`，把 `packages/<包>/` 下的每个副本从该包分母剔除（统一规则，不按文件挑选，MANIFEST 新增副本自动生效）；共享源的行为证据在 `shared/tests`（`settings-form`、`mount-once`、`plugin-settings-card`、`range-bubble` 等），由 shared 包自己的 vitest 随 `pnpm test` 运行，取舍见 [覆盖率只计本包代码](../.agents/notes/implemented/testing/2026-10-27-coverage-covers-own-code.md)。基线必须在 CI 侧也成立：包内有条件运行的测试（如 `dsh` 不在 PATH 时跳过的 benchmark 用例、解析不到已安装宿主时跳过的真实启动用例）会让本机覆盖率高于 Linux runner，两侧不一致时按 CI 的较低值记录。

门禁分两层：`ci.yml` 是 PR 门禁，把全部检查拆成三条并行通道——`Static checks`（文本规则 / lint / 类型检查 / 构建）、`Unit tests`（四个分片）、`Consistency gates`（已提交产物与文档一致性）——再由沿用旧名的 `CI checks` 汇聚 job 汇总，因此必需检查的墙钟是三条通道的最大值而不是总和；`nightly.yml` 是 Tier 2，每晚补充 PR 单趟看不到的证据——覆盖率棘轮与全量测试三连跑（flake 检测）。本地复现单个分片用 `node scripts/test-shard.mjs <分片> 4`，分片划分与权重表在 `scripts/test-shard.mjs`；取舍依据见 [CI 优化清单](../.agents/notes/implemented/process/2026-10-14-ci-parallel-lanes-and-optimization-checklist.md)。

测试环境里的 storage 由 `shared/vitest.setup.ts` 统一修好（Node 25 在全局定义了 `localStorage`，那个残桩会存活到 DOM 测试里，机理见该文件头部）；包自带的 vitest setup 必须接上它——用 `shared/vitest.config.ts`、import `shared/vitest.setup.ts`，或加进 `scripts/sync-shared.mjs` 的副本清单——否则该包在 Node 25 上跑的是降级路径，覆盖率随之偏低。

失败路径审计是业务特性的交付要求，以下分支必须各有测试，或在交付说明中写明其不可达：并发与幂等（重复提交、竞态、锁过期）、资源耗尽（余额不足、缺货、限流）、基础设施故障（死锁重试、事务回滚、连接中断）、第三方故障（假实现返回 500、网关超时、熔断降级）、校验与安全（越权租户、签名篡改、非法状态流转）。

## 常见任务

### 审核远程 PR

维护者可用 `node scripts/pr-review.mjs` 本地批量审核外部 PR（一次多个，
如 `--open` 审核全部 open PR）：先做静态硬性检查（规模上限新增/删除各
1 万行直接拒绝、禁止提交依赖缓存与密钥、emoji 扫描、PR 模板必填项、
密钥扫描、CI 文件保护），再在工作区 worktree 上按 CI 门禁序列构建验证
（序列与 `.github/workflows/ci.yml` 一致）。worktree 建在 `~/remote-e2e/pr-<N>`
（同 head 复用，跑完保留便于排查），定期用 `pnpm pr:review --cleanup` 或手动
`rm -rf ~/remote-e2e` 清理。

外部 PR 的模板硬检查含「测试证据与上游同步」与「视觉修复要求」：贡献者
必须提供自己本地测试的证据，并附上同步上游最新 `dev` 分支后重新测试
通过的证据；文本类改动可不附截图，视觉修复 / 用户可见变更必须附截图，
且视觉修复必须使用支持图像输入的多模态模型完成（纯文本模型如
deepseek-chat / deepseek-reasoner / gpt-3.5 直接拒绝）。缺失即 REJECT；
`.github/workflows/pr-contribution-rules.yml` 在 CI 侧同步拦截（评论 + 挂红）。

皮肤、宠物与社区插件索引的 PR 投到各自的独立仓（
`.github/workflows/reject-non-content-pr.yml` 会关闭投错仓库的 PR），
相应检查由那些仓库自己的 CI 跑；本仓的硬检查与视觉修复要求只针对本仓接收的改动。
用法与 verdict 语义见脚本头部注释；`pnpm pr:review --help` 查看全部选项。

### 修改 shared 运行时模块

shared/ 是 settings 卡片、轮询护栏、DSH_HOME 解析等跨包模块的唯一事实源；各包内的
同名文件是 scripts/sync-shared.mjs 生成的同步副本。改 shared 源后运行
node scripts/sync-shared.mjs 并把副本一并提交；pnpm test:scripts 的 drift 门禁防止副本漂移。

### 新增插件包

```sh
node scripts/dsh-plugin-new <name>   # 生成 packages/<name>/ 骨架
```

然后按 [plugins.md](plugins.md) 把包注册进聚合包（aggregate.yml 的
`patchFrom` 与 `deps`），跑 `node scripts/aggregate.mjs` 重新生成聚合包。
新包必须自带 README 三件套（`README.md` + `README.zh.md` +
`README.i18n.yaml`）与测试。

### 新增皮肤

皮肤与宠物的骨架、契约校验在各自的独立仓（dsh-skins / dsh-pet）内运行；本仓库消费
它们发布的 npm 包，市场内容取自 dsh-skins 子模块（钉版见
[market-inputs.lock.json](../market-inputs.lock.json)）。预览图由 `scripts/capture-previews`
直接写进该子模块的工作树：

```sh
node scripts/capture-previews <id>   # 重拍 satellites/dsh-skins/skins/<id>/preview/{light,dark}.jpg
pnpm market:fetch                    # 子模块 gitlink 指向新提交后，缓存输入过期并重新物化
pnpm market:build                    # 刷新市场产物（market/dist）
node scripts/skins-montage.mjs       # 重排根 README 皮肤一览图（docs/images/skins-montage.png）
```

预览图随皮肤源码提交在 dsh-skins 仓，本仓随后提交该子模块的新钉版与 `market/dist`，`pnpm market:check` 校验两者一致。要在提交进 dsh-skins 之前先看市场效果，用 `pnpm market:fetch --local --force` 读子模块工作树；由未 pin 内容生成的 `market/dist` 不得提交。
皮肤启用互斥由 dsh-skins 仓的 `dsh-skin use` 管理（客户端原子切换，不改
cordis.patch.yml）；skin-center npm 包只随附 `blue-fantasy`，其余皮肤由用户经
Workshop 按需安装到 `$DSH_HOME/skins/<id>/`。

### 本地验证（挂载进 dsh web）

```sh
node scripts/link-profile.mjs      # 把全家桶链接进 web profile
dsh plugin --profile web add link:<仓库绝对路径>/packages/dsh-web-all
dsh web                            # 重启后侧边栏出现插件入口
```

## 发布

发布流程见 [publish-prep.md](publish-prep.md) 与 .github/workflows/
release.yml：推送 vX.Y.Z tag 触发发布，tag 是版本唯一来源，
`scripts/verify-version.mjs` 在发布前校验每个包版本与 tag 一致。

### 多代理并行开发资源纪律

多子代理并发工作流（如 wave 批量实施、并行 worktree 开发）与本机 DSH Web GUI 共享同一台机器的 CPU 与内存。具体并发硬上限、worktree 管理与防卡顿规则见 [multi-agent-resources.md](multi-agent-resources.md)。

## 架构与跨包指引

- 架构总览与全景图见 [architecture.md](architecture.md)；
- 新插件脚手架与入桶流程见 [plugins.md](plugins.md)；
- 匿名安装遥测机制见 [telemetry.md](telemetry.md)；
- 双语文档配对契约见 [i18n.md](i18n.md)。

## 文档纪律

- 任何改动触及 README / AGENTS.md / docs/ 描述的行为时，同 PR 更新文档；
- 改包 README 任一侧后，同步另一侧并 `pnpm docs:write-pair <包名>`；
- 一次性记录（任务交接、验证快照）放 `docs/archive/`，不进长期文档目录。
