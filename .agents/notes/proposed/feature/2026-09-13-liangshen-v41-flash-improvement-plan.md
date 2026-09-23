# Agent Note: LiangShen mode improvement plan for DeepSeek V4.1 Flash

Status: proposed

English | [中文](2026-09-13-liangshen-v41-flash-improvement-plan.zh.md)

## Problem

LiangShen combines a short persona, workspace instructions, a native anchor covering the entire first user turn, and PTC presentation from the second turn. The current evidence does not establish that this complete strategy improves DeepSeek V4.1 Flash task success. The tool catalog also describes the full registry during the anchor turn even though the request exposes only four tools. This contract mismatch should be corrected before evaluating performance.

This proposal builds on [four-tool anchoring and PTC contract refinement](../../implemented/feature/2026-09-12-liangshen-anchor-tools-and-ptc-refinement.md), [workspace instructions in the system prompt](../../implemented/feature/2026-09-12-liangshen-agents-md-in-system-prompt.md), and [minimal persona with an injected tool catalog](../../implemented/feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.md). Saving this proposal does not supersede those implemented decisions. If evaluation supports a different default, implementation will partially supersede the affected decisions and update their cross-links.

## Proposal

Improve verified task completion while reducing unnecessary tool calls, human intervention, and cost. Deliver the work in three independently reviewable changes: tool-contract correctness; evaluation tooling and candidate configurations; and a default-policy change supported by the results.

Limit implementation to the owning LiangShen preset, its evaluation tools, focused tests, and associated documentation. Reuse existing configuration and the official NPM SDK. Experimental variants use isolated preset copies rather than new user-visible preset registrations. Shell implementations and host-owned model routing remain outside this plan.

## Context & Efficiency Impact

A shorter persona may reduce instruction overhead, but token savings alone do not establish better performance. Retain workspace instructions, plan-mode rules, and complete SDK argument, return-value, and calling semantics. Remove repeated catalog or program guidance only after confirming that the retained authoritative contract covers its meaning.

Native tool schemas and PTC SDK text incur different overhead. Measure the actual assembled system prompt, injected messages, schemas, cache usage, output tokens, and total trajectory cost. Moving text between message roles does not remove it from model context, and a cache hit does not prove stable behavior.

Use the model's existing reasoning-effort setting to compare quality and cost after screening the tool strategies. Do not introduce a first-response token cap as an anchoring mechanism. Bound the evaluation as a whole by session count, timeout, and an explicit cost budget established from smoke measurements.

## Implementation stages

### 1. Freeze the baseline and acceptance measures

Record the repository commit, preset source hashes, DSH version, provider and model route, reasoning effort, task revision, permissions, and workspace state. Preserve the current implementation as a reproducible reference.

Use independently verified task success as the primary metric. Also record regressions, instruction violations, tool errors, human interventions, elapsed time, token usage, and total cost per successful task, including failed attempts. Keep `we/let me` classification only as diagnostic style data.

Completion: the same task can be repeated in an isolated environment, and the exact configuration differences between groups can be inspected.

### 2. Correct tool-catalog accuracy

Modify [tool-catalog.mjs](../../../../packages/dsh-liangshen/presets/liangshen/tool-catalog.mjs) so the native catalog declares only the tools exposed by the current request. Under PTC, distinguish the directly callable `run_code` transport from tools callable through the SDK. Keep the complete official contract and correct stale statements such as the first turn having only a shell.

Preserve fallback, compaction recovery, and per-session isolation. Extend [tool-catalog.test.ts](../../../../packages/dsh-liangshen/tests/tool-catalog.test.ts) around first-turn multi-step execution, promotion, unavailable code runtime, failed presentation, resume, and compaction. Reuse existing coverage where it already proves the required behavior.

Completion: the catalog agrees with the actual request surface and invocation method; a native fallback never continues to advertise PTC. All subsequent experimental groups share this correctness fix.

### 3. Prepare independent prompt and tool-strategy candidates

Apply the candidate persona to experimental copies of [agent.cordis.yml](../../../../packages/dsh-liangshen/presets/liangshen/agent.cordis.yml):

- Remove the restriction against reasoning through concrete implementation.
- Replace immediate exit on a thinking loop with changing approach or using tools when repetition produces no new evidence.
- Express PDCA as inspecting relevant code, making the smallest sufficient change, and verifying the result.
- Preserve existing comments and add explanations only where behavior is not obvious.
- Retain workspace instructions, plan-mode policy, and the official SDK contract.

Candidate wording:

```text
Understand the task and inspect relevant files before making changes.
Make the smallest change that satisfies the requirements and workspace instructions.
Reason as deeply as needed, avoiding repetition without new evidence.
Use tools to test uncertain assumptions and verify the result.
Preserve existing comments and explain non-obvious behavior where necessary.
Finish when the requested outcome is verified; report remaining limitations.
```

Reuse `anchorTools` and `ptcPresentation` to vary tool strategy. An empty anchor list with PTC disabled exposes the full native roster; it is not equivalent to official Minimal or a newly curated minimal toolset.

Completion: prompt wording, anchoring, and PTC presentation can be varied independently without adding a user-visible preset.

### 4. Extend the runner and execute staged A/B evaluation

