# dsh-liangshen — 梁神模式（两阶段锚定 agent preset）

[English](README.md) | 中文

把「Anchored Standard」preset 做成 DSH 全家桶里的一键安装插件：Host 启动时把内置 preset 同步到 `~/.dsh/.agent-presets`，新建会话即可在预设选择器中选择「梁神模式」。首轮模型请求只看到官方 Minimal 精确双工具——持久 `bash` 与 `str_replace_editor`——与一行 persona，没有运行时上下文和指令注入；锚定建立后 wire 切换为 Code Mode（PTC），并开放全部 prompt section 与常规注入。全部通过官方 NPM SDK 实现，不修改 DSH 源码。

## 原理

DeepSeek V4 Pro 会强烈依赖 API 中可见的**首轮工具目录**选择执行轨迹。社区评测（[xiaobright/modeltest](https://github.com/xiaobright/modeltest)）中，Standard / PTC 只有 91/92 分，Minimal 达到 99/96，但 Minimal 只有两个工具。两阶段方案把「首次轨迹选择」与「后续完整工具能力」拆开：

1. 首轮模型请求只暴露官方 Minimal 精确双工具（持久 `bash` 与 `str_replace_editor`），只保留 `deployment:persona` 一个 prompt section，清空运行时上下文，并且只放行用户自己的消息；
2. 会话出现首次持久 `tool/call` 后，晋升会等到首个 reasoning 块呈 minimal-like（包含 `we` 且无 `let me`）才发生，四步兜底；随后 wire 切换为 Code Mode（PTC）——只暴露一个 `run_code`，完整工具注册表通过生成的 SDK 调用——并恢复全部 prompt section（含 plan mode 的 `plan:policy`）以及 workspace 指令、skill 目录与运行时快照等常规注入；
3. 阶段从持久化 session events 推导，resume / reload 不丢失状态。

Windows 原生环境实测（DeepSeek V4 Pro、max、V4.1b 题面）：98 / 99，均值 98.5，第二轮全程无 `let me` 痕迹，证明不是抽卡，也不需要牺牲完整工具能力。原始实验 preset：[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)。

## 稳定化控制

preset 在参考机制之上内置了额外保护，全部在 `agent.cordis.yml` 的 `tool-bootstrap` 段配置：

- `anchorGate`：首次 `tool/call` 后，目录继续保持双工具，直到首个 reasoning 块被判定为 minimal-like，避免 `Let me` 开局立刻拿到完整目录；
- `maxBootstrapSteps`：N 步后仍无锚定块时强制晋升；
- `promoteAfterFirstResponse`：首轮无工具调用的回答在响应后自动晋升；锚定门控中的会话也会在首轮结束时（`turn/end`）释放，因此新用户轮次一开始就拿到晋升后的目录；
- `promotedPresentation: code`：晋升后 wire 为 Code Mode（PTC）——一个 `run_code` 工具、完整注册表通过生成 SDK 调用；切换发生在 step 边界，不会打断当前步的原生工具调用；
- `deferredSources` + `deferredGraceSteps`：workspace 指令与 skill 目录在晋升后再等一步注入，工具目录切换和注入冲击不同时落地；
- `bootstrapMaxTokens`：phase 1 请求的输出预算封顶（社区实测 `max_tokens=1024` 是 "We need" 轨迹的高命中窗口，DSH 默认 256k 命中率为 0），晋升后自动剥离该封顶，避免 `requestProposal` 把 1024 焊进后续每个请求；
- `phase1FirstCallInstruction`：追加到 phase-1 persona 的可选一行指令，默认关闭：测试版本用它要求模型在正式作答前先做一次 Minimal 原生工具调用，让首轮能力类提问在晋升后的完整目录下作答，而不是基于被裁剪的双工具视图回答。因为它偏离了逐字节一致的 Minimal 表面，所以默认不开启。

已支持 plan mode：phase 1 会把 prompt sections 过滤为仅剩一行 `deployment:persona`，晋升后恢复全部 sections 并在 persona 末尾追加所选工作区路径，因此 Agent 明确自己的工作目录，plan-mode 的 `plan:policy` 也在晋升后的每一步都生效。

## 安装

```sh
# 方式一：全家桶（推荐）
dsh plugin --profile web add @linxin666/dsh-web-ui-all

# 方式二：单独安装
dsh plugin --profile web add @linxin666/dsh-liangshen

# 两种方式二选一：聚合包与独立 @linxin666/dsh-liangshen 都会挂载本 preset。
# 需要在两者之间切换时，先 dsh plugin remove 移除另一个再安装：
dsh plugin --profile web remove @linxin666/dsh-liangshen
```

装完**完整重启 `dsh web`**，新建空 session，预设选择「梁神模式」。插件会在启动时把 presets 同步进 `~/.dsh/.agent-presets`（升级插件后重启即自动更新）。

## 验证

导出 session JSONL，检查 `request/header`：

- 第一份 header 应只有 `bash/str_replace_editor`（持久 shell + 沙箱化编辑器）；
- 第一轮应只包含用户自己的消息：没有 workspace 指令 baseline、没有运行时快照、没有 skill 目录消息，并且只有 `deployment:persona` 一个 prompt section；
- 首次工具调用后，下一份变更 header 应恰好为 `run_code`（PTC）；运行时快照与全部 prompt section 随该步出现（含 plan mode 的 `plan:policy`，且 persona 末尾带有所选工作区路径），workspace 指令与 skill 目录再晚一步出现；
- phase 1 编辑器写入受宿主文件沙箱策略约束，不存在裸本地文件系统绕过；
- 此后的请求保持 `run_code`。

不读原始 reasoning 也能测量轨迹漂移：

```sh
node tools/analyze-session.mjs <导出的 session.jsonl>
```

## 行为与限制

- 第一次模型响应如果没有调用工具，在响应后即自动晋升；锚定门控中的会话也会在首轮结束（`turn/end`）时释放。释放判定发生在 prompt assemble 阶段，所以新用户轮次一开始就拿到晋升后的 PTC 目录，其消息也不会再被剥离；
- 首次工具调用后，晋升等待首个 minimal-like reasoning 块或 `maxBootstrapSteps` 兜底，先到者生效；
- 工具执行即使失败，只要 `tool/call` 已持久化，仍计入晋升条件；
- phase 1 只保留 `deployment:persona` prompt section；晋升后恢复全部 assembled sections 并在 persona 末尾追加所选工作区路径（`Your working directory is <cwd>.`），因此 Agent 会在选中的工作区工作，plan mode 的 `plan:policy` 也在晋升后生效；
- workspace 指令、skill 目录与运行时快照在首轮不注入；快照随 PTC 目录出现，前两者再晚一步出现；
- phase 1 文件工具继承宿主文件沙箱（不挂载裸 `dsh-fs-local`）；
- phase 1 的持久 `bash` 会替代 Standard 的一次性 shell 直到会话结束（两个工具都注册 `bash` 名字）；
- phase 1 有意只显示 Minimal 双工具，因此首轮能力类提问（如「你能联网吗」）可能基于被裁剪的视图作答、晋升后再被纠正；可开启 `phase1FirstCallInstruction`（见稳定化控制）要求先做一次 grounding 工具调用，或首轮直接问任务类问题避免该错位；
- 工具目录只变化一次，因此第一、二次请求之间会发生一次前缀缓存变化；
- preset 与 shell 访问具有相同信任等级，安装前可自行审阅 `presets/`；
- 插件不发起网络请求，也不增加遥测；
- 不要在已经产生内容的会话中途切换 preset；
- 需要 DSH 0.1.0-rc.5+（preset 机制与 `system-prompt/assemble` 钩子）。

## 许可

插件本体 Apache-2.0（zhu1090093659）。`presets/liangshen/agent.cordis.yml` 基于 DeepSeek Harness 内置 Minimal 与 Standard preset 修改，`tool-bootstrap.mjs` 来自 xiaobright/dsh-anchored-standard，均为 MIT，版权与许可声明见 preset 的 `NOTICE`。
