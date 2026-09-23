# 梁神模式动态推理努力度——熔断触发式的有界恢复

> 本 note 记录 2026-09-20 对 [清理梁神模式动态推理努力度](2026-09-17-remove-liangshen-dynamic-reasoning-effort.zh.md) 的**部分修正**：推理档位调节以「平时零干预、仅在运行时退化信号触发时一次性降档」的形态恢复。原 note 的另外两项决定（移除设置卡档位控件、不保留休眠代码）**维持不变**——新逻辑不挂在设置卡上，而是作为熔断器 `guard.mjs` 的一个动作存在。

Status: implemented

## 新证据（原 note 之后出现）

原 note 删除动态推理努力度的第三条理由是「persona 熔断纪律已足以压制发散思维」。该理由被 2026-09-10 V4.1-Flash 发布后的新证据推翻：

- **DSH Discussion #5976**：v4.1-flash 在超长上下文 + max effort 下陷入思考退化死循环（回合零产出、无自动熔断、需手动中止），同配置 v4-flash 3000+ 步未复发。报告结论明确：这是模型侧生成退化，但暴露的 guard 层缺口「**可以被插件补上，不需要动 core**」。该场景下 persona 纪律完全失效——模型连纪律文本本身都已脱离有效上下文，唯一有效的是外力中断。
- **官方档位成本数据**（V4.1 模型卡/技术报告）：effort 25→100 时输出 token 约 2.5×，60–80 已恢复大部分精度，最后到 100 让轨迹变长 1.6–1.8×。「固定全程 high/max」与「固定执行 low」都不是最优；最优是**默认不动用户档位 + 退化时临时降一档**。
- **r/DeepSeek 实测（1whgo3e）**：工具调用死循环烧 token 时，把 reasoning effort 降下来即恢复。

## 修正后的形态

| 维度 | 原实现（已删） | 本次恢复的形态 |
| :--- | :--- | :--- |
| 介入时机 | 每个阶段边界都切换 | **仅熔断器检测到退化信号时**（连续零产出长思考、同参数重复失败），平时一行请求都不改 |
| 默认值 | 默认关闭的休眠配置 | 无常驻配置；降档是熔断动作的一部分，由 guard 触发自动发生 |
| 前缀缓存 | 每阶段边界都破坏 | 只在熔断瞬间破坏一次——此时会话已失控，缓存成本远低于死循环烧掉的 token |
| 降档目标 | 固定执行档 low | 当前档位的下一档（max→high→low），避免 low 档的懒惰/忘指令体感 |
| 设置卡 | 三个档位控件 | 不恢复，维持原 note 的简化 |
| 载体 | 独立 `reasoning-effort.mjs` | 并入 `guard.mjs`，经 `agent/request` 水位临时改写，窗口默认 3 个请求 |

## Decision

- 不恢复 `reasoning-effort.mjs` 与其设置卡控件；
- 在 `presets/liangshen/guard.mjs` 内实现「熔断触发 → 注入熔断消息 + 经 `agent/request` 水位把 reasoningEffort 降一档，窗口 3 个请求」；
- guard 对请求的改写严格限于已触发熔断的 episode 窗口内，无信号时为纯 pass-through，满足原 note 对前缀缓存与用户显式档位的约束。

## Consequences

- 梁神模式获得 #5976 形态的运行时保护，且日常会话的请求面与缓存行为与未装 guard 完全一致；
- 熔断阈值（连续步数、重复失败数、思考字符阈）刻意保守：误中断真实长思考比漏报更伤体验，具体取值留给 `packages/dsh-liangshen/tools/benchmark-live-run.mjs` 的会话回放标定（见 docs/liangshen-v41-community-feedback-update.md §4 P2-2）。
