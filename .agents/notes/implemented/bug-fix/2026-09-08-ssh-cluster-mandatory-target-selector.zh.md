# Agent Note: ssh_cluster 强制目标筛选选择器防护 (Issue #1417)

状态: 已实现

## 问题背景

在 `dsh-ssh` 插件中，`ssh_cluster`（集群并发命令执行）此前允许在过滤条件完全为空（`aliases`、`environment` 与 `tags` 均未传或全为空）的情况下发起执行。在此状态下，执行引擎、HTTP 路由以及智能体工具层默认均以**全部已配置的主机**作为执行目标。

在自主智能体（AI Agent）运维场景下，一旦大模型因推理省略、参数丢失或上下文混淆未提供过滤项，带有破坏性或变更性质的 Shell 命令将无差别且静默地并发广播到所有远程主机（包括生产集群），造成极大的误伤与安全灾难。

## 决策方案

在全链路各层建立纵深防御体系，强制要求显式目标选择器：

1. **引擎层防御 (`src/engine/cluster.ts`)**：
   - `cluster()` 校验 `aliases`（非空字符串）、`environment`（非空字符串）与 `tags`（非空字符串）至少一项存在；
   - 若全部为空，直接抛出异常：`Error('ssh_cluster requires aliases, environment, or tags to limit the target set')`。
2. **HTTP 路由层拦截 (`src/routes.ts`)**：
   - 在 `/api/dsh-ssh/cluster` 路由入口处进行参数校验，缺失有效 selector 时直接响应 `400` 并附带相同错误提示，避免无谓的引擎调用。
3. **Agent 工具定义与校验 (`src/tools.ts`)**：
   - 更新 `ssh_cluster` 工具描述及各个参数的 docstring 说明，明确指出 `aliases`、`environment` 或 `tags` 必须至少指定一项；
   - 在 `execute` 执行阶段增加非空校验保护。
4. **模型 GUIDANCE 与多语言文案 (`src/index.ts`、`locales.ts` 与 `dsh-i18n`)**：
   - 同步更新系统提示词 `SSH_GUIDANCE`，明确集群执行需通过非空 selector 筛选；
   - 更新前端 UI 占位符 `cluster.aliases`，将“留空为全部”修正为提示至少填写一项过滤，并在中、英、俄三语字典中保持严格对齐。

## 测试验证

- 更新 `packages/dsh-ssh/tests/engine-cluster.test.ts`：增加空 selector 拦截断言，并为原 `maxWorkers` 测试用例传入显式别名参数；
- 更新 `packages/dsh-ssh/tests/routes.test.ts`：增加路由层 400 拦截与合法参数 200 响应测试；
- 更新 `packages/dsh-ssh/tests/tools.test.ts`：增加工具层 `execute` 拦截断言与文档说明字符串断言；
- `dsh-ssh` 全量 20 个测试套件、155 项单元测试全部通过；
- 通过全部门禁校验：`pnpm typecheck`、`pnpm i18n:check`、`pnpm docs:check`、`pnpm skin-center:check`、`pnpm aggregate:check`。

## 影响

彻底杜绝了模型或前端因省略参数而意外全量执行远程命令的高危隐患。如需跨主机执行，调用方必须通过明确的别名、环境或标签指定生效范围。