Extend [benchmark-live-run.mjs](../../../../packages/dsh-liangshen/tools/benchmark-live-run.mjs). Its default directory-listing and file-creation tasks are protocol smoke checks, not evidence of general coding gains. Keep [analyze-session.mjs](../../../../packages/dsh-liangshen/tools/analyze-session.mjs) style measurements separate from task outcomes.

| Group | Persona | Tool strategy | Comparison purpose |
| --- | --- | --- | --- |
| B | Current | Current two-stage strategy | Baseline after the shared correctness fix |
| P | Candidate | Current two-stage strategy | B versus P isolates persona changes |
| T | Candidate | PTC from the first turn | P versus T tests whether anchoring helps |
| N | Candidate | Native tools throughout | T versus N compares presentation |
| M | Official Minimal | Official configuration | External reference, not single-factor attribution |

Run the evaluation in this order:

1. Run at most 12 smoke sessions to validate the protocol, result collection, and cost estimates.
2. Select 20–30 representative tasks, with at least three repetitions per group. Cover code repair, tasks requiring specialized tools in the first turn, multi-turn edits, failure recovery, and workspace-instruction compliance.
3. Keep the model route, reasoning effort, permissions, and starting repository state fixed during the main comparison. After screening, separately compare `high` and `max` for the surviving candidates.
4. Set total-cost, session-count, and timeout limits from the smoke estimates before the larger run. Stop at the limits rather than expanding automatically.
5. Verify results with tests, resulting files, or explicit acceptance checks. Record infrastructure failures separately and publish their treatment in the report.
6. Compare paired tasks and report confidence intervals. Treat small samples as screening evidence; expand within the agreed budget before claiming a stable improvement.

Completion: the report identifies whether a difference comes from the persona, anchoring, or PTC, and whether the gain justifies its cost. Full native presentation must not be reported as Minimal.

### 5. Select defaults and complete delivery

Choose defaults in this order: task success; instruction compliance and human intervention; then cost and elapsed time.

- If removing anchoring performs better, retain anchoring as an experimental configuration.
- If native presentation and PTC suit different workloads, retain configurable selection and document the observed task categories.
- If the evidence cannot rule out regression, ship the contract fix and retain the current default strategy.

Update the package README pair, pairing record, and relevant Agent Notes. Save the evaluation report under `docs/archive/`. Raw credentials and private session content do not belong in the committed report.

Run the owning package tests and the required `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, and `pnpm i18n:check` gates at delivery, adding generation and build-artifact checks according to the final diff. For the current document-only save, validate Markdown structure, links, bilingual pairing, and whitespace.

Use isolated headless sessions for evaluation. Do not interrupt or restart the running DSH service. If a shipped preset-composition change requires reloading, state that the user must restart DSH for it to take effect.

Completion: the chosen configuration has reproducible evidence, documentation matches the delivered behavior, and the required checks have actual recorded results.

## Evidence references

The [DeepSeek R1 paper](https://arxiv.org/html/2501.12948v1), [DeepSeek V3.2 paper](https://arxiv.org/html/2512.02556v1), [V4.1 Flash technical report](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/DeepSeek_V41_Tech_Report.pdf), [official V4.1 Flash model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash), and [thinking-mode API documentation](https://api-docs.deepseek.com/guides/thinking_mode/) inform the candidate strategies. These sources do not evaluate this project's current LiangShen composition.

The [anchored-standard source project](https://github.com/xiaobright/dsh-anchored-standard) describes its V4 Pro focus and the limits of its Flash evidence. Its observations motivate an experiment rather than a presumed V4.1 Flash improvement.

## Alternatives considered

Immediately disabling anchoring and PTC as the new default is deferred: existing evidence does not establish a universal winner, and changing both at once would obscure their separate effects.

Switching every session to PTC is not selected as a universal policy: its batching and result-filtering benefits need to be weighed against task success and tool-contract overhead.

Restoring a 1024-token bootstrap cap or using `we/let me` as a promotion or success signal is not selected: truncation and output style do not establish correctness.

Removing workspace instructions or shortening SDK schemas to reproduce a bare Minimal prompt is not selected: necessary instructions and tool semantics are part of the task contract.

Building a new evaluation framework or registering separate public presets is not selected: the existing runner and configuration fields can express the required comparisons with a smaller change.

## Acceptance criteria

- Native and PTC catalog declarations match the actual request surface, including first-turn execution, fallback, resume, and compaction.
- Existing workspace-instruction, plan-mode, SDK-contract, and session-isolation behavior remains covered.
- Every comparison records the source and runtime configuration, uses independently verified outcomes, and keeps style metrics separate.
- The report covers uncertainty, infrastructure failures, cost limits, and the trade-off between quality and resources.
- Default changes follow the stated evidence rule; uncertain results retain the current strategy.
- Documentation pairs, decision records, and applicable validation evidence accompany implementation.

## Risks

Small or unrepresentative task sets may select a configuration that regresses other workloads. Provider routing and model updates can also change results, so runs must record their date and route and stay close enough in time to support comparison.

Prompt and tool changes can interact. The proposed matrix isolates selected comparisons but does not establish every interaction; a winning combination may need a focused follow-up before becoming the default.

PTC can reduce intermediate output while omitting evidence needed for the next decision. Removing anchoring can expose more schemas immediately. Both effects require measurement rather than assumptions about shorter prompts.

The full proposed sample can be expensive. Smoke estimates and explicit limits must determine the executable budget before paid evaluation begins. This document records a plan; it does not record completed implementation or live A/B results.
