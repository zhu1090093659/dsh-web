# 开发流程（development）

dsh-web 是 DeepSeek Harness Web 的插件 monorepo（皮肤以「皮肤」插件的资产包形式存在）。本文定义
贡献者日常流程；仓库规则见根 [AGENTS.md](../AGENTS.md)，包级规则见
[packages/AGENTS.md](../packages/AGENTS.md)，文档标准见 [AGENTS.md](AGENTS.md)。

## 环境准备

- Node.js >= 22 与 pnpm 11；
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
pnpm typecheck         # 全仓类型检查
pnpm test              # 全仓单测
pnpm test:standards    # 测试纪律门禁（BDD 结构 / 确定性时间 / 断言质量）
pnpm docs:check        # 文档一致性（链接 / README / i18n 配对）
pnpm i18n:check        # 双语与第三语言俄语键集一致性及 CJK 泄漏审计
pnpm emoji:check       # 手写源码无表情符号审计
pnpm libs:check        # 校验已提交 lib/ 产物与源码指纹一致性
pnpm coverage:check    # 覆盖率棘轮（Tier 2，整仓约一分钟）
```

改动提交前至少跑 `pnpm typecheck && pnpm test && pnpm test:standards && pnpm docs:check && pnpm i18n:check`；涉及聚合包、市场或皮肤中心时运行对应 `pnpm aggregate:check` / `pnpm market:check` / `pnpm skin-center:check`；CI 会全量跑所有门禁。

## 测试与门禁

业务测试纪律是仓库契约，由 `scripts/test-standards.mjs` 机械执行，规则与理由写在脚本头部：`no-arbitrary-sleep`（确定性时间用 `vi.useFakeTimers()` 配 `advanceTimersByTime()` 或带超时的 `waitFor`，不写 `setTimeout` / `sleep` 等待）、`no-ad-hoc-mock`（不用 `vi.mock` / `vi.spyOn` 打补丁，注入假实现或用真实后端）、`bdd-title`（`it` / `test` 标题以被测角色开头，如 `user ...`）、`given-when-then`（测试体写明前置条件、动作与可观察结果）、`call-count-only-assertion`（只断言调用次数不构成验证）、`tautological-assertion`（`toBeDefined()` 之类只重申值存在）。

历史测试按「文件 → 规则 → 计数」记入 `scripts/test-standards-baseline.json`：新测试文件从零基线开始，全部规则即刻生效；已有文件的计数只允许下降，修正后运行 `pnpm test:standards:write` 收紧基线。确需例外时在违规行尾或文件头部注释块写 `test-standards-allow: <原因>`，与 `i18n-allow:` 同一约定。

仓库工具测试（`scripts/`）只受机械规则约束，业务行为测试（`packages/`、`tests/`、`desktop/`）适用全部规则；纯算法单测放在前者，用户可见行为放在后者。

覆盖率棘轮由 `scripts/coverage-gate.mjs` 执行：逐包跑 `vitest --coverage`，把 lines / statements / functions / branches 记入 `scripts/coverage-baseline.json`，任一指标低于基线超过 0.5 个百分点即失败（插桩本身有约 0.04 个百分点的抖动，故留容差），提升后运行 `pnpm coverage:write` 收紧。仓库当前并存两代 vitest，覆盖率 provider 按代声明：3.x 包各自声明 `@vitest/coverage-v8@^3.2.7`，4.x 包由根 devDependency 经 Node 解析提供；升级某包 vitest 主版本必须同步升级其 provider，否则门禁直接报错而不是静默跳过。

门禁分两层：`ci.yml` 是 PR 门禁，一次跑完全部检查；`nightly.yml` 是 Tier 2，每晚补充 PR 单趟看不到的证据——覆盖率棘轮与全量测试三连跑（flake 检测）。

失败路径审计是业务特性的交付要求，以下分支必须各有测试，或在交付说明中写明其不可达：并发与幂等（重复提交、竞态、锁过期）、资源耗尽（余额不足、缺货、限流）、基础设施故障（死锁重试、事务回滚、连接中断）、第三方故障（假实现返回 500、网关超时、熔断降级）、校验与安全（越权租户、签名篡改、非法状态流转）。

## 常见任务

### 审核远程 PR

维护者可用 `node scripts/pr-review.mjs` 本地批量审核外部 PR（一次多个，
如 `--open` 审核全部 open PR）：先做静态硬性检查（规模上限新增/删除各
1 万行直接拒绝、禁止提交依赖缓存与密钥、emoji 扫描、PR 模板必填项、
密钥扫描、CI 文件保护），再在工作区 worktree 上按 CI 门禁序列构建验证
（install/typecheck/market/skin-center/community/build/test/
test:scripts/aggregate/docs）。worktree 与 e2e 验证统一放在
`~/remote-e2e`（同 head 复用，跑完保留便于排查），定期用
`pnpm pr:review --cleanup` 或手动 `rm -rf ~/remote-e2e` 清理。

外部 PR 的模板硬检查含「测试证据与上游同步」与「视觉修复要求」：贡献者
必须提供自己本地测试的证据，并附上同步上游最新 `dev` 分支后重新测试
通过的证据；文本类改动可不附截图，视觉修复 / 用户可见变更必须附截图，
且视觉修复必须使用支持图像输入的多模态模型完成（纯文本模型如
deepseek-chat / deepseek-reasoner / gpt-3.5 直接拒绝）。缺失即 REJECT；
`.github/workflows/pr-contribution-rules.yml` 在 CI 侧同步拦截（评论 + 挂红）。

皮肤 PR 额外自动做视觉验证：生成亮/暗预览截图（
`~/remote-e2e/e2e-<pr>/previews/`），像素指标分析自动判定过曝
（太闪）与对比度不足（看不清），截图供视觉模型复核；同时提醒
作者声明贡献者版权（模板「贡献者版权声明」节），并检查新皮肤
是否提供 `preview/{light,dark}.png`（市场清单自动派生，缺图即警告）。
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

```sh
node scripts/dsh-skin-new          # 生成 packages/skins/skin-center/skins/<id>/ 纯资产骨架
node scripts/capture-previews <id>  # 重拍 preview/{light,dark}.png
pnpm market:build                # 刷新市场产物（market/dist）
node scripts/skins-montage.mjs    # 重排根 README 皮肤一览图（docs/images/skins-montage.png）
```

皮肤启用互斥由 `dsh-skin use` 管理（客户端原子切换，不改 cordis.patch.yml）；皮肤资产全部内置在皮肤中心包，不单独发 npm 包。

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
