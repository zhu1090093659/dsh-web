# Agent Note: 梁神模式植入有界检查与主动收敛纪律

Status: implemented

## Problem

在非 Plan 模式的常规会话中，梁神模式（`dsh-liangshen`）预设内置的工作纪律（Thinking Disruption 与 Action-Oriented）要求模型在缺少事实时严禁在思考区推演猜测，必须立即闭合思考并调用原生检测工具（`read`/`grep`/`bash`）。

然而，由于缺少终止与主动收敛约束，当模型阅读目标文件并发现其中引用了其他外部模块或符号时，易触发单向正反馈循环：模型不断认为“细节事实不足”，进而顺着依赖链路逐层向下翻读，导致在使用者未介入敲打的情况下出现持续不断的重复读文件现象（失敛死循环）。

## Decision

在 `presets/liangshen/agent.cordis.yml` 的 Persona `prefix` 纪律中新增一条明确的有界检查与主动收敛准则：

```text
- Bounded Inspection & Convergence: Do not traverse dependency chains unbounded. Limit pre-action inspection to immediate target files (at most 2-3 inspection turns). Once core context is understood, immediately converge and begin answering or making edits. Verify edge cases during post-edit testing rather than over-reading upfront.
```

- **限定探索步数与范围**：禁止无限制遍历调用链，将动作前的前置检查严格限制在直接目标文件（至多 2~3 轮检查）；
- **强制主动收敛**：一旦建立基本核心认知，必须立即收敛，直接输出回答或进入代码编辑阶段；
- **测试闭环验证**：遵循 PDCA 循环，将细枝末节与边界情况的验证推移到编辑后的测试与运行阶段验证，避免前期过度阅读。

同步更新 `src/index.ts` 中的 `LIANGSHEN_GUIDANCE` 文案，并在 `tests/preset-composition.test.ts` 中固化该纪律断言。

## Alternatives considered

- 仅依靠使用者在 Prompt 中自行提醒。否决：预设本身的缺陷应在预设层面提供健全兜底，不能强迫用户每轮对话都附加防御性提示。
- 强制通过代码在工具调度层面硬截断调用次数。否决：硬性截断会破坏模型合法的大规模批处理场景，且属于运行期侵入性修改；通过 Persona 工作纪律引导符合梁神模式的纯提示词极简哲学。

## Consequences

- 梁神模式在非 Plan 模式下具备了明确的退出与收敛刹车，避免顺着依赖链路无休止翻读文件。
- 模型在获得局部足够信息后会更果断地开始编码或作答，将探索成本转移为后续测试验证成本。
- 系统提示词长度微幅增加一条规则，仍在极简 Persona 范畴之内。

## Testing

- `packages/dsh-liangshen/tests/preset-composition.test.ts` 钉住新增的 `Bounded Inspection & Convergence` 纪律行。
- `pnpm --filter @linxin666/dsh-liangshen test` 全套 18 个测试文件、295 个单测全部通过。
- 全仓构建与类型检查 `pnpm build && pnpm typecheck && pnpm libs:check` 验证通过。
