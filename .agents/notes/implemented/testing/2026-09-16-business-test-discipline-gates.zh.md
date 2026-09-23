# Agent Note: Business test discipline as machine-enforced gates

Status: implemented

## Problem

测试规模很大（406 个文件、约 4,400 个测试），但「什么样的测试算好测试」只存在于评审习惯里：58 个文件里有 113 处任意等待，31 个文件里有 161 处临时 mock 或 spy，3,991 个测试的标题没有指明被测角色，没有任何测试体写明 Given/When/Then 结构，另有 712 处断言质量问题（只断言调用次数、只重申值存在）。没有任何机械检查阻止下一个违规，于是每次评审都要重复争论同样的点。

已有三道门禁也不完整。双语字典门禁（pnpm i18n:check，单测在 scripts/i18n-audit.test.mjs，根说明要求合入前执行）没有被任何 workflow 引用，只在贡献者自己记得时才跑。表情符号规则是 ci.yml 里的内联 Python heredoc：逻辑正确，但没有测试、无法通过仓库脚本本地运行，而且报的是字符下标而非行列。仓库也完全没有覆盖率度量，因此「一个改动」和「一个删掉证据的改动」无法区分。

## Decision

- scripts/test-standards.mjs 是业务测试纪律门禁，对每个测试文件执行六条规则：no-arbitrary-sleep、no-ad-hoc-mock、bdd-title、given-when-then、call-count-only-assertion、tautological-assertion。每条规则及其理由写在脚本头部，门禁在失败处自带解释。
- 门禁对每个源文件扫描三个等长视图（原文、去注释但保留字符串内容、以及字符串内容一并遮蔽），因此 fixture 字符串里的 setTimeout( 或测试标题里的括号既不能掩盖违规，也不会打乱代码块匹配。
- 历史违规按「文件 → 规则」记入 scripts/test-standards-baseline.json（367 个文件、8,968 处违规）。新测试文件从零基线开始、适用全部规则；已有文件不允许计数上升；计数下降的文件会被报告，用 pnpm test:standards:write 收紧基线。
- 规则作用域按 lane 划分：packages/、tests/、desktop/ 下的业务行为测试受完整契约约束；scripts/ 存放仓库工具，其测试是纯函数的普通单测，因此只受机械规则约束。
- 已记录的例外使用 "test-standards-allow: <原因>" 标记：写在同一行行尾，或写在文件头部注释块中，与既有 i18n-allow 约定一致。
- scripts/emoji-audit.mjs 用经过评审、带单测的 Node 门禁取代内联 Python 表情符号步骤，本地以 pnpm emoji:check 运行。它保留相同的码点区间与排除目录，报 file:line:column 而非字符下标，并跳过任何非严格 UTF-8 的内容，因此工作区里未跟踪的视频渲染产物或打包 tarball 不会让它失败。
- scripts/coverage-gate.mjs 是覆盖率棘轮：对每个插件包运行 vitest 覆盖率，把 lines / statements / functions / branches 逐包记入 scripts/coverage-baseline.json，任一指标低于记录值超过 0.5 个百分点即失败——插桩并非逐位稳定（两次完全相同的整仓运行在某个包上相差 0.04 个百分点）。覆盖率 provider 按 vitest 主版本声明：六个 3.x 包各自声明 @vitest/coverage-v8@^3.2.7，4.x 包由根 devDependency 经 Node 解析提供。
- ci.yml 现在会跑此前缺失的 pnpm i18n:check、新增的 pnpm test:standards，以及取代 Python heredoc 的 pnpm emoji:check。
- .github/workflows/nightly.yml 是 Tier 2 lane：覆盖率棘轮加全量测试三连跑，后者用于区分「持续坏的测试」与「偶发 flake」。
- docs/development.md 承载测试规则、基线机制、分层与失败路径审计清单；根说明列出新命令，并要求合入前执行 pnpm test:standards。

## Alternatives considered

- 不做基线，直接对全仓强制六条规则。这等于要求在一次改动里重写 3,991 个测试标题和全部测试体，否则门禁永远红；增量执行才让规则今天就能生效。
- 用行内容指纹或 diff 变更行来匹配违规。指纹在每次重排或格式化后都会变动，基于 diff 的判定又会让本地与 CI 语义分叉；按文件、按规则计数稳定，且各处运行结果一致。
- 把规则做成 ESLint 规则（例如 vitest 插件）。仓库没有 ESLint 工具链，为 23 个包引入它比这六条规则本身更大；本仓库既有的做法是 scripts/ 下经过评审并带 node:test 单测的脚本，scripts/i18n-audit.mjs、scripts/verify-docs.mjs、scripts/lib-artifact-check.mjs 都是如此。
- 把规则做成只报告不拦截。要解决的问题正是评审压力，而只报告的结果就是被忽略。
- 每个 PR 都跑覆盖率棘轮。它要在插桩下重跑整个测试套件（十核本机 65.6 秒），而 PR lane 已经跑过一次套件；棘轮属于 Tier 2 工作，按夜与手动执行。
- 给 PR lane 加基于影响的测试选择。十核实测全仓测试 43.6 秒、全仓类型检查 27.2 秒，lane 的墙钟时间由 install 与 build 主导；引入受影响包依赖图等于为了几秒钟多维护一层映射。
- 在 Tier 2 里加 dsh-market.com 线上契约检查。工坊客户端与市场 worker 同属本仓库、一起部署，线上形状检查主要是在重复验证我们自己的部署；真正独立的依赖是钉住版本的 @deepseek-ai SDK cohort 与 npm registry，已由 runtime-deps:check 与发布时的 registry 校验覆盖。
- 在全部 23 个 manifest 里声明 @vitest/coverage-v8。只有六个 3.x 包需要自己声明，根 devDependency 已经为所有 4.x 包解析到 provider；多出的 17 条纯粹是维护面。

## Consequences

- 在 packages/、tests/ 或 desktop/ 下新增或修改测试，必须以角色关键字开头并写明前置条件、动作与结果，否则该 PR 直接变红。机械规则约束所有测试文件，包括工具 lane。
- 基线是债务账本而非目标：367 个文件、8,968 处违规。减少一处并用 pnpm test:standards:write 重新记录是棘轮；接受新债务同样需要在评审中留下这次可见的编辑。
- 覆盖率基线覆盖 21 个包，仓库总计 lines 56.64%、statements 56.14%、functions 69.8%、branches 67.74%。90% 分支覆盖率是方向而非现状；门禁的职责是阻止数字下降，逐包表格就是待办清单。分支覆盖率最低的是 dsh-market 56.47%、skin-center 56.99%、dsh-remote-web-ui 58.14%、dsh-preset-center 60.75%、dsh-session-archive 60.65%。
- PR CI 增加三步。其中两步是对全树的文本扫描，第三步取代了原有的 Python 步骤，因此 lane 成本只有几秒。
- nightly lane 增加一个定时 workflow，含 30 分钟的覆盖率 job 与 45 分钟的 flake job。它的首次定时运行即其验收运行；workflow 通过 actionlint，两个 job 的命令均在本地执行过。
- 升级某个包的 vitest 主版本现在必须在同一次改动里升级其覆盖率 provider；provider 不匹配会让 nightly 门禁大声失败，而不是静默不上报。
- 表情符号门禁的排除集合现在也覆盖被 git 忽略的本地产物（coverage、playwright-report、test-results、.codegraph、.zcode、.pnpm-store、.wrangler、gui-test-screenshots），因此刚跑过 Playwright 的工作区与干净的 CI 检出报告一致。

## Testing

- pnpm test:scripts 通过，新增三份测试：scripts/test-standards.test.mjs（27 个测试，覆盖扫描器、测试提取、六条规则、豁免、lane 划分与基线比较）、scripts/emoji-audit.test.mjs（11 个测试，覆盖码点规则、路径范围、行列上报与严格 UTF-8 门禁）、scripts/coverage-gate.test.mjs（14 个测试，覆盖指标提取、回归比较及其容差、加权总计、序列化与包发现）。
- pnpm test:standards 对已记录的基线通过；一个加入任意等待与非角色标题的探针 spec 会以三组新违规失败，并指出具体行号。
- 取代内联 Python 的 Node 表情符号门禁与其结果一致：两者扫描同样的手写源码并报告 0 处违规（Node 版补上了 Python 通过解码异常隐式获得的严格 UTF-8 跳过）。
- pnpm coverage:check 跑完整个包群：21 个包，没有包无法产出覆盖率，基线即由该次运行写入。
- actionlint 通过 .github/workflows（含新增 nightly.yml）；pnpm docs:check 与 pnpm i18n:check 通过。
- 未验证：nightly.yml 的真实定时运行。定时触发器无法在本地触发，其首次夜间执行即为其验收运行。
