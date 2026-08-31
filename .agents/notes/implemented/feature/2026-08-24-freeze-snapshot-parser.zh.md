# Agent Note: 冻结请求解析器与脱敏/污点安全门

Status: implemented

## Problem

续接卡片需要一座可信的桥，把 agent 的自由文本输出转成结构化上下文快照（目标 / 进度 / 下一步）。ADR 0001 对抗性审核明确了安全前置条件：冻结文本可能携带 token、私钥或以 / 开头的 DSH 命令行，无上限字段则带来账本膨胀与注入面。解析必须不依赖真实 LLM、会话、网络或文件系统即可全量验证。

## Decision

`packages/dsh-task-board/src/core/freeze-snapshot.ts` 是纯函数模块（工单 #3）。`parseFreezeRequest` 先抽取系统提示约定的 `<<<FREEZE ... >>>FREEZE` 块，要求 `目标:` / `进度:` / `下一步:` 三段齐全（重复或缺段是结构错误），再依次通过三道安全门：

- **脱敏**：PEM 私钥块、Bearer 凭据与常见 token 形态（OpenAI `sk-`、GitHub `ghp_`、GitLab `glpat-`、Slack `xox*`、AWS `AKIA`）一律塌缩为 `[REDACTED]`；任一命中置 `redacted` 警告。脱敏有损但不阻断冻结。
- **污点**：任一字段存在首个非空白字符为 `/` 的行即整体拒绝（`dsh-command-line`），对应 ADR 0001"冻结文本不得携带 DSH 命令行"的规则；非行首斜杠（如路径 `a/b/c`）不受影响。
- **尺寸**：每个字段按 UTF-8 字节数计不超过 8 KiB（`field-too-large`）；上限常量导出为 `FREEZE_FIELD_BYTE_LIMIT`。

失败一律返回可辨识联合 `{ ok: false, error: { code, message } }`；成功携带 `{ snapshot, warnings }`。辅助门（`redactSensitive`、`hasSlashCommandLines`）一并导出，供后续 Host 冻结写入路径复用。

## Alternatives considered

- **正则预筛加 LLM 辅助抽取** — 否决：工单 #3 要求不依赖真实 LLM 即可全量测试；确定性解析器可穷举测试且无隐藏失败模式。
- **对斜杠命令行做消毒而非拒绝** — 否决：ADR 0001 明确冻结文本不得携带 `/` 开头的 DSH 命令；静默剥离会让被污染的冻结看起来干净。
- **整体请求尺寸上限而非按字段** — 否决：一个 20 KiB 字段配两个空字段可整体通过却仍膨胀单一快照字段；按字段上限约束每张卡片最坏携带量。

## Consequences

- 解析器模块不触碰会话、网络或文件系统 API；其规格（`tests/freeze-snapshot.spec.ts`，19 例）在任何 vitest 环境可跑。
- 精确线格式（块标记、中文段标题）自此成为系统提示契约；后续变更对在途会话是破坏性变更，冻结写入路径落地时需引入版本标记。
- 敏感模式覆盖是按清单拒绝而非保证：新型密钥形态会漏过。`redacted} 警告的存在让下游复核者可以标记可疑冻结；扩充模式清单是增量操作。
- 每段末尾的空行被修剪；内部空行与缩进原样保留。

## Testing

`pnpm --filter @linxin666/dsh-client-ui-task-board test` 19 例覆盖解析正向路径、结构错误、各脱敏家族、按字段拒绝斜杠命令行（含行首空白斜杠与原型名正文行回归）与字节上限边界（恰好等于上限通过、8193 字节 CJK 字段失败）。规格按工单验收标准为纯函数测试。
