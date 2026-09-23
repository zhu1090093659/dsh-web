# Agent Note: 梁神模式现代化重构与精简

Status: implemented

部分取代[梁神模式面向 DeepSeek V4.1 Flash 的原生重构](../feature/2026-09-16-liangshen-v41-flash-native-rebuild.zh.md)与[梁神 shell 与分页决定](../feature/2026-09-17-liangshen-shell-and-paging-ptc-surface.zh.md)：彻底移除 `reasoning-effort` 插件，将 PTY 持久终端替换为上游标准 Stdio Shell（`tool-bash` / `tool-pwsh`），出厂呈现方式转正为 `both`，工具默认全量常驻不分页，并将压缩截断阈值放宽至标准预算。

## Problem

梁神模式此前积累了若干影响真实运行体验的工程摩擦：
1. **动态推理努力度弊大于利**：`reasoning-effort.mjs` 试图分阶段切换推理档位，破坏服务端前缀 KV Cache 命中率，静默覆盖模型选择器选项，且出厂默认关闭。
2. **PTY 终端卡片展示丑陋**：`tool-pwsh-persistent` 缺少 `description` 参数，直接展示原始长命令，且在 Windows 下存在终端转义符杂音。
3. **强制 PTC 脚本导致基准滑坡**：出厂固定为 `presentation: 'ptc'`，逼迫所有操作写 JS 脚本，相比原生 DSML 产生 5% 的基准下滑。
4. **人工分页交互割裂**：`pagedToolPatterns: ['mcp__*']` 导致 CodeGraph 等 MCP 工具无法直接调用，必须先调 `tool_activate` 空耗一轮。
5. **修剪阈值过于激进**：4096 字符截断阈值经常误切正常测试日志和报错堆栈的中间核心部分。

## Decision

对梁神模式进行系统性精简与现代化升级：
- **清理动态推理**：删除 `presets/liangshen/reasoning-effort.mjs` 及其配置、表单和单测。
- **换回标准 Stdio Shell**：在 `agent.cordis.yml` 中挂载上游标准 `@deepseek-ai/dsh-tool-bash` 与 `@deepseek-ai/dsh-tool-pwsh`，恢复带主动语态描述的标题卡片与确定性退出码。
- **呈现模式默认设为 `both`**：原生工具与 `run_code` 同驻，日常使用原生探索，保留 `run_code` 算力通道。
- **重塑 Persona 纪律**：新增 `Parallel Inspection`（单轮并发探索协议）与 `Shell Discipline`（无状态子进程的复合命令与 workdir 规范）。
- **默认全量常驻不分页**：`pagedToolPatterns: []`，移除 `tool-activate` 行，核心 MCP 首轮直接可用。
- **放宽压缩修剪阈值**：`tool-result-pruner` 调整为 8192（前 4096 / 后 1024）。

## Alternatives considered

- **保留 PTY 终端**：否决。Windows 下 PTY 字符杂音多且不支持生成简短标题卡片。
- **保持 PTC 为唯一模式**：否决。官方基准证实原生调用具备更高的完成率，原生并发能在免写脚本的前提下达成相同的轮次压缩。

## Consequences

- 梁神模式会话获得整洁的主动语态终端卡片、原生多工具并发支持与开箱可用的 MCP 体验。
- 模型选择器的推理档位全局生效，前缀 KV Cache 保持 100% 稳定性。
- 宿主下次启动时自动同步并清理旧文件。

## Testing

- 单元测试：`packages/dsh-liangshen` 全部 18 个测试文件（295 个测试）通过。
- 类型检查：`pnpm typecheck` 全仓 0 错误。
- 格式检查：`git diff --check` 0 警告通过。
- 文档与国际化：`pnpm docs:check` 与 `pnpm i18n:check` 100% 对齐通过。
- 产物校验：`pnpm libs:check` 指纹完全一致。
